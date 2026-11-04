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
const types = {'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png'};
const hash = value => createHash('sha256').update(value).digest();
async function start({request, password, port = 8080, host = '0.0.0.0', onPresence = () => {}}) {
  if (!password || password.length < 16) throw Error('Set SPICYSWIPE_PASSWORD to at least 16 characters.');
  const auth = hash('Basic ' + Buffer.from('spicy:' + password).toString('base64'));
  const clients = new Set();
  const root = path.resolve(__dirname, '..');
  const template = await fs.readFile(path.join(root,'desktop/index.html'),'utf8');
  const html = template.replace("connect-src 'none'", "connect-src 'self'")
    .replace('<title>', '<base href="/desktop/"><title>')
    .replace("base-uri 'none'", "base-uri 'self'")
    .replace('>DESKTOP<','>WEB<')
    .replace('</head>', '<link rel="stylesheet" href="/web/client.css"></head>')
    .replace('<script src="../shared/core.js">','<script src="/web/client.js"></script><script src="../shared/core.js">');
  const server = http.createServer(async (req,res) => {
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Frame-Options','DENY');
    res.setHeader('X-Content-Type-Options','nosniff');
    if (!timingSafeEqual(auth,hash(req.headers.authorization || ''))) {
      res.writeHead(401,{'WWW-Authenticate':'Basic realm="SpicySwipe"'}).end(); return;
    }
    try {
      if (req.method === 'POST' && req.url === '/api/request') {
        if (req.headers['content-type'] !== 'application/json' || req.headers['sec-fetch-site'] === 'cross-site') {
          res.writeHead(403).end(); return;
        }
        const chunks = []; let size = 0;
        for await (const chunk of req) {
          if ((size += chunk.length) > 65536) {res.writeHead(413).end(); return;}
          chunks.push(chunk);
        }
        const {action,data = {}} = JSON.parse(Buffer.concat(chunks));
        if (typeof action !== 'string' || !data || typeof data !== 'object' || Array.isArray(data)) throw Error('Invalid request.');
        const result = await request(action,data);
        res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({result}));
      } else if (req.method === 'GET' && req.url === '/api/events') {
        res.writeHead(200,{'Content-Type':'text/event-stream','X-Accel-Buffering':'no'});
        res.write(': connected\n\n'); clients.add(res); onPresence(true);
        const timer = setInterval(()=>res.write(': heartbeat\n\n'),20000);
        res.on('close',()=>{clearInterval(timer); clients.delete(res); if (!clients.size) onPresence(false);});
      } else if (req.method === 'GET' && req.url === '/') {
        res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}).end(html);
      } else if (req.method === 'GET' && assets.has(req.url.slice(1))) {
        const file = req.url.slice(1);
        const body = await fs.readFile(path.join(root,file));
        res.writeHead(200,{'Content-Type':types[path.extname(file)]}).end(body);
      } else res.writeHead(404).end();
    } catch (e) {res.writeHead(400,{'Content-Type':'application/json'}).end(JSON.stringify({error:e.message}));}
  });
  await new Promise((resolve,reject)=>server.once('error',reject).listen(port,host,resolve));
  return {server, emit(event){for(const client of clients)client.write('data: '+JSON.stringify(event)+'\n\n');}};
}
module.exports = {start, credentialStore};
