'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const Controller=require('../desktop/mobile-controller.cjs');
const Config=require('../desktop/mobile-config.cjs');
const box={x:10,y:20,width:80,height:90};
const control=key=>({key,label:key,bounds:box});
const screen=(overrides={})=>({platform:'hinge',kind:'profile',name:'Example',identity:'example-prompt-one',screenKey:'first',context:{name:'Example',bio:'I enjoy hiking',history:[]},photos:[{key:'photo-one',bounds:box,like:control('photo-one')}],controls:{skip:control('skip'),like:control('photo-one'),sendLike:null,comment:null,composer:null,sendMessage:null},composerText:'',emptyConversation:false,reason:'',...overrides});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}};

for(const pending of [false,true]){
 test('managed Hinge reopens from HOME without changing the session or replaying an action (pending='+pending+')',async()=>{
  let saved=null;
  const phone={serial:'emulator-1',avd:'assigned'},home='com.google.android.apps.nexuslauncher';
  const x=setup(screen(),{isManagedPhone:binding=>binding?.avd===phone.avd,checkpointStore:{read:()=>null,write:value=>{saved=structuredClone(value)}}});
  await x.c.request('status');
  x.c.binding=phone;x.android.deviceIdentity=async()=>phone;
  x.c.session.status='running';x.c.session.count=4;x.c.reservedCount=4;x.c.session.endsAt=Date.now()+1200000;
  x.c.session.nextBreakAt=6;x.c.session.breakUntil=null;
  const deadline=x.c.session.endsAt,guard=pending?{identity:'old',name:'Old'}:null;x.c.lastAction=guard;
  x.android.hierarchy=async()=>({xml:screen({kind:'blocked',reason:'Foreground mismatch'}),foreground:home});
  let launches=0;
  x.android.reopenFromHome=async(platform,{foreground,valid,reserve})=>{
   assert.equal(platform,'hinge');assert.equal(foreground,home);assert.equal(valid(),true);
   reserve();assert.ok(saved.nextHomeLaunchAt>Date.now());assert.deepEqual(saved.pendingAction,guard);launches++;return true;
  };
  const config={...x.c.config.swipe,allowBackground:true};
  const run=()=>x.c.sessionStep(config,()=>true,()=>assert.fail('no profile action'),async()=>true,x.c.token());
  assert.ok((await run()).retryAfter>0);assert.equal(launches,1);
  assert.ok((await run()).retryAfter>0);assert.equal(launches,1);
  assert.equal(x.c.lastAction,guard);assert.equal(x.c.session.count,4);assert.equal(x.c.session.endsAt,deadline);
  assert.equal(x.c.session.nextBreakAt,6);assert.equal(x.c.session.breakUntil,null);
  const restored=setup();restored.c.restoreCheckpoint(saved);assert.equal(restored.c.nextHomeLaunchAt,saved.nextHomeLaunchAt);
  assert.equal(restored.c.session.count,4);assert.deepEqual(restored.c.lastAction,guard);
  assert.deepEqual(x.calls,[]);
 });
}
test('Hinge HOME recovery stays off for ordinary Hinge screens, paused sessions, custom phones and disabled background',async()=>{
 for(const [foreground,status,managed,background] of [
  ['co.hinge.app','running',true,true],['launcher','paused',true,true],
  ['launcher','running',false,true],['launcher','running',true,false],
 ]){
  const x=setup(screen(),{isManagedPhone:()=>managed});await x.c.request('status');
  x.c.session.status=status;x.c.session.endsAt=Date.now()+60000;x.c.lastAction={identity:'old',name:'Old'};
  x.c.binding={serial:'emulator-1',avd:'assigned'};x.android.deviceIdentity=async()=>x.c.binding;
  x.android.hierarchy=async()=>({xml:screen({kind:'blocked'}),foreground});
  let probes=0;x.android.reopenFromHome=async()=>{probes++;return false;};
  await x.c.sessionStep({...x.c.config.swipe,allowBackground:background},()=>true,()=>assert.fail('no action'),async()=>true,x.c.token());
  assert.equal(probes,0);assert.ok(x.c.lastAction);assert.deepEqual(x.calls,[]);
 }
});
test('ambiguous HOME launch waits without escalating to a device restart or a feed force-stop',async()=>{
 const phone={serial:'emulator-1',avd:'assigned'};
 const x=setup(screen(),{isManagedPhone:()=>true});
 await x.c.request('status');x.c.binding=phone;x.android.deviceIdentity=async()=>phone;
 x.c.session.status='running';x.c.session.count=4;x.c.session.endsAt=Date.now()+600000;x.c.readFailures=2;
 x.android.hierarchy=async()=>({xml:screen({kind:'blocked'}),foreground:'com.android.launcher3'});
 x.android.reopenFromHome=async(_platform,{reserve})=>{
  reserve();throw Object.assign(Error('timeout'),{code:'ANDROID_COMMAND_TIMEOUT'});
 };
 let restarts=0,refreshes=0;x.c.recoverDevice=async()=>{restarts++;return {restarted:false}};x.android.refreshFeed=async()=>refreshes++;
 const result=await x.c.sessionStep({...x.c.config.swipe,allowBackground:true},()=>true,()=>assert.fail('no count'),async()=>true,x.c.token());
 assert.ok(result.retryAfter>0);assert.equal(restarts,0);assert.equal(refreshes,0);assert.equal(x.c.session.count,4);
 assert.ok(x.c.nextHomeLaunchAt>Date.now());
});
function setup(initial=screen(),extra={}){
 let current=initial,settings={sidebarConsentGiven:true,mobileConfig:{}};
 const calls=[],changes=[];
 const android={serial:'emulator-1',inputEpoch:0,refreshFeed:async(_platform,valid)=>{assert.equal(valid(),true);},cancelInput(){this.inputEpoch++},hierarchy:async()=>({xml:current,foreground:'co.hinge.app'}),tapControl:async(b,valid)=>{assert.equal(valid(),true);calls.push('tap');if(extra.tap)await extra.tap()},scrollProfile:async(opts,valid)=>{assert.equal(valid(),true);calls.push(opts);if(extra.scroll)await extra.scroll()},type:async text=>calls.push(text)};
 const service={request:async(action,data)=>{if(action==='load')return settings;if(action==='save'){settings={...settings,...data,...(data.mobileConfig?{mobileConfig:{...settings.mobileConfig,...data.mobileConfig}}:{})};return settings}if(action==='generate')return extra.generate?extra.generate(data):{response:'Hello hiking friend'};if(action==='record')calls.push(data)}};
 const c=new Controller({android,service,platform:'hinge',readScreen:xml=>xml,changed:s=>changes.push(s),random:()=>0.5,wait:async()=>{},...extra});
 return {c,android,calls,changes,set:s=>current=s,settings:s=>settings=s};
}
test('mobile configuration defaults to plain likes and bounded randomized browsing',()=>{
 const c=Config.normalize();assert.equal(c.mode,'like');assert.equal(c.autoOpeners,false);assert.equal(c.autoSend,false);assert.ok(c.scrollMax>=c.scrollMin);assert.equal(c.swipe.randomizeTiming,true);
 assert.throws(()=>Config.normalize({mode:'rose'}),/mode/i);assert.throws(()=>Config.normalize({scrollMin:5,scrollMax:2}),/scroll/i);assert.throws(()=>Config.normalize({swipe:{likeRatio:NaN}}),/invalid/i);
});
test('read-only review varies scroll distance and selects a visible photo without sending',async()=>{
 const x=setup();await x.c.request('config',{scrollMin:1,scrollMax:1});await x.c.request('review');assert.equal(x.calls.filter(v=>v==='tap').length,0);const scroll=x.calls.find(v=>v?.fraction);assert.ok(scroll.fraction>=.2&&scroll.fraction<=.65);assert.equal(x.c.snapshot().selectedPhoto.key,'photo-one');
});
test('unsupported and name-only screens cannot start or issue actions',async()=>{
 for(const s of [screen({identity:''}),screen({kind:'unsupported',reason:'Unsupported Bumble screen'})]){const x=setup(s);await assert.rejects(x.c.request('start'),/identity|supported|recogniz/i);assert.deepEqual(x.calls,[])}
});
test('mobile sessions require existing consent',async()=>{const x=setup();x.settings({sidebarConsentGiven:false});await assert.rejects(x.c.request('start'),/consent/i);});
test('stop during an in-flight screen read prevents late review actions',async()=>{
 const gate=deferred(),x=setup();x.android.hierarchy=async()=>{await gate.promise;return {xml:screen(),foreground:'co.hinge.app'}};const job=x.c.request('review');await new Promise(r=>setImmediate(r));await x.c.request('stop');gate.resolve();await assert.rejects(job,/cancel|changed|stopped/i);assert.deepEqual(x.calls,[]);
});
test('changing device discards a generated draft',async()=>{
 const gate=deferred(),x=setup(screen(),{generate:()=>gate.promise});const job=x.c.request('generate');await new Promise(r=>setImmediate(r));x.android.serial='emulator-2';gate.resolve({response:'Old device text'});await assert.rejects(job,/changed|cancel/i);assert.equal(x.c.snapshot().draft,null);
});
test('manual invalidation discards queued input and waits for active read',async()=>{
 const gate=deferred(),x=setup();x.android.hierarchy=async()=>{await gate.promise;return {xml:screen(),foreground:'co.hinge.app'}};const job=x.c.request('context');await new Promise(r=>setImmediate(r));x.c.invalidate('Manual input');gate.resolve();await assert.rejects(job,/cancel|changed/i);await x.c.drain();assert.deepEqual(x.calls,[]);
});
test('a stale draft cannot be inserted into another profile or conversation',async()=>{
 const x=setup(screen({kind:'conversation',identity:'chat-one',controls:{composer:control('composer'),sendMessage:control('send')}}));await x.c.request('generate');x.set(screen({kind:'conversation',identity:'chat-two',controls:{composer:control('composer'),sendMessage:control('send')}}));await assert.rejects(x.c.request('insert',{text:'Edited text'}),/changed|another/i);assert.equal(x.calls.length,0);
});
test('prefilled composers and unsupported Unicode are rejected before any tap',async()=>{
 const x=setup(screen({kind:'conversation',identity:'chat-one',controls:{composer:control('composer'),sendMessage:control('send')}}));await x.c.request('generate');await assert.rejects(x.c.request('insert',{text:'Hello 😊'}),/ASCII|plain|characters/i);x.set(screen({kind:'conversation',identity:'chat-one',composerText:'My unsent text',controls:{composer:control('composer'),sendMessage:control('send')}}));await assert.rejects(x.c.request('insert',{text:'Hello'}),/existing|unsent|already/i);assert.deepEqual(x.calls,[]);
});
test('plain Like refuses a comment already present in confirmation',async()=>{
 const x=setup(screen({kind:'like',composerText:'Existing draft',controls:{sendLike:control('send-like'),comment:control('comment')}}));await assert.rejects(x.c.request('act',{kind:'like'}),/existing|comment|unsent/i);assert.deepEqual(x.calls,[]);
});
test('a control moved after recognition is never tapped',async()=>{
 const x=setup();let reads=0;x.android.hierarchy=async()=>({xml:screen({screenKey:++reads===1?'old':'changed'}),foreground:'co.hinge.app'});await assert.rejects(x.c.request('act',{kind:'pass'}),/changed/i);assert.deepEqual(x.calls,[]);
});
test('an uncertain final action is not retried on unchanged profile',async()=>{
 const x=setup();await assert.rejects(x.c.request('act',{kind:'pass'}),/confirm|unchanged|transition/i);assert.equal(x.calls.filter(v=>v==='tap').length,1);await assert.rejects(x.c.request('act',{kind:'pass'}),/already|uncertain|unchanged/i);assert.equal(x.calls.filter(v=>v==='tap').length,1);
});
test('comment mode must be explicitly selected and generation failure never becomes a plain Like',async()=>{
 const x=setup(screen({kind:'like',controls:{sendLike:control('send'),comment:control('comment')}}),{generate:async()=>{throw Error('Provider unavailable')}});await x.c.request('config',{mode:'comment',scrollMin:0,scrollMax:0});await assert.rejects(x.c.request('act',{kind:'like'}),/Provider unavailable/);assert.deepEqual(x.calls,[]);
});
test('platform-specific settings preserve the other platform and do not inherit Tinder automatic sending',async()=>{
 const x=setup();x.settings({sidebarConsentGiven:true,messagingConfig:{autoSend:true},mobileConfig:{bumble:{mode:'comment'}}});await x.c.request('config',{scrollMin:0,scrollMax:0});assert.equal(x.c.snapshot().config.autoSend,false);const saved=await x.c.service.request('load');assert.equal(saved.mobileConfig.bumble.mode,'comment');
});

test('status hydrates saved mobile settings without a selected device or a write',async()=>{
 const x=setup();x.android.serial=null;x.settings({mobileConfig:{hinge:{mode:'comment',swipe:{maxSwipes:17}}}});
 const result=await x.c.request('status');assert.equal(result.config.mode,'comment');assert.equal(result.config.swipe.maxSwipes,17);assert.equal(result.busy,false);assert.deepEqual(x.calls,[]);
});
test('completed queued responses cannot restore the busy state from an earlier snapshot',async()=>{
 const x=setup();const result=await x.c.request('context');assert.equal(result.busy,false);assert.equal(x.changes.at(-1).busy,false);
});
test('manual mutations are rejected immediately while a session owns the device',async()=>{
 const x=setup(),gate=deferred();x.android.hierarchy=async()=>{await gate.promise;return {xml:screen(),foreground:'co.hinge.app'}};
 const pending=x.c.request('context');await new Promise(r=>setImmediate(r));x.c.session.status='running';
 for(const action of ['review','act','generate','insert','send']){
  const result=await Promise.race([x.c.request(action,{kind:'like',text:'Hello'}).then(()=>({ok:true}),error=>({error})),new Promise(r=>setImmediate(()=>r({queued:true})))]);
  assert.match(result.error?.message||'',/pause.*session|session.*running/i,action+' must reject before joining the queue');
 }
 x.c.session.status='idle';gate.resolve();await pending;assert.deepEqual(x.calls,[]);
});
test('manual mutation queued before session start rechecks ownership before executing',async()=>{
 const x=setup(),gate=deferred();x.android.hierarchy=async()=>{await gate.promise;return {xml:screen(),foreground:'co.hinge.app'}};
 const first=x.c.request('context'),second=x.c.request('review');await new Promise(r=>setImmediate(r));x.c.session.status='running';gate.resolve();await first;await assert.rejects(second,/pause.*session|session.*running/i);x.c.session.status='idle';assert.deepEqual(x.calls,[]);
});
test('an interrupted new review cannot leave old collected context available',async()=>{
 const x=setup();await x.c.request('config',{scrollMin:0,scrollMax:0});await x.c.request('review');assert.ok(x.c.reviewContext);
 x.android.hierarchy=async()=>{throw Error('New review interrupted')};await assert.rejects(x.c.request('review'),/interrupted/);assert.equal(x.c.reviewContext,null);
});
test('invalidation clears selected review text and profile binding',async()=>{
 const x=setup();await x.c.request('config',{scrollMin:0,scrollMax:0});await x.c.request('review');assert.ok(x.c.reviewContext);x.c.invalidate('Device changed');assert.equal(x.c.reviewContext,null);
});
test('reading a different same-name profile clears stored review context',async()=>{
 const x=setup();await x.c.request('config',{scrollMin:0,scrollMax:0});await x.c.request('review');x.set(screen({identity:'different-person',screenKey:'different'}));await x.c.request('context');assert.equal(x.c.reviewContext,null);
});
test('comments never reuse review text from another same-name identity',async()=>{
 let supplied;const x=setup(screen(),{generate:async data=>{supplied=data.context;throw Error('Provider deliberately stopped')}});await x.c.request('config',{mode:'comment',scrollMin:0,scrollMax:0});await x.c.request('review');
 x.set(screen({kind:'like',identity:'new-identity',screenKey:'new-like',context:{name:'Example',bio:'I enjoy painting',history:[]},controls:{comment:control('comment'),sendLike:control('send')}}));
 await assert.rejects(x.c.request('act',{kind:'like'}),/deliberately stopped/);assert.equal(supplied.bio,'I enjoy painting');assert.equal(supplied.bio.includes('hiking'),false);
});
test('photo-based fallback reparses recognition before authorizing any controls',async()=>{
 const parsed=[],base=screen({identity:null,controls:{like:null,skip:null},photos:[{key:'main-photo',bounds:box,like:null}]});
 const x=setup(base,{photoHashes:async()=>['0123456789abcdef'],readScreen:(xml,opts)=>{parsed.push(opts);return opts.photoIdentity?screen({identity:'photo-bound',screenKey:'photo-bound',photos:[{key:'main-photo',bounds:box,like:control('photo')}]}):xml;}});
 const result=await x.c.request('context');assert.equal(parsed.length,2);assert.equal(parsed[1].photoIdentity,'0123456789abcdef');assert.equal(result.screen.identity,'photo-bound');assert.ok(result.screen.controls.like);assert.equal(result.screen.photos[0].visual,'0123456789abcdef');
});
test('plain Like opens the selected recognized photo and records only final submission',async()=>{
 let taps=0;const x=setup(screen(),{tap:async()=>{taps++;x.set(taps===1?screen({kind:'like',screenKey:'like-confirmation',controls:{sendLike:control('ordinary-like')}}):screen({name:'Next',identity:'next-person',screenKey:'next'}));}});
 const result=await x.c.request('act',{kind:'like'});assert.equal(taps,2);assert.equal(x.calls.filter(v=>v?.kind==='like').length,1);assert.equal(result.screen.name,'Next');assert.equal(result.busy,false);assert.equal(x.c.lastAction,null);
});
test('explicit comment mode generates, verifies entered text and submits once',async()=>{
 let taps=0,typed='';const initial=screen({kind:'like',screenKey:'like',controls:{comment:control('comment'),sendLike:control('ordinary-like')}});
 const editor=text=>screen({kind:'like',screenKey:'editor-'+text,composerText:text,controls:{composer:control('composer'),sendLike:control('ordinary-like')}});
 const x=setup(initial,{generate:async()=>({response:'Hello hiking friend'}),tap:async()=>{taps++;if(taps===1)x.set(editor(''));if(taps===3)x.set(screen({name:'Next',identity:'next-profile',screenKey:'next'}));}});
 x.android.type=async text=>{typed=text;x.set(editor(text))};await x.c.request('config',{mode:'comment'});const result=await x.c.request('act',{kind:'like'});
 assert.equal(typed,'Hello hiking friend');assert.equal(taps,3);assert.equal(x.calls.filter(v=>v?.kind==='like').length,1);assert.equal(result.draft,null);assert.equal(result.busy,false);
});
test('stop during comment generation prevents every later input and submission',async()=>{
 const gate=deferred(),x=setup(screen({kind:'like',controls:{comment:control('comment'),sendLike:control('send')}}),{generate:()=>gate.promise});await x.c.request('config',{mode:'comment'});const pending=x.c.request('act',{kind:'like'});await new Promise(r=>setImmediate(r));await x.c.request('stop');gate.resolve({response:'Too late'});await assert.rejects(pending,/cancel|changed|stopped/i);assert.deepEqual(x.calls,[]);assert.equal(x.c.draft,null);
});
test('uncertain Like submission is never retried even when native tap rejects',async()=>{
 const x=setup(screen({kind:'like',controls:{sendLike:control('ordinary-like')}}),{tap:async()=>{throw Error('Native tap timed out')}});
 await assert.rejects(x.c.request('act',{kind:'like'}),/timed out/);await assert.rejects(x.c.request('act',{kind:'like'}),/already|uncertain/i);assert.equal(x.calls.filter(v=>v==='tap').length,1);assert.equal(x.calls.filter(v=>v?.kind==='like').length,0);
});


test('local visual comment evidence is required, re-read, and cannot silently become empty',async()=>{
 let value='Existing comment';const like=screen({kind:'like',controls:{comment:control('comment'),sendLike:control('send')},composerTextVerified:false});
 const x=setup(like,{readEvidence:async()=>({hashes:[],commentText:value}),readScreen:(xml,options)=>({...xml,composerText:options.commentText,composerTextVerified:typeof options.commentText==='string'})});
 await assert.rejects(x.c.request('act',{kind:'like'}),/existing comment/i);assert.equal(x.calls.length,0);
 value='';await x.c.request('context');const before=x.c.screen;value='Changed';await assert.rejects(x.c.fresh(before,x.c.token()),/changed/i);
});
test('stop during local visual verification cancels before any input',async()=>{
 const gate=deferred(),x=setup(screen(),{readEvidence:async()=>{await gate.promise;return {hashes:[]}}});
 const job=x.c.request('context');await new Promise(r=>setImmediate(r));await x.c.request('stop');gate.resolve();await assert.rejects(job,/canceled/i);assert.equal(x.calls.length,0);
});
test('random review aligns to a fully visible photo within a bounded number of extra scrolls',async()=>{
 let n=0;const clipped=screen({photos:[{key:'clipped',bounds:box,like:null}],controls:{skip:control('skip')}});let x;x=setup(screen(),{scroll:()=>{n++;x.set(n<3?clipped:screen({photos:[{key:'later-photo',bounds:box,like:control('later')}]}))}});
 await x.c.request('config',{scrollMin:1,scrollMax:1});await x.c.request('review');assert.equal(x.c.selectedPhoto.key,'later-photo');assert.equal(n,3);assert.equal(x.calls.includes('tap'),false);
});
test('unavailable photos stop bounded review without Like or Skip',async()=>{
 const x=setup(screen({photos:[],controls:{}}));await x.c.request('config',{scrollMin:0,scrollMax:0});await assert.rejects(x.c.request('review'),/photo/i);assert.ok(x.calls.filter(c=>c.fraction).length<=18);assert.equal(x.calls.includes('tap'),false);
});
const emptyChat=(patch={})=>screen({kind:'conversation',identity:'chat-one',screenKey:'empty-chat-one',context:{name:'Example',bio:'Hiking',history:[]},photos:[],controls:{composer:control('composer'),sendMessage:control('send-message')},emptyConversation:true,composerTextVerified:true,composerText:'',...patch});
test('watch defaults perform no read or provider request and autoSend alone never arms it',async()=>{
 const x=setup(emptyChat());let reads=0;x.android.hierarchy=async()=>{reads++;return {xml:emptyChat(),foreground:'co.hinge.app'}};
 const result=await x.c.request('watch');assert.equal(result.openerArmed,false);assert.equal(reads,0);assert.equal(result.draft,null);
 await x.c.request('config',{autoSend:true});await x.c.request('watch');assert.equal(reads,0);assert.equal(x.c.openerArmed,false);assert.deepEqual(x.calls,[]);
});
test('persisted opener opt-in does not arm the watcher until an explicit settings save',async()=>{
 const x=setup(emptyChat());x.settings({sidebarConsentGiven:true,mobileConfig:{hinge:{autoOpeners:true,autoSend:true}}});await x.c.request('status');
 assert.equal(x.c.config.autoOpeners,true);assert.equal(x.c.openerArmed,false);const result=await x.c.request('watch');assert.equal(result.draft,null);assert.deepEqual(x.calls,[]);
 await x.c.request('config',{});assert.equal(x.c.openerArmed,true);
});
test('watch generates one context-bound opener without inserting unless autoSend is selected',async()=>{
 const x=setup(emptyChat());await x.c.request('config',{autoOpeners:true});const result=await x.c.request('watch');
 assert.equal(result.draft.text,'Hello hiking friend');assert.equal(result.draft.identity,'chat-one');assert.equal(result.draft.inserted,undefined);assert.equal(result.openerArmed,true);assert.equal(result.busy,false);assert.deepEqual(x.calls,[]);
 await x.c.request('watch');assert.equal(x.c.openerAttempts.size,1);assert.deepEqual(x.calls,[]);
});
test('watch never generates for unknown, existing-text, ongoing or unverified conversations',async()=>{
 for(const patch of [{kind:'blocked'},{identity:null},{emptyConversation:false},{composerTextVerified:false},{composerText:'Unsent hello'},{composerText:' '}]){
  let generated=0;const x=setup(emptyChat(patch),{generate:async()=>{generated++;return {response:'Hello'}}});await x.c.request('config',{autoOpeners:true,autoSend:true});const result=await x.c.request('watch');
  assert.equal(generated,0,JSON.stringify(patch));assert.equal(result.draft,null);assert.equal(x.c.openerAttempts.size,0);assert.deepEqual(x.calls,[]);
 }
});
test('a failed automatic generation still consumes the conversation attempt',async()=>{
 let generated=0;const x=setup(emptyChat(),{generate:async()=>{generated++;throw Error('Provider offline')}});await x.c.request('config',{autoOpeners:true});
 await assert.rejects(x.c.request('watch'),/Provider offline/);await x.c.request('watch');assert.equal(generated,1);assert.equal(x.c.openerAttempts.size,1);assert.equal(x.c.draft,null);
});
test('watch requires consent before reading the conversation or contacting AI',async()=>{
 let reads=0,generated=0;const x=setup(emptyChat(),{generate:async()=>{generated++;return {response:'Hello'}}});x.settings({sidebarConsentGiven:false,mobileConfig:{}});await x.c.request('config',{autoOpeners:true});x.android.hierarchy=async()=>{reads++;return {xml:emptyChat(),foreground:'co.hinge.app'}};
 await assert.rejects(x.c.request('watch'),/consent/i);assert.equal(reads,0);assert.equal(generated,0);assert.equal(x.c.openerAttempts.size,0);
});
test('watch skips disconnected, hidden, busy and running-session states without queuing',async()=>{
 const x=setup(emptyChat());await x.c.request('config',{autoOpeners:true});let reads=0;x.android.hierarchy=async()=>{reads++;return {xml:emptyChat(),foreground:'co.hinge.app'}};
 x.android.serial=null;await x.c.request('watch');x.android.serial='emulator-1';x.c.visible=false;await x.c.request('watch');x.c.visible=true;x.c.busy=true;await x.c.request('watch');x.c.busy=false;x.c.session.status='running';
 const result=await Promise.race([x.c.request('watch'),new Promise(r=>setImmediate(()=>r(null)))]);assert.ok(result);assert.equal(reads,0);x.c.session.status='idle';
});
test('pause cancels in-flight automatic AI and disarms until an explicit config save',async()=>{
 const gate=deferred(),x=setup(emptyChat(),{generate:()=>gate.promise});await x.c.request('config',{autoOpeners:true,autoSend:true});const job=x.c.request('watch');await new Promise(r=>setImmediate(r));
 await x.c.request('pause');assert.equal(x.c.openerArmed,false);gate.resolve({response:'Late opener'});await assert.rejects(job,/cancel|changed|stopped/i);assert.equal(x.c.draft,null);assert.deepEqual(x.calls,[]);
 await x.c.request('watch');assert.equal(x.c.draft,null);await x.c.request('config',{});assert.equal(x.c.openerArmed,true);await x.c.request('watch');assert.equal(x.c.draft,null);
});
test('automatic send inserts verified draft then sends once when both options are selected',async()=>{
 let taps=0;const x=setup(emptyChat(),{tap:async()=>{taps++;}});x.android.type=async text=>{x.calls.push(text);x.set(emptyChat({composerText:text,screenKey:'typed-opener'}))};await x.c.request('config',{autoOpeners:true,autoSend:true});const result=await x.c.request('watch');
 assert.equal(taps,2);assert.equal(x.calls.filter(v=>v?.kind==='message').length,1);assert.equal(result.draft,null);await x.c.request('watch');assert.equal(taps,2);
});
test('conversation change before automatic generation cannot draft for an unqualified replacement',async()=>{
 let reads=0,generated=0;const x=setup(emptyChat(),{generate:async()=>{generated++;return {response:'Hello'}}});await x.c.request('config',{autoOpeners:true});x.android.hierarchy=async()=>({xml:++reads===1?emptyChat():emptyChat({identity:'chat-two',screenKey:'ongoing-chat-two',emptyConversation:false}),foreground:'co.hinge.app'});
 await assert.rejects(x.c.request('watch'),/changed|conversation/i);assert.equal(generated,0);assert.equal(x.c.draft,null);assert.equal(x.c.openerAttempts.size,1);
});
test('duplicate watch polls during AI do not queue another automatic attempt',async()=>{
 const gate=deferred();let generated=0;const x=setup(emptyChat(),{generate:async()=>{generated++;return gate.promise}});await x.c.request('config',{autoOpeners:true});const first=x.c.request('watch'),second=x.c.request('watch');
 await second;await new Promise(r=>setImmediate(r));gate.resolve({response:'One hello'});await first;assert.equal(generated,1);assert.equal(x.c.openerAttempts.size,1);
});
test('stop and disabling automatic openers disarm and successful Start re-arms saved opt-in',async()=>{
 const x=setup(screen(),{wait:()=>new Promise(()=>{})});await x.c.request('config',{autoOpeners:true});assert.equal(x.c.openerArmed,true);await x.c.request('stop');assert.equal(x.c.openerArmed,false);
 await x.c.request('start');assert.equal(x.c.openerArmed,true);await x.c.request('pause');assert.equal(x.c.openerArmed,false);await x.c.request('config',{autoOpeners:false});assert.equal(x.c.openerArmed,false);
});

