const test = require('node:test');
const assert = require('node:assert/strict');
const {start,credentialStore} = require('../web/server.cjs');
test('web workspace authenticates assets and commands and refuses cross-site writes', async t=>{
  const password = 'example-only-test-password';
  let called = 0;
  const {server} = await start({password,host:'127.0.0.1',port:0,request:async()=>++called});
  t.after(()=>server.close());
  const base = 'http://127.0.0.1:'+server.address().port;
  const headers = {authorization:'Basic '+Buffer.from('spicy:'+password).toString('base64'),'content-type':'application/json'};
  assert.equal((await fetch(base+'/')).status,401);
  assert.match(await (await fetch(base+'/',{headers})).text(),/web\/client.js/);
  assert.equal((await fetch(base+'/desktop/main.cjs',{headers})).status,404);
  const call = {method:'POST',headers,body:JSON.stringify({action:'info'})};
  assert.equal((await fetch(base+'/api/request',{...call,headers:{...headers,'sec-fetch-site':'cross-site'}})).status,403);
  assert.deepEqual(await (await fetch(base+'/api/request',call)).json(),{result:1});
});
test('encrypted provider keys survive restart and reject tampering',()=>{
  const key='12'.repeat(32);
  const bytes=credentialStore(key).encryptString('provider-key');
  assert.equal(credentialStore(key).decryptString(bytes),'provider-key');
  bytes[bytes.length-1]^=1;
  assert.throws(()=>credentialStore(key).decryptString(bytes));
});
