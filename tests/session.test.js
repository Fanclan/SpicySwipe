const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
const Session=fs.existsSync('shared/session.js')?require('../shared/session'):null;
const tick=()=>new Promise(r=>setImmediate(r));
test('stop during delay prevents any delayed swipe',async()=>{
 assert.equal(typeof Session,'function');let release,clicks=0;
 const s=new Session({wait:()=>new Promise(r=>release=r),act:async()=>{clicks++},changed:()=>{}});
 s.start({maxSwipes:3,delaySeconds:3});s.stop();release();await tick();assert.equal(clicks,0);assert.equal(s.snapshot().status,'idle');
});
test('session respects limit and preserves progress when paused and resumed',async()=>{
 assert.equal(typeof Session,'function');let waits=[],clicks=0;
 const s=new Session({wait:()=>new Promise(r=>waits.push(r)),act:async()=>{clicks++;return 'like'},changed:()=>{}});
 s.start({maxSwipes:2,delaySeconds:3});waits.shift()();await tick();assert.equal(clicks,1);
 s.pause();waits.shift()();await tick();assert.equal(clicks,1);assert.equal(s.snapshot().count,1);
 s.start();waits.shift()();await tick();assert.equal(clicks,2);assert.equal(s.snapshot().status,'complete');
});
test('failed page action stops a session without counting a swipe',async()=>{
 assert.equal(typeof Session,'function');const s=new Session({wait:async()=>{},act:async()=>{throw new Error('No card')},changed:()=>{}});
 s.start({maxSwipes:2,delaySeconds:3});await tick();assert.equal(s.snapshot().count,0);assert.equal(s.snapshot().status,'error');assert.equal(s.snapshot().error,'No card');
});
test('pause after a committed click preserves count and never exceeds session limit',async()=>{
 let finish,clicks=0;const waits=[];
 const s=new Session({wait:()=>new Promise(r=>waits.push(r)),act:async(config,valid,commit)=>{clicks++;if(commit)commit();await new Promise(r=>finish=r)},changed:()=>{}});
 s.start({maxSwipes:1,delaySeconds:3});waits.shift()();await tick();s.pause();finish();await tick();
 assert.equal(s.snapshot().count,1);assert.equal(clicks,1);
 if(s.snapshot().status==='paused'){s.start();if(waits.length)waits.shift()();await tick()}
 assert.equal(clicks,1);
});
test('random delays stay within the configured range and breaks precede the next profile',async()=>{
 let now=1000;const waits=[],draws=[0,1,.5];let clicks=0;
 const s=new Session({now:()=>now,random:()=>draws.shift()??0,wait:async ms=>{waits.push(ms);now+=ms},act:async()=>{clicks++}});
 s.start({maxSwipes:2,sessionMinutes:10,randomizeTiming:true,minDelaySeconds:3,maxDelaySeconds:9,breaksEnabled:true,breakEvery:1,breakMinSeconds:10,breakMaxSeconds:20});await tick();
 assert.deepEqual(waits,[3000,20000,6000]);assert.equal(clicks,2);assert.equal(s.snapshot().completionReason,'limit');
});
test('a suspended timer beyond the deadline cannot issue a swipe',async()=>{
 let now=0,release,clicks=0;const s=new Session({now:()=>now,wait:()=>new Promise(r=>release=r),act:async()=>clicks++});
 s.start({maxSwipes:500,sessionMinutes:1,delaySeconds:5});now=65000;release();await tick();assert.equal(clicks,0);assert.equal(s.snapshot().status,'complete');assert.equal(s.snapshot().completionReason,'time');
});
test('time limit cancels an in-progress photo dwell without counting a swipe',async()=>{
 let now=0,release,clicks=0;const s=new Session({now:()=>now,wait:ms=>{if(ms===3000){now+=ms;return Promise.resolve()}return new Promise(r=>release=r)},act:async(config,valid,commit,sleep)=>{if(await sleep(10000,'photos')){clicks++;commit()}}});
 s.start({maxSwipes:5,delaySeconds:3,sessionMinutes:1});await tick();assert.equal(typeof release,'function');now=61000;release();await tick();assert.equal(clicks,0);assert.equal(s.snapshot().count,0);assert.equal(s.snapshot().status,'complete');
});
test('paused sessions retain their deadline and cannot resume after it',async()=>{
 let now=0;const pending=[];const s=new Session({now:()=>now,wait:()=>new Promise(r=>pending.push(r)),act:async()=>assert.fail('expired')});s.start({sessionMinutes:1,maxSwipes:5});s.pause();now=61000;s.start();assert.equal(s.snapshot().status,'complete');assert.equal(s.snapshot().endsAt,60000);pending.forEach(r=>r());await tick();
});
test('stopping during review invalidates every later action and does not count a swipe',async()=>{
 let reviewing,release,clicks=0;const s=new Session({wait:async()=>{},act:async(config,valid,commit)=>{reviewing=true;await new Promise(r=>release=r);if(valid()){clicks++;commit()}}});s.start({maxSwipes:5});await tick();assert.equal(reviewing,true);s.stop();release();await tick();assert.equal(clicks,0);assert.equal(s.snapshot().count,0);
});
test('pause during a break preserves the remaining break instead of skipping or resampling it',async()=>{
 let now=0;const waits=[];const s=new Session({now:()=>now,random:()=>0,wait:ms=>new Promise(resolve=>waits.push({ms,resolve})),act:async()=>{}});s.start({maxSwipes:2,delaySeconds:3,sessionMinutes:5,breaksEnabled:true,breakEvery:1,breakMinSeconds:20,breakMaxSeconds:20});
 now=3000;waits.shift().resolve();await tick();assert.equal(s.snapshot().phase,'break');const original=waits.shift();now=8000;s.pause();s.start();assert.equal(waits[0].ms,15000);original.resolve();await tick();assert.equal(s.snapshot().count,1);s.stop();waits.shift().resolve();await tick();
});

test('an uncertain last action retains its count but reports the transition error',async()=>{const s=new Session({wait:async()=>{},act:async(config,valid,commit)=>{commit();throw Error('Transition not confirmed')}});s.start({maxSwipes:1});await tick();assert.equal(s.count,1);assert.equal(s.status,'error');assert.match(s.error,/Transition/);});

test('multi-gesture commit counts every issued input once despite duplicate calls',async()=>{const s=new Session({wait:async()=>{},act:async(c,valid,commit)=>{commit(2);commit(2)}});s.start({maxSwipes:2});await tick();assert.equal(s.count,2);assert.equal(s.status,'complete');assert.equal(s.completionReason,'limit')});