test('issued final Like and Skip count and record once despite cancellation before native return',async()=>{
 for(const kind of ['like','pass']){
  const initial=kind==='like'?screen({kind:'like',controls:{sendLike:control('ordinary-like')}}):screen();const x=setup(initial);let commits=0,reads=0;
  x.android.hierarchy=async()=>{reads++;return {xml:initial,foreground:'co.hinge.app'}};
  x.android.tapControl=async(bounds,valid,onIssued)=>{assert.equal(valid(),true);x.calls.push('native-issued');onIssued?.();onIssued?.();x.c.invalidate('Canceled after native command',{stop:true});throw Error('Post-dispatch cancellation')};
  await assert.rejects(x.c.act(kind,x.c.token(),()=>true,()=>{commits++}),/Post-dispatch cancellation/);
  assert.equal(commits,1,kind);assert.equal(x.calls.filter(v=>v?.kind===kind).length,1,kind);assert.equal(x.calls.filter(v=>v==='native-issued').length,1);assert.equal(reads,2,'cancellation prevents transition reads');assert.ok(x.c.lastAction,'uncertain issued action keeps duplicate guard');
 }
});
test('issued message submission records once even if post-dispatch cancellation rejects',async()=>{
 const chat=emptyChat({composerText:'Verified hello',screenKey:'inserted'}),x=setup(chat);x.c.draft={text:'Verified hello',identity:'chat-one',serial:'emulator-1',inserted:true};
 x.android.tapControl=async(bounds,valid,onIssued)=>{assert.equal(valid(),true);x.calls.push('native-issued');onIssued?.();x.c.invalidate('Stopped after issuing message',{stop:true});throw Error('Message native return canceled')};
 await assert.rejects(x.c.request('send'),/native return canceled/);assert.equal(x.calls.filter(v=>v?.kind==='message').length,1);assert.equal(x.calls.filter(v=>v==='native-issued').length,1);assert.equal(x.c.draft,null);
 await assert.rejects(x.c.request('send'),/Insert and verify/);assert.equal(x.calls.filter(v=>v==='native-issued').length,1);
});

const offerScreen=()=>screen({kind:'likeOffer',name:'',identity:'rose-offer',screenKey:'offer-key',photos:[],controls:{sendLike:control('normal-like')}});
test('Rose confirmation completes one Like before committing a one-action limit',async()=>{
 let taps=0,committed=0;const x=setup(screen({kind:'like',controls:{sendLike:control('initial')}}),{tap:async()=>{taps++;x.set(taps===1?offerScreen():screen({name:'Next',identity:'next',screenKey:'next'}))}});
 await x.c.act('like',x.c.token(),()=>committed===0,()=>committed++);assert.equal(taps,2);assert.equal(committed,1);assert.equal(x.calls.filter(v=>v?.kind==='like').length,1);assert.equal(x.c.lastAction,null);
});
test('explicit Like continues the currently open known Rose offer without AI or a Rose',async()=>{
 let taps=0;const x=setup(offerScreen(),{tap:async()=>{taps++;x.set(screen({name:'Next',identity:'next',screenKey:'next'}))},generate:()=>{throw Error('No AI permitted')}});await x.c.request('act',{kind:'like'});assert.equal(taps,1);assert.equal(x.calls.filter(v=>v?.kind==='like').length,1);
});
test('stuck Rose confirmation is tapped once and cannot be retried as another Like',async()=>{
 let taps=0;const x=setup(screen({kind:'like',controls:{sendLike:control('initial')}}),{tap:async()=>{taps++;x.set(offerScreen())}});
 await assert.rejects(x.c.request('act',{kind:'like'}),/confirm|transition/i);assert.equal(taps,2);await assert.rejects(x.c.request('act',{kind:'like'}),/attempted|uncertain/i);assert.equal(taps,2);assert.equal(x.calls.filter(v=>v?.kind==='like').length,1);
});
test('stop after first Like cannot continue the Rose offer and still accounts the attempt',async()=>{
 let taps=0;const x=setup(screen({kind:'like',controls:{sendLike:control('initial')}}),{tap:async()=>{taps++;x.set(offerScreen());x.c.invalidate('Stopped')}});await assert.rejects(x.c.request('act',{kind:'like'}),/canceled|changed/i);assert.equal(taps,1);assert.equal(x.calls.filter(v=>v?.kind==='like').length,1);
});

test('returning from an open Rose sheet to a Like editor is not a confirmed send',async()=>{const x=setup(offerScreen(),{tap:async()=>x.set(screen({kind:'like',controls:{sendLike:control('initial')}}))});await assert.rejects(x.c.request('act',{kind:'like'}),/transition|confirm/i);assert.ok(x.c.lastAction);});

test('a final Skip waits for transition before invalidating the session limit',async()=>{const x=setup(screen());let committed=0;x.android.tapControl=async(bounds,valid,onIssued)=>{assert.ok(valid());onIssued();assert.ok(valid(),'post-dispatch validation remains valid');x.set(screen({name:'Next',identity:'next',screenKey:'next'}))};await x.c.act('pass',x.c.token(),()=>committed===0,()=>committed++);assert.equal(committed,1);assert.equal(x.c.lastAction,null);assert.equal(x.calls.filter(v=>v?.kind==='pass').length,1);});

test('review searches past text-only sections with bounded larger scrolls',async()=>{const x=setup(screen({photos:[]}),{scroll:async()=>{if(x.calls.filter(v=>v?.fraction).length===2)x.set(screen())}});await x.c.request('config',{scrollMin:0,scrollMax:0});await x.c.request('review');assert.deepEqual(x.calls.filter(v=>v?.fraction).map(v=>v.fraction),[.55,.55]);assert.equal(x.c.selectedPhoto.key,'photo-one');});

test('bounded photo search reverses at the profile end instead of requiring manual scrolling',async()=>{const x=setup(screen({photos:[],screenKey:'end'}),{scroll:async()=>{if(x.calls.at(-1).direction==='down')x.set(screen())}});await x.c.request('config',{scrollMin:0,scrollMax:0});await x.c.request('review');assert.deepEqual(x.calls.filter(v=>v?.fraction).map(v=>v.direction),['up','down']);assert.equal(x.c.selectedPhoto.key,'photo-one');});

function bumble(overrides={}){return screen({platform:'bumble',photos:[{key:'main',bounds:box,visual:'0123456789abcdef',like:null}],controls:{like:{...control('right'),direction:'right'},skip:{...control('left'),direction:'left'}},...overrides})}
for(const [kind,direction]of [['like','right'],['pass','left']])test('Bumble '+kind+' uses one '+direction+' swipe and confirms the next profile',async()=>{
 const x=setup(bumble(),{platform:'bumble'});let commits=0;x.android.swipeProfile=async(d,b,valid,issued)=>{assert.equal(d,direction);assert.equal(valid(),true);x.calls.push(d);issued();x.set(bumble({name:'Next',identity:'next',screenKey:'next'}))};await x.c.act(kind,x.c.token(),()=>true,()=>commits++);assert.equal(commits,1);assert.equal(x.calls.filter(v=>v===direction).length,1);assert.equal(x.c.lastAction,null);assert.equal(x.calls.filter(v=>v?.kind===kind).length,1);
});
test('Bumble uncertain swipe is counted once and never automatically retried',async()=>{
 const x=setup(bumble(),{platform:'bumble'});let issued=0,commits=0;x.android.swipeProfile=async(d,b,v,cb)=>{issued++;cb()};await assert.rejects(x.c.act('like',x.c.token(),()=>true,()=>commits++),/transition/);await assert.rejects(x.c.act('like',x.c.token()),/already/);assert.equal(issued,1);assert.equal(commits,1);
});
test('Bumble changed profile or unsupported comment mode cannot swipe',async()=>{
 const x=setup(bumble(),{platform:'bumble'});x.android.swipeProfile=async()=>assert.fail('must not swipe');await x.c.request('config',{mode:'comment'});await assert.rejects(x.c.request('act',{kind:'like'}),/comment|Compliment/i);await x.c.request('config',{mode:'like'});let reads=0;x.android.hierarchy=async()=>({xml:bumble({screenKey:++reads===1?'one':'two'})});await assert.rejects(x.c.request('act',{kind:'like'}),/changed/);
});
test('Bumble review scrolls through content then returns to the verified main photo before swiping',async()=>{
 let moves=0;const x=setup(bumble(),{platform:'bumble',scroll:()=>{moves++;x.set(moves===1?bumble({identity:null,photos:[],screenKey:'details',controls:{},context:{bio:'Books'}}):bumble())}});await x.c.request('config',{scrollMin:1,scrollMax:1});await x.c.request('review');assert.equal(moves,2);assert.equal(x.calls[0].direction,'up');assert.equal(x.calls[1].direction,'down');assert.equal(x.c.screen.identity,'example-prompt-one');assert.equal(x.c.reviewContext.context.bio.includes('Books'),true);
});
test('Bumble review rejects a different profile after returning to the top',async()=>{
 let moves=0;const x=setup(bumble(),{platform:'bumble',scroll:()=>{moves++;x.set(moves===1?bumble({identity:null,photos:[],controls:{}}):bumble({identity:'other'}))}});await x.c.request('config',{scrollMin:1,scrollMax:1});await assert.rejects(x.c.request('review'),/changed/);
});
test('Bumble handles the exact first Like confirmation once',async()=>{
 const x=setup(bumble(),{platform:'bumble',tap:()=>x.set(bumble({name:'Next',identity:'next'}))});x.android.swipeProfile=async(d,b,v,cb)=>{cb();x.set(bumble({kind:'swipeConfirm',swipeDirection:'right',identity:'confirm',controls:{confirm:control('yes')}}))};await x.c.request('act',{kind:'like'});assert.equal(x.calls.filter(v=>v==='tap').length,1);assert.equal(x.calls.filter(v=>v?.kind==='like').length,1);
});

test('mobile configuration saves only its platform so concurrent sibling edits survive',async()=>{
 const x=setup();let patch;x.c.service={request:async(action,data)=>{if(action==='load')return {mobileConfig:{bumble:{swipe:{maxSwipes:25}}}};if(action==='save')patch=data;}};await x.c.request('config',{swipe:{maxSwipes:7}});assert.deepEqual(Object.keys(patch.mobileConfig),['hinge']);
});

test('paused mobile pacing edits survive restoration and change the resumed wait while preserving the active budget and pending Like',async()=>{
 let saved;
 const checkpointStore={read:()=>saved,write:value=>{saved=structuredClone(value)}};
 const waits=[];
 const wait=ms=>{waits.push(ms);return new Promise(()=>{})};
 const x=setup(bumble(),{platform:'bumble',checkpointStore,wait});
 await x.c.request('config',{swipe:{maxSwipes:80,sessionMinutes:90,likeRatio:1,minDelaySeconds:20,maxDelaySeconds:40}});
 await x.c.request('start');
 assert.equal(waits.at(-1),30000);
 x.c.session.count=5;x.c.reservedCount=5;
 x.c.lastAction={identity:'prior-card',name:'Previous'};
 x.c.session.nextBreakAt=20;x.c.session.breakUntil=Date.now()+45000;
 await x.c.request('pause');
 const before=structuredClone(saved);
 const interval={randomizeTiming:false,delaySeconds:8,minDelaySeconds:17,maxDelaySeconds:33};
 await x.c.request('config',{swipe:{...interval,maxSwipes:500,sessionMinutes:300,breakEvery:50,likeRatio:.5}});
 assert.equal(saved.config.swipe.maxSwipes,500);
 assert.deepEqual(saved.session,{...before.session,config:{...before.session.config,...interval}});
 assert.deepEqual(saved.pendingAction,before.pendingAction);
 const restored=setup(bumble(),{platform:'bumble',checkpointStore,wait});
 await restored.c.request('start');
 assert.equal(waits.at(-1),8000);
 assert.equal(restored.c.session.count,5);
 assert.equal(restored.c.session.endsAt,before.session.endsAt);
 assert.deepEqual(restored.c.lastAction,before.pendingAction);
 await restored.c.request('pause');
});

test('a partial mobile pacing edit preserves unsubmitted active settings and rejects an invalid active delay range',async()=>{
 const x=setup(screen(),{wait:()=>new Promise(()=>{})});
 await x.c.request('start');await x.c.request('pause');
 const initial=structuredClone(x.c.session.config);
 // An earlier version may have saved different preferences alongside the paused run.
 x.c.config=Config.normalize({swipe:{minDelaySeconds:5,maxDelaySeconds:80,delaySeconds:77}},x.c.config);
 await assert.rejects(x.c.request('config',{swipe:{maxDelaySeconds:10}}),/minimum.*maximum/i);
 assert.equal(x.c.config.swipe.maxDelaySeconds,80);
 assert.deepEqual(x.c.session.config,initial);
 await x.c.request('config',{swipe:{minDelaySeconds:12}});
 assert.deepEqual(x.c.session.config,{...initial,minDelaySeconds:12});
});

test('stopping during a paused pacing save cancels its change to the active interval',async()=>{
 const x=setup(screen(),{wait:()=>new Promise(()=>{})});
 await x.c.request('start');await x.c.request('pause');
 const initial=structuredClone(x.c.session.config);
 const saving=deferred(),release=deferred();
 x.c.service.request=async action=>{assert.equal(action,'save');saving.resolve();await release.promise};
 const edit=x.c.request('config',{swipe:{randomizeTiming:false,delaySeconds:7}});
 await saving.promise;await x.c.request('stop');release.resolve();
 await assert.rejects(edit,/canceled/i);
 assert.equal(x.c.session.status,'idle');
 assert.deepEqual(x.c.session.config,initial);
});

test('Bumble confirms first pass only for the matching swipe direction',async()=>{
 for(const confirmDirection of ['left','right']){const x=setup(bumble(),{platform:'bumble',tap:()=>x.set(bumble({name:'Next',identity:'next'}))});x.android.swipeProfile=async(d,b,v,cb)=>{cb();x.set(bumble({kind:'swipeConfirm',swipeDirection:confirmDirection,identity:'confirm',controls:{confirm:control('no')}}))};if(confirmDirection==='left'){await x.c.request('act',{kind:'pass'});assert.equal(x.calls.filter(v=>v==='tap').length,1)}else{await assert.rejects(x.c.request('act',{kind:'pass'}),/transition/);assert.equal(x.calls.filter(v=>v==='tap').length,0)}}
});

test('Bumble final profile waits without resetting count when its verified queue becomes empty',async()=>{
 const empty=bumble({kind:'empty',identity:null,name:'',reason:'No more profiles within your Bumble filters.',controls:{},photos:[]});const x=setup(bumble(),{platform:'bumble',wait:ms=>ms===300000?new Promise(()=>{}):Promise.resolve()});let swipes=0;x.android.swipeProfile=async(d,b,v,issued)=>{swipes++;issued();x.set(empty)};await x.c.request('config',{scrollMin:0,scrollMax:0,swipe:{maxSwipes:30,likeRatio:1}});await x.c.request('start');await new Promise(r=>setImmediate(r));await x.c.drain();assert.equal(x.c.session.status,'running');assert.equal(x.c.session.phase,'waiting for profiles');assert.equal(x.c.session.count,1);assert.equal(swipes,1);x.c.session.stop();
});
test('Bumble empty queue starts waiting without a swipe or error',async()=>{
 const x=setup(bumble({kind:'empty',identity:null,controls:{},photos:[]}),{platform:'bumble',wait:()=>new Promise(()=>{})});await x.c.request('start');assert.equal(x.c.session.status,'running');assert.equal(x.c.session.count,0);x.c.session.stop();
});

test('Hinge cropped confirmation uses verified square evidence without relaxing photo distance',async()=>{
 let taps=0;const original='1111111111111111',confirmation=screen({kind:'like',identity:'confirmation',screenKey:'confirmation',photos:[{key:'confirmation-photo',bounds:box}],controls:{sendLike:control('send'),comment:control('comment')},composerTextVerified:true});
 const x=setup(screen(),{readEvidence:async s=>({hashes:[s.kind==='like'?'ffffffffffffffff':original],squareHashes:s.kind==='like'?[original]:[],commentText:''}),tap:()=>{taps++;x.set(taps===1?confirmation:screen({name:'Next',identity:'next',screenKey:'next'}))}});
 await x.c.request('act',{kind:'like'});assert.equal(taps,2);assert.equal(x.calls.filter(v=>v?.kind==='like').length,1);
});

test('profile review reports the reader interruption reason without issuing a Like',async()=>{const x=setup(screen(),{scroll:async()=>x.set(screen({kind:'blocked',reason:'Unrecognized profile control: Purchase caption.'}))});await x.c.request('config',{scrollMin:1,scrollMax:1});await assert.rejects(x.c.request('review'),/Profile review interrupted: Unrecognized profile control: Purchase caption/);assert.equal(x.calls.filter(v=>v==='tap').length,0);assert.equal(x.c.selectedPhoto,null);});
test('profile name changes during review remain blocked with a distinct explanation',async()=>{const x=setup(screen(),{scroll:async()=>x.set(screen({name:'Different'}))});await x.c.request('config',{scrollMin:1,scrollMax:1});await assert.rejects(x.c.request('review'),/Profile changed during review/);assert.equal(x.calls.filter(v=>v==='tap').length,0);});

function twoPhotoHinge(){
 const fs=require('node:fs'),path=require('node:path'),{readScreen}=require('../desktop/mobile-screen.cjs');
 const extra='<node package="co.hinge.app" class="android.view.View" bounds="[53,1161][1027,2135]"><node package="co.hinge.app" class="android.widget.ImageView" content-desc="Sample&apos;s photo" bounds="[53,1161][1027,2135]"/><node package="co.hinge.app" class="android.widget.Button" content-desc="Like photo" enabled="true" clickable="true" bounds="[875,1983][1001,2109]"/></node>';
 const xml=fs.readFileSync(path.join(__dirname,'fixtures/mobile/hinge-profile.xml'),'utf8').replace('Prompt: A perfect weekend. Answer: Hiking &amp; coffee.','').replaceAll('[53,642][1027,1616]','[53,181][1027,1108]').replace('</hierarchy>',extra+'</hierarchy>');
 let hashes=['0123456789abcdef','fedcba9876543210'];const x=setup(xml,{readScreen,readEvidence:async()=>({hashes})});return {...x,setHashes:value=>hashes=value};
}
test('Hinge selecting the second photo cannot change fallback identity on an unchanged screen',async()=>{const x=twoPhotoHinge();await x.c.request('config',{scrollMin:0,scrollMax:0});const prepared=await x.c.review(x.c.token());assert.equal(prepared.photos.length,2);assert.equal(x.c.selectedPhoto.key,prepared.photos[1].key);const fresh=await x.c.fresh(prepared,x.c.token());assert.equal(fresh.identity,prepared.identity);assert.equal(fresh.screenKey,prepared.screenKey);assert.ok(x.c.reviewContext);assert.equal(x.calls.filter(v=>v==='tap').length,0);});
test('Hinge still rejects a changed selected photo even when its identity anchor is unchanged',async()=>{const x=twoPhotoHinge();await x.c.request('config',{scrollMin:0,scrollMax:0});const prepared=await x.c.review(x.c.token());x.setHashes(['0123456789abcdef','aaaaaaaaaaaaaaaa']);await assert.rejects(x.c.fresh(prepared,x.c.token()),/Screen changed/);assert.equal(x.c.screen.identity,prepared.identity);assert.notEqual(x.c.screen.screenKey,prepared.screenKey);assert.equal(x.calls.filter(v=>v==='tap').length,0);});
test('Hinge still rejects changed fallback identity evidence before any photo tap',async()=>{const x=twoPhotoHinge();await x.c.request('config',{scrollMin:0,scrollMax:0});const prepared=await x.c.review(x.c.token());x.setHashes(['bbbbbbbbbbbbbbbb','fedcba9876543210']);await assert.rejects(x.c.fresh(prepared,x.c.token()),/Screen changed/);assert.notEqual(x.c.screen.identity,prepared.identity);assert.equal(x.calls.filter(v=>v==='tap').length,0);});

test('Hinge reveals a top-clipped photo by moving down instead of searching past it',async()=>{
 const partial=screen({photos:[{key:'partial',bounds:box,like:null,revealDirection:'down'}],controls:{}});
 const x=setup(partial,{scroll:()=>{if(x.calls.at(-1).direction==='down')x.set(screen())}});
 await x.c.request('config',{scrollMin:0,scrollMax:0});await x.c.request('review');
 assert.deepEqual(x.calls.filter(v=>v?.fraction).map(v=>v.direction),['down']);
 assert.equal(x.c.selectedPhoto.key,'photo-one');assert.equal(x.calls.includes('tap'),false);
});

test('zero optional Hinge scrolls still recheck a managed compressed card before searching for a verified target',async()=>{
 const surface={x:40,y:774,width:640,height:338};
 const expanded={x:40,y:576,width:640,height:536};
 const clipped=screen({scrollSurface:surface,photos:[{key:'partial',bounds:surface,like:null}]});
 const middle=screen({screenKey:'expanding',scrollSurface:expanded,photos:[{key:'more-visible',bounds:expanded,like:null}]});
 const phone={serial:'emulator-1',avd:'assigned'};
 for(const state of ['current','changed screen','cancel','new binding','missing binding','unsafe surface','custom phone']){
  const initial=state==='unsafe surface'?{...clipped,scrollSurface:null}:clipped;
  const x=setup(initial,{isManagedPhone:b=>state!=='custom phone'&&b?.avd===phone.avd});
  const binding=state==='custom phone'?{serial:phone.serial}:phone;
  x.c.binding=state==='missing binding'?null:binding;
  x.android.deviceIdentity=async()=>state==='new binding'?{...phone,avd:'another'}:binding;
  await x.c.request('config',{scrollMin:0,scrollMax:0});let reads=0,moves=0;
  x.android.hierarchy=async()=>{
   reads++;
   if(reads===2&&state==='cancel')x.android.cancelInput();
   const xml=moves===2?screen():moves===1?middle:reads===2&&state==='changed screen'?{...clipped,screenKey:'different'}:initial;
   return {xml,foreground:'co.hinge.app'};
  };
  x.android.scrollProfile=async(opts,valid)=>{
   assert.equal(valid(),true);assert.equal(reads,2*(moves+1));
   assert.deepEqual(opts.surface,moves?expanded:surface);moves++;
  };
  if(state==='current'||state==='custom phone'){
   await x.c.request('review');assert.equal(moves,2);assert.equal(x.c.selectedPhoto.key,'photo-one');
  }else{
   await assert.rejects(x.c.request('review'),/changed|cancel|surface|another device/i);
   assert.equal(moves,0);assert.equal(x.c.selectedPhoto,null);
  }
  assert.deepEqual(x.calls,[]);
 }
});
function hingePhotoBehindSkip(y=448){
 const photo={key:'first-photo',bounds:{x:40,y,width:640,height:640},like:{...control('Like photo'),bounds:{x:550,y:y+500,width:80,height:80}}};
 const skip={...control('Skip Example'),bounds:{x:40,y:948,width:124,height:124}};
 return screen({screenKey:'photo-at-'+y,photos:[photo],prompts:[],controls:{skip,like:photo.like}});
}

test('automatic Hinge plain Like moves a square photo clear of Skip before opening its confirmation',async()=>{
 const original=hingePhotoBehindSkip(),clear=hingePhotoBehindSkip(230);
 const x=setup(original,{scroll:()=>x.set(clear)});
 const opened=[];let committed=0;
 x.android.tapControl=async(bounds,valid,issued)=>{
  assert.equal(valid(),true);opened.push(bounds);issued?.();
  x.set(opened.length===1?screen({kind:'like',screenKey:'form',composerTextVerified:true,controls:{sendLike:control('Send like')}}):screen({name:'Next',identity:'next',screenKey:'next'}));
 };
 await x.c.request('config',{scrollMin:0,scrollMax:0,swipe:{likeRatio:1,browsePhotos:false}});
 await x.c.sessionStep(x.c.config.swipe,()=>true,()=>committed++,async()=>true,x.c.token());
 assert.deepEqual(x.calls.filter(value=>value?.fraction).map(value=>value.direction),['up']);
 assert.deepEqual(opened,[clear.photos[0].like.bounds,box]);assert.equal(committed,1);
});

test('automatic Hinge plain Like honors the verified static prompt beside a Skip-obscured photo',async()=>{
 const prompt={key:'static-prompt',text:'Prompt: Weekend. Answer: Hiking',bounds:box,like:control('Like prompt')};
 const original=hingePhotoBehindSkip();original.prompts=[prompt];
 const x=setup(original);const opened=[];let committed=0;
 x.android.tapControl=async(bounds,valid,issued)=>{
  assert.equal(valid(),true);opened.push(bounds);issued?.();
  x.set(opened.length===1?screen({kind:'like',screenKey:'form',identity:'prompt-preview',photos:[],prompts:[{...prompt,like:null}],composerTextVerified:true,controls:{sendLike:control('Send like')}}):screen({name:'Next',identity:'next',screenKey:'next'}));
 };
 await x.c.request('config',{scrollMin:0,scrollMax:0,swipe:{likeRatio:1}});
 await x.c.sessionStep(x.c.config.swipe,()=>true,()=>committed++,async()=>true,x.c.token());
 assert.deepEqual(opened,[prompt.like.bounds,box]);assert.equal(committed,1);assert.equal(x.c.lastAction,null);
 assert.equal(x.calls.filter(value=>value?.fraction).length,0);
});

test('persistent Hinge photo occlusion keeps the automatic review bounded and manual review can still select the photo',async()=>{
 const x=setup(hingePhotoBehindSkip());
 await x.c.request('config',{scrollMin:0,scrollMax:0,swipe:{likeRatio:1,browsePhotos:false}});
 await x.c.sessionStep(x.c.config.swipe,()=>true,()=>assert.fail('No Like issued'),async()=>true,x.c.token());
 assert.equal(x.calls.includes('tap'),false);assert.equal(x.c.lastAction,null);
 assert.equal(x.calls.filter(value=>value?.fraction).length,6);
 x.calls.length=0;await x.c.request('review');
 assert.equal(x.calls.filter(value=>value?.fraction).length,0);assert.equal(x.c.selectedPhoto.key,'first-photo');
});

test('a vanished reviewed prompt never falls back to the Skip-obscured photo',async()=>{
 const original=hingePhotoBehindSkip(),x=setup(original);
 x.c.selectedPrompt={key:'vanished',text:'Prompt: Weekend. Answer: Hiking'};
 await assert.rejects(x.c.act('like',x.c.token(),()=>true,()=>assert.fail('No Like issued'),original),/reviewed prompt/i);
 assert.equal(x.calls.includes('tap'),false);assert.equal(x.c.lastAction,null);
});

function mixedHingeCard(){
 const native=(type,label,bounds,attributes='',children='')=>
  '<node package="co.hinge.app" class="android.'+type+'" content-desc="'+label+'" bounds="'+bounds+'" enabled="true" '+attributes+'>'+children+'</node>';
 const view=(label,bounds,children='',attributes='')=>native('view.View',label,bounds,'clickable="false" '+attributes,children);
 const button=(label,bounds)=>native('widget.Button',label,bounds,'clickable="true"');
 const photo='[40,150][680,790]',prompt='[40,810][680,1080]';
 const feed=view('','[0,100][720,1200]',
  view('',photo,native('widget.ImageView',"Example's photo",photo,'clickable="false"')+button('Like photo','[500,650][580,730]'))+
  view('',prompt,view('Prompt: A perfect weekend. Answer: Hiking',prompt)+button('Like prompt','[500,960][580,1040]')),'scrollable="true"');
 const xml='<hierarchy>'+view('','[0,0][720,1280]',feed+button('Skip Example','[10,1100][90,1180]')+
  view('Discover','[0,1200][144,1280]','','selected="true"'))+'</hierarchy>';
 return require('../desktop/mobile-screen.cjs').readScreen(xml,{platform:'hinge',foreground:'co.hinge.app'});
}

