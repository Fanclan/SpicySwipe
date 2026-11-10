const {test}=require('node:test');const assert=require('node:assert/strict');const {JSDOM}=require('jsdom');const fs=require('node:fs');const C=require('../shared/core');
const tick=()=>new Promise(r=>setImmediate(r));
async function setup(t,{compact=false,initial={},web=false}={}){
 const dom=new JSDOM('<div id="root"></div>',{url:'https://extension.test/',runScripts:'outside-only'});t.after(()=>dom.window.close());
 for(const file of ['shared/core.js','ui/icons.js','ui/workspace.js'])dom.window.eval(fs.readFileSync(file,'utf8'));
 let state=C.publicSettings(C.migrate({sidebarConsentGiven:true,hasCompletedOnboarding:true,...initial}));
 let context={conversationId:'A',name:'A',canMessage:true};const sent=[],pageActions=[],pageCalls=[];let pageHandler,pendingGenerate=async()=>({response:'Draft for A',modelUsed:'test',durationMs:100}),pendingModels=async()=>({models:[],message:'Okay'});let subscriber;
 const bridge={compact,load:async()=>state,save:async p=>{state={...state,...p};subscriber?.({type:'settings',data:state});return state},subscribe:fn=>{subscriber=fn;return()=>{}},authorizeOllama:async()=>true,request:async(action,payload)=>action==='generate'?pendingGenerate():pendingModels(payload),page:async(action,data)=>{pageActions.push(action);pageCalls.push({action,data});if(pageHandler)return pageHandler(action,data);if(action==='send'){sent.push(data);if(data.conversationId!==context.conversationId)throw new Error('Conversation changed');return {ok:true}}return {connected:true,context,session:{status:'idle',count:0,limit:30}}}};
 bridge.web=web;
 const root=dom.window.document.getElementById('root'),app=await dom.window.SSWorkspace.mount(root,bridge);t.after(()=>app.destroy());
 const click=async selector=>{root.querySelector(selector).click();await tick();await tick()};
 return {root,app,click,sent,pageActions,pageCalls,setPage:fn=>pageHandler=fn,updatePage:data=>subscriber({type:'page',data}),read:()=>state,changeContext:c=>context=c,setGenerate:fn=>pendingGenerate=fn,setModels:fn=>pendingModels=fn,update:p=>subscriber({type:'settings',data:{...state,...p}}),updateSession:session=>subscriber({type:'page',data:{connected:true,context,session}})};
}
test('failed regeneration cannot rebind an existing draft to another match',async t=>{
 const x=await setup(t);x.app.navigate('messages');await x.click('[data-action="generate"]');
 assert.equal(x.root.querySelector('#draft-text').value,'Draft for A');
 x.changeContext({conversationId:'B',name:'B',canMessage:true});x.setGenerate(async()=>{throw new Error('quota')});await x.click('[data-action="generate"]');await x.click('[data-action="send"]');
 assert.ok(x.sent.every(d=>d.conversationId!=='B'),'A draft must never be sent with B identity');
});
test('context refresh during generation discards the stale response',async t=>{
 const x=await setup(t);x.app.navigate('messages');await x.click('[data-action="refreshContext"]');let resolve;
 x.setGenerate(()=>new Promise(r=>resolve=r));await x.click('[data-action="generate"]');x.changeContext({conversationId:'B',name:'B',canMessage:true});await x.click('[data-action="refreshContext"]');resolve({response:'For A',modelUsed:'test',durationMs:1});await tick();await tick();
 assert.equal(x.root.querySelector('#draft-text').value,'');
});
test('provider switches ignore an earlier model-discovery result',async t=>{
 const x=await setup(t);x.app.navigate('settings');let resolve;x.setModels(payload=>payload?.provider==='ollama'?Promise.resolve({models:[],message:'Empty'}):new Promise(r=>resolve=r));await x.click('[data-action="models"]');await x.click('[data-provider="ollama"]');resolve({models:[{id:'gemini-only',name:'Gemini'}],message:'Connected'});await tick();await tick();
 assert.equal(x.root.querySelector('[name="model"]').value,'');assert.equal(x.root.querySelector('#model-options').children.length,0);
});
test('sidebar never renders credential input in the host page',async t=>{
 const x=await setup(t,{compact:true});x.app.navigate('settings');assert.equal(x.root.querySelector('input[type="password"]'),null);assert.ok(x.root.querySelector('[data-action="dashboard"]'));
});
test('unrelated activity updates preserve edits in composer',async t=>{
 const x=await setup(t);x.app.navigate('messages');const field=x.root.querySelector('#draft-text');field.value='My edited draft';field.dispatchEvent(new field.ownerDocument.defaultView.Event('input',{bubbles:true}));x.update({activity:[{kind:'like',time:Date.now(),detail:'Like'}]});assert.equal(x.root.querySelector('#draft-text').value,'My edited draft');
});

