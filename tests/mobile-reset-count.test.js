'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const Controller=require('../desktop/mobile-controller.cjs');
const Checkpoint=require('../desktop/mobile-checkpoint.cjs');
const Config=require('../desktop/mobile-config.cjs');
const Session=require('../shared/session.js');
const turnLimit=()=>require('../desktop/mobile-screen.cjs').readScreen(require('./fixtures/hinge-your-turn-limit.cjs').yourTurnLimit(),{foreground:'co.hinge.app'});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}};

async function fixture(t,platform='hinge',{count=7,pending='like'}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mobile-reset-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const store=new Checkpoint(path.join(dir,platform+'.json'));
 const config=Config.normalize({mode:'like',swipe:{maxSwipes:1000,sessionMinutes:null,likeRatio:1}});
 const session=new Session({});session.config=config.swipe;
 const saved={version:1,platform,session:{...session.checkpoint(),status:'paused',phase:'paused',runId:'previous-run',count,nextBreakAt:25,breakUntil:1234},config,
  binding:{serial:'emulator-1',avd:platform+'-phone'},pendingAction:pending?{kind:pending,identity:'old-card',name:'Previous',runId:'previous-run',sessionEndsAt:null}:null,
  recoveryAttempts:1,nextFeedRefreshAt:10000,nextFeedRetryAt:20000,nextHomeLaunchAt:30000,loadingFeedRelaunched:true};
 store.write(saved);
 const screen=()=>platform==='hinge'?turnLimit():{platform:'bumble',kind:'profile',name:'Previous',identity:'old-card',screenKey:'previous',photos:[],controls:{},context:{name:'Previous'},reason:''};
 const calls=[],android={serial:'emulator-1',inputEpoch:0,
  hierarchy:async()=>{calls.push('read');return {xml:screen(),foreground:platform==='hinge'?'co.hinge.app':'com.bumble.app'}},
  deviceIdentity:async()=>{calls.push('binding');return saved.binding},
  cancelInput:()=>assert.fail('Reset must not issue Android commands'),
  tapControl:()=>assert.fail('Reset must not dispatch a Like'),scrollProfile:()=>assert.fail('Reset must not navigate')};
 const service={request:async action=>{calls.push(action);if(action==='load')return {sidebarConsentGiven:true,mobileConfig:{[platform]:config}};if(action==='record')return {};throw Error('Unexpected service action '+action)}};
 const make=()=>new Controller({android,service,platform,checkpointStore:store,readScreen:xml=>xml,wait:()=>new Promise(()=>{})});
 const c=make();await c.request('status');c.screen=screen();calls.length=0;
 const observed=()=>{const state=c.snapshot();return {expectedRunId:state.session.runId,expectedCount:state.session.count,expectedResumeEpoch:state.resumeEpoch}};
 return {c,store,android,service,calls,make,observed};
}

test('Hinge resetCount durably resets the counter without releasing its pending Like or account limit',async t=>{
 const x=await fixture(t),previous=x.store.read(),guard=x.c.lastAction,screen=x.c.screen,token=x.c.token();
 x.c.openerArmed=true;x.c.selectedPhoto={key:'old'};x.c.selectedPrompt={key:'old'};x.c.reviewContext={identity:'old'};
 const expected=x.observed();assert.equal(x.c.snapshot().canResetCount,true);
 const result=await x.c.request('resetCount',expected),saved=x.store.read();
 assert.equal(result.session.status,'idle');assert.equal(result.session.count,0);assert.equal(result.session.limit,1000);
 assert.equal(result.session.runId,null);assert.equal(result.session.endsAt,null);assert.equal(result.session.nextActionAt,null);
 assert.equal(result.canResetCount,false);assert.equal(result.hasPendingAction,true);assert.equal(x.c.lastAction,guard);
 assert.equal(x.c.reservedCount,0);assert.equal(x.c.screen,screen);assert.match(result.reason,/Your Turn Limits/);
 assert.equal(result.openerArmed,false);assert.equal(result.draft,null);assert.equal(result.selectedPhoto,null);assert.equal(result.selectedPrompt,null);
 assert.ok(result.resumeEpoch>expected.expectedResumeEpoch);assert.ok(token.signal.aborted);
 assert.equal(saved.session.status,'idle');assert.equal(saved.session.count,0);assert.equal(saved.session.runId,null);
 assert.equal(saved.session.config.maxSwipes,1000);assert.equal(saved.session.config.sessionMinutes,null);assert.equal(saved.session.config.likeRatio,1);
 assert.equal(saved.session.nextBreakAt,saved.session.config.breakEvery);assert.equal(saved.session.breakUntil,null);
 for(const key of ['config','binding','pendingAction','recoveryAttempts','nextFeedRefreshAt','nextFeedRetryAt','nextHomeLaunchAt','loadingFeedRelaunched'])assert.deepEqual(saved[key],previous[key],key);
 assert.deepEqual(x.calls,[]);
 const reopened=x.make(),restored=await reopened.request('status');
 assert.equal(restored.session.count,0);assert.equal(restored.session.status,'idle');assert.equal(restored.hasPendingAction,true);
 assert.deepEqual(reopened.lastAction,previous.pendingAction);
 await assert.rejects(reopened.request('start'),/Your Turn Limits/);
 assert.equal(reopened.session.count,0);assert.equal(reopened.session.runId,null);assert.deepEqual(reopened.lastAction,previous.pendingAction);
 await assert.rejects(x.c.request('resetCount',expected),/reset|observed|changed/i);
});

