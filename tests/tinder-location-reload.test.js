const {test} = require('node:test');
const assert = require('node:assert/strict');
const LocationReload = require('../desktop/tinder-location-reload.cjs');
const url = 'https://tinder.com/app/recs';
const saved = {session:{status:'running'}};
const turn = () => new Promise(resolve => setImmediate(resolve));

function fixture(capture=async()=>saved) {
 const restored=[];
 const wc={url,reloads:0,getURL(){return this.url;},isDestroyed(){return false;},reload(){this.reloads++;}};
 const reload=new LocationReload({capture,restore:value=>restored.push(value),timeoutMs:15});
 return {wc,reload,restored};
}

test('location handoff restores once on the exact requested reload',async()=>{
 const {wc,reload,restored}=fixture();
 reload.reload(wc);await turn();assert.equal(wc.reloads,1);
 reload.ready(wc);assert.equal(restored.length,0);
 reload.navigating(wc,url,false);reload.ready(wc);assert.equal(restored.length,0);
 reload.committed(wc,url,200);reload.ready(wc);reload.ready(wc);
 assert.deepEqual(restored,[saved]);
});

test('unrelated navigation, failure, and an explicit stop discard the handoff',async()=>{
 for(const cancel of [
  (reload,wc)=>reload.navigating(wc,'https://tinder.com/app/messages',false),
  (reload,wc)=>reload.navigating(wc,url,true),
  reload=>reload.discard(),
  reload=>reload.userAction('stop')
 ]){
  const {wc,reload,restored}=fixture();
  reload.reload(wc);await turn();reload.navigating(wc,url,false);reload.committed(wc,url,200);cancel(reload,wc);reload.ready(wc);
  assert.equal(wc.reloads,1);assert.equal(restored.length,0);
 }
});

test('a manual pause while capturing preserves progress without an automatic resume',async()=>{
 let resolve;const {wc,reload,restored}=fixture(()=>new Promise(r=>resolve=r));
 reload.reload(wc);reload.userAction('pause');resolve(saved);await turn();
 reload.navigating(wc,url,false);reload.committed(wc,url,200);reload.ready(wc);
 assert.equal(wc.reloads,1);assert.equal(restored[0].session.status,'paused');
});

test('the privacy reload proceeds promptly even if the renderer is unavailable',async()=>{
 let finish;const {wc,reload,restored}=fixture(()=>new Promise(resolve=>finish=resolve));
 reload.reload(wc);reload.reload(wc);await new Promise(resolve=>setTimeout(resolve,35));
 finish(saved);await turn();reload.navigating(wc,url,false);reload.committed(wc,url,200);reload.ready(wc);
 assert.equal(wc.reloads,1);assert.deepEqual(restored,[]);
});

test('ending a lease while the sharing page is loading reloads again and carries the original checkpoint once',async()=>{
 const {wc,reload,restored}=fixture();
 reload.reload(wc);await turn();reload.navigating(wc,url,false);reload.committed(wc,url,200);
 reload.reload(wc);assert.equal(wc.reloads,2);reload.ready(wc);
 reload.navigating(wc,url,false);reload.committed(wc,url,200);reload.ready(wc);
 assert.deepEqual(restored,[saved]);
});

test('a failed destination or manual start before restore never opens a fresh action budget',async()=>{
 const {wc,reload,restored}=fixture();
 reload.reload(wc);assert.throws(()=>reload.userAction('start'),/reload/i);
 await turn();reload.navigating(wc,url,false);reload.committed(wc,url,403);reload.ready(wc);
 assert.deepEqual(restored,[]);
});
