const test = require('node:test');
const assert = require('node:assert/strict');
const {start,credentialStore} = require('../web/server.cjs');
const password = 'example-only-test-password';
async function fixture(t) {
  let called = 0;
  const {server} = await start({password,host:'127.0.0.1',port:0,request:async()=>++called});
  t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
  const base = 'http://127.0.0.1:'+server.address().port;
  return {
    get: (path,opts={}) => fetch(base+path,{redirect:'manual',...opts}),
    post: (path,body,headers={}) => fetch(base+path,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)})
  };
}
test('a fresh browser sees the sign-in page; API calls and private files require a session',async t=>{
  const {get,post} = await fixture(t);
  const entry = await get('/');
  assert.equal(entry.status,200);
  assert.equal(entry.headers.has('www-authenticate'),false);
  assert.match(await entry.text(),/type=["']password["']/i);
  for (const file of ['/web/login.css','/web/login.js']) assert.equal((await get(file)).status,200);
  assert.equal((await get('/web/client.js')).status,401);
  assert.equal((await get('/api/events')).status,401);
  assert.equal((await post('/api/request',{action:'info'})).status,401);
  const fail = await post('/api/login',{password:'incorrect'});
  assert.equal(fail.status,401);
  assert.equal(fail.headers.has('set-cookie'),false);
});
test('sign-in issues a cookie, gates commands, and sign-out revokes the active event stream', async t=>{
  const {get,post} = await fixture(t);
  const login = await post('/api/login',{password},{origin:'https://workspace.test','sec-fetch-site':'same-origin'});
  assert.equal(login.status,200);
  const setCookie = login.headers.get('set-cookie');
  for (const attr of ['HttpOnly','SameSite=Strict','Secure','Max-Age='])assert.ok(setCookie.includes(attr));
  const headers = {cookie:setCookie.split(';')[0]};
  assert.match(await (await get('/',{headers})).text(),/web\/client.js/);
  const redirect = await get('/login',{headers});
  assert.equal(redirect.status,303);
  assert.equal(redirect.headers.get('location'),'/');
  assert.equal((await get('/desktop/main.cjs',{headers})).status,404);
  const stream = await get('/api/events',{headers});
  assert.equal(stream.status,200);
  assert.equal((await post('/api/request',{action:'info'},{...headers,'sec-fetch-site':'same-site'})).status,403);
  assert.equal((await post('/api/request',{action:'info'},{...headers,origin:'https://unrelated.example'})).status,403);
  assert.deepEqual(await (await post('/api/request',{action:'info'},headers)).json(),{result:1});
  assert.equal((await post('/api/logout',{},headers)).status,200);
  assert.match(await stream.text(),/event: signed-out/);
  assert.equal((await post('/api/request',{action:'info'},headers)).status,401);
});
test('repeated invalid passwords are throttled and foreign sign-in requests are refused', async t=>{
  const {post}=await fixture(t);
  assert.equal((await post('/api/login',{password},{'sec-fetch-site':'cross-site'})).status,403);
  for(let i=0;i<10;i++) assert.equal((await post('/api/login',{password:'incorrect'})).status,401);
  const limited=await post('/api/login',{password});
  assert.equal(limited.status,429);
  assert.ok(Number(limited.headers.get('retry-after'))>0);
});
test('encrypted provider keys survive restart and reject tampering',()=>{
  const key='12'.repeat(32);
  const bytes=credentialStore(key).encryptString('provider-key');
  assert.equal(credentialStore(key).decryptString(bytes),'provider-key');
  bytes[bytes.length-1]^=1;
  assert.throws(()=>credentialStore(key).decryptString(bytes));
});