test('selecting Ollama automatically discovers models without activating it or replacing a saved choice',async t=>{
 const x=await setup(t,{initial:{models:{ollama:'chosen:8b'},ollamaUrl:'http://ollama.local:11434'}});x.app.navigate('settings');
 x.setModels(async payload=>{assert.equal(payload.provider,'ollama');assert.equal(payload.ollamaUrl,'http://ollama.local:11434');return {models:[{id:'first:4b',name:'First'},{id:'chosen:8b',name:'Chosen'}],message:'Found 2 models'}});
 await x.click('[data-provider="ollama"]');assert.equal(x.root.querySelector('[name="model"]').value,'chosen:8b');assert.equal(x.root.querySelector('#model-options').children.length,2);assert.equal(x.read().activeAI,'gemini');
});
test('saving a LAN connection discovers models and persists the first when no model was chosen',async t=>{
 const x=await setup(t);x.app.navigate('settings');await x.click('[data-provider="ollama"]');
 const url=x.root.querySelector('[name="ollamaUrl"]');url.value='http://192.168.1.50:11434';url.dispatchEvent(new url.ownerDocument.defaultView.Event('input',{bubbles:true}));
 x.setModels(async()=>({models:[{id:'qwen3:8b',name:'Qwen'}],message:'Found 1 model'}));await x.click('[data-action="saveConnection"]');
 assert.equal(x.read().ollamaUrl,'http://192.168.1.50:11434');assert.equal(x.read().models.ollama,'qwen3:8b');
});
test('editing the server URL discards pending discovery results',async t=>{
 const x=await setup(t);x.app.navigate('settings');let resolve;x.setModels(()=>new Promise(r=>resolve=r));await x.click('[data-provider="ollama"]');
 const url=x.root.querySelector('[name="ollamaUrl"]');url.value='http://new-server:11434';url.dispatchEvent(new url.ownerDocument.defaultView.Event('input',{bubbles:true}));
 assert.equal(typeof resolve,'function');resolve({models:[{id:'old-server-model',name:'Old'}],message:'Old server'});await tick();await tick();
 assert.equal(x.root.querySelector('#model-options').children.length,0);assert.equal(x.root.querySelector('[name="model"]').value,'');
});
test('reopening saved Ollama settings discovers models and shows empty and offline states',async t=>{
 const x=await setup(t,{initial:{activeAI:'ollama'}});x.setModels(async()=>({models:[],message:'Connected, but no models are installed.'}));x.app.navigate('settings');await tick();await tick();
 assert.match(x.root.querySelector('#connection-result').textContent,/no models/);assert.equal(x.root.querySelector('#installed-models').disabled,true);
 x.app.navigate('overview');x.setModels(async()=>{throw new Error('Server offline')});x.app.navigate('settings');await tick();await tick();
 assert.equal(x.root.querySelector('#connection-result').textContent,'Server offline');assert.equal(x.root.querySelector('#connection-result').classList.contains('error'),true);
});
test('changing the theme keeps discovered Ollama models usable',async t=>{
 const x=await setup(t,{initial:{activeAI:'ollama'}});x.setModels(async()=>({models:[{id:'qwen3:8b',name:'Qwen'}],message:'Found 1 model'}));x.app.navigate('settings');await tick();await tick();await x.click('[data-action="theme"]');
 assert.equal(x.root.querySelector('#installed-models').disabled,false);assert.equal(x.root.querySelector('#installed-models').options.length,2);
});