test('Bumble resetCount durably clears its counter while preserving any unresolved Like or Skip',async t=>{
 for(const pending of [null,'like','pass']){
  const x=await fixture(t,'bumble',{count:450,pending}),previous=x.store.read(),guard=x.c.lastAction,screen=x.c.screen;
  const expected=x.observed();assert.equal(x.c.snapshot().canResetCount,true);
  const reset=await x.c.request('resetCount',expected),saved=x.store.read();
  assert.equal(reset.platform,'bumble');assert.equal(reset.session.status,'idle');assert.equal(reset.session.count,0);assert.equal(reset.session.limit,1000);
  assert.equal(reset.session.runId,null);assert.equal(reset.session.endsAt,null);assert.equal(reset.session.nextActionAt,null);
  assert.equal(reset.hasPendingAction,Boolean(pending));assert.equal(x.c.lastAction,guard);assert.equal(x.c.screen,screen);assert.equal(x.c.reservedCount,0);
  if(pending)assert.match(reset.reason,/earlier action.*unconfirmed/);
  assert.equal(saved.session.status,'idle');assert.equal(saved.session.count,0);assert.equal(saved.session.config.likeRatio,1);assert.equal(saved.session.config.maxSwipes,1000);
  assert.equal(saved.session.config.sessionMinutes,null);assert.ok(reset.resumeEpoch>expected.expectedResumeEpoch);
  const {session:oldSession,...oldState}=previous,{session:newSession,...newState}=saved;
  assert.deepEqual(newState,oldState);assert.equal(oldSession.count,450);assert.equal(newSession.runId,null);
  assert.deepEqual(x.calls,[]);
  const reopened=x.make(),restored=await reopened.request('status');
  assert.equal(restored.session.status,'idle');assert.equal(restored.session.count,0);assert.equal(restored.session.limit,1000);
  assert.equal(restored.session.endsAt,null);assert.equal(restored.hasPendingAction,Boolean(pending));assert.deepEqual(reopened.lastAction,guard);
  await assert.rejects(x.c.request('resetCount',expected),/reset|observed|changed/i);
 }
});

