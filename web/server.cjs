'use strict';
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, timingSafeEqual, createCipheriv, createDecipheriv, randomBytes } = require('node:crypto');

function credentialStore(hex) {
  if (!/^[0-9a-f]{64}$/i.test(hex || '')) throw Error('Set SPICYSWIPE_STORAGE_KEY to 32 random bytes in hex.');
  const key = Buffer.from(hex, 'hex');
  return {
    isEncryptionAvailable: () => true,
    encryptString(value) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), body]);
    },
    decryptString(blob) {
      const cipher = createDecipheriv('aes-256-gcm', key, blob.subarray(0, 12));
      cipher.setAuthTag(blob.subarray(12, 28));
      return Buffer.concat([cipher.update(blob.subarray(28)), cipher.final()]).toString();
    }
  };
}

const assets = new Set(('desktop/styles.css desktop/mobile-automation.css desktop/mobile-automation.js desktop/android-controls.js desktop/renderer.js shared/core.js ui/icons.js ui/workspace.js ui/styles.css assets/icon48.png web/client.js web/client.css').split(' '));
const types = {'.html':'text/html; charset=utf-8','.js':'application/javascript','.css':'text/css','.png':'image/png'};
const hash = value => createHash('sha256').update(value).digest();
const sessionCookie = 'spicyswipe_session';
const sessionLifetime = 12 * 60 * 60 * 1000;
const loginWindow = 60 * 1000;
const maxFailures = 10;

function getSessionToken(req) {
  return (req.headers.cookie || '').split(';').map(value => value.trim())
    .find(value => value.startsWith(sessionCookie + '='))?.slice(sessionCookie.length + 1);
}

function permittedPost(req) {
  if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') return false;
  const site = req.headers['sec-fetch-site'];
  if (site) return site === 'same-origin' || site === 'none';
  if (!req.headers.origin) return true; // Non-browser API client.
  try { return new URL(req.headers.origin).host === req.headers.host; }
  catch { return false; }
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 65536) throw Object.assign(Error('Request too large.'), {status:413});
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks)); }
  catch { throw Error('Invalid JSON.'); }
}

function json(res, status, body) {
  res.writeHead(status, {'Content-Type':'application/json'}).end(JSON.stringify(body));
}