test('overnight preset populates a bounded session without starting and saves every pacing option',async t=>{
 const x=await setup(t);x.app.navigate('swiping');assert.ok(x.root.querySelector('[data-action="overnightPreset"]'),'Overnight preset must be available');await x.click('[data-action="overnightPreset"]');
 assert.equal(x.root.querySelector('[name="maxSwipes"]').value,'500');assert.equal(x.root.querySelector('[name="sessionMinutes"]').value,'480');assert.equal(x.root.querySelector('[name="allowBackground"]').checked,true);assert.equal(x.pageActions.includes('start'),false);
 await x.click('[data-action="saveSwiping"]');const c=x.read().swipeConfig;assert.equal(c.randomizeTiming,true);assert.equal(c.minDelaySeconds,15);assert.equal(c.maxDelaySeconds,45);assert.equal(c.maxPhotos,4);assert.equal(c.browsePhotos,true);assert.equal(c.scrollProfile,true);assert.equal(c.breaksEnabled,true);assert.equal(c.breakEvery,25);assert.equal(c.breakMinSeconds,120);assert.equal(c.breakMaxSeconds,300);
});
test('invalid timing ranges prevent a session from starting',async t=>{
 const x=await setup(t);x.app.navigate('swiping');assert.ok(x.root.querySelector('[name="minDelaySeconds"]'));x.root.querySelector('[name="minDelaySeconds"]').value='90';x.root.querySelector('[name="maxDelaySeconds"]').value='10';await x.click('[data-action="start"]');assert.equal(x.pageActions.includes('start'),false);
});
test('web Quick preset preserves the selected background setting',async t=>{
 const x=await setup(t,{web:true});x.app.navigate('swiping');
 const field=x.root.querySelector('[name="allowBackground"]');
 for(const value of [true,false]){
  field.checked=value;
  await x.click('[data-action="quickPreset"]');
  assert.equal(field.checked,value);
 }
});
test('Tinder saves one or both session limits and restores the empty field',async t=>{
 const x=await setup(t,{web:true});
 for(const [profiles,minutes] of [[1000,null],[null,45],[70,20]]){
  x.app.navigate('swiping');
  x.root.querySelector('[name="maxSwipes"]').value=profiles??'';
  x.root.querySelector('[name="sessionMinutes"]').value=minutes??'';
  await x.click('[data-action="start"]');
  assert.equal(x.pageActions.at(-1),'start');
  assert.equal(x.read().swipeConfig.maxSwipes,profiles);
  assert.equal(x.read().swipeConfig.sessionMinutes,minutes);
  x.app.navigate('overview');x.app.navigate('swiping');
  assert.equal(x.root.querySelector('[name="maxSwipes"]').value,String(profiles??''));
  assert.equal(x.root.querySelector('[name="sessionMinutes"]').value,String(minutes??''));
 }
});
test('Tinder rejects two empty limits before save or start and presets restore valid limits',async t=>{
 const x=await setup(t);x.app.navigate('swiping');
 x.root.querySelector('[name="maxSwipes"]').value='';
 x.root.querySelector('[name="sessionMinutes"]').value='';
 for(const action of ['saveSwiping','start']){
  await x.click(`[data-action="${action}"]`);
  assert.match(x.root.querySelector('.toast').textContent,/profile limit.*time limit/i);
  assert.equal(x.pageActions.includes('start'),false);
  assert.ok(x.read().swipeConfig.maxSwipes);
 }
 await x.click('[data-action="quickPreset"]');
 await x.click('[data-action="start"]');
 assert.equal(x.pageActions.at(-1),'start');
});
test('Tinder shows a time-only count without a profile target and a profile-only session without a deadline',async t=>{
 const x=await setup(t);x.app.navigate('swiping');await tick();
 const phase={status:'running',phase:'waiting for profiles',count:17,nextActionAt:Date.now()+300000};
 x.updateSession({...phase,limit:null,endsAt:Date.now()+60000});
 assert.match(x.root.querySelector('.session-progress').textContent,/17\s*profiles/i);
 assert.equal(x.root.querySelector('#session-progress').hidden,true);
 assert.match(x.root.querySelector('#session-deadline').textContent,/Ends at/i);
 x.updateSession({...phase,limit:1000,endsAt:null});
 assert.equal(x.root.querySelector('#session-progress').hidden,false);
 assert.equal(x.root.querySelector('#session-progress').max,1000);
 assert.equal(x.root.querySelector('#session-deadline').textContent,'');
 assert.doesNotMatch(x.root.querySelector('#session-message').textContent,/deadline/i);
});
test('resuming Tinder with an unfinished edit uses the limits of the paused run',async t=>{
 const x=await setup(t);x.app.navigate('swiping');await tick();
 x.updateSession({status:'paused',phase:'paused',limit:1000,count:16,endsAt:null});
 x.root.querySelector('[name="maxSwipes"]').value='';
 x.root.querySelector('[name="sessionMinutes"]').value='';
 await x.click('[data-action="start"]');
 assert.equal(x.pageActions.at(-1),'start');
 assert.ok(x.read().swipeConfig.maxSwipes);
});

