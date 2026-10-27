const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');const C=require('../shared/core');const {webcrypto}=require('node:crypto');
function setup(initial={},access=true){
 let data=structuredClone(initial),listener,installed;const callbacks=[];
 const chrome={permissions:{contains:async()=>access},runtime:{id:'test-extension',getURL:p=>'chrome-extension://test-extension/'+p,onConnect:{addListener:()=>{}},onMessage:{addListener:fn=>listener=fn},onInstalled:{addListener:fn=>installed=fn},onStartup:{addListener:()=>{}}},storage:{local:{get:async()=>structuredClone(data),set:async v=>{data={...data,...structuredClone(v)}}}},tabs:{query:async()=>[]}};
 const sandbox={chrome,SSCore:C,SSAI:{generate:async()=>({response:'Hi',modelUsed:'mock',provider:'gemini'}),listModels:async s=>[{id:s.activeAI+':'+s.ollamaUrl}]},importScripts:()=>{},crypto:webcrypto,console,URL};vm.createContext(sandbox);vm.runInContext(fs.readFileSync('background.js','utf8'),sandbox);
 const request=(action,value,sender={id:'test-extension',url:'chrome-extension://test-extension/ui/dashboard.html'})=>new Promise(resolve=>listener({type:'ss:request',action,data:value},sender,resolve));
 return {request,installed,read:()=>data};
}
test('installation/update preserves consent, keys, provider and totals',async()=>{const x=setup({activeAI:'claude',anthropicApiKey:'test-secret',sidebarConsentGiven:true,allTimeAnalytics:{swipes:23}});await x.installed();const s=x.read();assert.equal(s.sidebarConsentGiven,true);assert.equal(s.anthropicApiKey,'test-secret');assert.equal(s.activeAI,'claude');assert.equal(s.allTimeAnalytics.swipes,23)});
test('public settings never return provider credentials',async()=>{const x=setup({openaiApiKey:'secret-a',geminiProApiKey:'secret-b'});const res=await x.request('load');assert.ok(!JSON.stringify(res).includes('secret-'));assert.equal(res.data.credentials.chatgpt,true)});
test('unrelated senders cannot request generation',async()=>{const x=setup();assert.equal((await x.request('generate',{}, {id:'other'})).error,'Unauthorized sender.')});
test('concurrent activity events increment rather than overwrite counters',async()=>{const x=setup();const sender={id:'test-extension',tab:{id:1},url:'https://tinder.com/app/recs'};await Promise.all([x.request('record',{kind:'like'},sender),x.request('record',{kind:'pass'},sender)]);assert.equal(x.read().allTimeAnalytics.swipes,2);assert.equal(x.read().activity.length,2)});
test('content scripts cannot save credentials through settings RPC',async()=>{const x=setup();const result=await x.request('save',{openaiApiKey:'page-key'},{id:'test-extension',tab:{id:1},url:'https://tinder.com/app/recs'});assert.match(result.error||'',/workspace|credential/i);assert.equal(x.read().openaiApiKey,undefined)});

test('Ollama discovery uses an unsaved LAN endpoint without switching the active provider',async()=>{
 const x=setup({activeAI:'gemini'});const result=await x.request('models',{provider:'ollama',ollamaUrl:'http://192.168.1.50:8080'});
 assert.equal(result.data.models[0].id,'ollama:http://192.168.1.50:8080');assert.equal(x.read().activeAI,'gemini');
});
test('ungranted Ollama hosts cannot be queried or used for drafts',async()=>{
 const x=setup({activeAI:'ollama',ollamaUrl:'http://192.168.1.50:8080',sidebarConsentGiven:true},false);
 for(const action of ['models','generate'])assert.match((await x.request(action,{})).error||'',/server access/i);
});