async function start({request, password, port = 8080, host = '0.0.0.0', onPresence = () => {}}) {
  if (!password || password.length < 16) throw Error('Set SPICYSWIPE_PASSWORD to at least 16 characters.');
  const expected = hash(password);
  const sessions = new Map();
  const clients = new Set();
  const failures = new Map();
  const root = path.resolve(__dirname, '..');
  const template = await fs.readFile(path.join(root,'desktop/index.html'),'utf8');
  const html = template.replace("connect-src 'none'", "connect-src 'self'")
    .replace('<title>', '<base href="/desktop/"><title>')
    .replace("base-uri 'none'", "base-uri 'self'")
    .replace('>DESKTOP<','>WEB<')
    .replace('</head>', '<link rel="stylesheet" href="/web/client.css"></head>')
    .replace('<script src="../shared/core.js">','<script src="/web/client.js"></script><script src="../shared/core.js">');

  function revoke(token) {
    const session = sessions.get(token);
    if (!session) return;
    clearTimeout(session.timer);
    sessions.delete(token);
    for (const res of session.streams) res.end('event: signed-out\ndata: {}\n\n');
  }

  function cookie(req, token, age) {
    // Browsers supply an HTTPS Origin to the login POST behind TLS termination.
    const secure = req.socket.encrypted || req.headers.origin?.startsWith('https://') || req.headers['x-forwarded-proto'] === 'https';
    return sessionCookie + '=' + token + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' + age + (secure ? '; Secure' : '');
  }

  function signIn(req,res,attempt,previousToken) {
    const peer = req.socket.remoteAddress;
    const now = Date.now();
    let recent = failures.get(peer);
    if (recent && recent.until <= now) {failures.delete(peer); recent = undefined;}
    if (recent && recent.count >= maxFailures) {
      res.setHeader('Retry-After', String(Math.ceil((recent.until-now)/1000)));
      return json(res,429,{error:'Too many attempts. Try again in a minute.'});
    }
    if (typeof attempt?.password !== 'string' || !timingSafeEqual(expected,hash(attempt.password))) {
      if (!recent) {
        recent = {count:0,until:now + loginWindow};
        failures.set(peer,recent);
      }
      recent.count++;
      return json(res,401,{error:'That password didn’t match. Try again.'});
    }
    failures.delete(peer);
    revoke(previousToken);
    if (sessions.size >= 32) revoke(sessions.keys().next().value);
    const token = randomBytes(32).toString('hex');
    const timer = setTimeout(() => revoke(token),sessionLifetime).unref();
    sessions.set(token,{timer,expires:now + sessionLifetime,streams:new Set()});
    res.setHeader('Set-Cookie',cookie(req,token,sessionLifetime / 1000));
    return json(res,200,{ok:true});
  }

  async function serveAsset(file,res) {
    const body = await fs.readFile(path.join(root,file));
    res.writeHead(200,{'Content-Type':types[path.extname(file)]}).end(body);
  }

  const server = http.createServer(async (req,res) => {
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Frame-Options','DENY');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','same-origin');
    const token = getSessionToken(req);
    if (sessions.get(token)?.expires <= Date.now()) revoke(token);
    const session = sessions.get(token);
    try {
      if (req.method === 'POST' && !permittedPost(req)) return json(res,403,{error:'Same-origin JSON request required.'});
      if (req.method === 'POST' && req.url === '/api/login') return signIn(req,res,await readJson(req),token);
      if (req.method === 'GET' && (req.url === '/' || req.url === '/login')) {
        if (session && req.url === '/login') return res.writeHead(303,{Location:'/'}).end();
        if (!session) {
          res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
          return await serveAsset('web/login.html',res);
        }
        return res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}).end(html);
      }
      if (req.method === 'GET' && ['/web/login.css','/web/login.js'].includes(req.url)) return await serveAsset(req.url.slice(1),res);
      if (!session) return json(res,401,{error:'Sign in to your workspace.'});
      if (req.method === 'POST' && req.url === '/api/logout') {
        revoke(token);
        res.setHeader('Set-Cookie',cookie(req,'',0));
        return json(res,200,{ok:true});
      }
      if (req.method === 'POST' && req.url === '/api/request') {
        const {action,data = {}} = await readJson(req);
        if (!sessions.has(token)) return json(res,401,{error:'Sign in to your workspace.'});
        if (typeof action !== 'string' || !data || typeof data !== 'object' || Array.isArray(data)) throw Error('Invalid request.');
        return json(res,200,{result:await request(action,data)});
      }
      if (req.method === 'GET' && req.url === '/api/events') {
        res.writeHead(200,{'Content-Type':'text/event-stream','X-Accel-Buffering':'no'});
        res.write(': connected\n\n'); clients.add(res); session.streams.add(res); onPresence(true);
        const timer = setInterval(()=>res.write(': heartbeat\n\n'),20000);
        res.on('close',()=>{clearInterval(timer); clients.delete(res); session.streams.delete(res); if (!clients.size) onPresence(false);});
        return;
      }
      if (req.method === 'GET' && assets.has(req.url.slice(1))) return await serveAsset(req.url.slice(1),res);
      res.writeHead(404).end();
    } catch (e) {json(res,e.status || 400,{error:e.message});}
  });
  const cleanup = setInterval(()=>{
    for(const [peer,recent] of failures) if(recent.until <= Date.now())failures.delete(peer);
  },loginWindow).unref();
  server.on('close',()=>{clearInterval(cleanup);for(const token of sessions.keys())revoke(token);});
  await new Promise((resolve,reject)=>server.once('error',reject).listen(port,host,resolve));
  return {server, emit(event){for(const client of clients)if(!client.writableEnded)client.write('data: '+JSON.stringify(event)+'\n\n');}};
}
module.exports = {start, credentialStore};
