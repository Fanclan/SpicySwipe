const {test} = require('node:test');
const assert = require('node:assert/strict');
const LocationReload = require('../desktop/tinder-location-reload.cjs');
const url = 'https://tinder.com/app/recs';
const saved = {session:{status:'running'}};
const turn = () => new Promise(resolve => setImmediate(resolve));

function fixture(capture=async()=>saved, options={}) {
 const restored=[];
 const wc={url,reloads:0,getURL(){return this.url;},isDestroyed(){return false;},reload(){this.reloads++;}};
 const reload=new LocationReload({capture,restore:value=>{restored.push(value);return value.session;},timeoutMs:15,...options});
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

test('empty Discover reload requires a live checkpoint and preserves the same run',async()=>{
 for(const result of [null,saved]){
  const {wc,reload,restored}=fixture();
  reload.reload(wc,async()=>result);await turn();
  assert.equal(wc.reloads,result?1:0);
  if(result){reload.navigating(wc,url,false);reload.committed(wc,url,200);reload.ready(wc);assert.deepEqual(restored,[saved]);}
 }
});

test('a stale empty check cannot reload another page, and a location revocation takes priority',async()=>{
 let finish;const {wc,reload,restored}=fixture();
 reload.reload(wc,()=>new Promise(r=>finish=r));wc.url='https://tinder.com/app/messages';
 reload.navigating(wc,wc.url,true);finish(saved);await turn();assert.equal(wc.reloads,0);
 reload.reload(wc,async()=>saved);await turn();assert.equal(wc.reloads,0);
 wc.url=url;reload.reload(wc,()=>new Promise(()=>{}));reload.reload(wc);await turn();assert.equal(wc.reloads,1);
 reload.navigating(wc,url,false);reload.committed(wc,url,200);reload.ready(wc);assert.deepEqual(restored,[saved]);
});

const countOnly={session:{status:'running',runId:'count-only',count:478,limit:1000,endsAt:null},lastCard:'verified-card',nextFeedRefreshAt:500000};
async function loadingEmpty(f){
 f.reload.reload(f.wc,async()=>countOnly,'source-document');await turn();
 f.reload.navigating(f.wc,url,false);
}

test('a slow exact Discover reload retains its count-only session through commit and preload initialization',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const f=fixture();await loadingEmpty(f);
 t.mock.timers.tick(40000);f.reload.committed(f.wc,url,200);t.mock.timers.tick(40000);
 f.reload.ready(f.wc,'new-document');await turn();
 assert.deepEqual(f.restored,[countOnly]);assert.equal(f.wc.reloads,1);
});

test('a lost empty-reload acknowledgement retries the same checkpoint on the same document and respects Pause',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const calls=[];let reject;
 const f=fixture(undefined,{restore:(saved,documentId)=>{
   calls.push([structuredClone(saved),documentId]);
   if(calls.length===1)return new Promise((_,no)=>{reject=no});
   return saved.session;
 }});
 await loadingEmpty(f);f.reload.committed(f.wc,url,200);f.reload.ready(f.wc,'new-document');
 f.reload.userAction('pause');reject(Error('lost reply'));await turn();
 t.mock.timers.tick(30000);await turn();
 assert.deepEqual(calls,[[countOnly,'new-document'],[{...countOnly,session:{...countOnly.session,status:'paused'}},'new-document']]);
 assert.equal(f.wc.reloads,1);assert.equal(f.reload.pending,null);
});

test('an uncertain handoff cannot reapply a checkpoint after Stop, another navigation, or a replacement document',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 for(const cancel of [
   f=>f.reload.userAction('stop'),
   f=>f.reload.navigating(f.wc,url,false),
   f=>f.reload.ready(f.wc,'different-document'),
 ]){
  let reject,attempts=0;
  const f=fixture(undefined,{restore:()=>{attempts++;return new Promise((_,no)=>{reject=no});}});
  await loadingEmpty(f);f.reload.committed(f.wc,url,200);f.reload.ready(f.wc,'new-document');
  cancel(f);reject(Error('lost reply'));await turn();t.mock.timers.tick(30000);await turn();
  assert.equal(attempts,1);assert.equal(f.reload.pending,null);
 }
});

test('a new location handoff captures current progress when a previous empty restore has an uncertain acknowledgement',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const late={...countOnly,session:{...countOnly.session,count:479}};
 const restored=[];let failed;
 const f=fixture(async()=>late,{restore:(value,doc)=>{
   restored.push([value,doc]);
   if(restored.length===1)return new Promise((_,no)=>{failed=no});
   return value.session;
 }});
 await loadingEmpty(f);f.reload.committed(f.wc,url,200);f.reload.ready(f.wc,'first-document');
 failed(Error('lost acknowledgement'));await turn();
 f.reload.reload(f.wc);await turn();f.reload.navigating(f.wc,url,false);
 f.reload.committed(f.wc,url,200);f.reload.ready(f.wc,'location-document');
 t.mock.timers.tick(30000);await turn();
 assert.deepEqual(restored,[[countOnly,'first-document'],[late,'location-document']]);
});

test('only the failed main navigation for a scheduled Discover reload clears its pending handoff',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const f=fixture();await loadingEmpty(f);
 f.reload.failed(f.wc,'https://tinder.com/app/messages');
 assert.throws(()=>f.reload.userAction('start'),/reload/i);
 f.reload.failed(f.wc,url);
 assert.doesNotThrow(()=>f.reload.userAction('start'));
 f.reload.committed(f.wc,url,200);f.reload.ready(f.wc,'other-document');
 assert.deepEqual(f.restored,[]);
});

test('a delayed ready from the source document cannot consume the replacement handoff',async()=>{
 const f=fixture();await loadingEmpty(f);f.reload.committed(f.wc,url,200);
 f.reload.ready(f.wc,'source-document');assert.deepEqual(f.restored,[]);
 f.reload.ready(f.wc,'replacement');await turn();
 assert.deepEqual(f.restored,[countOnly]);
});