const heldId='a'.repeat(32);
function handed(stage='held',session={},details={}){
 const source={version:1,runId:heldId,count:250,limit:1000,endsAt:null};
 return {connected:true,context:{page:'/app/recs'},session:{status:'held',count:250,limit:1000,endsAt:null,runId:heldId,...session},
  tinderHandoff:{stage,source,minimumOnly:false,rendererSession:{status:'idle',phase:'idle',runId:null,count:0,endsAt:null},...details}};
}
async function heldWorkspace(t){
 const x=await setup(t,{web:true});const snap=handed();x.setPage(async()=>snap);
 x.app.navigate('swiping');await tick();x.updatePage(snap);return x;
}
test('held Tinder exposes its original count, remaining Likes, uncertain delivery and no deadline',async t=>{
 const x=await heldWorkspace(t);const q=s=>x.root.querySelector(s);
 assert.equal(q('#session-count').textContent,'250');assert.equal(q('#session-progress').max,1000);
 assert.match(q('#session-message').textContent,/confirm.*last Like/i);
 assert.match(q('#session-deadline').textContent,/750.*no time limit/i);
 for(const name of ['start','pause','stop'])assert.equal(q('[data-action="'+name+'"]').disabled,true);
 assert.equal(q('[data-action="reviewHeld"]').hidden,false);
});
test('Tinder recovery requires explicit confirmation tied to the source budget and leaves form settings alone',async t=>{
 const x=await heldWorkspace(t);
 const original=JSON.stringify(x.read().swipeConfig);
 await x.click('[data-action="reviewHeld"]');
 assert.equal(x.pageActions.includes('continueHeld'),false);
 const modal=x.root.querySelector('[role="dialog"]');assert.match(modal.textContent,/first Like.*repeat/i);assert.match(modal.textContent,/750/);
 await x.click('[data-action="dismiss"]');assert.equal(x.pageActions.includes('continueHeld'),false);
 await x.click('[data-action="reviewHeld"]');await x.click('[data-action="confirmHeld"]');
 const calls=x.pageCalls.filter(c=>c.action==='continueHeld');assert.equal(calls.length,1);
 assert.deepEqual(JSON.parse(JSON.stringify(calls[0].data)),{sourceRunId:heldId,sourceCount:250,remaining:750,acceptPossibleRepeat:true});
 assert.equal(x.pageActions.includes('start'),false);assert.equal(JSON.stringify(x.read().swipeConfig),original);
});
test('a changed Tinder source, lost connection or closed review invalidates a pending confirmation',async t=>{
 const x=await heldWorkspace(t);const snap=handed();
 for(const next of [handed('dispatching'),handed('held',{}, {source:{...snap.tinderHandoff.source,runId:'b'.repeat(32)}}),{...snap,connected:false}]){
  x.updatePage(snap);await x.click('[data-action="reviewHeld"]');
  const confirm=x.root.querySelector('[data-action="confirmHeld"]');x.updatePage(next);confirm.click();await tick();
  assert.equal(x.root.querySelector('.modal-layer').hidden,true);
 }
 assert.equal(x.pageActions.includes('continueHeld'),false);
});
test('an unconfirmed dispatch shows a lower bound, suppresses a fresh Start, and an invalid hold shows no invented count',async t=>{
 const x=await heldWorkspace(t),q=s=>x.root.querySelector(s);
 x.updatePage(handed('dispatching',{}, {minimumOnly:true}));
 assert.match(q('.session-progress').textContent,/at least 250/i);
 assert.doesNotMatch(q('#session-deadline').textContent,/750.*remaining/i);
 assert.equal(q('[data-action="start"]').disabled,true);assert.equal(q('[data-action="reviewHeld"]').hidden,true);
 x.updatePage(handed('invalid',{count:null,limit:null},{source:null,rendererSession:null,minimumOnly:true}));
 assert.equal(q('#session-progress').hidden,true);assert.doesNotMatch(q('#session-count').textContent,/^0$/);
 assert.equal(q('[data-action="start"]').disabled,true);
});
test('an acknowledged Tinder run uses its cumulative count and can resume only the live paused segment',async t=>{
 const x=await heldWorkspace(t),q=s=>x.root.querySelector(s);
 const segment={status:'paused',runId:'b'.repeat(32),count:9,limit:750,endsAt:null};
 const current=handed('acknowledged',{status:'paused',count:259},{rendererSession:segment});
 x.updatePage(current);assert.equal(q('#session-count').textContent,'259');assert.match(q('#session-limit').textContent,/1000/);
 assert.equal(q('[data-action="start"]').disabled,false);assert.match(q('[data-action="start"]').textContent,/resume/i);
 x.updatePage(handed('acknowledged',{status:'error',count:259},{rendererSession:{...segment,status:'error'}}));
 assert.equal(q('[data-action="start"]').disabled,true);
 x.updatePage(handed('complete',{status:'complete',phase:'complete',count:1000,completionReason:'limit'}));
 assert.equal(q('[data-action="start"]').disabled,true);assert.match(q('#session-message').textContent,/limit reached/i);
});
test('an older context response cannot replace a newer Tinder handoff event',async t=>{
 const x=await heldWorkspace(t),snap=handed();let finish;
 x.setPage(action=>action==='context'?new Promise(resolve=>{finish=resolve}):Promise.resolve(snap));
 x.app.navigate('swiping');assert.equal(typeof finish,'function');
 x.updatePage(handed('acknowledged',{status:'running',phase:'waiting',count:258},{rendererSession:{status:'running',runId:'b'.repeat(32),count:8,limit:750,endsAt:null}}));
 finish(snap);await tick();await tick();
 assert.equal(x.root.querySelector('#session-count').textContent,'258');
 assert.equal(x.root.querySelector('[data-action="reviewHeld"]').hidden,true);
});
test('a pending recovery cannot be submitted again while a fresh status still reports the old hold',async t=>{
 const x=await heldWorkspace(t),snap=handed();let finish;
 x.setPage(action=>action==='continueHeld'?new Promise(resolve=>{finish=resolve}):Promise.resolve(snap));
 await x.click('[data-action="reviewHeld"]');await x.click('[data-action="confirmHeld"]');
 x.updatePage(snap);
 assert.equal(x.root.querySelector('[data-action="reviewHeld"]').disabled,true);
 await x.click('[data-action="reviewHeld"]');
 assert.equal(x.pageActions.filter(a=>a==='continueHeld').length,1);
 finish(handed('dispatching',{}, {minimumOnly:true}));await tick();
 assert.equal(x.root.querySelector('[data-action="reviewHeld"]').hidden,true);
});
test('a terminal Tinder session must be archived explicitly before a separate session can start',async t=>{
 const x=await heldWorkspace(t),q=s=>x.root.querySelector(s);
 const final=handed('complete',{status:'complete',phase:'complete',count:1000,completionReason:'limit'});
 const archived={connected:true,context:{},session:{status:'idle',count:0,limit:30},tinderHandoffArchived:{source:final.tinderHandoff.source,count:1000,status:'complete'}};
 x.setPage(async action=>action==='archiveHeld'?archived:final);x.updatePage(final);
 assert.equal(q('[data-action="start"]').disabled,true);
 await x.click('[data-action="reviewArchive"]');assert.ok(!x.pageActions.includes('archiveHeld'));await x.click('[data-action="dismiss"]');
 await x.click('[data-action="reviewArchive"]');await x.click('[data-action="confirmArchive"]');
 const archive=x.pageCalls.filter(c=>c.action==='archiveHeld');assert.equal(archive.length,1);
 assert.deepEqual(JSON.parse(JSON.stringify(archive[0].data)),{sourceRunId:heldId,finalCount:1000});
 assert.equal(x.pageActions.includes('start'),false);assert.equal(q('[data-action="start"]').disabled,false);
 assert.match(q('#session-controls-help').textContent,/archived.*1000/i);
});
