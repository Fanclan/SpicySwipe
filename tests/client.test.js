const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');const C=require('../shared/core');
test('LAN authorization requests only the selected host synchronously and reports denial',async()=>{
 let requested;const sandbox={SSCore:C,chrome:{permissions:{request:options=>{requested=options;return Promise.resolve(false)}}}};vm.createContext(sandbox);vm.runInContext(fs.readFileSync('shared/client.js','utf8'),sandbox);
 assert.equal(typeof sandbox.SSClient.authorizeOllama,'function');const pending=sandbox.SSClient.authorizeOllama('http://192.168.1.50:8080');assert.equal(requested.origins[0],'http://192.168.1.50/*');await assert.rejects(pending,/access.*not granted/i);
});
