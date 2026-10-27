const { test }=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const core=require('../shared/core');
const ai=fs.existsSync('shared/ai.js')?require('../shared/ai'):{};
function settings(provider){return core.migrate({activeAI:provider,[core.providers[provider].key]:'test-key',models:{[provider]:'chosen-model'}})}
const response=(body,status=200)=>({ok:status<400,status,json:async()=>body});
test('OpenAI uses selected model, Responses output and no unsupported temperature',async()=>{
 assert.equal(typeof ai.generate,'function'); let request;
 const result=await ai.generate(settings('chatgpt'),'hello',async(url,init)=>{request={url,...init};return response({output:[{type:'reasoning'},{type:'message',content:[{type:'output_text',text:'Hi there'}]}]})});
 assert.match(request.url,/\/v1\/responses$/);const body=JSON.parse(request.body);
 assert.equal(body.model,'chosen-model');assert.equal(body.store,false);assert.equal(body.temperature,undefined);assert.equal(result.response,'Hi there');assert.equal(result.modelUsed,'chosen-model');
});
test('all providers send authentication correctly and parse text',async()=>{
 assert.equal(typeof ai.generate,'function');
 const fixtures={gemini:{candidates:[{content:{parts:[{text:'thinking',thought:true},{text:'Hi'}]}}]},claude:{content:[{type:'text',text:'Hi'}]},deepseek:{choices:[{message:{content:'Hi'}}]},ollama:{message:{content:'Hi'}}};
 for(const [provider,body] of Object.entries(fixtures)){
  const result=await ai.generate(settings(provider),'hello',async(url,init)=>{
   assert.ok(init.signal);const data=JSON.parse(init.body);assert.ok(data.system || data.systemInstruction || data.messages);
   if(provider==='gemini'){assert.equal(init.headers['x-goog-api-key'],'test-key');assert.ok(!url.includes('test-key'))}
   if(provider==='claude') assert.equal(init.headers['anthropic-dangerous-direct-browser-access'],'true');
   return response(body);
  });assert.equal(result.response,'Hi');
 }
});
test('missing key, empty output and quota failures never fall back',async()=>{
 assert.equal(typeof ai.generate,'function');
 await assert.rejects(ai.generate(core.migrate({activeAI:'claude'}),'hi',()=>assert.fail('must not fetch')),/API key/);
 await assert.rejects(ai.generate(settings('chatgpt'),'hi',async()=>response({output:[]})),/empty|text/i);
 let calls=0;await assert.rejects(ai.generate(settings('gemini'),'hi',async()=>{calls++;return response({},429)}),/quota|rate/i);assert.equal(calls,1);
});
test('model discovery filters non-text models and follows Gemini pages',async()=>{
 assert.equal(typeof ai.listModels,'function');let calls=0;
 const result=await ai.listModels(settings('gemini'),async()=>response(++calls===1?{models:[{name:'models/gemini-flash',supportedGenerationMethods:['generateContent']},{name:'models/gemini-image',supportedGenerationMethods:['generateContent']}],nextPageToken:'next'}:{models:[{name:'models/gemini-pro',supportedGenerationMethods:['generateContent']},{name:'models/embedding',supportedGenerationMethods:['embedContent']}]}));
 assert.deepEqual(result.map(m=>m.id),['gemini-flash','gemini-pro']);assert.equal(calls,2);
});

test('LAN Ollama discovers exact installed IDs and generates against the configured server',async()=>{
 const s={...settings('ollama'),ollamaUrl:'http://192.168.1.50:8080',models:{ollama:'my-live-chat:latest'}};
 const models=await ai.listModels(s,async(url,init)=>{assert.equal(url,'http://192.168.1.50:8080/api/tags');assert.equal(init.headers.Authorization,undefined);return response({models:[{name:'my-live-chat:latest'},{name:'qwen3:8b'}]})});
 assert.deepEqual(models.map(m=>m.id),['my-live-chat:latest','qwen3:8b']);
 const draft=await ai.generate(s,'hello',async(url,init)=>{assert.equal(url,'http://192.168.1.50:8080/api/chat');assert.equal(JSON.parse(init.body).model,'my-live-chat:latest');return response({message:{content:'Hello'}})});assert.equal(draft.response,'Hello');
});
