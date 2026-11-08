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
