'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const Controller=require('../desktop/mobile-controller.cjs');
const Config=require('../desktop/mobile-config.cjs');
const box={x:10,y:20,width:80,height:90};
const control=key=>({key,label:key,bounds:box});
const screen=(overrides={})=>({platform:'hinge',kind:'profile',name:'Example',identity:'example-prompt-one',screenKey:'first',context:{name:'Example',bio:'I enjoy hiking',history:[]},photos:[{key:'photo-one',bounds:box,like:control('photo-one')}],controls:{skip:control('skip'),like:control('photo-one'),sendLike:null,comment:null,composer:null,sendMessage:null},composerText:'',emptyConversation:false,reason:'',...overrides});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}};
function setup(initial=screen(),extra={}){
 let current=initial,settings={sidebarConsentGiven:true,mobileConfig:{}};
 const calls=[],changes=[];
 const android={serial:'emulator-1',inputEpoch:0,cancelInput(){this.inputEpoch++},hierarchy:async()=>({xml:current,foreground:'co.hinge.app'}),tapControl:async(b,valid)=>{assert.equal(valid(),true);calls.push('tap');if(extra.tap)await extra.tap()},scrollProfile:async(opts,valid)=>{assert.equal(valid(),true);calls.push(opts);if(extra.scroll)await extra.scroll()},type:async text=>calls.push(text)};
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
 const x=setup(screen({photos:[],controls:{}}));await x.c.request('config',{scrollMin:0,scrollMax:0});await assert.rejects(x.c.request('review'),/photo/i);assert.ok(x.calls.filter(c=>c.fraction).length<=6);assert.equal(x.calls.includes('tap'),false);
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

test('Bumble confirms first pass only for the matching swipe direction',async()=>{
 for(const confirmDirection of ['left','right']){const x=setup(bumble(),{platform:'bumble',tap:()=>x.set(bumble({name:'Next',identity:'next'}))});x.android.swipeProfile=async(d,b,v,cb)=>{cb();x.set(bumble({kind:'swipeConfirm',swipeDirection:confirmDirection,identity:'confirm',controls:{confirm:control('no')}}))};if(confirmDirection==='left'){await x.c.request('act',{kind:'pass'});assert.equal(x.calls.filter(v=>v==='tap').length,1)}else{await assert.rejects(x.c.request('act',{kind:'pass'}),/transition/);assert.equal(x.calls.filter(v=>v==='tap').length,0)}}
});

test('Bumble final profile completes the session when its verified queue becomes empty',async()=>{
 const empty=bumble({kind:'empty',identity:null,name:'',reason:'No more profiles within your Bumble filters.',controls:{},photos:[]});const x=setup(bumble(),{platform:'bumble'});let swipes=0;x.android.swipeProfile=async(d,b,v,issued)=>{swipes++;issued();x.set(empty)};await x.c.request('config',{scrollMin:0,scrollMax:0,swipe:{maxSwipes:30,likeRatio:1}});await x.c.request('start');await new Promise(r=>setImmediate(r));await x.c.drain();assert.equal(x.c.session.status,'complete');assert.equal(x.c.session.completionReason,'no more profiles');assert.equal(x.c.session.count,1);assert.equal(swipes,1);
});
test('Bumble empty queue completes Start without a swipe or error',async()=>{
 const x=setup(bumble({kind:'empty',identity:null,controls:{},photos:[]}),{platform:'bumble'});await x.c.request('start');assert.equal(x.c.session.status,'complete');assert.equal(x.c.session.count,0);assert.equal(x.c.session.completionReason,'no more profiles');
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