async function mixedHingeRun(card,settings={}){
 const x=setup(card);
 await x.c.request('config',{scrollMin:0,scrollMax:0,swipe:{likeRatio:1},...settings});
 x.c.session.wait=()=>new Promise(()=>{});
 await x.c.request('start');
 return x;
}

test('first automatic 100% Hinge Like selects the exact static prompt when both native targets are available',async()=>{
 for(const label of ['Send like','Send priority like']){
  const card=mixedHingeCard(),prompt=card.prompts[0],x=await mixedHingeRun(card);
  const taps=[];let commits=0;
  x.android.tapControl=async(bounds,valid,issued)=>{
   assert.equal(valid(),true);taps.push(bounds);issued?.();
   x.set(taps.length===1?screen({kind:'like',screenKey:'form',identity:'prompt-form',photos:[],prompts:[{...prompt,like:null}],
    composerTextVerified:true,controls:{sendLike:control(label)}}):screen({name:'Next',identity:'next',screenKey:'next'}));
  };
  await x.c.sessionStep(x.c.session.config,()=>true,()=>commits++,async()=>true,x.c.token());
  assert.deepEqual(taps,[prompt.like.bounds,box]);assert.equal(commits,1);assert.equal(x.c.lastAction,null);
  await x.c.request('stop');
 }
});

test('first-review prompt priority requires plain 100% automation and one uniquely bindable prompt',async()=>{
 for(const variant of ['manual','mixed-rate','comment','duplicate-text','two-targets','unscoped-control','wrong-owner']){
  const card=mixedHingeCard(),prompt=card.prompts[0];
  if(variant==='duplicate-text')card.prompts.push({...prompt,key:'other',like:null});
  if(variant==='two-targets')card.prompts.push({...prompt,key:'other',text:'Prompt: Dream trip. Answer: Italy'});
  if(variant==='unscoped-control')prompt.like=control('Like');
  if(variant==='wrong-owner')card.controls.skip=control('Skip Someone else');
  const settings=variant==='mixed-rate'?{swipe:{likeRatio:.8}}:variant==='comment'?{mode:'comment'}:{};
  const x=await mixedHingeRun(card,settings);
  if(variant==='manual'){await x.c.request('pause');await x.c.request('review')}
  else await x.c.review(x.c.token(),async()=>true,card,'like');
  assert.equal(x.c.selectedPhoto?.key,card.photos[0].key,variant);assert.equal(x.c.selectedPrompt,null);
  await x.c.request('stop');
 }
});

test('a changed first-review prompt or an unverified ordinary blank Like form cannot submit',async()=>{
 for(const variant of ['changed-source','changed-form','duplicate-form','photo-in-form','rose','unverified-blank','changed-final']){
  const card=mixedHingeCard(),prompt=card.prompts[0],x=await mixedHingeRun(card);
  const token=x.c.token(),prepared=await x.c.review(token,async()=>true,card,'like');
  assert.equal(x.c.selectedPrompt?.key,prompt.key);
  if(variant==='changed-source')x.set({...card,screenKey:'changed',prompts:[]});
  const form=screen({kind:'like',identity:'form',screenKey:'form',photos:variant==='photo-in-form'?card.photos:[],
   prompts:variant==='changed-form'?[{...prompt,text:'Prompt: Different. Answer: Different'}]:variant==='duplicate-form'?[prompt,prompt]:[prompt],
   composerTextVerified:variant!=='unverified-blank',controls:{sendLike:control(variant==='rose'?'Send a Rose':'Send like')}});
  let taps=0,formReads=0;
  x.android.tapControl=async()=>{taps++;x.set(form)};
  const hierarchy=x.android.hierarchy;
  x.android.hierarchy=async()=>{
   const raw=await hierarchy();
   return raw.xml===form&&variant==='changed-final'&&++formReads===2?{...raw,xml:{...form,screenKey:'changed',prompts:[]}}:raw;
  };
  await assert.rejects(x.c.act('like',token,()=>true,()=>assert.fail('No Like issued'),prepared));
  assert.equal(taps,variant==='changed-source'?0:1,variant);assert.equal(x.c.lastAction,null);
  await x.c.request('stop');
 }
});

test('Hinge finishes aligning a clipped photo reached on the last search step',async()=>{
 const x=setup(screen({photos:[],screenKey:'text-0'}),{scroll:()=>{
  const count=x.calls.filter(v=>v?.fraction).length;
  x.set(count<6?screen({photos:[],screenKey:'text-'+count}):count===6?screen({screenKey:'edge',photos:[{key:'partial',bounds:box,like:null,revealDirection:'up'}]}):screen());
 }});
 await x.c.request('config',{scrollMin:0,scrollMax:0});await x.c.request('review');
 assert.equal(x.calls.filter(v=>v?.fraction).length,7);assert.equal(x.c.selectedPhoto.key,'photo-one');
 assert.equal(x.calls.includes('tap'),false);
});
test('Hinge alignment remains bounded when a clipped photo cannot be revealed',async()=>{
 const x=setup(screen({photos:[],screenKey:'text-0'}),{scroll:()=>{
  const count=x.calls.filter(v=>v?.fraction).length;
  x.set(count<6?screen({photos:[],screenKey:'text-'+count}):screen({screenKey:'edge-'+count,photos:[{key:'partial',bounds:box,like:null,revealDirection:'up'}]}));
 }});
 await x.c.request('config',{scrollMin:0,scrollMax:0});
 await assert.rejects(x.c.request('review'),/No fully visible photo/);
 assert.equal(x.calls.filter(v=>v?.fraction).length,8);assert.equal(x.c.selectedPhoto,null);
});
test('Hinge stopping during final photo alignment prevents selection and any Like',async()=>{
 const x=setup(screen({photos:[],screenKey:'text-0'}),{scroll:()=>{
  const count=x.calls.filter(v=>v?.fraction).length;
  if(count===7)x.c.invalidate('Stop during alignment',{stop:true});
  else x.set(count<6?screen({photos:[],screenKey:'text-'+count}):screen({screenKey:'edge',photos:[{key:'partial',bounds:box,like:null,revealDirection:'up'}]}));
 }});
 await x.c.request('config',{scrollMin:0,scrollMax:0});
 await assert.rejects(x.c.request('review'),/canceled|changed/);
 assert.equal(x.calls.filter(v=>v?.fraction).length,7);assert.equal(x.calls.includes('tap'),false);assert.equal(x.c.selectedPhoto,null);
});
test('Bumble can leave an old uncertain guard only with independently different stable static evidence',async()=>{
 const x=setup(bumble({identity:'new-photo',profileDiscriminator:'name-age-31'}),{platform:'bumble'});
 x.c.lastAction={name:'Example',identity:'old-photo',profileDiscriminator:'name-age-29'};
 let swipes=0;x.android.swipeProfile=async(d,b,v,issued)=>{assert.ok(v());swipes++;issued();x.set(bumble({name:'Next',identity:'next',screenKey:'next'}))};
 await x.c.act('like',x.c.token());assert.equal(swipes,1);assert.equal(x.c.lastAction,null);
});
test('Bumble preserves historical uncertain guards that lack static evidence',async()=>{
 const x=setup(bumble({identity:'new-photo',profileDiscriminator:'name-age-31'}),{platform:'bumble'});
 x.c.lastAction={name:'Example',identity:'old-photo'};
 x.android.swipeProfile=async()=>assert.fail('must not swipe');
 await assert.rejects(x.c.act('like',x.c.token()),/already|uncertain/);assert.ok(x.c.lastAction);
});

test('Bumble late-transition guard stays set if static evidence changes during revalidation',async()=>{
 const initial=bumble({identity:'new-photo',profileDiscriminator:'name-age-31'});
 const x=setup(initial,{platform:'bumble'});x.c.lastAction={name:'Example',identity:'old-photo',profileDiscriminator:'name-age-29'};
 let reads=0;x.android.hierarchy=async()=>({xml:++reads===1?initial:{...initial,profileDiscriminator:'name-age-29'}});
 x.android.swipeProfile=async()=>assert.fail('must not swipe');
 await assert.rejects(x.c.act('like',x.c.token()),/uncertain|changed/);assert.ok(x.c.lastAction);
});


const readFailure=()=>Object.assign(Error('Android command failed.'),{code:'ANDROID_COMMAND_FAILED'});
test('a transient Android hierarchy failure is retried with fresh evidence and no input',async()=>{
 const x=setup();let reads=0;x.android.hierarchy=async()=>{if(++reads===1)throw readFailure();return {xml:screen({screenKey:'fresh'}),foreground:'co.hinge.app'}};
 const s=await x.c.request('context');assert.equal(s.screen.screenKey,'fresh');assert.equal(reads,2);assert.deepEqual(x.calls,[]);
});
test('a transient screenshot failure discards the previous hierarchy before retrying',async()=>{
 let evidence=0;const x=setup(screen(),{readEvidence:async()=>{if(++evidence===1)throw readFailure();return {hashes:[]}}});let reads=0;x.android.hierarchy=async()=>({xml:screen({identity:++reads===1?'old':'fresh'}),foreground:'co.hinge.app'});
 const s=await x.c.request('context');assert.equal(s.screen.identity,'fresh');assert.equal(reads,2);assert.deepEqual(x.calls,[]);
});
test('persistent Android read failures stop after one retry',async()=>{
 const x=setup();let reads=0;x.android.hierarchy=async()=>{reads++;throw readFailure()};await assert.rejects(x.c.request('context'),/command failed/);assert.equal(reads,2);assert.deepEqual(x.calls,[]);
});
test('canceling during Android read recovery prevents a second read',async()=>{
 const gate=deferred(),x=setup(screen(),{wait:()=>gate.promise});let reads=0;x.android.hierarchy=async()=>{reads++;throw readFailure()};
 const job=x.c.request('context');const result=assert.rejects(job,/changed|cancel/i);await new Promise(r=>setImmediate(r));await x.c.request('stop');gate.resolve();await result;assert.equal(reads,1);assert.deepEqual(x.calls,[]);
});
test('Android command failures from taps are never automatically repeated',async()=>{
 const x=setup(screen({kind:'like',controls:{sendLike:control('send')}}),{tap:async()=>{throw readFailure()}});
 await assert.rejects(x.c.request('act',{kind:'like'}),/command failed/);assert.equal(x.calls.filter(v=>v==='tap').length,1);assert.ok(x.c.lastAction);
});


test('video-heavy profiles fall back toward the top despite changing screen revisions',async()=>{
 let moves=0,back=0;const x=setup(screen({photos:[]}),{scroll:async()=>{moves++;if(moves>6&&x.calls.at(-1).direction==='down')back++;x.set(back===7?screen():screen({photos:[],screenKey:'video-'+moves}))}});
 await x.c.request('config',{scrollMin:0,scrollMax:0});await x.c.request('review');assert.equal(x.c.selectedPhoto.key,'photo-one');assert.equal(back,7);assert.equal(x.calls.includes('tap'),false);
});
test('return-to-top recovery still stops on changed profiles before any Like',async()=>{
 let moves=0;const x=setup(screen({photos:[]}),{scroll:async()=>{moves++;x.set(screen({photos:[],screenKey:'video-'+moves,...(moves===7?{name:'Another'}:{})}))}});
 await x.c.request('config',{scrollMin:0,scrollMax:0});await assert.rejects(x.c.request('review'),/Profile changed/);assert.equal(moves,7);assert.equal(x.calls.includes('tap'),false);
});


test('a video-first next profile gathers evidence without repeating the submitted Like',async()=>{
 const next=screen({name:'Next',identity:null,photos:[],screenKey:'next-video'});const x=setup(screen({kind:'like',controls:{sendLike:control('send')}}),{tap:()=>x.set(next),scroll:()=>x.set(screen({name:'Next',identity:'next-evidence',screenKey:'next-detail'}))});
 await x.c.request('act',{kind:'like'});assert.equal(x.calls.filter(v=>v==='tap').length,1);assert.equal(x.calls.filter(v=>v?.fraction).length,1);assert.equal(x.c.lastAction,null);
});
test('review gathers evidence on video-first profiles before choosing a photo',async()=>{
 const x=setup(screen({identity:null,photos:[]}),{scroll:()=>x.set(screen())});await x.c.request('config',{scrollMin:0,scrollMax:0});await x.c.request('review');assert.equal(x.c.selectedPhoto.key,'photo-one');assert.equal(x.calls.includes('tap'),false);
});
test('identity recovery stays bounded and rejects a changed profile',async()=>{
 for(const changed of [false,true]){let moves=0;const x=setup(screen({identity:null,photos:[]}),{scroll:()=>{moves++;if(changed)x.set(screen({name:'Other'}))}});await x.c.request('config',{scrollMin:0,scrollMax:0});await assert.rejects(x.c.request('review'),/identity|Profile changed/i);assert.equal(moves,changed?1:3);assert.equal(x.calls.includes('tap'),false);}
});


const reminder=()=>bumble({kind:'chatReminder',identity:null,controls:{dismiss:control('close')},photos:[],screenKey:'reminder'});
test('Bumble closes a chat reminder after a swipe without messaging or repeating the swipe',async()=>{
 const x=setup(bumble(),{platform:'bumble',tap:()=>x.set(bumble({name:'Next',identity:'next',screenKey:'next'}))});let swipes=0,commits=0;
 x.android.swipeProfile=async(d,b,valid,issued)=>{assert.ok(valid());swipes++;issued();x.set(reminder())};
 await x.c.act('like',x.c.token(),()=>true,()=>commits++);assert.equal(swipes,1);assert.equal(commits,1);assert.equal(x.calls.filter(v=>v==='tap').length,1);assert.equal(x.c.lastAction,null);
});
test('Bumble never repeatedly closes a stuck chat reminder or repeats its swipe',async()=>{
 const x=setup(bumble(),{platform:'bumble'});let swipes=0;x.android.swipeProfile=async(d,b,valid,issued)=>{swipes++;issued();x.set(reminder())};
 await assert.rejects(x.c.act('like',x.c.token()),/popup|transition/i);assert.equal(swipes,1);assert.equal(x.calls.filter(v=>v==='tap').length,1);assert.ok(x.c.lastAction);
});

test('Bumble review dismisses a verified reminder before browsing the next card',async()=>{
 const x=setup(reminder(),{platform:'bumble',tap:()=>x.set(bumble())});await x.c.request('config',{scrollMin:0,scrollMax:0});await x.c.request('review');assert.equal(x.c.screen.kind,'profile');assert.equal(x.calls.filter(v=>v==='tap').length,1);
});

test('Bumble closes a SuperSwipe offer after a swipe without messaging or repeating the swipe',async()=>{
 const x=setup(bumble(),{platform:'bumble',tap:()=>x.set(bumble({name:'Next',identity:'next',screenKey:'next'}))});let swipes=0,commits=0;
 x.android.swipeProfile=async(d,b,valid,issued)=>{assert.ok(valid());swipes++;issued();x.set(({...reminder(),kind:'promoOffer'}))};
 await x.c.act('like',x.c.token(),()=>true,()=>commits++);assert.equal(swipes,1);assert.equal(commits,1);assert.equal(x.calls.filter(v=>v==='tap').length,1);assert.equal(x.c.lastAction,null);
});
test('Bumble never repeatedly closes a stuck SuperSwipe offer or repeats its swipe',async()=>{
 const x=setup(bumble(),{platform:'bumble'});let swipes=0;x.android.swipeProfile=async(d,b,valid,issued)=>{swipes++;issued();x.set(({...reminder(),kind:'promoOffer'}))};
 await assert.rejects(x.c.act('like',x.c.token()),/popup|transition/i);assert.equal(swipes,1);assert.equal(x.calls.filter(v=>v==='tap').length,1);assert.ok(x.c.lastAction);
});

test('Bumble review dismisses a verified offer before browsing the next card',async()=>{
 const x=setup(({...reminder(),kind:'promoOffer'}),{platform:'bumble',tap:()=>x.set(bumble())});await x.c.request('config',{scrollMin:0,scrollMax:0});await x.c.request('review');assert.equal(x.c.screen.kind,'profile');assert.equal(x.calls.filter(v=>v==='tap').length,1);
});

test('Hinge empty transition confirms issued action and waits without another input',async()=>{
 const x=setup(screen(),{wait:ms=>ms===300000?new Promise(()=>{}):Promise.resolve()});let taps=0;x.android.tapControl=async(b,valid,issued)=>{assert.ok(valid());taps++;issued?.();x.set(screen({kind:'empty',identity:null,name:'',photos:[],controls:{}}))};await x.c.request('config',{scrollMin:0,scrollMax:0,swipe:{likeRatio:0,maxSwipes:10}});await x.c.request('start');await new Promise(r=>setImmediate(r));await x.c.drain();assert.equal(x.c.session.count,1);assert.equal(x.c.session.phase,'waiting for profiles');assert.equal(taps,1);assert.equal(x.c.lastAction,null);x.c.session.stop();
});

test('pending action is durable before input and blocks replay after recreation',async()=>{
 let saved;const store={read:()=>saved,write:v=>{saved=structuredClone(v)}};const x=setup(screen({kind:'like',controls:{sendLike:control('send')}}),{checkpointStore:store});
 x.android.tapControl=async()=>{assert.ok(saved.pendingAction);throw Object.assign(Error('transport timeout'),{code:'ANDROID_COMMAND_TIMEOUT'})};
 await assert.rejects(x.c.request('act',{kind:'like'}),/timeout/);assert.ok(saved.pendingAction);
 const y=setup(screen(),{checkpointStore:store});await y.c.request('status');await assert.rejects(y.c.request('act',{kind:'pass'}),/uncertain|already/);assert.equal(y.calls.filter(x=>x==='tap').length,0);
});
test('checkpoint write failure prevents any final input',async()=>{const x=setup(screen({kind:'like',controls:{sendLike:control('send')}}),{checkpointStore:{read:()=>null,write:()=>{throw Error('disk full')}}});await assert.rejects(x.c.request('act',{kind:'like'}),/disk|checkpoint/i);assert.equal(x.calls.filter(x=>x==='tap').length,0)});
test('restored mobile session is paused with original progress and refuses another device',async()=>{
 const x=setup();await x.c.request('status');x.c.session.start({maxSwipes:1000,sessionMinutes:600});x.c.session.count=8;x.c.session.pause();let value={version:1,platform:'hinge',binding:{serial:'emulator-1'},session:x.c.session.checkpoint(),config:x.c.config,pendingAction:null,recoveryAttempts:0};const y=setup(screen(),{checkpointStore:{read:()=>value,write:v=>{value=v}},wait:()=>new Promise(()=>{})});await y.c.request('status');assert.equal(y.c.session.count,8);assert.equal(y.c.session.status,'paused');y.android.serial='different-device';await assert.rejects(y.c.request('start'),/device|binding/i);assert.equal(y.c.session.count,8);assert.equal(y.c.session.endsAt,x.c.session.endsAt);
});

test('transport failures get bounded backoff then one scoped recovery, without resetting budget',async()=>{
 const x=setup();await x.c.request('status');x.c.session.status='running';x.c.session.endsAt=Date.now()+100000;x.c.session.count=8;x.c.binding={serial:'emulator-1',avd:'Test'};let recoveries=0;x.c.recoverDevice=async()=>{recoveries++;return {restarted:true}};x.android.hierarchy=async()=>{throw Object.assign(Error('read timeout'),{code:'ANDROID_COMMAND_TIMEOUT'})};
 const t=x.c.token();for(let i=0;i<3;i++){const result=await x.c.sessionStep(x.c.config.swipe,()=>true,()=>assert.fail('no input'),async()=>true,t);assert.ok(result.retryAfter>0)}assert.equal(recoveries,1);assert.equal(x.c.session.count,8);assert.ok((await x.c.sessionStep(x.c.config.swipe,()=>true,()=>{},async()=>true,x.c.token())).retryAfter>0);assert.equal(recoveries,1);
});
test('an uncertain action prevents automatic device recovery or replay',async()=>{const x=setup();x.c.lastAction={identity:'old',name:'Old'};let recovered=0;x.c.recoverDevice=async()=>{recovered++};x.android.hierarchy=async()=>{throw Object.assign(Error('timeout'),{code:'ANDROID_COMMAND_TIMEOUT'})};assert.ok((await x.c.sessionStep(x.c.config.swipe,()=>true,()=>{},async()=>true,x.c.token())).retryAfter>0);assert.equal(recovered,0)});

test('a crash at the input boundary retains a conservative count reservation',async()=>{let saved;const x=setup(screen({kind:'like',controls:{sendLike:control('send')}}),{checkpointStore:{read:()=>null,write:v=>{saved=structuredClone(v)}}});await x.c.request('status');x.c.session.status='running';x.c.session.endsAt=Date.now()+60000;x.c.session.count=8;x.android.tapControl=async()=>{assert.equal(saved.session.count,9);assert.ok(saved.pendingAction);throw Error('process interrupted')};await assert.rejects(x.c.act('like',x.c.token()),/interrupted/);const y=setup(screen(),{checkpointStore:{read:()=>saved,write:()=>{}}});await y.c.request('status');assert.equal(y.c.session.count,9);assert.equal(y.c.session.status,'paused');assert.equal(y.c.session.endsAt,x.c.session.endsAt);});
test('Stop during scoped recovery prevents late resumption',async()=>{const gate=deferred(),x=setup();await x.c.request('status');x.c.binding={serial:'emulator-1',avd:'Test'};x.c.readFailures=2;x.c.session.status='running';x.c.session.endsAt=Date.now()+60000;x.android.hierarchy=async()=>{throw Object.assign(Error('timeout'),{code:'ANDROID_COMMAND_TIMEOUT'})};x.c.recoverDevice=async options=>{await gate.promise;assert.equal(options.valid(),false);return {restarted:true,serial:'emulator-2'}};const job=x.c.sessionStep(x.c.config.swipe,()=>x.c.session.status==='running',()=>{},async()=>true,x.c.token());await new Promise(r=>setImmediate(r));await x.c.request('stop');gate.resolve();await assert.rejects(job,/cancel/i);assert.equal(x.c.session.status,'idle');assert.equal(x.android.serial,'emulator-1');});

test('resuming an error at its deadline or count limit cannot create a fresh budget',async()=>{
 for(const exhausted of ['time','limit']){const x=setup();await x.c.request('status');const endsAt=Date.now()+(exhausted==='time'?-1:60000);Object.assign(x.c.session,{status:'error',endsAt,count:exhausted==='limit'?x.c.session.config.maxSwipes:8});await x.c.request('start');assert.equal(x.c.session.status,'complete');assert.equal(x.c.session.endsAt,endsAt);assert.equal(x.c.session.completionReason,exhausted);assert.equal(x.calls.filter(v=>v==='tap').length,0);}
});

test('verified empty feed refresh obtains a profile without resetting budget or counting a Like',async()=>{const empty=screen({kind:'empty',identity:null,photos:[],controls:{}}),x=setup(empty);await x.c.request('status');x.c.session.count=8;x.c.session.endsAt=Date.now()+600000;const end=x.c.session.endsAt;let refreshes=0;x.android.refreshFeed=async()=>{refreshes++;x.set(screen())};const result=await x.c.refreshEmpty(empty,x.c.token(),()=>true);assert.equal(result.kind,'profile');assert.equal(refreshes,1);assert.equal(x.c.session.count,8);assert.equal(x.c.session.endsAt,end);assert.equal(x.calls.filter(c=>c==='tap').length,0);});
test('empty-feed refresh cooldown persists and never refreshes profiles or uncertain actions',async()=>{const empty=screen({kind:'empty',identity:null,photos:[],controls:{}}),x=setup(empty);await x.c.request('status');let refreshes=0;x.android.refreshFeed=async()=>{refreshes++};await x.c.refreshEmpty(empty,x.c.token(),()=>true);await x.c.refreshEmpty(empty,x.c.token(),()=>true);assert.equal(refreshes,1);assert.ok(x.c.checkpoint().nextFeedRefreshAt>Date.now());await x.c.refreshEmpty(screen(),x.c.token(),()=>true);assert.equal(refreshes,1);x.c.nextFeedRefreshAt=0;x.c.lastAction={identity:'pending',name:'Pending'};await assert.rejects(x.c.refreshEmpty(empty,x.c.token(),()=>true),/uncertain|pending/i);assert.equal(refreshes,1);});
test('changed screen before feed refresh prevents relaunch',async()=>{const x=setup(screen());let refreshes=0;x.android.refreshFeed=async()=>refreshes++;await assert.rejects(x.c.refreshEmpty(screen({kind:'empty',identity:null,photos:[],controls:{}}),x.c.token(),()=>true),/changed/i);assert.equal(refreshes,0)});

test('Stop during a feed relaunch cancels later reads and preserves the deadline',async()=>{const empty=screen({kind:'empty',identity:null,photos:[],controls:{}}),x=setup(empty),gate=deferred();await x.c.request('status');x.c.session.endsAt=Date.now()+60000;const end=x.c.session.endsAt;x.android.refreshFeed=async()=>gate.promise;const job=x.c.refreshEmpty(empty,x.c.token(),()=>true);await new Promise(r=>setImmediate(r));await x.c.request('stop');gate.resolve();await assert.rejects(job,/cancel|changed/i);assert.equal(x.c.session.count,0);assert.equal(x.c.session.endsAt,end);assert.equal(x.c.session.status,'idle')});
test('feed cooldown survives controller recreation and prevents another relaunch',async()=>{const empty=screen({kind:'empty',identity:null,photos:[],controls:{}}),x=setup(empty);await x.c.request('status');await x.c.refreshEmpty(empty,x.c.token(),()=>true);const saved=x.c.checkpoint(),y=setup(empty,{checkpointStore:{read:()=>saved,write:()=>{}}});await y.c.request('status');y.android.refreshFeed=async()=>assert.fail('cooldown must survive restart');assert.equal((await y.c.refreshEmpty(empty,y.c.token(),()=>true)).kind,'empty');assert.equal(y.c.nextFeedRefreshAt,x.c.nextFeedRefreshAt)});

for(const code of ['COMMENT_FIELD_UNREADABLE','OCR_TIMEOUT'])test('transient '+code+' rebuilds hierarchy and visual evidence before proceeding',async()=>{let attempts=0,reads=0;const x=setup(screen(),{readEvidence:async()=>{if(++attempts===1)throw Object.assign(Error('Transient comment read'),{code});return {hashes:[],commentText:''}}});x.android.hierarchy=async()=>({xml:screen({identity:'observation-'+(++reads)}),foreground:'co.hinge.app'});const result=await x.c.request('context');assert.equal(attempts,2);assert.equal(reads,2);assert.equal(result.screen.identity,'observation-2');assert.deepEqual(x.calls,[]);});
test('persistent unreadable comments stop without any Like and cannot be treated as blank',async()=>{let attempts=0;const x=setup(screen({kind:'like',controls:{sendLike:control('send')}}),{readEvidence:async()=>{attempts++;throw Object.assign(Error('Comment unreadable'),{code:'COMMENT_FIELD_UNREADABLE'})}});await assert.rejects(x.c.request('act',{kind:'like'}),/unreadable/);assert.equal(attempts,2);assert.ok(!x.calls.includes('tap'));assert.equal(x.c.lastAction,null);});


