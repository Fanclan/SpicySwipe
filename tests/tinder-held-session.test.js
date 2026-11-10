'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const Held=require('../desktop/tinder-held-session.cjs');
const emulateWebDirectoryDescriptor=require('./fixtures/web-receipt-directory.cjs');
const seed={version:1,runId:'a'.repeat(32),count:250,limit:1000,endsAt:null};
const next='b'.repeat(32);
const approval={sourceRunId:seed.runId,sourceCount:250,remaining:750,acceptPossibleRepeat:true};
function view(status='idle',count=0,runId=null,limit=750){
  return {connected:true,capabilities:{budgetGuard:1},context:{page:'/app/recs'},session:{status,phase:status,runId,count,limit,endsAt:null,
    nextActionAt:null,completionReason:status==='complete'?'limit':'',error:''}};
}
function setup(t,emulateDirectory=process.platform==='win32'){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ss-held-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const file=path.join(directory,'sessions','tinder-held.json');
  if(emulateDirectory)emulateWebDirectoryDescriptor(t,path.dirname(file));
  const open=(input=JSON.stringify(seed))=>new Held(file,input);
  let screen=view(),ready=true,starts=0,saves=0;
  const send=async(action,data)=>{
    if(action==='context')return {...screen,guardedStartReady:ready&&!!data?.budgetGuard};
    if(action==='start'){starts++;screen=view('running',screen.session.count,next)}
    if(action==='pause')screen=view('paused',screen.session.count,next);
    if(action==='stop')screen=view('idle',screen.session.count,next);
    return screen;
  };
  return {file,open,send,prepare:async n=>{assert.equal(n,750);saves++},
    set:s=>{screen=s},ready:v=>{ready=v},starts:()=>starts,saves:()=>saves};
}
test('an unseeded workspace passes through original page calls and never creates a migration file',async t=>{
  const x=setup(t),h=x.open(''),v=view();
  assert.equal(h.project(v),v);
  assert.equal(await h.control('start',{},async()=>v),v);
  await assert.rejects(h.control('continueHeld',approval,x.send,x.prepare));
  assert.equal(fs.existsSync(x.file),false);
});
test('source hold survives restart and reports the original receipt on cold or live snapshots',async t=>{
  const x=setup(t);
  for(const h of [x.open(),x.open(''),x.open()]){
    for(const raw of [undefined,view(),{connected:false}]){
      const v=h.project(raw);
      assert.equal(v.session.status,'held');assert.equal(v.session.count,250);assert.equal(v.session.limit,1000);
      assert.equal(v.session.runId,seed.runId);assert.equal(v.session.endsAt,null);assert.equal(v.tinderHandoff.minimumOnly,false);
    }
    const v=await h.control('context',{},async()=>{throw Error('renderer unavailable')});
    assert.equal(v.session.count,250);
    for(const action of ['start','stop'])await assert.rejects(h.control(action,{},async()=>assert.fail('no raw action')));
  }
});
test('the POSIX web store creates owner-only receipt and dispatch files',{skip:process.platform==='win32'&&'POSIX mode bits are unavailable on Windows'},async t=>{
  const x=setup(t),h=x.open();
  await h.control('continueHeld',approval,x.send,x.prepare);
  assert.equal(fs.statSync(path.dirname(x.file)).mode&0o777,0o700);
  for(const file of [x.file,x.file+'.dispatch']){
    const stat=fs.lstatSync(file);
    assert.ok(stat.isFile());assert.equal(stat.mode&0o777,0o600);
  }
});
test('failure to flush the native claim directory blocks dispatch and prevents replay',async t=>{
  const x=setup(t,false),dir=path.dirname(x.file);
  fs.mkdirSync(dir,{mode:0o700});
  fs.writeFileSync(x.file,JSON.stringify({source:seed,stage:'held',successorId:null,successorCount:0}),{mode:0o600});
  if(process.platform!=='win32'){
    const open=fs.openSync;
    t.mock.method(fs,'openSync',(file,flags,...rest)=>{
      if(file===dir&&flags==='r')throw Object.assign(Error('Directory handle unavailable'),{code:'EACCES'});
      return open(file,flags,...rest);
    });
  }
  const h=x.open('');
  assert.equal(h.stage,'held');
  await assert.rejects(h.control('continueHeld',approval,x.send,x.prepare),/reserved|saved/);
  assert.equal(h.stage,'invalid');assert.deepEqual(JSON.parse(fs.readFileSync(x.file+'.dispatch','utf8')),{runId:seed.runId});
  const reopened=x.open('');
  assert.equal(reopened.stage,'dispatching');
  await assert.rejects(reopened.control('continueHeld',approval,x.send,x.prepare));
  assert.equal(x.starts(),0);
});
test('invalid source data, conflicting seed and unreadable disk fail closed for Tinder only',async t=>{
  const x=setup(t);
  for(const bad of ['{',JSON.stringify({...seed,count:1000}),JSON.stringify({...seed,version:2}),JSON.stringify({...seed,extra:'data'})]){
    const h=x.open(bad);assert.equal(h.project(view()).tinderHandoff.stage,'invalid');
    await assert.rejects(h.control('start',{},async()=>assert.fail()));
  }
  x.open();
  const conflict=x.open(JSON.stringify({...seed,runId:next}));
  assert.equal(conflict.project(view()).tinderHandoff.stage,'invalid');
  assert.equal(x.open().project(view()).tinderHandoff.stage,'held');
  fs.writeFileSync(x.file,'corrupt');
  assert.equal(x.open('').project(view()).tinderHandoff.stage,'invalid');
});
test('recovery requires affirmative source-bound input and actual eligible renderer status',async t=>{
  const x=setup(t),h=x.open();
  for(const changes of [{acceptPossibleRepeat:false},{sourceRunId:next},{sourceCount:249},{remaining:1000}]){
    await assert.rejects(h.control('continueHeld',{...approval,...changes},x.send,x.prepare));
  }
  await assert.rejects(h.control('start',{budgetGuard:{allowPossibleRepeat:true}},x.send,x.prepare));
  x.ready(false);await assert.rejects(h.control('continueHeld',approval,x.send,x.prepare));
  assert.equal(x.starts(),0);assert.equal(h.project(view()).tinderHandoff.stage,'held');
  x.ready(true);x.set(view('running',0,next));await assert.rejects(h.control('continueHeld',approval,x.send,x.prepare));
  assert.equal(x.starts(),0);
});
test('one durable dispatch binds only its acknowledged renderer and projects cumulative counts',async t=>{
  const x=setup(t),h=x.open();
  let beforeStart;
  const send=async(action,data)=>{
    if(action==='start'){
      beforeStart=x.open('').project(view());
      assert.deepEqual(data,{budgetGuard:{previousStatus:'idle',previousRunId:null,previousCount:0,maxSwipes:750,allowPossibleRepeat:true}});
    }
    return x.send(action,data);
  };
  const result=await h.control('continueHeld',approval,send,x.prepare);
  assert.equal(beforeStart.tinderHandoff.stage,'dispatching');assert.equal(beforeStart.tinderHandoff.minimumOnly,true);
  assert.equal(result.tinderHandoff.rendererSession.runId,next);assert.equal(result.session.runId,seed.runId);
  assert.equal(result.session.count,250);assert.equal(result.session.limit,1000);
  assert.equal(h.project(view('running',4,next)).session.count,254);
  const cold=x.open('').project(view());assert.equal(cold.session.count,254);assert.equal(cold.tinderHandoff.minimumOnly,true);
  assert.equal(h.project(view('running',99,'c'.repeat(32))).session.count,254);
  assert.equal(h.project(view('running',2,next)).session.count,254);
  await assert.rejects(h.control('continueHeld',approval,x.send,x.prepare));assert.equal(x.starts(),1);
  assert.equal(h.project(view('complete',750,next)).session.count,1000);
  const finished=x.open('').project(view());assert.equal(finished.session.status,'complete');
  assert.equal(finished.session.completionReason,'limit');assert.equal(finished.tinderHandoff.minimumOnly,false);
});
test('lost acknowledgement is never inferred from lookalike events or retried after restart',async t=>{
  const x=setup(t),h=x.open(),other=x.open();
  const send=async(a,d)=>{
    if(a==='start'){const raw=await x.send(a,d);assert.equal(h.project(raw).tinderHandoff.stage,'dispatching');throw Error('timeout')}
    return x.send(a,d);
  };
  await assert.rejects(h.control('continueHeld',approval,send,x.prepare));
  for(const reader of [h,other,x.open('')]){
    await assert.rejects(reader.control('continueHeld',approval,x.send,x.prepare));
  }
  assert.equal(x.open('').project(view('running',5,next)).tinderHandoff.minimumOnly,true);
  assert.equal(x.starts(),1);
});
for(const descriptorFixture of process.platform==='win32'?[true]:[false,true])test('two overlapping hosts spend one shared reservation with '+(descriptorFixture?'fixture':'native')+' directory flush',async t=>{
  const x=setup(t,descriptorFixture),first=x.open(),second=x.open(),gates=[];
  let prepared,release;
  const bothPrepared=new Promise(r=>{prepared=r});
  const blocked=new Promise(r=>{release=r});
  let dispatches=0;
  const send=async(action,data)=>{
    if(action==='context'&&data?.budgetGuard){
      gates.push(true);if(gates.length===2)prepared();await blocked;
      return {...view(),capabilities:{budgetGuard:1},guardedStartReady:true};
    }
    if(action==='start')dispatches++;
    return x.send(action,data);
  };
  const calls=[first,second].map(host=>host.control('continueHeld',approval,send,x.prepare));
  await bothPrepared;release();
  const results=await Promise.allSettled(calls);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(dispatches,1);
});
test('a Pause while preparing cancels the pending request without issuing any Start',async t=>{
  const x=setup(t),h=x.open();
  let arrived,release;
  const preparing=new Promise(r=>{arrived=r});
  const budget=new Promise(r=>{release=r});
  const call=h.control('continueHeld',approval,x.send,async()=>{arrived();await budget});
  await preparing;await assert.rejects(h.control('pause',{},x.send));
  release();await assert.rejects(call);
  assert.equal(x.starts(),0);assert.equal(h.project(view()).tinderHandoff.stage,'held');
});
test('an acknowledged paused successor resumes only its same renderer run, and deliberate Stop preserves totals',async t=>{
  const x=setup(t),h=x.open();await h.control('continueHeld',approval,x.send,x.prepare);
  x.set(view('running',3,next));const paused=await h.control('pause',{},x.send);
  assert.equal(paused.session.status,'paused');assert.equal(paused.session.count,253);
  await h.control('start',{},async(a,d)=>{
    if(a==='start')assert.deepEqual(d,{resumeRunId:next,expectedCount:3});
    return x.send(a,d);
  });
  const stopped=await h.control('stop',{},x.send);
  assert.equal(stopped.tinderHandoff.stage,'stopped');assert.equal(stopped.session.count,253);
  await assert.rejects(x.open('').control('start',{},x.send));
});
test('only a deliberate confirmed terminal archive releases the workspace for a new run',async t=>{
  for(const completed of [true,false]){
    const x=setup(t),h=x.open(),initialArchive={sourceRunId:seed.runId,finalCount:250};
    await assert.rejects(h.control('archiveHeld',initialArchive,x.send));
    await h.control('continueHeld',approval,x.send,x.prepare);
    await assert.rejects(h.control('archiveHeld',initialArchive,x.send));
    const n=completed?750:4,total=250+n;
    x.set(view('running',n,next));
    if(completed)h.project(view('complete',n,next));else await h.control('stop',{},x.send);
    await assert.rejects(h.control('archiveHeld',{sourceRunId:next,finalCount:total},x.send));
    await assert.rejects(h.control('archiveHeld',{sourceRunId:seed.runId,finalCount:total-1},x.send));
    await h.control('archiveHeld',{sourceRunId:seed.runId,finalCount:total},x.send);
    for(const restarted of [h,x.open(),x.open('')]){
      const fresh=view('running',1,'c'.repeat(32),21);
      const projected=await restarted.control('start',{},async()=>fresh);
      assert.deepEqual(projected.session,fresh.session);assert.equal(projected.tinderHandoff,undefined);
      assert.deepEqual(projected.tinderHandoffArchived,{source:seed,count:total,status:completed?'complete':'stopped'});
      await assert.rejects(restarted.control('continueHeld',approval,x.send,x.prepare));
    }
  }
});
test('after a receipt write fails, the owner may still stop the active renderer without releasing the hold',async t=>{
  const x=setup(t),h=x.open();await h.control('continueHeld',approval,x.send,x.prepare);
  fs.unlinkSync(x.file);fs.mkdirSync(x.file);x.set(view('running',4,next));
  assert.equal(h.project(view('running',4,next)).tinderHandoff.stage,'invalid');
  const result=await h.control('stop',{},x.send);
  assert.equal(result.tinderHandoff.stage,'invalid');assert.equal(result.tinderHandoff.rendererSession.status,'idle');
  await assert.rejects(h.control('start',{},x.send));
});