for(const platform of ['hinge','bumble']){
test(`${platform} resetCount writes the candidate before memory adoption and keeps the old run on write failure`,async t=>{
 const x=await fixture(t,platform),previous=x.store.read(),guard=x.c.lastAction,screen=x.c.screen;
 const write=x.store.write.bind(x.store);let candidates=0;
 x.store.write=value=>{
  if(value.session.status==='idle'&&value.session.count===0){
   candidates++;assert.equal(x.c.session.count,7);assert.equal(x.c.session.runId,'previous-run');assert.equal(x.c.lastAction,guard);
   throw Error('Reset checkpoint disk unavailable');
  }
  write(value);
 };
 await assert.rejects(x.c.request('resetCount',x.observed()),/disk unavailable/);
 assert.equal(candidates,1);assert.deepEqual(x.store.read(),previous);
 assert.equal(x.c.session.count,7);assert.equal(x.c.reservedCount,7);assert.equal(x.c.session.runId,'previous-run');
 assert.equal(x.c.lastAction,guard);assert.equal(x.c.screen,screen);assert.equal(x.c.snapshot().canResetCount,false);
 assert.match(x.c.snapshot().reason,/disk unavailable/);assert.deepEqual(x.calls,[]);
});

test(`${platform} resetCount rejects missing, malformed, and stale observations without changing progress`,async t=>{
 const x=await fixture(t,platform),before=x.store.read(),correct=x.observed();
 for(const data of [{},null,{...correct,expectedRunId:null},{...correct,expectedRunId:'other'},
  {...correct,expectedCount:6},{...correct,expectedCount:7.5},{...correct,expectedResumeEpoch:-1},
  {...correct,expectedResumeEpoch:correct.expectedResumeEpoch+1}]){
  await assert.rejects(x.c.request('resetCount',data),/reset|observed|changed/i);
  assert.deepEqual(x.store.read(),before);assert.equal(x.c.session.count,7);
 }
 assert.deepEqual(x.calls,[]);
});

test(`${platform} resetCount is unavailable for unknown platforms, active, unsettled, unbound, and protected review states`,async t=>{
 const x=await fixture(t,platform);
 const cases=[['platform','unknown'],['loaded',false],['checkpointStore',null],['storageError','Old storage failure'],
  ['binding',null],['binding',{serial:'another-phone'}],['rejectedPhoto',{attempted:true}],['draft',{text:'Unsent'}],['reservedCount',8],['busy',true]];
 for(const [key,value] of cases){
  const previous=x.c[key],data=x.observed();x.c[key]=value;
  assert.equal(x.c.snapshot().canResetCount,false,key);
  await assert.rejects(x.c.request('resetCount',data),/reset|observed|changed/i);x.c[key]=previous;
 }
 for(const [key,value] of [['status','running'],['runId',null],['count',0]]){
  const previous=x.c.session[key],data=x.observed();x.c.session[key]=value;
  assert.equal(x.c.snapshot().canResetCount,false,key);
  await assert.rejects(x.c.request('resetCount',data),/reset|observed|changed/i);x.c.session[key]=previous;
 }
 assert.equal(x.store.read().session.count,7);assert.deepEqual(x.calls,[]);
});

test(`${platform} resetCount rechecks queued observations after config, count, and device changes`,async t=>{
 for(const change of ['config','count','device']){
  const x=await fixture(t,platform),gate=deferred();x.c.queue=gate.promise;
  const reset=x.c.request('resetCount',x.observed());
  if(change==='config')x.c.invalidateResume();
  if(change==='count')x.c.session.count=x.c.reservedCount=8;
  if(change==='device')x.android.inputEpoch++;
  gate.resolve();await assert.rejects(reset,/reset|observed|changed|cancel/i);
  assert.equal(x.c.session.runId,'previous-run');assert.equal(x.c.session.count,change==='count'?8:7);
  assert.deepEqual(x.calls,[]);
 }
});

test(`${platform} resetCount cancels Start and Resume queued behind the old observed run`,async t=>{
 const x=await fixture(t,platform),expected=x.observed();
 const reset=x.c.request('resetCount',expected);
 const start=x.c.request('start');
 const resume=x.c.request('start',{resumeRunId:expected.expectedRunId,expectedResumeEpoch:expected.expectedResumeEpoch});
 const [resetResult,startResult,resumeResult]=await Promise.allSettled([reset,start,resume]);
 assert.equal(resetResult.status,'fulfilled');
 for(const result of [startResult,resumeResult]){
  assert.equal(result.status,'rejected');assert.match(result.reason.message,/changed|canceled/i);
 }
 assert.equal(x.c.session.status,'idle');assert.equal(x.c.session.count,0);assert.equal(x.c.session.runId,null);
 assert.equal(x.store.read().session.count,0);assert.equal(x.store.read().pendingAction.identity,'old-card');
 assert.deepEqual(x.calls,[]);
});

test(`${platform} resetCount rejects an old worker commit after its queue has drained`,async t=>{
 const x=await fixture(t,platform),released=deferred(),entered=deferred();let commit;
 x.c.session.wait=async()=>{};x.c.session.act=async(_config,_valid,commitAction)=>{commit=commitAction;entered.resolve();await released.promise};
 x.c.session.controller=new AbortController();x.c.session.status='running';
 const oldRun=x.c.session.run(x.c.session.epoch);await entered.promise;
 x.c.session.pause();await x.c.drain();
 await x.c.request('resetCount',x.observed());
 commit();released.resolve();await oldRun;
 assert.equal(x.c.session.count,0);assert.equal(x.c.session.runId,null);assert.equal(x.store.read().session.count,0);
 assert.equal(x.c.lastAction.identity,'old-card');assert.deepEqual(x.calls,[]);
});
}

test('Hinge resetCount preserves an optional time limit without starting its deadline until a new session starts',async t=>{
 const x=await fixture(t),previous=x.store.read();
 previous.config.swipe.sessionMinutes=45;previous.session.config.sessionMinutes=45;
 previous.session.endsAt=Date.now()-60000;x.store.write(previous);
 const c=x.make();await c.request('status');assert.equal(c.session.status,'complete');
 const state=c.snapshot();
 await c.request('resetCount',{expectedRunId:state.session.runId,expectedCount:state.session.count,expectedResumeEpoch:state.resumeEpoch});
 const saved=x.store.read();assert.equal(saved.session.endsAt,null);assert.equal(saved.session.config.sessionMinutes,45);
 const reopened=x.make();await reopened.request('status');assert.equal(reopened.session.status,'idle');assert.equal(reopened.session.endsAt,null);
 x.android.hierarchy=async()=>({xml:{platform:'hinge',kind:'profile',identity:'next-card',name:'Next',screenKey:'new',photos:[],prompts:[],controls:{},context:{name:'Next'},composerText:''},foreground:'co.hinge.app'});
 reopened.session.wait=()=>new Promise(()=>{});
 const earliest=Date.now()+45*60000;
 const started=await reopened.request('start');
 assert.equal(started.session.status,'running');assert.equal(started.session.count,0);assert.equal(started.session.limit,1000);
 assert.ok(started.session.endsAt>=earliest&&started.session.endsAt<=Date.now()+45*60000);
 assert.notEqual(started.session.runId,'previous-run');assert.equal(reopened.lastAction.identity,'old-card');
 reopened.session.pause();
});