test('Hinge waits once for a transient Like-form layout without repeating its photo tap',async()=>{
 let taps=0,reads=0;const blocked=screen({kind:'blocked',reason:'An unfamiliar Like control requires user attention.'}),form=screen({kind:'like',controls:{sendLike:control('send')},composerTextVerified:true});
 const x=setup(screen(),{tap:()=>{taps++;x.set(taps===1?blocked:screen({name:'Next',identity:'next'}))}});
 const base=x.c.read.bind(x.c);x.c.read=async t=>{const s=await base(t);if(s.kind==='blocked'&&++reads===1)x.set(form);return s};
 await x.c.act('like',x.c.token());assert.equal(taps,2);assert.equal(reads,1);assert.equal(x.c.lastAction,null);
});
test('Hinge persistent or changed Like forms remain blocked after a bounded reread',async()=>{
 for(const changed of [false,true]){let taps=0,reads=0;const blocked=screen({kind:'blocked',reason:'An unfamiliar Like control requires user attention.'});const x=setup(screen(),{tap:()=>{taps++;x.set(blocked)}});const base=x.c.read.bind(x.c);x.c.read=async t=>{const s=await base(t);if(s.kind==='blocked'){reads++;if(changed)x.set(screen({kind:'like',name:'Other',identity:'other',controls:{sendLike:control('send')},composerTextVerified:true}))}return s};await assert.rejects(x.c.act('like',x.c.token()),/unfamiliar|verify/i);assert.equal(taps,1);assert.equal(reads,changed?1:2);assert.equal(x.c.lastAction,null);}
});
test('Bumble reconciles a stalled swipe by refreshing once and verifying the new profile twice',async()=>{
 const original=bumble(),next=bumble({name:'Next',identity:'next',screenKey:'next'});const x=setup(original,{platform:'bumble'});let swipes=0,refreshes=0,commits=0,observations=0;
 x.android.swipeProfile=async(d,b,v,issued)=>{swipes++;issued();x.set({...original,screenKey:'settled'})};x.android.refreshFeed=async(p,v)=>{assert.equal(p,'bumble');assert.ok(v());assert.equal(x.c.lastAction.refreshAttempted,true);refreshes++;x.set(next)};
 const base=x.c.read.bind(x.c);x.c.read=async t=>{const s=await base(t);if(refreshes)observations++;return s};
 await x.c.act('like',x.c.token(),()=>true,()=>commits++);assert.equal(swipes,1);assert.equal(refreshes,1);assert.ok(observations>=2);assert.equal(commits,1);assert.equal(x.c.lastAction,null);
});
test('Bumble refresh never treats the same card or unstable new evidence as a confirmed swipe',async()=>{
 for(const mode of ['same','unstable','changed-photo']){const original=bumble({profileDiscriminator:'static'}),x=setup(original,{platform:'bumble'});let swipes=0,refreshes=0,reads=0,commits=0;x.android.swipeProfile=async(d,b,v,issued)=>{swipes++;issued();x.set({...original,screenKey:'settled'})};x.android.refreshFeed=async()=>{refreshes++;if(mode==='unstable')x.set(bumble({name:'Next',identity:'next'}));if(mode==='changed-photo')x.set({...original,identity:'other-photo'});};const base=x.c.read.bind(x.c);x.c.read=async t=>{const s=await base(t);if(refreshes&&mode==='unstable'&&++reads===1)x.set(original);return s};await assert.rejects(x.c.act('like',x.c.token(),()=>true,()=>commits++),/confirm|transition/i);assert.equal(swipes,1);assert.equal(refreshes,1);assert.equal(commits,1);assert.ok(x.c.lastAction);assert.equal(x.c.lastAction.refreshAttempted,true);}
});
test('Bumble reconciliation does not repeat a persisted refresh and cancellation prevents further reads',async()=>{
 const x=setup(bumble(),{platform:'bumble'});x.c.lastAction={identity:'original',name:'Original',refreshAttempted:true};x.android.refreshFeed=async()=>assert.fail('must not repeat');assert.equal(await x.c.reconcileBumble(bumble(),x.c.token(),()=>true),false);
 const y=setup(bumble(),{platform:'bumble'}),gate=deferred();await y.c.request('status');y.c.lastAction={identity:bumble().identity,name:bumble().name};y.android.refreshFeed=async()=>gate.promise;const job=y.c.reconcileBumble(bumble(),y.c.token(),()=>true);await new Promise(r=>setImmediate(r));await y.c.request('stop');gate.resolve();await assert.rejects(job,/cancel|changed/i);assert.ok(y.c.lastAction);
});

test('Bumble verified empty or distinct same-name profile confirms only after two post-refresh observations',async()=>{
 for(const mode of ['empty','same-name']){const original=bumble({profileDiscriminator:'old'}),next=mode==='empty'?bumble({kind:'empty',identity:null,photos:[],controls:{}}):bumble({identity:'next',profileDiscriminator:'new'});const x=setup(original,{platform:'bumble'});await x.c.request('status');x.c.lastAction={identity:original.identity,name:original.name,profileDiscriminator:'old'};x.c.session.count=7;x.c.session.endsAt=Date.now()+60000;const end=x.c.session.endsAt;let reads=0;x.android.refreshFeed=async()=>{x.set(next)};const base=x.c.read.bind(x.c);x.c.read=async t=>{const s=await base(t);if(s===next)reads++;return s};assert.equal(await x.c.reconcileBumble(original,x.c.token(),()=>true),true);assert.equal(reads,2);assert.equal(x.c.session.count,7);assert.equal(x.c.session.endsAt,end);assert.equal(x.calls.includes('tap'),false);assert.equal(x.c.lastAction,null);}
});
test('Bumble failed refresh remains durably reserved and cannot trigger a second refresh',async()=>{
 const original=bumble(),x=setup(original,{platform:'bumble'});x.c.lastAction={identity:original.identity,name:original.name};let calls=0;x.android.refreshFeed=async()=>{calls++;throw Error('transport failed')};await assert.rejects(x.c.reconcileBumble(original,x.c.token(),()=>true),/transport/);assert.equal(x.c.checkpoint().pendingAction.refreshAttempted,true);assert.equal(await x.c.reconcileBumble(original,x.c.token(),()=>true),false);assert.equal(calls,1);
});
test('Bumble cannot refresh a different pending profile or act after deadline cancellation',async()=>{
 const x=setup(bumble(),{platform:'bumble'});x.c.lastAction={identity:'other',name:'Other'};x.android.refreshFeed=async()=>assert.fail('must not refresh');assert.equal(await x.c.reconcileBumble(bumble(),x.c.token(),()=>true),false);await assert.rejects(x.c.reconcileBumble(bumble(),x.c.token(),()=>false),/cancel|changed/i);
});

test('resumed pending Bumble swipe reconciles before review without counting or issuing another swipe',async()=>{
 const original=bumble(),x=setup(original,{platform:'bumble'});await x.c.request('status');x.c.lastAction={identity:original.identity,name:original.name};x.c.session.count=9;x.c.session.endsAt=Date.now()+60000;const end=x.c.session.endsAt;x.android.refreshFeed=async()=>x.set(bumble({name:'Next',identity:'next'}));x.c.review=async()=>assert.fail('must not review during reconciliation');x.android.swipeProfile=async()=>assert.fail('must not swipe');const result=await x.c.sessionStep(x.c.config.swipe,()=>true,()=>assert.fail('must not count'),async()=>true,x.c.token());assert.ok(result.retryAfter>0);assert.equal(x.c.session.count,9);assert.equal(x.c.session.endsAt,end);assert.equal(x.c.lastAction,null);
});
test('late verified Bumble transition clears a persisted refresh guard without another refresh',async()=>{
 const original=bumble(),x=setup(bumble({name:'Next',identity:'next'}),{platform:'bumble'});x.c.lastAction={identity:original.identity,name:original.name,refreshAttempted:true};x.android.refreshFeed=async()=>assert.fail('must not refresh');assert.equal(await x.c.reconcileBumble(original,x.c.token(),()=>true),true);assert.equal(x.c.lastAction,null);
});

test('pending Hinge action resolves from two verified empty observations without another input',async()=>{
 const x=setup(screen({kind:'empty',identity:null,photos:[],controls:{}}));await x.c.request('status');x.c.lastAction={identity:'old',name:'Old'};x.c.session.count=5;const result=await x.c.sessionStep(x.c.config.swipe,()=>true,()=>assert.fail('no count'),async()=>true,x.c.token());assert.ok(result.retryAfter);assert.equal(x.c.lastAction,null);assert.equal(x.c.session.count,5);assert.equal(x.calls.includes('tap'),false);
});
test('uncertain actions keep observing and rate-limit persisted app refreshes instead of failing the session',async()=>{
 const original=bumble(),x=setup(original,{platform:'bumble'});await x.c.request('status');let now=1000,refreshes=0;x.c.session.now=()=>now;x.c.session.endsAt=900000;x.c.session.count=7;x.c.lastAction={identity:original.identity,name:original.name};x.android.refreshFeed=async()=>refreshes++;
 for(let i=0;i<4;i++){const result=await x.c.sessionStep(x.c.config.swipe,()=>true,()=>assert.fail('no count'),async()=>true,x.c.token());assert.ok(result.retryAfter);assert.match(result.phase,/verif/);}
 assert.equal(refreshes,1);assert.equal(x.c.session.count,7);assert.equal(x.c.session.endsAt,900000);const saved=x.c.checkpoint();assert.ok(saved.nextFeedRefreshAt>now);
 now=x.c.nextFeedRefreshAt+1;await x.c.sessionStep(x.c.config.swipe,()=>true,()=>assert.fail('no count'),async()=>true,x.c.token());assert.equal(refreshes,2);assert.ok(x.c.lastAction);assert.equal(x.calls.includes('tap'),false);
});
test('pending transport and OCR failures back off without releasing the action guard',async()=>{
 for(const code of ['ANDROID_COMMAND_FAILED','ANDROID_FOREGROUND_UNAVAILABLE','OCR_TIMEOUT','COMMENT_FIELD_UNREADABLE']){const x=setup();await x.c.request('status');x.c.session.count=4;x.c.session.endsAt=Date.now()+60000;x.c.lastAction={identity:'old',name:'Old'};x.c.read=async()=>{throw Object.assign(Error('temporary'),{code})};const result=await x.c.sessionStep(x.c.config.swipe,()=>true,()=>assert.fail('no count'),async()=>true,x.c.token());assert.ok(result.retryAfter);assert.ok(x.c.lastAction);assert.equal(x.c.session.count,4);}
});
test('pending action recovery remains canceled by Stop and refuses storage or binding failures',async()=>{
 for(const code of ['MOBILE_STORAGE_FAILURE','MOBILE_DEVICE_CHANGED']){const x=setup();x.c.lastAction={identity:'old',name:'Old'};x.c.read=async()=>{throw Object.assign(Error('fatal'),{code})};await assert.rejects(x.c.sessionStep(x.c.config.swipe,()=>true,()=>{},async()=>true,x.c.token()),/fatal/);}
});
test('transient unsupported layout retries observation without acting on an unknown overlay',async()=>{
 const x=setup(screen({kind:'blocked',identity:null,photos:[],controls:{},reason:'Unknown overlay'}));await x.c.request('status');let refreshes=0;x.android.refreshFeed=async()=>refreshes++;for(let i=0;i<5;i++){const result=await x.c.sessionStep(x.c.config.swipe,()=>true,()=>assert.fail('no count'),async()=>true,x.c.token());assert.ok(result.retryAfter)}assert.equal(refreshes,0);assert.equal(x.calls.includes('tap'),false);
});

test('whole session survives transient failures and completes only two real committed actions',async()=>{
 const x=setup();await x.c.request('status');let now=100000,attempts=0,commits=0;x.c.session.now=()=>now;x.c.session.wait=async ms=>{now+=ms};x.c.review=async()=>screen();x.c.act=async(k,t,v,commit)=>{if(++attempts<=2)throw Object.assign(Error('read failed'),{code:'ANDROID_COMMAND_FAILED'});commits++;commit()};x.c.session.start({...x.c.config.swipe,maxSwipes:2,sessionMinutes:1,randomizeTiming:false,delaySeconds:1,breaksEnabled:false});const end=x.c.session.endsAt;for(let i=0;i<30&&x.c.session.status==='running';i++)await new Promise(r=>setImmediate(r));assert.equal(x.c.session.status,'complete');assert.equal(x.c.session.completionReason,'limit');assert.equal(x.c.session.count,2);assert.equal(commits,2);assert.equal(attempts,4);assert.equal(x.c.session.endsAt,end);
});
test('unresolved pending action waits through multiple recovery cycles and stops at the original deadline',async()=>{
 const original=bumble(),x=setup(original,{platform:'bumble'});await x.c.request('status');let now=100000,refreshes=0;x.c.session.now=()=>now;x.c.session.wait=async ms=>{now+=ms};x.android.refreshFeed=async()=>refreshes++;x.c.lastAction={identity:original.identity,name:original.name};x.c.session.start({...x.c.config.swipe,maxSwipes:1000,sessionMinutes:1,randomizeTiming:false,delaySeconds:1,breaksEnabled:false});const end=x.c.session.endsAt;for(let i=0;i<30&&x.c.session.status==='running';i++)await new Promise(r=>setImmediate(r));assert.equal(x.c.session.status,'complete');assert.equal(x.c.session.completionReason,'time');assert.equal(x.c.session.count,0);assert.equal(x.c.session.endsAt,end);assert.equal(refreshes,1);assert.ok(x.c.lastAction);assert.equal(x.calls.includes('tap'),false);
});

test('conservative final reservation completes the limit while retaining its uncertain action',async()=>{
 const x=setup();await x.c.request('status');x.c.session.status='running';x.c.session.config.maxSwipes=1;x.c.session.endsAt=Date.now()+60000;x.c.reservedCount=1;x.c.lastAction={identity:'old',name:'Old'};x.c.pendingWait();assert.equal(x.c.session.status,'complete');assert.equal(x.c.session.completionReason,'limit');assert.equal(x.c.session.count,1);assert.ok(x.c.lastAction);
});
test('transport recovery never relaunches using a cached profile after an editor appears',async()=>{
 const x=setup();await x.c.request('status');x.c.screen=screen();x.c.readFailures=2;let reads=0,refreshes=0;x.c.read=async()=>{if(++reads===1)throw Object.assign(Error('read failed'),{code:'ANDROID_COMMAND_FAILED'});return screen({kind:'like',composerTextVerified:true,composerText:'Unsent draft'})};x.android.refreshFeed=async()=>refreshes++;const result=await x.c.sessionStep(x.c.config.swipe,()=>true,()=>assert.fail('no count'),async()=>true,x.c.token());assert.ok(result.retryAfter);assert.equal(refreshes,0);assert.ok(reads>=2);
});

test('changed photo evidence on the same pending person permits refresh but never confirms another profile',async()=>{
 const original=bumble({profileDiscriminator:'same-static'}),current=bumble({identity:'changed-photo',profileDiscriminator:'same-static'}),x=setup(current,{platform:'bumble'});x.c.lastAction={identity:original.identity,name:original.name,profileDiscriminator:original.profileDiscriminator};let refreshes=0;x.android.refreshFeed=async()=>refreshes++;assert.equal(await x.c.reconcilePending(original,x.c.token(),()=>true),false);assert.equal(refreshes,1);assert.ok(x.c.lastAction);assert.equal(x.calls.includes('tap'),false);
});

const feedError=()=>screen({kind:'feedError',name:'',identity:null,screenKey:'feed-error',photos:[],controls:{retry:control('Try again')}});
test('Hinge session retries a verified feed error without counting a profile action or clearing pending evidence',async()=>{
 const x=setup(feedError(),{tap:()=>x.set(screen())});await x.c.request('status');x.c.session.count=3;x.c.session.endsAt=Date.now()+600000;x.c.lastAction={identity:'previous',name:'Previous'};const pending=x.c.lastAction,end=x.c.session.endsAt;
 const result=await x.c.sessionStep(x.c.config.swipe,()=>true,()=>assert.fail('retry is not a Like'),async()=>true,x.c.token());
 assert.equal(x.calls.filter(v=>v==='tap').length,1);assert.equal(x.c.screen.kind,'profile');assert.equal(x.c.session.count,3);assert.equal(x.c.session.endsAt,end);assert.equal(x.c.lastAction,pending);assert.ok(result.retryAfter>0);
});
test('feed retry has a durable cooldown and never taps a changed screen',async()=>{
 const x=setup(feedError());await x.c.request('status');await x.c.sessionStep(x.c.config.swipe,()=>true,()=>assert.fail(),async()=>true,x.c.token());await x.c.sessionStep(x.c.config.swipe,()=>true,()=>assert.fail(),async()=>true,x.c.token());assert.equal(x.calls.filter(v=>v==='tap').length,1);assert.ok(x.c.checkpoint().nextFeedRetryAt>Date.now());
 const y=setup(feedError());let reads=0;y.android.hierarchy=async()=>({xml:++reads===1?feedError():screen({kind:'blocked',screenKey:'overlay'}),foreground:'co.hinge.app'});await y.c.sessionStep(y.c.config.swipe,()=>true,()=>assert.fail(),async()=>true,y.c.token());assert.equal(y.calls.filter(v=>v==='tap').length,0);
});
test('Hinge can start on a verified recoverable feed error without resetting a resumed budget',async()=>{
 const x=setup(feedError(),{wait:()=>new Promise(()=>{})});await x.c.request('status');x.c.session.status='paused';x.c.session.count=3;x.c.session.endsAt=Date.now()+600000;const end=x.c.session.endsAt;await x.c.request('start');assert.equal(x.c.session.status,'running');assert.equal(x.c.session.count,3);assert.equal(x.c.session.endsAt,end);x.c.session.pause();
});

test('native Bumble footer Like scrolls within reviewed profile and confirms next person without gesture replay',async()=>{
 const initial=bumble({actionStrategy:'footer'}),footer=bumble({actionStrategy:'footer',name:'',identity:null,photos:[],controls:{profileLike:control('Like'),profilePass:control('Not for me')}}),next=bumble({name:'Next',identity:'next',screenKey:'next'});
 const x=setup(initial,{platform:'bumble',scroll:()=>x.set(footer),tap:()=>x.set(next)});let committed=0;x.android.swipeProfile=async()=>assert.fail('native footer must not swipe');await x.c.act('like',x.c.token(),()=>true,()=>committed++);assert.equal(committed,1);assert.equal(x.calls.filter(v=>v==='tap').length,1);assert.equal(x.c.lastAction,null);assert.equal(x.c.screen.name,'Next');
});
test('Bumble footer search stops on a different named profile or unknown overlay without issuing a Like',async()=>{
 for(const after of [bumble({actionStrategy:'footer',name:'Other',identity:'other'}),bumble({kind:'blocked',reason:'overlay'})]){const x=setup(bumble({actionStrategy:'footer'}),{platform:'bumble',scroll:()=>x.set(after)});await assert.rejects(x.c.act('like',x.c.token()),/changed|interrupted|recognized/i);assert.equal(x.calls.filter(v=>v==='tap').length,0);assert.equal(x.c.lastAction,null);}
});
test('Bumble repositions a covered ordinary footer once and only votes after independent unobstructed evidence',async()=>{
 const area={x:465,y:320,width:122,height:200};
 const main=bumble({actionStrategy:'footer'}),covered=bumble({actionStrategy:'footer',screenKey:'covered',name:'',identity:null,photos:[],controls:{},footerScrollSurface:area});
 const clear=bumble({actionStrategy:'footer',screenKey:'clear',name:'',identity:null,photos:[],controls:{profileLike:control('Like'),profilePass:control('Not for me')}});
 const next=bumble({screenKey:'next',name:'Next',identity:'next'});
 for(const outcome of ['clear','still covered','changed','cancel']){
  let moves=0,committed=0;const evidence=[];
  const x=setup(main,{platform:'bumble',scroll:()=>{
   if(++moves===1)x.set(covered);
   else if(outcome==='clear')x.set(clear);
   else if(outcome==='changed')x.set(bumble({kind:'blocked',screenKey:'overlay',controls:{}}));
   else if(outcome==='cancel')x.c.invalidate('Stopped');
  },tap:()=>x.set(next)});
  const hierarchy=x.android.hierarchy;
  x.android.hierarchy=async()=>{const h=await hierarchy();evidence.push(h.xml.screenKey);return h};
  const result=x.c.act('like',x.c.token(),()=>true,()=>committed++);
  if(outcome==='clear')await result;else await assert.rejects(result);
  const scrolls=x.calls.filter(op=>op?.direction);
  assert.equal(scrolls.length,2);assert.deepEqual(scrolls[1].surface,area);assert.equal(scrolls[1].direction,'up');
  assert.equal(evidence.filter(key=>key==='covered').length>=2,true);
  assert.equal(x.calls.filter(op=>op==='tap').length,outcome==='clear'?1:0);
  assert.equal(committed,outcome==='clear'?1:0);assert.equal(x.c.lastAction,null);
  if(outcome==='clear')assert.equal(evidence.filter(key=>key==='clear').length,2);
 }
});
test('Bumble restored at a covered footer must review the main card before voting and preserves a pending Like',async()=>{
 const area={x:465,y:320,width:122,height:200};
 const covered=bumble({actionStrategy:'footer',screenKey:'covered',name:'',identity:null,photos:[],controls:{},footerScrollSurface:area});
 const clear={...covered,screenKey:'clear',footerScrollSurface:undefined,controls:{profileLike:control('Like'),profilePass:control('Not for me')}};
 const main=bumble({actionStrategy:'footer',screenKey:'main'});
 const x=setup(covered,{platform:'bumble',scroll:()=>x.set(x.calls.length===1?clear:main)});
 await x.c.request('config',{scrollMin:0,scrollMax:0});
 const prepared=await x.c.reviewBumble(x.c.token(),async()=>true);
 assert.deepEqual(x.calls.map(op=>op.direction),['up','down']);assert.equal(prepared.identity,main.identity);
 const y=setup(covered,{platform:'bumble'}),pending={identity:'previous',name:'Previous'};
 y.c.lastAction=pending;
 assert.equal(await y.c.reconcilePending(pending,y.c.token(),()=>true),false);
 assert.equal(y.c.lastAction,pending);assert.deepEqual(y.calls,[]);
});
test('Bumble footer search is bounded and cannot tap after cancellation',async()=>{
 const initial=bumble({actionStrategy:'footer'}),x=setup(initial,{platform:'bumble'});await assert.rejects(x.c.act('like',x.c.token()),/footer|ordinary Like/i);assert.ok(x.calls.filter(v=>v?.direction).length<=24);assert.equal(x.calls.filter(v=>v==='tap').length,0);
 const y=setup(initial,{platform:'bumble',scroll:()=>y.c.invalidate('Stopped')});await assert.rejects(y.c.act('like',y.c.token()),/cancel/i);assert.equal(y.calls.filter(v=>v==='tap').length,0);
});

test('video-only Hinge review can select a verified static prompt and send a plain Like',async()=>{
 const prompt={key:'prompt-one',text:'Prompt: My weekend. Answer: Hiking',bounds:box,like:control('Like prompt')},initial=screen({photos:[],prompts:[prompt],controls:{skip:control('skip'),like:null}});let taps=0;
 const x=setup(initial,{tap:()=>{taps++;x.set(taps===1?screen({kind:'like',photos:[],prompts:[{...prompt,like:null}],composerTextVerified:true,controls:{sendLike:control('send'),comment:control('comment')}}):screen({name:'Next',identity:'next',screenKey:'next'}))}});await x.c.request('config',{scrollMin:0,scrollMax:0});const prepared=await x.c.review(x.c.token());let committed=0;await x.c.act('like',x.c.token(),()=>true,()=>committed++,prepared);assert.equal(committed,1);assert.equal(taps,2);assert.equal(x.c.lastAction,null);
});
test('Hinge changed prompt confirmation never sends a Like',async()=>{
 const prompt={key:'prompt-one',text:'Prompt: My weekend. Answer: Hiking',bounds:box,like:control('Like prompt')},initial=screen({photos:[],prompts:[prompt],controls:{skip:control('skip'),like:null}});const x=setup(initial,{tap:()=>x.set(screen({kind:'like',photos:[],prompts:[{...prompt,text:'Prompt: Other. Answer: Other',like:null}],composerTextVerified:true,controls:{sendLike:control('send'),comment:control('comment')}}))});await x.c.request('config',{scrollMin:0,scrollMax:0});const prepared=await x.c.review(x.c.token());await assert.rejects(x.c.act('like',x.c.token(),()=>true,()=>assert.fail(),prepared),/prompt|verify/i);assert.equal(x.calls.filter(v=>v==='tap').length,1);
});

test('Bumble footer search rejects contradictory same-name static identity',async()=>{
 const initial=bumble({actionStrategy:'footer',profileDiscriminator:'original-age'}),changed=bumble({actionStrategy:'footer',identity:'other',profileDiscriminator:'different-age',controls:{profileLike:control('Like')}});const x=setup(initial,{platform:'bumble',scroll:()=>x.set(changed)});await assert.rejects(x.c.act('like',x.c.token()),/changed/i);assert.equal(x.calls.filter(v=>v==='tap').length,0);assert.equal(x.c.lastAction,null);
});
test('pending Bumble footer action returns to main card read-only and verifies a late transition',async()=>{
 const footer=bumble({actionStrategy:'footer',identity:null,name:'',controls:{profileLike:control('Like')}}),next=bumble({actionStrategy:'footer',name:'Next',identity:'next'});const x=setup(footer,{platform:'bumble',scroll:()=>x.set(next)});x.c.lastAction={identity:'original',name:'Original'};x.c.session.count=10;const pending=x.c.lastAction;assert.equal(await x.c.reconcilePending(pending,x.c.token(),()=>true),true);assert.equal(x.c.lastAction,null);assert.equal(x.c.session.count,10);assert.equal(x.calls.filter(v=>v==='tap').length,0);assert.equal(x.calls.filter(v=>v?.direction==='down').length,1);
});
test('pending Bumble read-only top recovery is bounded and retains guard on an unknown screen',async()=>{
 const footer=bumble({actionStrategy:'footer',identity:null,name:'',controls:{profileLike:control('Like')}}),x=setup(footer,{platform:'bumble',scroll:()=>x.set(bumble({kind:'blocked',identity:null,reason:'unknown'}))});x.c.lastAction={identity:'original',name:'Original'};assert.equal(await x.c.reconcilePending(x.c.lastAction,x.c.token(),()=>true),false);assert.ok(x.c.lastAction);assert.equal(x.calls.filter(v=>v==='tap').length,0);assert.equal(x.calls.filter(v=>v?.direction).length,1);
});

test('Hinge reopens Discover before reviewing an unbound or previously rejected blank Like form',async()=>{
 const initial=screen({photos:[],prompts:[{key:'one',text:'Prompt: Weekend. Answer: Hiking',bounds:box,like:control('Like prompt')}]}),form=screen({kind:'like',name:'Other',identity:'other',prompts:[{text:'Prompt: Other. Answer: Other'}],photos:[],composerTextVerified:true,controls:{sendLike:control('send'),comment:control('comment')}});
 const x=setup(initial,{tap:()=>x.set(form)});await x.c.request('config',{scrollMin:0,scrollMax:0,swipe:{likeRatio:1}});
 let commits=0,refreshes=0;const step=()=>x.c.sessionStep(x.c.config.swipe,()=>true,()=>commits++,async()=>true,x.c.token());await step();assert.equal(commits,0);
 x.android.refreshFeed=async()=>{refreshes++;x.set(screen({name:'New card',identity:'new'}))};
 await step();assert.equal(refreshes,1);assert.equal(x.calls.filter(v=>v==='tap').length,1);assert.equal(commits,0);assert.equal(x.c.screen.name,'New card');
});
test('Hinge blank Like form can resume the saved session but typed comments never auto-submit',async()=>{
 const form=screen({kind:'like',composerTextVerified:true,controls:{sendLike:control('send'),comment:control('comment')}}),x=setup(form,{wait:()=>new Promise(()=>{})});await x.c.request('config',{swipe:{likeRatio:1}});x.c.session.status='paused';x.c.session.count=3;x.c.session.endsAt=Date.now()+600000;await x.c.request('start');assert.equal(x.c.session.status,'running');x.c.session.pause();
 for(const fields of [{composerText:'existing comment'},{composerTextVerified:false}]){const y=setup({...form,...fields});await y.c.sessionStep(y.c.config.swipe,()=>true,()=>assert.fail(),async()=>true,y.c.token());assert.equal(y.calls.filter(v=>v==='tap').length,0);}
});

test('Bumble pending footer Like closes verified feedback prompt and confirms a different profile without voting again',async()=>{
 const feedback=bumble({...reminder(),kind:'feedbackPrompt'}),next=bumble({name:'Next',identity:'next',screenKey:'next'});
 const x=setup(feedback,{platform:'bumble',tap:()=>x.set(next)});x.c.lastAction={name:'Original',identity:'original'};x.c.session.count=1;
 assert.equal(await x.c.reconcilePending(x.c.lastAction,x.c.token(),()=>true),true);
 assert.equal(x.calls.filter(v=>v==='tap').length,1);assert.equal(x.c.session.count,1);assert.equal(x.c.lastAction,null);
});
test('resuming a pending Bumble match dismisses only Close and reconciles the previous Like against the underlying card',async()=>{
 const previous=bumble({profileDiscriminator:'original-profile'}),base=setup(previous,{platform:'bumble'});base.c.session.wait=()=>new Promise(()=>{});
 await base.c.request('config',{swipe:{maxSwipes:1000,sessionMinutes:null}});
 const {session}=await base.c.request('start');base.c.session.count=81;
 // The native footer records these three fields. The run ID belongs to the session.
 const pending=base.c.lastAction={identity:previous.identity,name:previous.name,profileDiscriminator:previous.profileDiscriminator};
 base.c.nextFeedRefreshAt=Date.now()+300000;
 await base.c.request('pause');const saved=base.c.checkpoint();
 for(const distinct of [false,true]){
  const notice={...reminder(),kind:'matchNotice'},next=distinct?bumble({name:'Next',identity:'new-card',screenKey:'next'}):previous;
  const x=setup(notice,{platform:'bumble',checkpointStore:{read:()=>structuredClone(saved),write:()=>{}}});x.c.session.wait=()=>new Promise(()=>{});
  const taps=[];let observations=0;
  x.android.tapControl=async(bounds,valid)=>{
   assert.ok(valid());assert.deepEqual(x.c.lastAction,pending);taps.push(bounds);x.set(next);
  };
  const hierarchy=x.android.hierarchy;
  x.android.hierarchy=async()=>{const raw=await hierarchy();if(raw.xml===next){observations++;assert.deepEqual(x.c.lastAction,pending)}return raw};
  const resumed=await x.c.request('start',{resumeRunId:session.runId});
  assert.equal(resumed.session.count,81);assert.equal(resumed.session.runId,session.runId);assert.deepEqual(x.c.lastAction,pending);
  await x.c.sessionStep(x.c.session.config,()=>true,()=>assert.fail('No repeated Like'),async()=>true,x.c.token());
  assert.deepEqual(taps,[notice.controls.dismiss.bounds]);assert.ok(observations>=2);
  assert.deepEqual(x.c.lastAction,distinct?null:pending);assert.equal(x.c.session.count,81);
  assert.deepEqual(x.calls.map(call=>call.kind),['session']);await x.c.request('stop');
 }
});
test('Bumble dismisses verified feedback after the ordinary footer Like before checking transition',async()=>{
 const initial=bumble({actionStrategy:'footer'}),footer=bumble({actionStrategy:'footer',name:'',identity:null,controls:{profileLike:control('Like')}}),feedback=bumble({...reminder(),kind:'feedbackPrompt'}),next=bumble({name:'Next',identity:'next',screenKey:'next'});
 let taps=0,commits=0;const x=setup(initial,{platform:'bumble',scroll:()=>x.set(footer),tap:()=>x.set(++taps===1?feedback:next)});
 await x.c.act('like',x.c.token(),()=>true,()=>commits++);assert.equal(taps,2);assert.equal(commits,1);assert.equal(x.c.lastAction,null);
});

test('Bumble restores the main card from a deep native profile without photo dwell on positioning scrolls',async()=>{
 const anonymous=bumble({actionStrategy:'footer',name:'',identity:null,photos:[],controls:{}}),main=bumble({actionStrategy:'footer'});
 let movements=0;const x=setup(anonymous,{platform:'bumble',scroll:()=>{if(++movements===12)x.set(main)}});
 await x.c.request('config',{scrollMin:0,scrollMax:0});const waits=[];
 await x.c.reviewBumble(x.c.token(),async ms=>{waits.push(ms);return true});
 assert.equal(movements,12);assert.ok(waits.every(ms=>ms<=500));assert.equal(x.calls.filter(v=>v==='tap').length,0);
});
test('native Bumble automated review continues to the footer from its verified scroll position',async()=>{
 const main=bumble({actionStrategy:'footer'}),middle=bumble({actionStrategy:'footer',name:'',identity:null,screenKey:'middle',controls:{}}),footer={...middle,screenKey:'footer',controls:{profileLike:control('Like')}},next=bumble({name:'Next',identity:'next',screenKey:'next'});
 let moves=0;const x=setup(main,{platform:'bumble',scroll:()=>{x.set(++moves===1?middle:moves===2?footer:main)},tap:()=>x.set(next)});
 await x.c.request('config',{scrollMin:1,scrollMax:1});const t=x.c.token(),prepared=await x.c.reviewBumble(t,async()=>true);let commits=0;
 await x.c.act('like',t,()=>true,()=>commits++,prepared);
 assert.deepEqual(x.calls.filter(v=>v?.direction).map(v=>v.direction),['up','up']);assert.equal(commits,1);assert.equal(x.c.screen.name,'Next');
});

test('automatic Bumble footer review with zero optional scrolls reuses the start observation and still independently checks each input',async()=>{
 const main=bumble({actionStrategy:'footer',screenKey:'main'});
 const footer=bumble({actionStrategy:'footer',screenKey:'footer',name:'',identity:null,photos:[],controls:{profileLike:control('Like')}});
 const next=bumble({screenKey:'next',name:'Next',identity:'next'});
 const events=[];
 const x=setup(main,{platform:'bumble',scroll:()=>{events.push('scroll');x.set(footer)},tap:()=>{events.push('tap');x.set(next)}});
 await x.c.request('config',{scrollMin:0,scrollMax:0,swipe:{likeRatio:1}});
 const hierarchy=x.android.hierarchy;
 x.android.hierarchy=async()=>{const result=await hierarchy();events.push(result.xml.screenKey);return result};
 await x.c.sessionStep(x.c.config.swipe,()=>true,()=>events.push('commit'),async()=>true,x.c.token());
 assert.deepEqual(events,['main','main','scroll','footer','footer','tap','next','commit']);
 assert.equal(x.c.lastAction,null);
});

test('a changed or canceled automatic Bumble card cannot reach the first footer scroll',async()=>{
 for(const interrupt of ['changed','cancel']){
  const main=bumble({actionStrategy:'footer',screenKey:'main'}),other=bumble({actionStrategy:'footer',screenKey:'different',name:'Other',identity:'other'});
  const x=setup(main,{platform:'bumble'});
  await x.c.request('config',{scrollMin:0,scrollMax:0,swipe:{likeRatio:1}});
  const hierarchy=x.android.hierarchy;let reads=0;
  x.android.hierarchy=async()=>{
   const result=await hierarchy();
   if(++reads===1){if(interrupt==='changed')x.set(other);else x.c.invalidate('Paused')}
   return result;
  };
  const step=x.c.sessionStep(x.c.config.swipe,()=>true,()=>assert.fail('must not vote'),async()=>true,x.c.token());
  if(interrupt==='cancel')await assert.rejects(step,/cancel/i);
  else assert.ok((await step).retryAfter>0);
  assert.deepEqual(x.calls,[]);
  assert.equal(x.c.lastAction,null);
 }
});

async function oneBumbleFooter({managed=true,scrollProfile=true,scrollMax=0,browsePhotos=false,manual=false,interrupt}={}){
 const main=bumble({actionStrategy:'footer',screenKey:'main'});
 const footer=bumble({actionStrategy:'footer',screenKey:'footer',name:'',identity:null,photos:[],controls:{profileLike:control('Like')}});
 const next=bumble({screenKey:'next',name:'Next',identity:'next'});
 const events=[];
 const x=setup(main,{platform:'bumble',random:()=>0,isManagedPhone:binding=>managed&&binding?.avd==='assigned',
  wait:async ms=>{events.push(ms)},tap:()=>{events.push('tap');x.set(next)},
  scroll:async()=>{
   events.push('scroll');
   if(interrupt==='pause')await x.c.request('pause');
   if(interrupt==='device')x.android.serial='different-device';
   x.set(interrupt==='card'?{...footer,name:'Different'}:footer);
  }});
 x.android.deviceIdentity=async()=>({serial:x.android.serial,avd:'assigned'});
 const hierarchy=x.android.hierarchy;
 x.android.hierarchy=async()=>{const sample=await hierarchy();events.push(sample.xml.screenKey);return sample};
 await x.c.request('config',{scrollMin:0,scrollMax,swipe:{scrollProfile,browsePhotos,likeRatio:1,maxSwipes:1}});
 if(manual)await x.c.request('act',{kind:'like'});
 else{
  const first=deferred(),retry=deferred();let started=false;
  x.c.session.wait=()=>{if(started)return retry.promise;started=true;return first.promise};
  await x.c.request('start');first.resolve();
  await new Promise(resolve=>setImmediate(resolve));await x.c.drain();
  if(x.c.session.status==='running')await x.c.request('pause');
  retry.resolve();
 }
 return {events,moves:x.calls.filter(call=>call?.direction),count:x.c.session.count,pending:x.c.lastAction};
}

test('an unpaced managed Bumble session reads the footer immediately after the shorter vertical gesture',async()=>{
 for(const settings of [{scrollMax:0},{scrollProfile:false,scrollMax:2}]){
  const {events,moves,count}=await oneBumbleFooter(settings);
  assert.deepEqual(moves,[{fraction:.65,direction:'up',duration:250}]);
  assert.deepEqual(events.slice(events.indexOf('scroll'),events.indexOf('tap')+1),['scroll','footer','footer','tap']);
  assert.equal(count,1);
 }
});

test('custom, user-paced and manual Bumble footer navigation retain the normal gesture and settle wait',async()=>{
 for(const settings of [{managed:false},{browsePhotos:true},{scrollMax:1},{manual:true}]){
  const {events,moves}=await oneBumbleFooter(settings);
  assert.deepEqual(moves,[{fraction:.65,direction:'up',duration:400}]);
  assert.deepEqual(events.slice(events.indexOf('scroll'),events.indexOf('tap')+1),['scroll',450,'footer','footer','tap']);
 }
});

test('a pause, different device or different profile during the managed Bumble footer gesture prevents a vote',async()=>{
 for(const interrupt of ['pause','device','card']){
  const {events,moves,count,pending}=await oneBumbleFooter({interrupt});
  assert.deepEqual(moves,[{fraction:.65,direction:'up',duration:250}]);
  assert.ok(!events.includes('tap'));assert.equal(count,0);assert.equal(pending,null);
 }
});

test('Bumble independently observes the screen before any optional or positioning review scroll',async()=>{
 const main=bumble({actionStrategy:'footer'}),deep=bumble({actionStrategy:'footer',identity:null,name:'',photos:[],controls:{}});
 for(const [initial,scrolls] of [[main,1],[deep,0]]){
  const x=setup(initial,{platform:'bumble'});
  await x.c.request('config',{scrollMin:scrolls,scrollMax:scrolls,swipe:{likeRatio:1}});
  const hierarchy=x.android.hierarchy;let reads=0;
  x.android.hierarchy=async()=>{
   const result=await hierarchy();
   if(++reads===1)x.set(bumble({kind:'blocked',identity:null,controls:{},reason:'Overlay'}));
   return result;
  };
  const outcome=await x.c.sessionStep(x.c.config.swipe,()=>true,()=>assert.fail('must not vote'),async()=>true,x.c.token());
  assert.ok(outcome.retryAfter>0);assert.equal(reads,2);assert.deepEqual(x.calls,[]);
 }
});

const loadingDiscover = () => screen({kind:'feedLoading', name:'', identity:null, screenKey:'discover-shell', photos:[], controls:{}});
async function loadingHinge(managed=true) {
 const phone = {serial:'emulator-1', avd:'assigned'};
 const x = setup(loadingDiscover(), {isManagedPhone:binding=>managed && binding?.avd===phone.avd});
 await x.c.request('status');
 x.android.deviceIdentity = async () => phone;
 x.c.binding = phone;
 x.c.session.status = 'running';
 x.c.session.count = x.c.reservedCount = 4;
 x.c.session.endsAt = Date.now()+1200000;
 x.c.lastAction = {identity:'previous-person', name:'Previous'};
 x.run = (sleep=async()=>true) => x.c.sessionStep(x.c.config.swipe,()=>true,()=>assert.fail('shell must never commit an action'),sleep,x.c.token());
 return x;
}

test('blank Discover shell allows loading before one managed relaunch and preserves an uncertain Like', async () => {
 const x = await loadingHinge();
 const guard=x.c.lastAction, deadline=x.c.session.endsAt;
 const delays=[];
 let launches=0;
 x.android.refreshFeed=async (platform,valid,_wait,beforeStop)=>{
  await beforeStop();
  assert.equal(platform,'hinge'); assert.equal(valid(),true); assert.ok(x.c.checkpoint().nextFeedRefreshAt>Date.now());
  assert.equal(x.c.checkpoint().pendingAction,launches === 0 ? guard : null); launches++;
 };
 const result=await x.run(async ms=>{delays.push(ms);return true});
 assert.ok(delays.some(ms=>ms>=30000)); assert.equal(launches,1); assert.ok(result.retryAfter>0);
 assert.equal(x.c.lastAction,guard); assert.equal(x.c.session.count,4); assert.equal(x.c.session.endsAt,deadline);
 x.c.nextFeedRefreshAt=0;
 await x.run(); assert.equal(launches,1,'a permanently blank feed must not be relaunched repeatedly');
 const saved=x.c.checkpoint(), y=await loadingHinge();
 y.c.restoreCheckpoint(saved); y.c.session.status='running';
 y.android.refreshFeed=async()=>assert.fail('restart must not re-arm the same blank episode');
 await y.run(); assert.deepEqual(y.c.lastAction,guard); assert.equal(y.c.session.endsAt,deadline);
 x.set(screen()); await x.run(); assert.equal(x.c.lastAction,null,'a verified changed card may then reconcile');
 x.set(loadingDiscover()); await x.run(); assert.equal(launches,2,'new episode after a verified profile');
 assert.deepEqual(x.calls,[]);
});
test('blank Discover shell skips relaunch on a changed screen, unowned device or interrupted grace period', async () => {
 for (const condition of ['normal card', 'overlay', 'unmanaged', 'canceled', 'cooldown']) {
  const x=await loadingHinge(condition!=='unmanaged');
  x.android.refreshFeed=async()=>assert.fail('should not relaunch: '+condition);
  if(condition==='cooldown')x.c.nextFeedRefreshAt=Date.now()+120000;
  const result=await x.run(async()=>{
   if(condition==='normal card')x.set(screen());
   if(condition==='overlay')x.set(screen({kind:'blocked',identity:null,screenKey:'overlay'}));
   return condition!=='canceled';
  });
  assert.ok(result.retryAfter>0); assert.equal(x.c.session.count,4); assert.ok(x.c.lastAction); assert.deepEqual(x.calls,[]);
 }
});
test('paused managed Hinge can resume on a verified blank Discover shell with the existing deadline', async () => {
 const x=await loadingHinge();x.c.wait=()=>new Promise(()=>{});x.c.session.wait=x.c.wait;
 x.c.session.status='paused';const deadline=x.c.session.endsAt;
 try {const started=await x.c.request('start');assert.equal(started.session.status,'running');assert.equal(started.session.count,4);assert.equal(started.session.endsAt,deadline);assert.ok(x.c.lastAction)}
 finally {await x.c.request('pause')}
});

test('blank Discover preflight can recover after cooldown, uncertain force-stop acknowledgement cannot be replayed', async () => {
 const x=await loadingHinge(), guard=x.c.lastAction;
 let attempts=0, mutations=0;
 x.android.refreshFeed=async(_platform,_valid,_wait,beforeStop)=>{
  attempts++;
  if(attempts===1)throw Object.assign(Error('launcher lookup timed out'),{code:'ANDROID_COMMAND_TIMEOUT'});
  await beforeStop();
  assert.equal(x.c.checkpoint().loadingFeedRelaunched,true);
  mutations++;
  throw Object.assign(Error('stop acknowledgement timed out'),{code:'ANDROID_COMMAND_TIMEOUT'});
 };
 await x.run(); assert.equal(attempts,1); assert.equal(x.c.checkpoint().loadingFeedRelaunched,false);
 await x.run(); assert.equal(attempts,1);
 x.c.nextFeedRefreshAt=0; await x.run(); assert.equal(mutations,1);
 x.c.nextFeedRefreshAt=0; await x.run(); assert.equal(attempts,2); assert.equal(x.c.lastAction,guard);
});

test('Hinge binds a deep photo preview only within the reviewed plain Like operation',async()=>{
 const digest=require('node:crypto').createHash;
 const patch=(kind,seed)=>{
  const windows=[.3,1.7,2.9].map(shift=>{
   const bitmap=Buffer.alloc(9*8*4,255);
   for(let i=0;i<72;i++)for(let channel=0;channel<3;channel++)bitmap[i*4+channel]=Math.round(120+90*Math.sin(seed+i*.68+channel+shift));
   return bitmap;
  });
  return {kind,windows,digest:digest('sha256').update(Buffer.concat(windows)).digest('hex')};
 };
 for (const variant of ['ordinary','wrong-photo','changed-recipient','typed-comment','overlay','changed-on-final-read','duplicate-source','nonselected-source-only','selected-of-two']) {
  const sourcePatch=patch('profile',.2),rightPreview=patch('like',.2),wrongPreview=patch('like',2);
  const form=screen({kind:'like',name:variant==='changed-recipient'?'Another':'Example',identity:'form-only',screenKey:'form',photos:[{key:'preview',bounds:box}],controls:{sendLike:control('send'),comment:control('comment')},composerTextVerified:true,composerText:variant==='typed-comment'?'text':''});
  const shown=variant==='overlay'?screen({kind:'blocked',reason:'Unrecognized overlay.'}):form;
  const source=screen(), comparison=patch('profile',2);
  const twoSources=['duplicate-source','nonselected-source-only','selected-of-two'].includes(variant);
  if(twoSources)source.photos.push({key:'photo-two',bounds:{...box,y:box.y+box.height+1},like:control('other-photo')});
  const sourceSamples=twoSources
   ? [variant==='nonselected-source-only'?comparison:sourcePatch,variant==='selected-of-two'?comparison:sourcePatch]
   : [sourcePatch];
  let taps=0,reads=0;
  const x=setup(source,{readScreen:xml=>structuredClone(xml),readEvidence:async s=>{
   if(s.kind==='like')reads++;
   const preview=variant==='wrong-photo'||(variant==='changed-on-final-read'&&reads>1)?wrongPreview:rightPreview;
   return {hashes:s.photos.map(()=>s.kind==='like'?'ffffffffffffffff':'1111111111111111'),patchEvidence:s.kind==='like'?[preview]:sourceSamples,commentText:s.composerText};
  },tap:()=>{taps++;x.set(taps===1?shown:screen({name:'Next',identity:'new-profile',screenKey:'next'}));}});
  if(twoSources)x.c.selectedPhoto=source.photos[0];
  if(variant==='ordinary'||variant==='selected-of-two'){
   await x.c.request('act',{kind:'like'});assert.equal(taps,2,variant);assert.equal(x.calls.filter(v=>v?.kind==='like').length,1);
  }else{
   await assert.rejects(x.c.request('act',{kind:'like'}));assert.equal(taps,1,variant);assert.equal(x.calls.filter(v=>v?.kind==='like').length,0,variant);
  }
  assert.ok(!JSON.stringify(x.c.snapshot()).includes('windows'), 'raw image samples remain local');
  assert.ok(!JSON.stringify(x.c.checkpoint()).includes('windows'), 'raw image samples never enter a checkpoint');
 }
});

function confirmedSkipFixture({count=74,limit=1000,extra={}}={}){
 const current=screen({controls:{skip:{...control('native-skip'),label:'Skip Example'}}});
 let saved;
 const x=setup(current,{checkpointStore:{read:()=>null,write:value=>{saved=structuredClone(value)}},...extra});
 const step=()=>x.c.sessionStep(x.c.session.config,()=>true,()=>assert.fail('Unexpected worker action'),async()=>true,x.c.token());
 async function prepare(){
  await x.c.request('status');
  const s=x.c.session;
  s.status='running';s.count=count;s.endsAt=Date.now()+3600000;
  s.config={...s.config,likeRatio:1,maxSwipes:limit,breaksEnabled:true};
  s.nextBreakAt=count+1;s.breakUntil=null;x.c.reservedCount=count;
  x.c.binding={serial:x.android.serial,avd:'hinge-phone'};x.android.deviceIdentity=async()=>({...x.c.binding});
  x.c.lastAction={kind:'like',sessionEndsAt:s.endsAt,name:'Example',identity:'earlier-photo'};
  x.c.nextFeedRefreshAt=Date.now()+300000;await step();
 }
 return {...x,current,prepare,step,saved:()=>saved,offer:()=>x.c.snapshot().pendingSkipOffer,
  confirm:token=>x.c.request('confirmPendingSkip',{token})};
}
test('one-card Skip reserves once before input and worker independently verifies transition',async()=>{
 const x=confirmedSkipFixture();await x.prepare();
 const offer=x.offer();assert.deepEqual(Object.keys(offer).sort(),['expiresAt','name','token']);
 assert.equal(offer.name,'Example');assert.ok(offer.expiresAt>Date.now());assert.ok(offer.token.length>=20);
 const deadline=x.c.session.endsAt;
 let taps=0;
 x.android.tapControl=async(bounds,valid,issued)=>{
  assert.equal(valid(),true);assert.deepEqual(bounds,box);assert.equal(x.saved().session.count,75);
  assert.equal(x.saved().pendingAction.kind,'pass');assert.equal(x.saved().pendingAction.identity,x.current.identity);
  taps++;issued();
 };
 const outcomes=await Promise.allSettled([x.confirm(offer.token),x.confirm(offer.token)]);
 assert.deepEqual(outcomes.map(r=>r.status),['fulfilled','rejected']);assert.equal(taps,1);
 assert.equal(x.offer(),null);assert.equal(x.c.session.count,75);assert.equal(x.c.session.endsAt,deadline);
 assert.equal(x.c.session.nextBreakAt,75);assert.equal(x.c.session.breakUntil,null);
 await x.step();assert.equal(x.offer(),null);assert.equal(x.c.lastAction.kind,'pass');
 x.set(screen({identity:'new',name:'Next'}));await x.step();assert.equal(x.c.lastAction,null);
 assert.deepEqual(x.calls.map(r=>r.kind),['pass']);
});
test('one-card Skip expires on observed away-and-back, changed fresh evidence, deadline, timeout or cancellation',async()=>{
 for(const scenario of ['away','changed','expired','deadline','pause','stop','device','draft','break']){
  const x=confirmedSkipFixture();await x.prepare();const token=x.offer().token,guard=x.c.lastAction;
  if(scenario==='away'){x.set(screen({kind:'blocked'}));await x.c.request('context');x.set(x.current);await x.c.request('context')}
  if(scenario==='changed')x.set({...x.current,screenKey:'changed'});
  if(scenario==='expired')x.c.session.now=()=>Date.now()+300000;
  if(scenario==='deadline')x.c.session.endsAt=Date.now()-1;
  if(scenario==='pause'||scenario==='stop')await x.c.request(scenario);
  if(scenario==='device')x.android.deviceIdentity=async()=>({serial:x.android.serial,avd:'another-phone'});
  if(scenario==='draft')x.c.draft={text:'draft'};
  if(scenario==='break')x.c.session.breakUntil=Date.now()+60000;
  await assert.rejects(x.confirm(token),undefined,scenario);assert.equal(x.c.lastAction,guard,scenario);
  assert.equal(x.c.session.count,74);assert.deepEqual(x.calls,[]);
 }
});
test('one-card Skip never opens from an in-flight Like, ambiguous legacy guard, other screen, or a pending pass',async()=>{
 for(const scenario of ['inflight','unknown','pass','offer','other-session','other-name','unverified-control','other-screen']){
  const x=confirmedSkipFixture();await x.prepare();
  x.c.lastAction={...x.c.lastAction};
  if(scenario==='inflight'){x.c.reserveAction({...x.c.lastAction});await x.c.read(x.c.token())}
  if(scenario==='unknown')delete x.c.lastAction.kind;
  if(scenario==='pass')x.c.lastAction.kind='pass';
  if(scenario==='offer')x.c.lastAction.offerKey='offer';
  if(scenario==='other-session')x.c.lastAction.sessionEndsAt--;
  if(scenario==='other-name')x.set({...x.current,name:'Other'});
  if(scenario==='unverified-control')x.set({...x.current,controls:{skip:control('skip')}});
  if(scenario==='other-screen')x.set({...x.current,kind:'like'});
  if(scenario!=='inflight')await x.step();
  assert.equal(x.offer(),null,scenario);assert.deepEqual(x.calls,[]);
 }
});
test('one-card Skip at limit keeps its durable reservation on lost acknowledgement and restart',async()=>{
 const x=confirmedSkipFixture({count:999});await x.prepare();const token=x.offer().token;
 x.android.tapControl=async()=>{assert.equal(x.saved().session.count,1000);throw Error('Lost acknowledgement')};
 await assert.rejects(x.confirm(token),/acknowledgement/);assert.equal(x.c.session.count,1000);
 assert.equal(x.c.session.status,'complete');assert.equal(x.c.session.completionReason,'limit');
 const restored=setup();restored.c.restoreCheckpoint(x.saved());
 assert.equal(restored.c.session.count,1000);assert.equal(restored.c.lastAction.kind,'pass');
 assert.equal(restored.c.snapshot().pendingSkipOffer,null);await assert.rejects(x.confirm(token));
});
test('one-card Skip declines failed storage and leaves the original count and Like guard on disk',async()=>{
 const x=confirmedSkipFixture();await x.prepare();const token=x.offer().token;
 const write=x.c.checkpointStore.write;
 x.c.checkpointStore.write=value=>{if(value.pendingAction?.kind==='pass')throw Error('No space');write(value)};
 await assert.rejects(x.confirm(token),/No space/);assert.deepEqual(x.calls,[]);
 assert.equal(x.c.lastAction.kind,'like');assert.equal(x.saved().pendingAction.kind,'like');
 assert.equal(x.c.session.count,74);assert.equal(x.c.reservedCount,74);assert.equal(x.saved().session.count,74);
 assert.equal(x.offer(),null);assert.notEqual(x.c.session.status,'running');
});
test('one-card Skip rejects an observation interrupted before a successful retry on the same card',async()=>{
 const x=confirmedSkipFixture();await x.prepare();const token=x.offer().token;
 const read=x.android.hierarchy;let first=true;x.android.hierarchy=async()=>{
  if(first){first=false;throw Object.assign(Error('Interrupted observation'),{code:'ANDROID_COMMAND_FAILED'})}
  return read();
 };
 await assert.rejects(x.confirm(token));assert.deepEqual(x.calls,[]);assert.equal(x.c.session.count,74);
});
test('one-card Skip tokens cannot survive a relaunch or server restart',async()=>{
 const x=confirmedSkipFixture();await x.prepare();const token=x.offer().token;
 x.c.nextFeedRefreshAt=0;await x.step();const renewed=x.offer().token;
 assert.notEqual(token,renewed);await assert.rejects(x.confirm(token));assert.deepEqual(x.calls,[]);
 const restored=setup(x.current,{checkpointStore:{read:x.saved,write:()=>{}}});await restored.c.request('status');
 assert.equal(restored.c.session.status,'paused');assert.equal(restored.c.snapshot().pendingSkipOffer,null);
 await assert.rejects(restored.c.request('confirmPendingSkip',{token:renewed}));
});
test('one-card Skip remains budgeted when paused between reservation and device input',async()=>{
 const x=confirmedSkipFixture();await x.prepare();const token=x.offer().token;
 x.android.tapControl=async(_bounds,valid)=>{await x.c.request('pause');assert.equal(valid(),false);throw Error('Canceled before input')};
 await assert.rejects(x.confirm(token));assert.deepEqual(x.calls,[]);assert.equal(x.saved().session.count,75);
 assert.equal(x.saved().pendingAction.kind,'pass');assert.equal(x.saved().session.status,'paused');
 const restored=setup();restored.c.restoreCheckpoint(x.saved());assert.equal(restored.c.session.count,75);
 assert.equal(restored.c.session.nextBreakAt,75);assert.equal(restored.c.lastAction.kind,'pass');
});
test('one-card Skip becomes available for an uncertain ordinary Like only after the worker has verified the held card',async()=>{
 const x=confirmedSkipFixture();await x.prepare();const like=screen({kind:'like',controls:{sendLike:control('Send Like')}});
 x.set(like);x.c.lastAction=null;const holds=deferred(),release=deferred();
 x.android.tapControl=async(_bounds,valid,issued)=>{
  assert.equal(valid(),true);issued();x.set(x.current);
  await x.c.read(x.c.token());holds.resolve();await release.promise;
 };
 const submitting=x.c.submitLike(like,x.current,x.c.token(),()=>true,()=>x.c.session.count++);
 await holds.promise;assert.equal(x.offer(),null);assert.equal(x.saved().pendingAction.kind,'like');
 assert.equal(x.saved().pendingAction.sessionEndsAt,x.c.session.endsAt);release.resolve();
 await assert.rejects(submitting,/confirm the action transition/);assert.equal(x.offer(),null);
 x.c.session.nextBreakAt++;await x.step();assert.ok(x.offer()?.token);
 assert.equal(x.c.session.count,75);assert.deepEqual(x.calls.map(a=>a.kind),['like']);
});
test('one-card Skip keeps the same offer during a read-only poll while the UI is busy',async()=>{
 const x=confirmedSkipFixture();await x.prepare();const offer=x.offer();const ready=deferred(),release=deferred();
 x.android.hierarchy=async()=>{ready.resolve();await release.promise;return {xml:x.current,foreground:'co.hinge.app'}};
 const polling=x.c.request('context');await ready.promise;
 assert.equal(x.c.snapshot().busy,true);assert.deepEqual(x.offer(),offer);release.resolve();await polling;
 assert.deepEqual(x.offer(),offer);
});
test('one-card Skip keeps the session complete when a paced worker queues behind the final slot',async()=>{
 const x=confirmedSkipFixture({count:999});await x.prepare();
 const s=x.c.session,asleep=deferred(),wake=deferred(),workerQueued=deferred(),issued=deferred(),ack=deferred();
 s.controller=new AbortController();s.wait=async()=>{asleep.resolve();await wake.promise};
 const act=s.act;
 s.act=(...args)=>{const job=act(...args);workerQueued.resolve();return job};
 x.android.tapControl=async(_bounds,valid,onIssued)=>{
  assert.equal(valid(),true);onIssued();issued.resolve();await ack.promise;
 };
 const runner=s.run(s.epoch);await asleep.promise;
 const click=x.confirm(x.offer().token);await issued.promise;
 wake.resolve();await workerQueued.promise;ack.resolve();
 await Promise.all([click,runner]);
 assert.equal(s.status,'complete');assert.equal(s.completionReason,'limit');assert.equal(s.count,1000);
 assert.equal(x.saved().session.status,'complete');assert.equal(x.saved().pendingAction.kind,'pass');
 assert.deepEqual(x.calls.map(action=>action.kind),['pass']);
});

function repeatedPhotoFixture({scroll=false,readEvidence}={}){
 const failedPhoto={key:'first-position',bounds:box,like:control('Like photo'),visual:'123456789abcdef0'};
 const root=screen({photos:[failedPhoto],reviewScrollSurface:{x:80,y:150,width:360,height:350}});
 const form=screen({kind:'like',identity:'preview-identity',screenKey:'preview',photos:[{key:'preview',visual:'ffffffffffffffff'}],
  composerTextVerified:true,controls:{sendLike:control('Send Like')}});
 const prompt={key:'native-prompt',bounds:box,text:'Prompt: First date. Answer: Hiking',like:{...control('Like prompt'),bounds:{...box,x:100}}};
 let saved,commits=0;
 const x=setup(root,{readEvidence,checkpointStore:{read:()=>null,write:cp=>{saved=structuredClone(cp)}}});
 x.android.deviceIdentity=async()=>({serial:x.android.serial});
 const step=()=>x.c.sessionStep(x.c.session.config,()=>x.c.session.status==='running'&&x.c.session.now()<x.c.session.endsAt,
  ()=>{commits++;x.c.session.count++},async()=>true,x.c.token());
 async function prepare(){
  await x.c.request('config',{scrollMin:0,scrollMax:0,swipe:{likeRatio:1,scrollProfile:scroll,browsePhotos:false}});
  const s=x.c.session;s.status='running';s.endsAt=Date.now()+600000;s.config={...x.c.config.swipe,maxSwipes:100};s.count=x.c.reservedCount=4;
  x.c.binding={serial:x.android.serial};x.android.tapControl=async(_bounds,valid)=>{assert.equal(valid(),true);x.calls.push('open');x.set(form)};
  await step();assert.equal(commits,0);assert.equal(x.c.lastAction,null);assert.equal(x.c.session.count,4);
 }
 async function reopen(card){
  x.c.nextFeedRefreshAt=0;x.android.refreshFeed=async()=>x.set(card);await step();
 }
 return {...x,root,form,prompt,failedPhoto,prepare,reopen,step,saved:()=>saved,commits:()=>commits};
}
test('rejected Hinge photo reopens Discover, ignores its moved alias and binds an exact alternate prompt',async()=>{
 const x=repeatedPhotoFixture();await x.prepare();
 const hint=x.saved().rejectedPhoto;assert.ok(hint);assert.ok(!JSON.stringify(hint).includes('Example'));
 const alias={...x.failedPhoto,key:'changed-position',bounds:{...box,y:75}};
 await x.reopen({...x.root,screenKey:'fresh-root',photos:[alias],prompts:[x.prompt]});
 const opened=[];x.android.tapControl=async(bounds,valid,issued)=>{
  assert.equal(valid(),true);opened.push(bounds);issued?.();
  x.set(opened.length===1?{...x.form,photos:[],prompts:[{...x.prompt,like:null}]}:screen({name:'Next',identity:'next'}));
 };
 await x.step();assert.deepEqual(opened,[x.prompt.like.bounds,box]);assert.equal(x.commits(),1);
 assert.equal(x.saved().rejectedPhoto??null,null);assert.equal(x.c.session.count,5);
});
test('rejected Hinge photo holds without any repeated opening if no verified alternate exists, including after restore',async()=>{
 const x=repeatedPhotoFixture();await x.prepare();await x.reopen(x.root);const opens=x.calls.length;
 await x.step();await x.step();assert.equal(x.calls.length,opens);assert.match(x.c.reason,/alternate/i);assert.equal(x.c.session.count,4);
 const cp=x.saved();assert.ok(cp.rejectedPhoto);
 const y=setup(x.root,{checkpointStore:{read:()=>cp,write:()=>{}}});await y.c.request('status');assert.equal(y.c.session.status,'paused');
 y.c.session.status='running';await y.c.sessionStep(cp.session.config,()=>true,()=>assert.fail(),async()=>true,y.c.token());
 assert.deepEqual(y.calls,[]);assert.match(y.c.reason,/alternate/i);
});
test('rejected Hinge photo leaves distinct same-name cards on the ordinary review path',async()=>{
 const x=repeatedPhotoFixture();await x.prepare();const different={...x.root,identity:'different-person',screenKey:'different',
  photos:[{...x.failedPhoto,visual:'eeeeeeeeeeeeeeee'}],prompts:[x.prompt]};
 await x.reopen(different);const opened=[];
 x.android.tapControl=async(bounds,valid,issued)=>{assert.equal(valid(),true);opened.push(bounds);issued?.();x.set(opened.length===1?{...x.form,identity:different.identity}:screen({name:'Next',identity:'next'}))};
 await x.step();assert.deepEqual(opened,[box,box]);assert.equal(x.commits(),1);
});
test('rejected Hinge photo holds a changed, unrecognizable crop after its own scroll without opening it',async()=>{
 const x=repeatedPhotoFixture({scroll:true});await x.prepare();await x.reopen(x.root);
 const alias={...x.root,identity:'cropped-identity',screenKey:'cropped',reviewScrollSurface:null,photos:[{...x.failedPhoto,key:'other',like:null,
   bounds:{...box,height:24},revealDirection:'down',visual:'ffffffffffffffff'}]};
 let scrolls=0;x.android.scrollProfile=async()=>{scrolls++;x.set(alias)};
 await x.step();assert.equal(scrolls,1);await x.step();assert.equal(scrolls,1);
 assert.equal(x.calls.filter(a=>a==='open').length,1);assert.equal(x.commits(),0);
});
test('rejected Hinge photo walks past the excluded photo to a pinned native prompt using continuous observations',async()=>{
 const x=repeatedPhotoFixture({scroll:true});await x.prepare();
 const inert={...x.prompt,like:null};await x.reopen({...x.root,prompts:[inert]});const moves=[];
 x.android.scrollProfile=async opts=>{
  moves.push(opts.direction);x.set(moves.length===1?{...x.root,screenKey:'clipped',photos:[{...x.failedPhoto,like:null,visual:'6767676767676767',visualSquare:x.failedPhoto.visual,revealDirection:'down'}],prompts:[inert]}:
   {...x.root,identity:'new-viewport',screenKey:'prompt-visible',photos:[],prompts:[x.prompt]});
 };
 const taps=[];x.android.tapControl=async(b,valid,issued)=>{assert.equal(valid(),true);taps.push(b);issued?.();x.set(taps.length===1?{...x.form,photos:[],prompts:[x.prompt]}:screen({name:'Next',identity:'next'}))};
 await x.step();assert.deepEqual(moves,['up','up']);assert.deepEqual(taps,[x.prompt.like.bounds,box]);assert.equal(x.commits(),1);
});
test('rejected Hinge photo requires a matching alternate photo on the form even when its profile identity agrees',async()=>{
 for(const match of [false,true]){
  const x=repeatedPhotoFixture();await x.prepare();
  const other={...x.failedPhoto,key:'alternative',visual:'eeeeeeeeeeeeeeee',like:{...control('Like photo'),bounds:{...box,x:80}}};
  await x.reopen({...x.root,photos:[x.failedPhoto,other]});const taps=[];
  x.android.tapControl=async(b,valid,issued)=>{assert.equal(valid(),true);taps.push(b);issued?.();x.set(taps.length===1?
   {...x.form,identity:x.root.identity,photos:match?[other]:x.form.photos}:screen({name:'Next',identity:'next'}))};
  await x.step();assert.equal(x.commits(),match?1:0);assert.deepEqual(taps,match?[other.like.bounds,box]:[other.like.bounds]);
  if(!match){await x.reopen(x.root);await x.step();assert.equal(taps.length,1);assert.equal(x.saved().rejectedPhoto.attempted,true)}
 }
});
test('rejected Hinge photo respects pending guards, exhausted budgets, and cancellation during revalidation',async()=>{
 for(const mode of ['guard','cap','deadline','pause']){
  const x=repeatedPhotoFixture();await x.prepare();await x.reopen({...x.root,prompts:[x.prompt]});
  if(mode==='guard')x.c.lastAction={kind:'like',identity:x.root.identity,name:x.root.name,sessionEndsAt:x.c.session.endsAt};
  if(mode==='cap')x.c.session.config.maxSwipes=4;
  if(mode==='deadline')x.c.session.now=()=>x.c.session.endsAt+1;
  if(mode==='pause'){x.android.deviceIdentity=async()=>{x.c.invalidate('Paused');return {serial:x.android.serial}}}
  if(mode==='pause')await assert.rejects(x.step());else await x.step();
  assert.equal(x.calls.filter(action=>action==='open').length,1);assert.equal(x.commits(),0);
  if(mode==='guard')assert.equal(x.c.lastAction.kind,'like');
 }
});

test('rejected Hinge photo with one-bit drift and a new native identity can only block a vote',async()=>{
 const identity=(name,visual)=>require('node:crypto').createHash('sha256').update(JSON.stringify(['hinge-photo',name,visual])).digest('hex');
 for(const spent of [false,true]){
  const x=repeatedPhotoFixture();x.root.identity=identity(x.root.name,x.failedPhoto.visual);await x.prepare();await x.reopen(x.root);
  if(spent)await x.step();
  const hint=structuredClone(x.saved().rejectedPhoto),drifted='123456789abcdef1';
  const alias={...x.root,identity:identity(x.root.name,drifted),screenKey:'drifted',photos:[{...x.failedPhoto,visual:drifted}],prompts:[x.prompt]};
  assert.notEqual(alias.identity,x.root.identity);
  x.set(alias);await x.step();await x.step();assert.equal(x.calls.filter(a=>a==='open').length,1);
  assert.deepEqual(x.saved().rejectedPhoto,hint);assert.equal(x.commits(),0);
  const otherName='Other',different={...alias,name:otherName,identity:identity(otherName,drifted)};
  x.set(different);const taps=[];
  x.android.tapControl=async(b,valid,issued)=>{assert.equal(valid(),true);taps.push(b);issued?.();
   x.set(taps.length===1?{...x.form,name:otherName,identity:different.identity}:screen({name:'Next',identity:'next'}))};
  await x.step();assert.deepEqual(taps,[box,box]);assert.equal(x.commits(),1);
 }
});
test('rejected Hinge photo holds an exact unidentifiable endpoint before identifying gestures, even after restart',async()=>{
 const x=repeatedPhotoFixture({scroll:true});await x.prepare();await x.reopen(x.root);
 const endpoint={...x.root,screenKey:'blank-endpoint-revision',reviewScrollSurface:null,identity:null,photos:[]};let scrolls=0;
 x.android.scrollProfile=async()=>{scrolls++;x.set(endpoint)};
 await x.step();assert.equal(scrolls,1);await x.step();assert.equal(scrolls,1);assert.equal(x.commits(),0);
 const cp=x.saved(),y=setup(endpoint,{wait:()=>new Promise(()=>{}),checkpointStore:{read:()=>cp,write:()=>{}}});
 await y.c.request('status');await y.c.request('start');assert.equal(y.c.session.status,'running');
 await y.c.sessionStep(cp.session.config,()=>true,()=>assert.fail(),async()=>true,y.c.token());
 assert.equal(y.calls.some(a=>a?.direction||a==='tap'),false);y.c.invalidate('Done');
});
test('rejected Hinge photo stops when a verified alternate scroll surface is missing or null',async()=>{
 for(const absent of [false,true]){
  const x=repeatedPhotoFixture({scroll:true});await x.prepare();const initial={...x.root,reviewScrollSurface:null};
  if(absent)delete initial.reviewScrollSurface;
  await x.reopen(initial);x.android.scrollProfile=async()=>assert.fail('No generic swipe permitted');
  await x.step();assert.match(x.c.reason,/alternate/);assert.equal(x.commits(),0);
 }
});
test('rejected Hinge photo verifies full, 578px, and 425px top crops before choosing a newly visible prompt',async()=>{
 const {evidence}=require('../desktop/mobile-vision.cjs');
 function imageFor(box){
  const top=box.y+box.height-box.width;
  return {getSize:()=>({width:800,height:1200}),crop:rect=>({resize:({width,height})=>({toBitmap:()=>{
   const bytes=Buffer.alloc(width*height*4,255);
   for(let y=0;y<height;y++)for(let x=0;x<width;x++)for(let c=0;c<3;c++){
    const u=(rect.x+(x+.5)*rect.width/width-box.x)/box.width,v=(rect.y+(y+.5)*rect.height/height-top)/box.width;
    bytes[(y*width+x)*4+c]=Math.round(116+45*Math.sin(29*u+11*v+c)+38*Math.cos(17*v-13*u+c)+26*Math.cos(51*v+35*u));
   }
   return bytes;
  }})})};
 }
 const full={x:40,y:210,width:640,height:640},hashes=new Set();
 const x=repeatedPhotoFixture({scroll:true,readEvidence:async s=>{
  if(s.kind!=='profile'||s.photos[0]?.bounds?.width!==640)return {hashes:s.photos.map(p=>p.visual||null)};
  const result=await evidence(imageFor(s.photos[0].bounds),s);hashes.add(result.hashes[0]);return result;
 }});
 x.failedPhoto.bounds=full;await x.prepare();await x.reopen(x.root);
 const moves=[];x.android.scrollProfile=async(opts,valid)=>{
  assert.equal(valid(),true);assert.deepEqual(opts.surface,x.root.reviewScrollSurface);moves.push(opts.direction);
  const height=moves.length===1?578:moves.length===2?425:397,key='crop-'+height;
  x.set({...x.root,identity:key,screenKey:key,photos:[{...x.failedPhoto,key,bounds:{...full,y:137,height},like:null,revealDirection:'down'}],
   prompts:height===397?[x.prompt]:[]});
 };
 const taps=[];x.android.tapControl=async(b,valid,issued)=>{assert.equal(valid(),true);taps.push(b);issued?.();
  x.set(taps.length===1?{...x.form,photos:[],prompts:[x.prompt]}:screen({name:'Next',identity:'next'}))};
 await x.step();assert.deepEqual(moves,['up','up','up']);assert.ok(hashes.size>=4);
 assert.deepEqual(taps,[x.prompt.like.bounds,box]);assert.equal(x.commits(),1);
});

async function legacyPromptScan(returnToSource=false){
 const x=repeatedPhotoFixture({scroll:true});const skip={...control('Skip '+x.root.name),bounds:{x:600,y:1100,width:50,height:50}};
 x.root.controls={...x.root.controls,skip};await x.prepare();
 const partial=h=>({...x.root,identity:'crop-'+h,screenKey:'viewport-'+h,photos:[{...x.failedPhoto,
  bounds:{x:40,y:137,width:640,height:h},visual:'123456789abcdf0f',visualSquare:null,revealDirection:'down',like:null}]});
 const held=partial(473);const start=returnToSource?x.root:held;
 await x.reopen(start);const cp=x.saved();
 Object.assign(cp.rejectedPhoto,{attempted:true,heldIdentity:held.identity,heldRevision:held.screenKey});
 x.c.restoreCheckpoint(cp);x.c.session.status='running';
 return {...x,held,partial};
}
test('held Hinge prompt scan upgrades a release 7 endpoint or a strongly reidentified original card once',async()=>{
 for(const fromSource of [false,true]){
  const x=await legacyPromptScan(fromSource),moves=[],taps=[];
  const promptCard={...x.root,identity:'independent-prompt-card',screenKey:'new-prompt',photos:[{...x.failedPhoto,visual:'ffffffffeeeeeeee'}],prompts:[x.prompt]};
  x.android.scrollProfile=async(opts,valid)=>{
   assert.equal(valid(),true);assert.deepEqual(opts.surface,x.root.reviewScrollSurface);assert.equal(opts.direction,'up');
   assert.ok(x.saved().rejectedPhoto.promptScan);moves.push(opts);x.set(moves.length===4?promptCard:x.partial(473-moves.length*65));
  };
  x.android.tapControl=async(b,valid,issued)=>{assert.equal(valid(),true);taps.push(b);issued?.();x.set(taps.length===1?
   {...x.form,identity:'form-only',photos:[],prompts:[{...x.prompt,like:null}],controls:{sendLike:control('Send like')}}:screen({name:'Next',identity:'new'}))};
  await x.step();assert.equal(moves.length,4);assert.deepEqual(taps,[x.prompt.like.bounds,box]);assert.equal(x.commits(),1);
  assert.equal(x.c.session.count,5);assert.equal(x.saved().rejectedPhoto??null,null);
 }
});
test('held Hinge prompt scan exhausts one forward search and survives restart without reopening any photo',async()=>{
 const x=await legacyPromptScan(),moves=[];x.android.scrollProfile=async opts=>{
  assert.equal(opts.direction,'up');moves.push(opts);
  x.set({...x.root,identity:'other-same-name-'+moves.length,screenKey:'changed-'+moves.length,
   photos:[{...x.failedPhoto,visual:'ffffffffeeeeeeee'}],prompts:[]});
 };
 await x.step();assert.equal(moves.length,8);assert.equal(x.commits(),0);
 const cp=x.saved();assert.ok(cp.rejectedPhoto.promptScan);await x.step();assert.equal(moves.length,8);
 x.c.restoreCheckpoint(cp);x.c.session.status='running';await x.step();assert.equal(moves.length,8);
 assert.equal(x.calls.filter(a=>a==='open').length,1);
});
test('held Hinge prompt scan rejects changed or duplicated prompt evidence and never sends from a tainted form',async()=>{
 for(const mode of ['other-form','duplicate','typed','doubt','changed-final-read','changed-source']){
  const x=await legacyPromptScan();let taps=0,moves=0;
  const source={...x.held,identity:'independent-prompt',screenKey:'prompt',photos:[],prompts:[x.prompt]};
  x.android.scrollProfile=async()=>{moves++;x.set(source)};
  const good={...x.form,photos:[],prompts:[x.prompt],controls:{sendLike:control('Send like')}};
  x.android.tapControl=async(_b,valid)=>{assert.equal(valid(),true);taps++;x.set({...good,
   name:mode==='other-form'?'Other':good.name,prompts:mode==='duplicate'?[x.prompt,x.prompt]:good.prompts,
   composerText:mode==='typed'?'unsent':'',composerTextVerified:mode!=='doubt'});};
  const read=x.android.hierarchy;let formReads=0,sourceReads=0;
  x.android.hierarchy=async()=>{const raw=await read();if(raw.xml===source&&mode==='changed-source'&&++sourceReads===2)return {...raw,xml:{...source,screenKey:'changed'}};
   if(raw.xml.kind==='like'&&mode==='changed-final-read'&&++formReads===2)return {...raw,xml:{...raw.xml,screenKey:'new-final',prompts:[]}};return raw};
  await x.step();assert.equal(moves,1);assert.equal(taps,mode==='changed-source'?0:1,mode);
  assert.equal(x.commits(),0);assert.equal(x.c.session.count,4);assert.equal(x.c.lastAction,null);
 }
});
test('held Hinge prompt scan independently accepts the native included priority Like on a blank prompt form',async()=>{
 const x=await legacyPromptScan();x.set({...x.held,reviewScrollSurface:null,prompts:[x.prompt]});
 const taps=[];x.android.scrollProfile=async()=>assert.fail('No gesture needed');
 const send={...control('Send priority like'),bounds:{...box,x:123}};
 x.android.tapControl=async(b,valid,issued)=>{assert.equal(valid(),true);taps.push(b);issued?.();
  x.set(taps.length===1?{...x.form,photos:[],prompts:[{...x.prompt,like:null}],controls:{sendLike:send}}:screen({name:'Next',identity:'next'}))};
 await x.step();assert.deepEqual(taps,[x.prompt.like.bounds,send.bounds]);assert.equal(x.commits(),1);
});
test('held Hinge prompt scan crosses identity-free inert lanes without using poll options or photo controls',async()=>{
 const x=await legacyPromptScan();let moves=0;const taps=[];
 x.android.scrollProfile=async(opts,valid)=>{assert.equal(valid(),true);assert.equal(opts.direction,'up');moves++;
  x.set(moves<3?{...x.held,identity:null,screenKey:'poll-'+moves,photos:[],prompts:[],controls:{like:control('Like poll'),poll:control('Option')}}:
   {...x.root,identity:'independently-new',screenKey:'same-name-different-card',prompts:[x.prompt]})};
 x.android.tapControl=async(b,valid,issued)=>{assert.equal(valid(),true);taps.push(b);issued?.();x.set(taps.length===1?
  {...x.form,name:x.root.name,identity:'independent-form',photos:[],prompts:[x.prompt],controls:{sendLike:control('Send like')}}:screen({name:'Next',identity:'next'}))};
 await x.step();assert.equal(moves,3);assert.deepEqual(taps,[x.prompt.like.bounds,box]);assert.equal(x.commits(),1);
});
test('held Hinge prompt scan never replays a motion after a lost receipt, including a zero-identity resume',async()=>{
 const x=await legacyPromptScan();let persisted;
 const changed={...x.held,identity:null,screenKey:'interrupted-poll',photos:[],prompts:[]};
 x.android.scrollProfile=async()=>{persisted=x.saved();assert.equal(persisted.rejectedPhoto.promptScan,'moving');throw Object.assign(Error('Lost acknowledgement'),{code:'ANDROID_COMMAND_TIMEOUT'})};
 await x.step();assert.ok(persisted);
 const y=setup(changed,{wait:()=>new Promise(()=>{}),checkpointStore:{read:()=>persisted,write:()=>{}}});
 await y.c.request('status');await y.c.request('start');
 await y.c.sessionStep(y.c.session.config,()=>true,()=>assert.fail(),async()=>true,y.c.token());
 assert.equal(y.calls.some(a=>a?.direction||a==='tap'),false);assert.equal(y.c.session.count,4);assert.equal(y.c.checkpoint().rejectedPhoto.promptScan,'spent');
 y.c.invalidate('Done');
});
test('held Hinge prompt scan preserves budgets and refuses Rose, message variants and pending votes',async()=>{
 for(const mode of ['cap','time','pending','pause','Rose','message']){
  const x=await legacyPromptScan();
  if(mode==='cap')x.c.session.config.maxSwipes=4;
  if(mode==='time')x.c.session.now=()=>x.c.session.endsAt+1;
  if(mode==='pending')x.c.lastAction={identity:x.held.identity,name:x.held.name,kind:'like',sessionEndsAt:x.c.session.endsAt};
  let moves=0,taps=0;
  x.android.scrollProfile=async()=>{moves++;if(mode==='pause'){x.c.invalidate('Pause during motion');return}x.set({...x.root,identity:'prompt-found',screenKey:'prompt',prompts:[x.prompt]})};
  x.android.tapControl=async()=>{taps++;x.set({...x.form,photos:[],prompts:[x.prompt],controls:{sendLike:control(mode==='Rose'?'Send a Rose':'Send priority like with message')}})};
  if(mode==='pause')await assert.rejects(x.step());else await x.step();
  assert.equal(moves,['pause','Rose','message'].includes(mode)?1:0);assert.equal(taps,['Rose','message'].includes(mode)?1:0);
  assert.equal(x.commits(),0);assert.equal(x.c.session.count,4);
 }
});
function wheelViewport(x,index,{drag=false,prompt=false}={}){
 const landmarks=[{key:'first',x:120,y:600-index*20,width:110,height:32},{key:'second',x:50,y:800-index*20,width:150,height:34}];
 return {...x.held,screenKey:index?'wheel-'+index:x.held.screenKey,reviewScrollSurface:drag?x.held.reviewScrollSurface:null,
  reviewWheelPoint:{x:175,y:615},reviewScrollFrame:{ownerKey:'scroller',chromeKey:'header-footer',landmarks},
  prompts:prompt?[x.prompt]:[]};
}
function restoreSpent(x){
 const cp=x.saved();cp.rejectedPhoto.promptScan='spent';delete cp.rejectedPhoto.promptMovesRemaining;
 x.c.restoreCheckpoint(cp);x.c.session.status='running';
}
test('fresh Hinge prompt search shares eight durably charged moves between drag and wheel',async()=>{
 const x=await legacyPromptScan();let moves=0;const modes=[],taps=[];
 x.set(wheelViewport(x,0,{drag:true}));
 const move=mode=>{
  modes.push(mode);moves++;
  assert.equal(x.saved().rejectedPhoto.promptScan,'moving');assert.equal(x.saved().rejectedPhoto.promptMovesRemaining,8-moves);
  x.set(wheelViewport(x,moves,{drag:moves%2===0,prompt:moves===8}));
 };
 x.android.wheelDiscover=async(p,valid)=>{assert.equal(valid(),true);assert.deepEqual(p,{x:175,y:615});move('wheel')};
 x.android.scrollProfile=async(opts,valid)=>{assert.equal(valid(),true);assert.deepEqual(opts.surface,x.held.reviewScrollSurface);move('drag')};
 x.android.tapControl=async(b,valid,issued)=>{assert.equal(valid(),true);taps.push(b);issued?.();x.set(taps.length===1?
  {...x.form,photos:[],prompts:[x.prompt],controls:{sendLike:control('Send priority like')}}:screen({name:'Next',identity:'next'}))};
 await x.step();assert.deepEqual(modes,Array(4).fill(['drag','wheel']).flat());
 assert.deepEqual(taps,[x.prompt.like.bounds,box]);assert.equal(x.commits(),1);
});
test('wheel requires forward translation of distinct passive landmarks under the original fixed chrome and scroller',async()=>{
 for(const mode of ['stationary','backwards','one','duplicate','inconsistent','sideways','chrome','owner','foreign','no-frame']){
  const x=await legacyPromptScan();let moves=0,taps=0;const before=wheelViewport(x,0);x.set(before);
  x.android.wheelDiscover=async()=>{
   moves++;const after=wheelViewport(x,1,{prompt:true}),frame=after.reviewScrollFrame;
   if(mode==='stationary')frame.landmarks=before.reviewScrollFrame.landmarks;
   if(mode==='backwards')frame.landmarks.forEach(l=>l.y+=40);
   if(mode==='one')frame.landmarks.pop();
   if(mode==='duplicate')frame.landmarks[1].key=frame.landmarks[0].key;
   if(mode==='inconsistent')frame.landmarks[1].y+=12;
   if(mode==='sideways')frame.landmarks[1].x+=20;
   if(mode==='chrome')frame.chromeKey='changed';
   if(mode==='owner')frame.ownerKey='nested';
   if(mode==='foreign')after.name='Other';
   if(mode==='no-frame')after.reviewScrollFrame=null;
   x.set(after);
  };
  x.android.tapControl=async()=>{taps++};
  await x.step();assert.equal(moves,1,mode);assert.equal(taps,0,mode);assert.equal(x.commits(),0,mode);
  if(mode!=='foreign'){await x.step();assert.equal(moves,1,mode);assert.equal(taps,0,mode)}
 }
});
test('legacy spent Hinge scan requires a newly proven route at the exact endpoint',async()=>{
 for(const mode of ['wheel','clipped-heading','old-drag','changed-revision','different-identity','no-frame','visible-prompt','no-ack']){
  const x=await legacyPromptScan();restoreSpent(x);let moves=0,taps=0;
  const before=wheelViewport(x,0,{drag:['old-drag','clipped-heading'].includes(mode),prompt:mode==='visible-prompt'});
  if(mode==='changed-revision')before.screenKey='changed';
  if(mode==='different-identity')before.identity='different';
  if(mode==='clipped-heading')before.reviewNewChoiceLane=true;
  if(mode==='no-frame')before.reviewScrollFrame=null;
  x.set(before);
  const move=()=>{
   moves++;assert.equal(x.saved().rejectedPhoto.promptMovesRemaining,7);
   assert.equal(x.saved().rejectedPhoto.promptScan,'moving');
   x.set({...wheelViewport(x,1),reviewWheelPoint:null});if(mode==='no-ack')throw Object.assign(Error('Lost receipt'),{code:'ANDROID_COMMAND_TIMEOUT'});
  };
  x.android.scrollProfile=async()=>{assert.equal(mode,'clipped-heading');move()};
  x.android.wheelDiscover=async()=>{assert.ok(['wheel','no-ack'].includes(mode));move()};
  x.android.tapControl=async()=>{taps++};
  await x.step();const cp=x.saved();x.c.restoreCheckpoint(cp);x.c.session.status='running';await x.step();await x.step();
  const expected=['wheel','clipped-heading','no-ack'].includes(mode)?1:0;
  assert.equal(moves,expected,mode);assert.equal(taps,0,mode);assert.equal(x.commits(),0,mode);
  if(!expected)assert.equal(x.saved().rejectedPhoto.promptMovesRemaining,undefined,mode);
 }
});
test('one legacy wheel move can bind a new static prompt only through a verified blank ordinary Like form',async()=>{
 const x=await legacyPromptScan();restoreSpent(x);const before=wheelViewport(x,0);x.set(before);
 let moves=0;const taps=[];
 x.android.wheelDiscover=async()=>{moves++;x.set(wheelViewport(x,1,{prompt:true}))};
 x.android.tapControl=async(b,valid,issued)=>{assert.equal(valid(),true);taps.push(b);issued?.();x.set(taps.length===1?
  {...x.form,photos:[],prompts:[x.prompt],controls:{sendLike:control('Send priority like')}}:screen({name:'Next',identity:'next'}))};
 await x.step();assert.equal(moves,1);assert.deepEqual(taps,[x.prompt.like.bounds,box]);assert.equal(x.commits(),1);
 assert.equal(x.c.session.count,5);assert.equal(x.saved().rejectedPhoto??null,null);
});
test('legacy wheel grant remains untouched when its independently reread point, route or owner changes',async()=>{
 for(const mode of ['point','route','owner','chrome','revision']){
  const x=await legacyPromptScan();restoreSpent(x);const before=wheelViewport(x,0);x.set(before);const sealed=structuredClone(x.c.rejectedPhoto);
  const read=x.android.hierarchy;let reads=0,moves=0;
  x.android.hierarchy=async()=>{const result=await read();if(++reads<4)return result;
   const changed=structuredClone(before);
   if(mode==='point')changed.reviewWheelPoint.x++;
   if(mode==='route')changed.reviewScrollSurface=x.held.reviewScrollSurface;
   if(mode==='owner')changed.reviewScrollFrame.ownerKey='nested';
   if(mode==='chrome')changed.reviewScrollFrame.chromeKey='changed';
   if(mode==='revision')changed.screenKey='changed';
   return {...result,xml:changed};
  };
  x.android.wheelDiscover=x.android.scrollProfile=async()=>{moves++};
  await x.step();assert.equal(moves,0,mode);assert.deepEqual(x.c.rejectedPhoto,sealed,mode);assert.equal(x.commits(),0);
 }
});
function coldPhoto(x){
 return {...x.root,photos:[{...x.failedPhoto,bounds:{x:40,y:160,width:640,height:640},revealDirection:null}]};
}
function restorePollHold(x,extra={}){
 const cp=structuredClone(x.c.checkpoint());Object.assign(cp.rejectedPhoto,{attempted:true,heldIdentity:null,promptScan:'spent'},extra);
 x.c.restoreCheckpoint(cp);x.c.session.status='running';
}
test('legacy poll hold can reach a fresh prompt after several moves from a cold original photo or its newly navigable saved endpoint',async()=>{
 for(const entry of ['cold-photo','cold-captioned-photo','saved-poll']){
  const x=await legacyPromptScan();restorePollHold(x);
  const root=coldPhoto(x);if(entry==='cold-captioned-photo')root.photos[0].like=control('Like photo prompt');
  x.set(entry==='saved-poll'?{...wheelViewport(x,0,{drag:true}),identity:null,reviewNewChoiceLane:true,photos:[]}:root);
  const taps=[],moves=[];
  const move=(mode,valid)=>{
   assert.equal(valid(),true);moves.push(mode);const receipt=x.saved().rejectedPhoto;
   assert.equal(receipt.promptScan,'moving');assert.equal(receipt.promptMovesRemaining,8-moves.length);
   x.set(wheelViewport(x,moves.length,{drag:moves.length%2===0,prompt:moves.length===5}));
  };
  x.android.scrollProfile=async(o,v)=>{assert.equal(o.direction,'up');move('drag',v)};
  x.android.wheelDiscover=async(p,v)=>move('wheel',v);
  x.android.tapControl=async(b,valid,issued)=>{assert.equal(valid(),true);taps.push(b);issued?.();x.set(taps.length===1?
   {...x.form,photos:[],prompts:[x.prompt],controls:{sendLike:control('Send priority like')}}:screen({name:'Next',identity:'next'}))};
  await x.step();assert.deepEqual(moves,['drag','wheel','drag','wheel','drag'],entry);
  assert.deepEqual(taps,[x.prompt.like.bounds,box]);assert.equal(x.commits(),1);assert.equal(x.c.session.count,5);
 }
});
test('cold legacy photo recovery never navigates from a weak source or reissues a started pass',async()=>{
 for(const mode of ['one-bit','square-only','duplicate','cropped','unowned','poll-control','different-identity','different-profile','known-hold','tried','moving','deadline','cap','draft','pending']){
  const x=await legacyPromptScan();restorePollHold(x,mode==='known-hold'?{heldIdentity:'known'}:
   mode==='tried'?{promptMovesRemaining:4}:mode==='moving'?{promptScan:'moving'}:{});
  const card=coldPhoto(x),p=card.photos[0];
  if(mode==='one-bit')p.visual='123456789abcdef1';
  if(mode==='square-only'){p.visualSquare=p.visual;p.visual='ffffffffffffffff'}
  if(mode==='duplicate')card.photos.push({...p,key:'other'});
  if(mode==='cropped'){p.bounds.height-=40;p.revealDirection='down'}
  if(mode==='unowned')p.like=null;
  if(mode==='poll-control')p.like=control('Like poll');
  if(mode==='different-identity')card.identity='other-with-same-name-and-photo';
  if(mode==='different-profile'){card.identity='other-with-same-name';p.visual='ffffffffffffffff'}
  if(mode==='deadline')x.c.session.now=()=>x.c.session.endsAt;
  if(mode==='cap')x.c.session.config.maxSwipes=4;
  if(mode==='draft')x.c.draft={text:'unsubmitted'};
  if(mode==='pending')x.c.lastAction={identity:card.identity,name:card.name,kind:'like',sessionEndsAt:x.c.session.endsAt};
  x.set(card);let moves=0,taps=0;x.android.wheelDiscover=x.android.scrollProfile=async()=>{moves++};x.android.tapControl=async()=>{taps++};
  await x.step();assert.equal(moves,0,mode);assert.equal(taps,0,mode);assert.equal(x.commits(),0,mode);
 }
});
test('legacy cold recovery survives a worker restart after input without rearming the original source',async()=>{
 const x=await legacyPromptScan();restorePollHold(x);const root=coldPhoto(x);x.set(root);
 let issued=0,saved;
 x.android.scrollProfile=async()=>{issued++;saved=x.saved();throw Object.assign(Error('Lost receipt'),{code:'ANDROID_COMMAND_TIMEOUT'})};
 await x.step();assert.equal(issued,1);assert.equal(saved.rejectedPhoto.promptScan,'moving');assert.equal(saved.rejectedPhoto.promptMovesRemaining,7);
 const y=setup(root,{wait:()=>new Promise(()=>{}),checkpointStore:{read:()=>saved,write:()=>{}}});
 await y.c.request('status');await y.c.request('start');
 for(let i=0;i<2;i++)await y.c.sessionStep(y.c.session.config,()=>true,()=>assert.fail(),async()=>true,y.c.token());
 assert.deepEqual(y.calls.map(c=>c.kind),['session']);assert.equal(y.c.checkpoint().rejectedPhoto.promptMovesRemaining,0);assert.equal(y.c.session.count,4);
 y.c.invalidate('Done');
});
test('a foreground switch before wheel dispatch leaves the session available to retire that motion',async()=>{
 const x=await legacyPromptScan();x.set(wheelViewport(x,0));let preflights=0;
 x.android.wheelDiscover=async()=>{preflights++;throw Object.assign(Error('App switched'),{code:'ANDROID_FOREGROUND_UNAVAILABLE'})};
 await x.step();assert.equal(x.c.session.status,'running');assert.equal(x.saved().rejectedPhoto.promptScan,'moving');
 await x.step();assert.equal(preflights,1);assert.equal(x.saved().rejectedPhoto.promptMovesRemaining,0);assert.equal(x.commits(),0);
});
test('restoring a legacy unidentified poll observes a changed unidentified screen without identifying gestures',async()=>{
 const x=await legacyPromptScan();restorePollHold(x);const cp=structuredClone(x.c.checkpoint()),sealed=structuredClone(cp.rejectedPhoto);
 const poll={...x.held,identity:null,photos:[],prompts:[],screenKey:'other-poll-revision'};
 const y=setup(poll,{wait:()=>new Promise(()=>{}),checkpointStore:{read:()=>cp,write:()=>{}}});
 await y.c.request('status');await y.c.request('start');
 await y.c.sessionStep(y.c.session.config,()=>true,()=>assert.fail(),async()=>true,y.c.token());
 assert.deepEqual(y.calls.map(c=>c.kind),['session']);assert.deepEqual(y.c.rejectedPhoto,sealed);
 y.c.invalidate('Done');
});
async function exhaustedDiscover(fromSource=false){
 const x=await legacyPromptScan();restorePollHold(x,{promptMovesRemaining:0});
 const card=fromSource?coldPhoto(x):{...x.held,photos:[],prompts:[],identity:null,controls:{...x.held.controls,skip:null}};
 x.set(card);x.c.nextFeedRefreshAt=0;
 const hint=structuredClone(x.c.rejectedPhoto),deadline=x.c.session.endsAt;
 x.android.scrollProfile=x.android.wheelDiscover=x.android.tapControl=async()=>assert.fail('An inventory refresh cannot browse or vote');
 return {...x,card,hint,deadline};
}
async function refreshedPromptFixture(){
 const x=await exhaustedDiscover(),avd='managed-hinge',chromeKey='c'.repeat(64);
 const cp=structuredClone(x.c.checkpoint());cp.session.runId='current-run';cp.session.endsAt=Date.now()+3600000;
 cp.binding.avd=avd;Object.assign(cp.rejectedPhoto,{runId:cp.session.runId,endsAt:cp.session.endsAt,avd});
 x.c.restoreCheckpoint(cp);x.c.session.status='running';x.c.isManagedPhone=b=>b.avd===avd;
 x.android.deviceIdentity=async()=>({serial:x.android.serial,avd});
 const surface={x:140,y:300,width:120,height:180},source={...coldPhoto(x),recoveryChromeKey:chromeKey,recoveryDrag:{chromeKey,surface}};
 const promptCard={...source,identity:'prompt-identity',screenKey:'new-prompt-screen',recoveryDrag:null,prompts:[x.prompt],
  photos:[{...source.photos[0],revealDirection:'up',like:null}]};
 const form={...x.form,prompts:[{...x.prompt,like:null}],photos:[],controls:{sendLike:control('Send like')}};
 const taps=[],moves=[];
 x.android.refreshFeed=async(_p,_v,_w,beforeStop)=>{await beforeStop();x.set(source)};
 x.android.scrollProfile=async(opts,valid)=>{assert.equal(valid(),true);assert.deepEqual(opts.surface,surface);
  assert.ok(x.saved().rejectedPhoto.promptRecovery);moves.push(opts);x.set(promptCard)};
 x.android.tapControl=async(bounds,valid,onIssued)=>{assert.equal(valid(),true);taps.push(bounds);onIssued?.();
  x.set(taps.length===1?form:screen({identity:'next',name:'Other'}))};
 return {...x,source,promptCard,form,surface,taps,moves};
}
test('a successful held refresh permits one durable nonvoting drag and only an independently linked ordinary prompt',async()=>{
 const x=await refreshedPromptFixture();
 await x.step();if(!x.commits())await x.step();
 assert.equal(x.moves.length,1);assert.deepEqual(x.taps,[x.prompt.like.bounds,box]);assert.equal(x.commits(),1);
});
test('a profile-only recovered prompt retains the original managed run and its single 1000-profile budget',async()=>{
 const x=await refreshedPromptFixture(),cp=structuredClone(x.c.checkpoint());
 cp.session.endsAt=cp.rejectedPhoto.endsAt=null;cp.session.config.sessionMinutes=cp.config.swipe.sessionMinutes=null;
 cp.session.config.maxSwipes=cp.config.swipe.maxSwipes=1000;cp.session.count=cp.rejectedPhoto.count=999;
 cp.session.nextBreakAt=1001;
 x.c.restoreCheckpoint(cp);x.c.session.status='running';
 const step=()=>x.c.sessionStep(x.c.session.config,()=>x.c.session.status==='running',()=>{x.c.session.count++},async()=>true,x.c.token());
 await step();await step();assert.equal(x.c.session.count,1000);assert.equal(x.c.session.endsAt,null);assert.equal(x.c.session.runId,cp.session.runId);
 assert.equal(x.moves.length,1);assert.deepEqual(x.taps,[x.prompt.like.bounds,box]);
});
test('a consumed post-refresh drag can resume a newly visible linked prompt without replaying the gesture',async()=>{
 const x=await refreshedPromptFixture();let saved;
 x.android.scrollProfile=async()=>{saved=x.saved();x.set(x.promptCard);throw Object.assign(Error('lost motion response'),{code:'ANDROID_COMMAND_TIMEOUT'})};
 await x.step();if(!saved)await x.step();assert.ok(saved?.rejectedPhoto.promptRecovery);
 x.c.restoreCheckpoint(saved);x.c.session.status='running';
 x.android.scrollProfile=async()=>assert.fail('never replay a charged motion');
 await x.step();assert.deepEqual(x.taps,[x.prompt.like.bounds,box]);assert.equal(x.commits(),1);
});
test('an interrupted prompt opening is not repeated and later held-refresh cycles keep their normal pacing',async()=>{
 const x=await refreshedPromptFixture();let openings=0,refreshes=0,saved,now=Date.now();x.c.session.now=()=>now;
 x.android.refreshFeed=async(_p,_v,_w,beforeStop)=>{await beforeStop();refreshes++;x.set(x.source)};
 x.android.tapControl=async()=>{openings++;saved=x.saved();throw Object.assign(Error('Lost prompt acknowledgment'),{code:'ANDROID_COMMAND_TIMEOUT'})};
 await x.step();await x.step();
 assert.equal(openings,1);assert.equal(saved.rejectedPhoto.promptRecovery.opened,true);assert.equal(x.commits(),0);
 assert.ok(!JSON.stringify(saved.rejectedPhoto.promptRecovery).includes(x.prompt.text));
 x.c.restoreCheckpoint(saved);x.c.session.status='running';await x.step();await x.step();
 assert.equal(refreshes,1);now+=300001;await x.step();await x.step();
 assert.equal(refreshes,2);assert.equal(openings,1);assert.equal(x.moves.length,1);assert.equal(x.commits(),0);
});
test('a consumed recovery keeps periodic refresh on an exact held endpoint with changed or missing chrome, and releases a different profile',async()=>{
 for(const chrome of [undefined,'d'.repeat(64)]){
  const x=await refreshedPromptFixture();let now=Date.now(),refreshes=0;x.c.session.now=()=>now;
  x.android.scrollProfile=async(_opts,valid)=>{assert.ok(valid());x.moves.push(1);x.set({...x.promptCard,prompts:[]})};
  x.android.refreshFeed=async(_p,_v,_w,beforeStop)=>{await beforeStop();refreshes++;x.set(refreshes===1?x.source:screen({name:'Different',identity:'new-profile',screenKey:'new'}))};
  await x.step();await x.step();assert.equal(x.moves.length,1);
  const held={...x.promptCard,prompts:[],recoveryChromeKey:chrome};
  assert.equal(x.c.rejectedPhoto.heldRevision,held.screenKey);x.set(held);now+=300001;
  const result=await x.step();assert.equal(refreshes,2);assert.equal(result.phase,'checking next profile');
  const ordinary=deferred();x.c.review=async()=>{ordinary.resolve();throw Object.assign(Error('observed regular review'),{code:'MOBILE_REVIEW_INTERRUPTED'})};
  await x.step();await ordinary.promise;assert.equal(x.moves.length,1);assert.equal(x.commits(),0);
 }
});
test('a prompt that changes during the blank ordinary Like form cannot acquire a vote reservation',async()=>{
 for(const mode of ['edited','photo','rose','unknown-composer','message','changed form']){
  const x=await refreshedPromptFixture();let openings=0;
  x.android.tapControl=async(bounds)=>{openings++;assert.deepEqual(bounds,x.prompt.like.bounds);const form=structuredClone(x.form);
   if(mode==='edited')form.prompts[0].text+=' changed';
   if(mode==='photo')form.photos=[x.failedPhoto];
   if(mode==='rose')form.controls.sendLike=control('Send a Rose');
   if(mode==='unknown-composer')form.composerTextVerified=false;
   if(mode==='message')form.composerText='user draft';
   if(mode==='changed form'){const hierarchy=x.android.hierarchy;let reads=0;x.android.hierarchy=async()=>++reads===2?
    {xml:{...form,prompts:[{...form.prompts[0],text:'Different'}]},foreground:'co.hinge.app'}:hierarchy()}
   x.set(form);
  };
  await x.step();await x.step();
  assert.equal(openings,1,mode);assert.equal(x.commits(),0,mode);assert.equal(x.c.lastAction,null,mode);
 }
});
test('a different same-name card from a later acknowledged inventory refresh returns to ordinary Hinge review',async()=>{
 for(const chrome of [undefined,'c'.repeat(64)]){
  const x=await refreshedPromptFixture();let now=Date.now(),launches=0,reviewed=0;
  x.c.session.now=()=>now;
  const different={...x.source,identity:'independent-new-card',screenKey:'different-revision',recoveryChromeKey:chrome,
   photos:[{...x.source.photos[0],visual:'ff00ff00ff00ff00'}],prompts:[{...x.prompt,text:'different native prompt'}]};
  x.android.refreshFeed=async(_p,_v,_w,beforeStop)=>{await beforeStop();x.set(++launches===1?x.source:different)};
  x.android.scrollProfile=async()=>{x.moves.push(1);x.set({...x.promptCard,prompts:[]})};
  await x.step();await x.step();now+=300001;await x.step();assert.equal(launches,2);
  const oldRevision=x.c.rejectedPhoto.heldRevision;x.c.review=async()=>{reviewed++;throw Object.assign(Error('observed ordinary review'),{code:'MOBILE_REVIEW_INTERRUPTED'})};
  await x.step();
  assert.equal(reviewed,1);assert.equal(x.c.rejectedPhoto.heldRevision,oldRevision);
  assert.equal(x.moves.length,1);assert.equal(x.commits(),0);
 }
});
test('a later refresh can anchor a changed prompt-only or clipped endpoint for inventory without enabling a Like',async()=>{
 for(const clipped of [false,true]){
  const x=await refreshedPromptFixture();let launches=0,now=Date.now();x.c.session.now=()=>now;
  const first={...x.promptCard,prompts:[]},later={...x.promptCard,screenKey:'other-viewport',identity:'different-evidence',recoveryChromeKey:undefined,
   photos:clipped?[{...x.failedPhoto,visual:'ff00ff00ff00ff00',like:null,revealDirection:'up'}]:[]};
  x.android.scrollProfile=async()=>{x.moves.push(1);x.set(first)};
  x.android.refreshFeed=async(_p,_v,_w,beforeStop)=>{await beforeStop();x.set(++launches===1?x.source:later)};
  await x.step();await x.step();assert.equal(x.c.rejectedPhoto.heldRevision,first.screenKey);
  now+=300001;await x.step();await x.step();assert.equal(x.c.rejectedPhoto.heldRevision,later.screenKey);
  now+=300001;await x.step();assert.equal(launches,3);assert.equal(x.moves.length,1);assert.equal(x.taps.length,0);assert.equal(x.commits(),0);
 }
});
test('the post-refresh prompt recovery refuses unproven routes, changed ownership, and unrelated prompt screens',async()=>{
 for(const mode of ['no-refresh','failed-refresh','same-endpoint','wrong-chrome','no-route','not-managed','near-source','no-link','different-chrome','not-a-prompt','pending','deadline','limit','break','draft','storage']){
  const x=await refreshedPromptFixture();let c=x.c;
  if(mode==='no-refresh'){c.nextFeedRefreshAt=c.session.now()+60000;x.set(x.source)}
  if(mode==='failed-refresh')x.android.refreshFeed=async()=>{x.set(x.source);throw Object.assign(Error('no ack'),{code:'ANDROID_COMMAND_TIMEOUT'})};
  if(mode==='same-endpoint'){c.rejectedPhoto.heldRevision=x.source.screenKey;c.rejectedPhoto.heldIdentity=x.source.identity;x.set(x.source)}
  if(mode==='wrong-chrome')x.source.recoveryDrag.chromeKey='f'.repeat(64);
  if(mode==='no-route')x.source.recoveryDrag=null;
  if(mode==='not-managed')c.isManagedPhone=()=>false;
  if(mode==='near-source')x.source.photos[0]={...x.source.photos[0],visual:'123456789abcdef1'};
  if(mode==='no-link')x.promptCard.photos=[{...x.source.photos[0],visual:'0000000000000000'}];
  if(mode==='different-chrome')x.promptCard.recoveryChromeKey='f'.repeat(64);
  if(mode==='not-a-prompt')x.promptCard.prompts=[];
  if(mode==='pending')c.lastAction={identity:x.card.identity||'held',name:x.card.name,kind:'like',runId:c.session.runId,sessionEndsAt:c.session.endsAt};
  if(mode==='deadline')c.session.now=()=>c.session.endsAt;
  if(mode==='limit')c.session.config.maxSwipes=c.session.count;
  if(mode==='break')Object.assign(c.session,{config:{...c.session.config,breaksEnabled:true},nextBreakAt:c.session.count});
  if(mode==='draft')c.draft={text:'private'};
  if(mode==='storage')c.storageError='unavailable';
  for(let i=0;i<2;i++)await x.step().catch(()=>{});
  assert.equal(x.commits(),0,mode);assert.deepEqual(x.taps,[],mode);
  assert.equal(x.moves.length,['no-link','different-chrome','not-a-prompt'].includes(mode)?1:0,mode);
 }
});
test('a consumed Hinge review periodically checks inventory from its exact held poll or cold source',async()=>{
 for(const [entry,result] of [['poll','same'],['cold','empty'],['poll','new']]){
  const x=await exhaustedDiscover(entry==='cold');let now=Date.now(),launches=0;
  x.c.session.now=()=>now;
  const next=result==='new'?screen({name:'New',identity:'new-card'}):result==='empty'?screen({kind:'empty',identity:null,photos:[],controls:{}}):x.card;
  x.android.refreshFeed=async(platform,valid,_wait,beforeStop)=>{
   assert.equal(platform,'hinge');assert.equal(valid(),true);assert.ok(x.saved().nextFeedRefreshAt>=now+300000);
   assert.deepEqual(x.saved().rejectedPhoto,x.hint);await beforeStop();launches++;x.set(next);
  };
  const state=await x.step();assert.equal(launches,1,entry+' '+result);assert.equal(x.c.screen.kind,next.kind);
  assert.equal(x.commits(),0);assert.equal(x.c.session.count,4);assert.equal(x.c.session.endsAt,x.deadline);
  assert.deepEqual(x.saved().rejectedPhoto,x.hint);assert.equal(x.c.lastAction,null);
  if(result==='new')assert.equal(state.phase,'checking next profile');
  if(result==='empty')assert.equal(state.phase,'waiting for profiles');
  if(result==='same'){
   const cp=x.saved();x.c.restoreCheckpoint(cp);x.c.session.status='running';await x.step();assert.equal(launches,1);
   now+=300001;await x.step();assert.equal(launches,2);assert.deepEqual(x.c.rejectedPhoto,x.hint);
  }
 }
});
test('exhausted Hinge inventory refresh revalidates the held screen immediately before stopping the native app',async()=>{
 const x=await exhaustedDiscover();let lookups=0,stops=0;
 x.android.refreshFeed=async(_platform,_valid,_wait,beforeStop)=>{
  lookups++;x.set({...x.card,kind:'blocked',screenKey:'gate',reason:'Subscription'});await beforeStop();stops++;
 };
 await x.step();assert.equal(lookups,1);assert.equal(stops,0);assert.equal(x.commits(),0);
 assert.deepEqual(x.saved().rejectedPhoto,x.hint);assert.ok(x.saved().nextFeedRefreshAt>Date.now());
});
test('exhausted Hinge inventory refresh preserves cooldown after a lost launcher acknowledgment',async()=>{
 const x=await exhaustedDiscover();let stops=0;
 x.android.refreshFeed=async(_platform,_valid,_wait,beforeStop)=>{
  await beforeStop();stops++;throw Object.assign(Error('Lost acknowledgement'),{code:'ANDROID_COMMAND_TIMEOUT'});
 };
 await x.step();const cp=x.saved();assert.equal(stops,1);assert.ok(cp.nextFeedRefreshAt>Date.now());
 x.c.restoreCheckpoint(cp);x.c.session.status='running';await x.step();assert.equal(stops,1);
 assert.deepEqual(x.saved().rejectedPhoto,x.hint);assert.equal(x.commits(),0);
});
test('inventory checks require an owned exhausted Hinge review and the exact held endpoint or complete source',async()=>{
 for(const mode of ['pending','draft','stopped','expired','limit','moving','untried','legacy','remaining','wrong-identity','wrong-revision','near-photo','composer','break','unbound','wrong-app','comment-mode','changed-rate']){
  const x=await exhaustedDiscover(mode==='near-photo');let refreshes=0;
  x.android.refreshFeed=async()=>{refreshes++};
  if(mode==='pending')x.c.lastAction={identity:'held',name:x.card.name,kind:'like',sessionEndsAt:x.c.session.endsAt};
  if(mode==='draft')x.c.draft={text:'draft'};
  if(mode==='stopped')x.c.session.status='paused';
  if(mode==='expired')x.c.session.now=()=>x.deadline;
  if(mode==='limit')x.c.session.config.maxSwipes=4;
  if(mode==='moving')x.c.rejectedPhoto.promptScan='moving';
  if(mode==='untried')Object.assign(x.c.rejectedPhoto,{attempted:false,promptScan:undefined,promptMovesRemaining:undefined});
  if(mode==='legacy')delete x.c.rejectedPhoto.promptMovesRemaining;
  if(mode==='remaining')x.c.rejectedPhoto.promptMovesRemaining=3;
  if(mode==='wrong-identity')x.set({...x.card,identity:'unexpected'});
  if(mode==='wrong-revision')x.set({...x.card,screenKey:'unexpected',identity:'unknown-card',photos:[{...x.failedPhoto,like:null}]});
  if(mode==='near-photo')x.set({...x.card,photos:[{...x.card.photos[0],visual:'123456789abcdef1'}]});
  if(mode==='composer')x.set({...x.card,controls:{...x.card.controls,composer:control('compose')}});
  if(mode==='break')Object.assign(x.c.session,{config:{...x.c.session.config,breaksEnabled:true},breakUntil:x.deadline-1});
  if(mode==='unbound')x.c.binding=null;
  if(mode==='comment-mode')x.c.config.mode='comment';
  if(mode==='changed-rate')x.c.config.swipe.likeRatio=0.5;
  if(mode==='wrong-app')x.android.hierarchy=async()=>({xml:x.card,foreground:'other.app'});
  x.android.scrollProfile=x.android.tapControl=async()=>{};
  await x.step();assert.equal(refreshes,0,mode);assert.equal(x.commits(),0,mode);
 }
});
test('a changed card during the stability wait cannot trigger generic device recovery against its replacement',async()=>{
 const x=await exhaustedDiscover();x.c.readFailures=3;let launches=0;
 const unrelated=screen({name:'New',identity:'different',screenKey:'changed'});
 x.android.refreshFeed=async()=>{launches++};
 const result=await x.c.sessionStep(x.c.session.config,()=>true,()=>assert.fail(),async()=>{x.set(unrelated);return true},x.c.token());
 assert.equal(launches,0);assert.equal(result.phase,'checking next profile');assert.deepEqual(x.c.rejectedPhoto,x.hint);assert.equal(x.c.nextFeedRefreshAt,0);
});
test('an initially unreachable held Hinge endpoint survives restart and refreshes inventory after its cooldown',async()=>{
 const x=await legacyPromptScan();let now=Date.now(),refreshes=0;
 x.c.session.now=()=>now;
 const endpoint={...x.held,reviewScrollSurface:null,reviewWheelPoint:null,prompts:[]};
 x.set(endpoint);x.c.nextFeedRefreshAt=now+300000;
 x.android.scrollProfile=x.android.wheelDiscover=x.android.tapControl=async()=>assert.fail('No authorized gesture or vote');
 x.android.refreshFeed=async(_platform,valid,_wait,beforeStop)=>{
  assert.equal(valid(),true);await beforeStop();refreshes++;x.set(screen({kind:'empty',identity:null,photos:[],controls:{}}));
 };
 const initial=structuredClone(x.c.rejectedPhoto);
 assert.equal((await x.step()).phase,'waiting for another profile');
 const saved=x.saved();assert.deepEqual(saved.rejectedPhoto,{...initial,promptScan:'spent',promptMovesRemaining:0});
 assert.equal(refreshes,0);x.c.restoreCheckpoint(saved);x.c.session.status='running';
 await x.step();assert.equal(refreshes,0);
 now+=300001;assert.equal((await x.step()).phase,'waiting for profiles');
 assert.equal(refreshes,1);assert.equal(x.commits(),0);assert.equal(x.c.session.count,4);
 assert.deepEqual(x.saved().rejectedPhoto,saved.rejectedPhoto);
});

test('a superseded or changed initial endpoint cannot acquire an exhausted Hinge review',async()=>{
 for(const mode of ['new-run','pending','changed-screen','new-prompt','new-route','after-read']){
  const x=await legacyPromptScan(),initial=structuredClone(x.c.rejectedPhoto);
  const endpoint={...x.held,reviewScrollSurface:null,reviewWheelPoint:null,prompts:[]};x.set(endpoint);
  const hint=x.c.rejectedPhoto,token=x.c.token();let rereads=0;
  const hierarchy=x.android.hierarchy;
  if(mode==='after-read'){
   const fresh=x.c.fresh.bind(x.c);
   x.c.fresh=async(...args)=>{const card=await fresh(...args);x.c.session.epoch++;return card};
  }
  x.android.hierarchy=async()=>{
   rereads++;
   if(mode==='new-run')x.c.session.epoch++;
   if(mode==='pending')x.c.lastAction={identity:'pending'};
   if(mode==='changed-screen')x.set({...endpoint,screenKey:'different'});
   if(mode==='new-prompt')x.set({...endpoint,prompts:[x.prompt]});
   if(mode==='new-route')x.set({...endpoint,reviewScrollSurface:x.held.reviewScrollSurface});
   return hierarchy();
  };
  x.android.scrollProfile=x.android.wheelDiscover=x.android.tapControl=x.android.refreshFeed=async()=>assert.fail('No authorized input');
  await assert.rejects(x.c.reviewHeldPrompt(endpoint,hint,token,()=>true,async()=>true));
  assert.equal(rereads,1,mode);assert.deepEqual(x.c.rejectedPhoto,initial,mode);
  assert.deepEqual(x.saved().rejectedPhoto,initial,mode);assert.equal(x.commits(),0,mode);
 }
});

test('a newly explored Hinge prompt pass records exhaustion when its verified route ends early',async()=>{
 const x=await legacyPromptScan();let moves=0;
 x.android.scrollProfile=async()=>{moves++;x.set({...x.held,identity:null,photos:[],prompts:[],screenKey:'ended',reviewScrollSurface:null,reviewWheelPoint:null})};
 await x.step();assert.equal(moves,1);assert.equal(x.saved().rejectedPhoto.promptMovesRemaining,0);assert.equal(x.commits(),0);
});

test('mobile profile-only sessions keep refreshing empty feeds beyond twelve hours and resume the same run',async()=>{
 for(const platform of ['hinge','bumble']){
  const empty=screen({platform,kind:'empty',identity:null,photos:[],controls:{}});
  const x=setup(empty,{platform});let now=Date.now(),refreshes=0;
  x.c.session.now=()=>now;x.c.session.wait=()=>new Promise(()=>{});
  x.android.refreshFeed=async()=>{refreshes++};
  await x.c.request('config',{swipe:{maxSwipes:1000,sessionMinutes:null}});
  const started=await x.c.request('start');assert.equal(started.session.endsAt,null);assert.ok(started.session.runId);
  const step=()=>x.c.sessionStep(x.c.session.config,()=>x.c.session.valid(x.c.session.epoch),
   ()=>assert.fail('An empty feed must not count'),async()=>true,x.c.token());
  assert.equal((await step()).phase,'waiting for profiles');
  now+=13*3600000;
  assert.equal((await step()).phase,'waiting for profiles');assert.equal(refreshes,2);
  x.c.session.count=x.c.reservedCount=7;
  await x.c.request('pause');const cp=x.c.checkpoint();
  const y=setup(empty,{platform,checkpointStore:{read:()=>cp,write:()=>{}}});y.c.session.wait=()=>new Promise(()=>{});
  const resumed=await y.c.request('start');
  assert.equal(resumed.session.status,'running');assert.equal(resumed.session.runId,started.session.runId);
  assert.equal(resumed.session.endsAt,null);assert.equal(resumed.session.count,7);
  await y.c.request('pause');
 }
});

test('time-only mobile budgets preserve uncertain reservations without ending at a count of zero',async()=>{
 const x=setup();x.c.session.wait=()=>new Promise(()=>{});
 await x.c.request('config',{swipe:{maxSwipes:null,sessionMinutes:60}});
 const started=await x.c.request('start');const s=x.c.session;
 assert.equal(started.session.limit,null);assert.ok(started.session.endsAt>s.now());
 x.c.reserveAction({kind:'pass',name:'Prior',identity:'earlier'});x.c.pendingWait();
 assert.equal(s.count,1);assert.equal(s.status,'running');
 s.status='error';const resumed=await x.c.request('start');
 assert.equal(resumed.session.status,'running');assert.equal(resumed.session.count,1);
 assert.equal(resumed.session.endsAt,started.session.endsAt);assert.equal(resumed.session.runId,started.session.runId);
 await x.c.request('pause');
});

test('mobile settings reject removing both limits together or by a partial patch',async()=>{
 const x=setup();
 await assert.rejects(x.c.request('config',{swipe:{sessionMinutes:null,maxSwipes:null}}),/limit/i);
 await x.c.request('config',{swipe:{sessionMinutes:null,maxSwipes:23}});
 await assert.rejects(x.c.request('config',{swipe:{maxSwipes:null}}),/limit/i);
 assert.equal(x.c.config.swipe.maxSwipes,23);
});

test('Hinge offers a fresh one-card confirmation only for its restored no-deadline Like guard',async()=>{
 const x=confirmedSkipFixture();await x.prepare();
 const cp=x.saved();
 cp.session.runId='6da0e53c-0648-48f9-a176-a906b12b116a';cp.session.endsAt=null;
 cp.session.config.sessionMinutes=cp.config.swipe.sessionMinutes=null;
 cp.pendingAction.sessionEndsAt=null;cp.pendingAction.runId=cp.session.runId;
 x.c.restoreCheckpoint(cp);x.c.session.status='running';await x.step();
 assert.ok(x.offer()?.expiresAt>x.c.session.now());assert.ok(x.offer().expiresAt<=x.c.session.now()+120000);
 const token=x.offer().token;
 x.c.session.runId='2176f391-fdd3-4ded-b504-c98827dadaa5';
 await assert.rejects(x.confirm(token),/expired/);await x.step();assert.equal(x.offer(),null);
 x.c.lastAction={...x.c.lastAction};delete x.c.lastAction.runId;await x.step();
 assert.equal(x.offer(),null);assert.equal(x.c.session.count,74);
});

test('Hinge rejects an unverified photo only within the same count-only run across restarts',async()=>{
 const x=repeatedPhotoFixture();await x.c.request('config',{scrollMin:0,scrollMax:0,
  swipe:{maxSwipes:1000,sessionMinutes:null,likeRatio:1,scrollProfile:false,browsePhotos:false}});
 x.c.session.wait=()=>new Promise(()=>{});const started=await x.c.request('start');
 x.android.tapControl=async()=>x.set(x.form);
 const step=()=>x.c.sessionStep(x.c.session.config,()=>true,()=>assert.fail('Unverified photo'),async()=>true,x.c.token());
 await step();const cp=x.saved();assert.equal(cp.rejectedPhoto.runId,started.session.runId);assert.equal(cp.rejectedPhoto.endsAt,null);
 const y=setup(x.root,{checkpointStore:{read:()=>cp,write:()=>{}}});y.c.session.wait=()=>new Promise(()=>{});
 const resumed=await y.c.request('start');assert.equal(resumed.session.count,0);
 assert.ok(y.c.scopedPhotoRejection(y.c.token()));
 await y.c.request('stop');const fresh=await y.c.request('start');assert.notEqual(fresh.session.runId,started.session.runId);
 assert.equal(y.c.scopedPhotoRejection(y.c.token()),null);
 await y.c.request('stop');await x.c.request('stop');
});

test('both restored mobile workers reconcile an old reservation, poll an empty feed, then stop on the thousandth profile',async()=>{
 for(const platform of ['bumble','hinge']){
  const empty=screen({platform,kind:'empty',identity:null,photos:[],controls:{}});
  const original=setup(empty,{platform});
  original.c.session.wait=()=>new Promise(()=>{});
  await original.c.request('config',{scrollMin:0,scrollMax:0,swipe:{
   maxSwipes:1000,sessionMinutes:null,likeRatio:1,breaksEnabled:false,browsePhotos:false,scrollProfile:false}});
  const started=await original.c.request('start');
  original.c.session.count=original.c.reservedCount=998;
  original.c.reserveAction({identity:'previous-card',name:'Previous'});
  const saved=structuredClone(original.c.checkpoint());assert.equal(saved.session.count,999);
  await original.c.request('pause');

  const x=setup(empty,{platform,checkpointStore:{read:()=>saved,write:()=>{}}});
  let now=Date.now()+14*3600000,ticks=0,refreshes=0,votes=0;
  x.c.session.now=()=>now;
  x.c.session.wait=async ms=>{if(++ticks>40)throw Error('The feed poll failed to advance');now+=ms};
  x.android.refreshFeed=async()=>{
   assert.equal(x.c.lastAction,null);assert.equal(x.c.session.count,999);
   if(++refreshes===2)x.set(platform==='bumble'?bumble():screen());
  };
  if(platform==='bumble')x.android.swipeProfile=async(direction,_bounds,valid,issued)=>{
   assert.equal(direction,'right');assert.equal(valid(),true);votes++;issued();x.set(empty);
  };
  else x.android.tapControl=async(_bounds,valid,issued)=>{
   assert.equal(valid(),true);
   if(issued){votes++;issued();x.set(empty)}
   else x.set(screen({kind:'like',composerTextVerified:true,controls:{sendLike:control('Send like')}}));
  };
  await x.c.request('start');await new Promise(resolve=>setImmediate(resolve));await x.c.drain();
  assert.equal(x.c.session.status,'complete',x.c.session.error);assert.equal(x.c.session.completionReason,'limit');
  assert.equal(x.c.session.count,1000);assert.equal(x.c.session.endsAt,null);
  assert.equal(x.c.session.runId,started.session.runId);assert.equal(x.c.lastAction,null);
  assert.equal(refreshes,2);assert.equal(votes,1);
 }
});

test('a timed v1 Like guard belongs to its restored run even if a later run has the same deadline',async()=>{
 const x=confirmedSkipFixture();await x.prepare();
 const saved=x.saved();delete saved.session.runId;delete saved.pendingAction.runId;
 x.c.restoreCheckpoint(saved);x.c.session.status='running';
 await x.step();assert.ok(x.offer());
 x.c.session.runId='c607c37e7e00422587f2bab165abba56';await x.step();
 assert.equal(x.offer(),null);assert.equal(x.c.lastAction.identity,saved.pendingAction.identity);
});

test('a profile arriving during empty-feed launcher lookup stays visible for ordinary review',async()=>{
 for(const platform of ['hinge','bumble']){
  const empty=screen({platform,kind:'empty',identity:null,photos:[],controls:{}});
  const next=platform==='bumble'?bumble():screen();
  const x=setup(empty,{platform});await x.c.request('status');
  x.c.readFailures=3;x.c.session.status='running';x.c.session.count=x.c.reservedCount=8;
  let launches=0,stops=0;
  x.android.refreshFeed=async(_platform,valid,_wait,beforeStop)=>{
   launches++;x.set(next);assert.equal(valid(),true);
   if(beforeStop)await beforeStop();
   stops++;
  };
  const outcome=await x.c.sessionStep(x.c.config.swipe,()=>true,()=>assert.fail('no vote'),async()=>true,x.c.token());
  assert.equal(launches,1);assert.equal(stops,0);assert.equal(outcome.phase,'checking next profile');
  assert.equal(x.c.screen.identity,next.identity);assert.equal(x.c.session.count,8);
  assert.equal(x.c.lastAction,null);assert.ok(x.c.nextFeedRefreshAt>x.c.session.now());
 }
});

test('clean managed Hinge polls a persistently blank Discover shell through lost refresh acknowledgement until a real profile is counted',async()=>{
 const phone={serial:'emulator-1',avd:'assigned'},blank=loadingDiscover();let saved,now=Date.now(),ticks=0;
 const x=setup(blank,{checkpointStore:{read:()=>null,write:cp=>{saved=structuredClone(cp)}},isManagedPhone:b=>b?.avd===phone.avd});
 x.android.deviceIdentity=async()=>({...phone});
 x.c.session.now=()=>now;
 x.c.session.wait=async ms=>{if(++ticks>180)throw Error('Clean Discover stopped refreshing');now+=ms};
 const launches=[];
 x.android.refreshFeed=async(_platform,valid,_wait,beforeStop)=>{
  await beforeStop();assert.equal(valid(),true);assert.ok(saved.nextFeedRefreshAt>=now+300000);
  assert.equal(saved.session.count,0);assert.equal(saved.pendingAction,null);launches.push(now);
  if(launches.length===2)throw Object.assign(Error('Lost native launcher acknowledgement'),{code:'ANDROID_COMMAND_TIMEOUT'});
  if(launches.length===3)x.set(screen());
 };
 let votes=0;
 x.android.tapControl=async(_bounds,valid,issued)=>{
  assert.equal(valid(),true);
  if(issued){votes++;issued();x.set(screen({name:'Next',identity:'next'}))}
  else x.set(screen({kind:'like',composerTextVerified:true,controls:{sendLike:control('Send like')}}));
 };
 await x.c.request('config',{scrollMin:0,scrollMax:0,swipe:{maxSwipes:1,sessionMinutes:null,likeRatio:1,
  allowBackground:true,breaksEnabled:false,browsePhotos:false,scrollProfile:false}});
 await x.c.request('start');await new Promise(resolve=>setImmediate(resolve));await x.c.drain();
 assert.equal(x.c.session.status,'complete',x.c.session.error);assert.equal(x.c.session.completionReason,'limit');
 assert.equal(x.c.session.count,1);assert.equal(votes,1);assert.equal(launches.length,3);
 assert.ok(launches[1]-launches[0]>=300000);assert.ok(launches[2]-launches[1]>=300000);
 assert.equal(saved.pendingAction,null);assert.equal(saved.loadingFeedRelaunched,false);
});

test('clean Hinge loading refresh hands a changed native screen back to normal review before force-stop',async()=>{
 for(const next of [screen(),feedError(),screen({kind:'blocked',reason:'Subscription gate'})]){
  const x=await loadingHinge();x.c.checkpointStore={write(){}};
  x.c.lastAction=null;x.c.loadingFeedRelaunched=true;x.c.nextFeedRefreshAt=0;x.c.readFailures=3;
  let lookups=0,stops=0;
  x.android.refreshFeed=async(_platform,_valid,_wait,beforeStop)=>{lookups++;x.set(next);await beforeStop();stops++};
  const result=await x.run();
  assert.equal(lookups,1);assert.equal(stops,0);assert.equal(result.phase,'checking next profile');
  assert.equal(x.c.screen.kind,next.kind);assert.equal(x.c.session.count,4);
  assert.ok(x.c.nextFeedRefreshAt>x.c.session.now());
 }
});

test('repeat Hinge loading refresh rechecks the occupied run, budget and managed binding',async()=>{
 for(const scenario of ['pending','draft','cap','deadline','unsettled-count','unmanaged','no-store','missing-key','changed-phone','expired-during-grace']){
  const x=await loadingHinge(scenario!=='unmanaged');
  x.c.checkpointStore=scenario==='no-store'?null:{write(){}};x.c.loadingFeedRelaunched=true;x.c.nextFeedRefreshAt=0;
  if(scenario!=='pending')x.c.lastAction=null;
  if(scenario==='draft')x.c.draft={text:'draft'};
  if(scenario==='cap')x.c.session.config.maxSwipes=x.c.session.count;
  if(scenario==='unsettled-count')x.c.reservedCount++;
  if(scenario==='deadline')x.c.session.endsAt=Date.now()-1;
  if(scenario==='missing-key')x.set({...loadingDiscover(),screenKey:null});
  let stops=0;
  x.android.refreshFeed=async(_platform,_valid,_wait,beforeStop)=>{
   if(scenario==='changed-phone')x.android.deviceIdentity=async()=>({...x.c.binding,avd:'different-phone'});
   await beforeStop();stops++;
  };
  try{await x.run(async()=>{if(scenario==='expired-during-grace')x.c.session.endsAt=Date.now()-1;return true})}
  catch(e){if(scenario!=='changed-phone'||e.code!=='MOBILE_DEVICE_CHANGED')throw e}
  assert.equal(stops,0,scenario);assert.equal(x.c.session.count,4,scenario);
 }
});

test('restoring a clean Hinge loading checkpoint honors its original cooldown and does not hide storage failures',async()=>{
 const x=await loadingHinge();x.c.lastAction=null;x.c.loadingFeedRelaunched=true;
 let now=Date.now();x.c.nextFeedRefreshAt=now+300000;
 const saved=x.c.checkpoint(),y=await loadingHinge();
 y.c.restoreCheckpoint(saved);y.c.session.status='running';y.c.session.now=()=>now;
 let failed=false,stops=0;
 y.c.checkpointStore={write:cp=>{if(failed&&cp.nextFeedRefreshAt>now)throw Error('No space')}};
 y.android.refreshFeed=async(_platform,_valid,_wait,beforeStop)=>{await beforeStop();stops++};
 await y.run();assert.equal(stops,0);now+=300001;
 await y.run();assert.equal(stops,1);assert.equal(y.c.session.count,4);
 now+=300001;failed=true;
 await assert.rejects(y.run(),e=>e.code==='MOBILE_STORAGE_FAILURE');assert.equal(stops,1);
});

test('an unresolved Hinge Like retains its one-shot blank guard across a visible Retry or the same profile',async()=>{
 const x=await loadingHinge();let launches=0;
 x.android.refreshFeed=async(_platform,_valid,_wait,beforeStop)=>{await beforeStop();launches++};
 await x.run();const guard=x.c.lastAction;assert.equal(launches,1);
 for(const current of [feedError(),screen({identity:guard.identity,name:guard.name})]){
  x.set(current);await x.c.read(x.c.token());x.set(loadingDiscover());x.c.nextFeedRefreshAt=0;
  await x.run();assert.equal(launches,1);assert.equal(x.c.lastAction,guard);
 }
 x.set(screen({identity:'new-card',name:'Next'}));await x.run();assert.equal(x.c.lastAction,null);
 x.set(loadingDiscover());await x.run();assert.equal(launches,2);
});

test('compare-and-resume keeps one exact mobile run and acknowledges duplicate starts without another session record',async()=>{
 const x=setup();x.c.session.wait=()=>new Promise(()=>{});
 await x.c.request('config',{swipe:{sessionMinutes:null,maxSwipes:1000}});
 const started=await x.c.request('start');x.c.session.count=x.c.reservedCount=9;
 const paused=await x.c.request('pause');
 assert.ok(Number.isSafeInteger(paused.resumeEpoch));
 const pair={resumeRunId:started.session.runId,expectedResumeEpoch:paused.resumeEpoch};
 const [a,b]=await Promise.all([x.c.request('start',pair),x.c.request('start',pair)]);
 for(const s of [a.session,b.session]){
  assert.equal(s.status,'running');assert.equal(s.runId,pair.resumeRunId);
  assert.equal(s.count,9);assert.equal(s.limit,1000);assert.equal(s.endsAt,null);
 }
 assert.equal(x.calls.filter(c=>c.kind==='session').length,2);
 await assert.rejects(x.c.request('start'),/already running/i);
 assert.equal((await x.c.request('start',{...pair,expectedResumeEpoch:0})).session.count,9);
 await x.c.request('stop');
});

test('guarded mobile start rejects old epochs, wrong IDs, inactive or expired runs, and a missing run ID',async()=>{
 const x=setup();x.c.session.wait=()=>new Promise(()=>{});
 const started=await x.c.request('start'),sid=started.session.runId;
 await x.c.request('pause');const old=(await x.c.request('status')).resumeEpoch;
 const paused=await x.c.request('pause');assert.ok(paused.resumeEpoch>old);
 for(const data of [{resumeRunId:sid,expectedResumeEpoch:old},{resumeRunId:'different'},
                    {resumeRunId:null},{expectedResumeEpoch:paused.resumeEpoch},{resumeRunId:sid,expectedResumeEpoch:-1}]){
  await assert.rejects(x.c.request('start',data));assert.equal(x.c.session.status,'paused');assert.equal(x.c.session.runId,sid);
 }
 x.c.session.endsAt=Date.now()-1;await assert.rejects(x.c.request('start',{resumeRunId:sid}));
 assert.equal(x.c.session.status,'complete');await assert.rejects(x.c.request('start',{resumeRunId:sid}));
 await x.c.request('stop');await assert.rejects(x.c.request('start',{resumeRunId:sid}));
 const fresh=await x.c.request('start');assert.notEqual(fresh.session.runId,sid);
 await assert.rejects(x.c.request('start',{resumeRunId:sid}));assert.equal(x.c.session.runId,fresh.session.runId);
 await x.c.request('stop');
});

test('Stop or Pause during final native screen validation cancels guarded and ordinary mobile starts',async()=>{
 for(const guarded of [false,true])for(const action of ['pause','stop']){
  const x=setup(screen({kind:'empty',identity:null}));x.c.session.wait=()=>new Promise(()=>{});
  const started=await x.c.request('start');x.c.session.count=x.c.reservedCount=11;
  const paused=await x.c.request('pause');
  let reading=false,canceled;
  const hierarchy=x.android.hierarchy;x.android.hierarchy=async()=>{reading=true;return hierarchy()};
  x.c.changed=()=>{if(reading){reading=false;canceled=x.c.request(action)}};
  const guard={resumeRunId:started.session.runId,expectedResumeEpoch:paused.resumeEpoch};
  await assert.rejects(x.c.request('start',guarded?guard:{}));
  await canceled;assert.equal(x.c.session.status,action==='pause'?'paused':'idle');
  assert.equal(x.c.session.runId,started.session.runId);assert.equal(x.c.session.count,11);
  assert.equal(x.calls.filter(c=>c.kind==='session').length,1);
 }
});

test('a stop during guarded mobile start acknowledgement cannot rearm an opener or claim a successful resume',async()=>{
 const x=setup();x.c.session.wait=()=>new Promise(()=>{});
 await x.c.request('config',{autoOpeners:true});
 const started=await x.c.request('start'),paused=await x.c.request('pause');
 const entered=deferred(),release=deferred();const request=x.c.service.request;
 x.c.service.request=async(action,...rest)=>{if(action==='record'){entered.resolve();await release.promise}return request(action,...rest)};
 const job=x.c.request('start',{resumeRunId:started.session.runId,expectedResumeEpoch:paused.resumeEpoch});
 await entered.promise;await x.c.request('stop');release.resolve();await assert.rejects(job);
 assert.equal(x.c.session.status,'idle');assert.equal(x.c.openerArmed,false);
});

test('a repeated or mismatched guarded start cannot write checkpoints for a different or already running worker',async()=>{
 let writes=0;
 const x=setup(screen(),{checkpointStore:{read:()=>null,write:()=>{writes++}}});x.c.session.wait=()=>new Promise(()=>{});
 const started=await x.c.request('start');const before=writes;
 await x.c.request('start',{resumeRunId:started.session.runId});
 await assert.rejects(x.c.request('start',{resumeRunId:'other'}));
 assert.equal(writes,before);assert.equal(x.c.session.status,'running');
 await x.c.request('stop');
});

test('a changed paused mobile config invalidates the old resume observation, including legacy timed checkpoints',async()=>{
 const base=setup();base.c.session.wait=()=>new Promise(()=>{});
 await base.c.request('start');await base.c.request('pause');
 const cp=base.c.checkpoint();delete cp.session.runId;
 const x=setup(screen(),{checkpointStore:{read:()=>cp,write:()=>{}}});x.c.session.wait=()=>new Promise(()=>{});
 const before=await x.c.request('status'),sid=before.session.runId;
 const after=await x.c.request('config',{swipe:{randomizeTiming:false,delaySeconds:21}});
 assert.ok(after.resumeEpoch>before.resumeEpoch);assert.equal(x.c.session.config.delaySeconds,21);
 await assert.rejects(x.c.request('start',{resumeRunId:sid,expectedResumeEpoch:before.resumeEpoch}));
 assert.equal(x.c.session.status,'paused');
 assert.equal((await x.c.request('start',{resumeRunId:sid,expectedResumeEpoch:after.resumeEpoch})).session.runId,sid);
 await x.c.request('stop');
});

test('a status read during an in-flight mobile settings write cannot resume its outdated checkpoint',async()=>{
 const x=setup();x.c.session.wait=()=>new Promise(()=>{});
 await x.c.request('start');const paused=await x.c.request('pause');
 const entered=deferred(),release=deferred(),request=x.c.service.request;
 x.c.service.request=async(action,...args)=>{if(action==='save'){entered.resolve();await release.promise}return request(action,...args)};
 const edit=x.c.request('config',{swipe:{delaySeconds:23}});await entered.promise;
 const during=await x.c.request('status');assert.notEqual(during.config.swipe.delaySeconds,23);
 const resume=snap=>x.c.request('start',{resumeRunId:snap.session.runId,expectedResumeEpoch:snap.resumeEpoch});
 const first=assert.rejects(resume(paused)),second=assert.rejects(resume(during));
 release.resolve();const saved=await edit;await Promise.all([first,second]);
 assert.equal(x.c.session.status,'paused');assert.equal(saved.config.swipe.delaySeconds,23);
 assert.equal((await resume(saved)).session.runId,paused.session.runId);await x.c.request('stop');
});

test('a manual action queued during guarded native start preflight supersedes the resume without canceling the manual action',async()=>{
 const x=setup();x.c.session.wait=()=>new Promise(()=>{});
 await x.c.request('start');const paused=await x.c.request('pause'),entered=deferred(),release=deferred();
 const read=x.android.hierarchy;let first=true;x.android.hierarchy=async()=>{if(first){first=false;entered.resolve();await release.promise}return read()};
 const starting=x.c.request('start',{resumeRunId:paused.session.runId});
 await entered.promise;
 const operationEpoch=x.c.epoch,inputEpoch=x.android.inputEpoch;
 x.android.tapControl=async(_bounds,valid,issued)=>{assert.equal(valid(),true);issued();x.set(screen({name:'Next',identity:'next'}))};
 const manual=x.c.request('act',{kind:'pass'});const stale=assert.rejects(starting);
 release.resolve();await Promise.all([stale,manual]);assert.equal(x.c.session.status,'paused');
 assert.equal(x.calls.filter(c=>c.kind==='pass').length,1);assert.equal(x.c.epoch,operationEpoch);assert.equal(x.android.inputEpoch,inputEpoch);
 await assert.rejects(x.c.request('start',{resumeRunId:paused.session.runId,expectedResumeEpoch:paused.resumeEpoch}));
});
