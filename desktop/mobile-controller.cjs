'use strict';
const {createHash,randomUUID}=require('node:crypto');
const Session=require('../shared/session.js');
const Config=require('./mobile-config.cjs');
const {sameClippedPhoto,sameScrollPhoto,overlapsPhotoPatch}=require('./mobile-vision.cjs');
// Keep comparison samples out of renderer snapshots, event streams and saved sessions.
const photoPatches = new WeakMap();
const scrollPhotos = new WeakMap();
const dismissibleBumbleScreens=new Set(['chatReminder','promoOffer','feedbackPrompt']);
const transientRead=new Set(['ANDROID_COMMAND_FAILED','ANDROID_COMMAND_TIMEOUT','ANDROID_DEVICE_UNAVAILABLE','ANDROID_FOREGROUND_UNAVAILABLE','COMMENT_FIELD_UNREADABLE','OCR_TIMEOUT','MOBILE_SCREEN_UNAVAILABLE','MOBILE_SCREEN_CHANGED','MOBILE_REVIEW_INTERRUPTED']);
const transientError=(message,code='MOBILE_REVIEW_INTERRUPTED')=>Object.assign(Error(message),{code});
const delay=(ms,signal)=>new Promise(resolve=>{const done=()=>{clearTimeout(timer);signal?.removeEventListener('abort',done);resolve()};const timer=setTimeout(done,ms);signal?.addEventListener('abort',done,{once:true});if(signal?.aborted)done()});
const hashDistance=(a,b)=>{if(!a||!b||a.length!==b.length)return Infinity;let n=0;for(let i=0;i<a.length;i++){let x=parseInt(a[i],16)^parseInt(b[i],16);while(x){n+=x&1;x>>=1}}return n};
const nameDigest=name=>createHash('sha256').update(name).digest('hex');
const photoFingerprint=value=>typeof value==='string'&&/^[a-f0-9]{16}$/.test(value);
const matchesFingerprint=(p,visual,tolerance=6)=>photoFingerprint(visual)&&[p.visual,p.visualSquare].some(v=>photoFingerprint(v)&&hashDistance(v,visual)<=tolerance);
const visibleFingerprint=(s,visual)=>s.photos?.some(p=>matchesFingerprint(p,visual));
const alternativeUnavailable=()=>transientError('The reviewed photo could not be verified. Waiting for another profile or a manual review.','MOBILE_ALTERNATE_UNAVAILABLE');
const promptMoveLimit=8;
function wheelLandmarks(frame){
 if(!frame?.ownerKey||!frame.chromeKey||!Array.isArray(frame.landmarks))return null;
 const points=new Map();
 for(const mark of frame.landmarks){
  if(!mark?.key||points.has(mark.key)||!['x','y','width','height'].every(k=>Number.isInteger(mark[k]))||mark.width<=0||mark.height<=0)return null;
  points.set(mark.key,mark);
 }
 return points.size>=2?points:null;
}
function wheelAdvanced(before,after){
 if(!before||!after||before.ownerKey!==after.ownerKey||before.chromeKey!==after.chromeKey)return false;
 const a=wheelLandmarks(before),b=wheelLandmarks(after),offsets=[],rows=new Set();
 if(!a||!b)return false;
 for(const [key,start] of a){
  const end=b.get(key);if(!end)continue;
  if(start.x!==end.x||start.width!==end.width||start.height!==end.height)return false;
  offsets.push(start.y-end.y);rows.add(start.y);
 }
 return rows.size>=2&&Math.min(...offsets)>=4&&Math.max(...offsets)-Math.min(...offsets)<=2;
}
// Pixel changes alone cannot establish a new same-name Bumble profile.
const distinctBumbleProfile=(before,after)=>after.kind==='profile'&&Boolean(after.identity)&&after.identity!==before.identity&&after.name===before.name&&Boolean(before.profileDiscriminator)&&Boolean(after.profileDiscriminator)&&after.profileDiscriminator!==before.profileDiscriminator&&after.controls?.like?.direction==='right';
class MobileController{
 constructor({android,service,platform,changed=()=>{},random=Math.random,wait=delay,readScreen,photoHashes,readEvidence,checkpointStore,recoverDevice,isManagedPhone=()=>false}){
  if(!['hinge','bumble'].includes(platform))throw Error('Unknown mobile platform.');
  Object.assign(this,{android,service,platform,changed,random,wait,photoHashes,readEvidence,checkpointStore,recoverDevice,isManagedPhone});this.readFailures=0;this.nextFeedRefreshAt=0;this.nextFeedRetryAt=0;this.nextHomeLaunchAt=0;this.loadingFeedRelaunched=false;this.binding=null;this.reservedCount=0;this.recoveryAttempts=0;this.readScreen=readScreen||require('./mobile-screen.cjs').readScreen;
  this.config=Config.normalize();this.screen=null;this.draft=null;this.selectedPhoto=null;this.selectedPrompt=null;this.queue=Promise.resolve();this.epoch=0;this.busy=false;this.loaded=false;this.loading=null;this.reviewContext=null;this.visible=true;this.lastAction=null;this.openerAttempts=new Set();this.openerArmed=false;this.watchPending=false;this.abort=new AbortController();
  this.session=new Session({random,wait,act:(c,valid,commit,sleep)=>this.enqueue(token=>this.sessionStep(c,valid,commit,sleep,token),true),changed:()=>this.notify()});
 }
 snapshot(){const offer=this.currentSkipOffer();return {pendingSkipOffer:offer?{token:offer.token,name:offer.name,expiresAt:offer.expiresAt}:null,platform:this.platform,session:this.session.snapshot(),screen:this.screen,config:this.config,draft:this.draft,selectedPhoto:this.selectedPhoto,selectedPrompt:this.selectedPrompt||null,busy:this.busy,openerArmed:this.openerArmed,reason:this.reason||''}}
 checkpoint(){const session=this.session.checkpoint();session.count=Math.max(session.count,this.reservedCount);return {version:1,platform:this.platform,session,config:this.config,binding:this.binding,pendingAction:this.lastAction,...(this.rejectedPhoto?{rejectedPhoto:this.rejectedPhoto}:{}),recoveryAttempts:this.recoveryAttempts,nextFeedRefreshAt:this.nextFeedRefreshAt||0,nextFeedRetryAt:this.nextFeedRetryAt||0,nextHomeLaunchAt:this.nextHomeLaunchAt,loadingFeedRelaunched:this.loadingFeedRelaunched}}
 persist(){if(this.loaded&&this.checkpointStore){try{this.checkpointStore.write(this.checkpoint())}catch(error){this.storageError=error.message;throw Object.assign(error,{code:'MOBILE_STORAGE_FAILURE'})}}}
 notify(){
  try{this.persist()}catch(error){this.storageError=error.message;this.reason=error.message;if(this.session.status==='running'){this.session.epoch++;this.session.status='error';this.session.phase='error';this.session.error=error.message;this.session.controller?.abort()}}
  this.changed(this.snapshot());
 }
 reserveAction(action,increment=1){
  this.rejectedPhoto=null;this.skipOffer=null;this.lastAction=action;
  if(this.session.status==='running')this.reservedCount=Math.max(this.session.count,this.reservedCount)+increment;
  this.persist();
 }
 async verifyBinding(t){
  const binding=this.android.deviceIdentity?await this.android.deviceIdentity():{serial:t.serial};this.assert(t);
  if(this.binding&&(this.binding.avd?this.binding.avd!==binding.avd:this.binding.serial!==binding.serial))throw transientError('Saved session belongs to another device. Reconnect its original device before resuming.','MOBILE_DEVICE_CHANGED');
  this.binding=binding;this.persist();
 }
 restoreCheckpoint(saved){
  if(!saved)return;
  if(saved.nextHomeLaunchAt!==undefined&&(!Number.isFinite(saved.nextHomeLaunchAt)||saved.nextHomeLaunchAt<0))throw Error('Mobile checkpoint is invalid. Repair it before starting.');
  if((saved.nextFeedRetryAt!==undefined&&(!Number.isFinite(saved.nextFeedRetryAt)||saved.nextFeedRetryAt<0))||(saved.nextFeedRefreshAt!==undefined&&(!Number.isFinite(saved.nextFeedRefreshAt)||saved.nextFeedRefreshAt<0))||saved.version!==1||saved.platform!==this.platform||!saved.session||!saved.config||!(saved.binding===null||(typeof saved.binding?.serial==='string'&&(!saved.binding.avd||typeof saved.binding.avd==='string')))||!Number.isInteger(saved.recoveryAttempts)||saved.recoveryAttempts<0||saved.recoveryAttempts>1||!(saved.pendingAction===null||(typeof saved.pendingAction?.identity==='string'&&typeof saved.pendingAction?.name==='string')))throw Error('Mobile checkpoint is invalid. Repair it before starting.');
  if(saved.loadingFeedRelaunched!==undefined&&typeof saved.loadingFeedRelaunched!=='boolean')throw Error('Mobile checkpoint is invalid. Repair it before starting.');
  const hint=saved.rejectedPhoto;
  if(hint&&(!/^[0-9a-f]{64}$/.test(hint.nameDigest)||!photoFingerprint(hint.visual)||!(hint.entryVisual===null||photoFingerprint(hint.entryVisual))||
    ![hint.sourceIdentity,hint.entryIdentity,hint.serial].every(v=>typeof v==='string'&&v.length>0)||
    !(hint.heldIdentity===null||typeof hint.heldIdentity==='string')||!(hint.heldRevision===null||typeof hint.heldRevision==='string')||!(hint.avd===null||typeof hint.avd==='string')||
    (hint.promptScan!==undefined&&!['moving','spent'].includes(hint.promptScan))||
    (hint.promptMovesRemaining!==undefined&&(!hint.promptScan||!Number.isInteger(hint.promptMovesRemaining)||hint.promptMovesRemaining<0||hint.promptMovesRemaining>promptMoveLimit))||
    typeof hint.attempted!=='boolean'||!Number.isFinite(hint.endsAt)||!Number.isInteger(hint.count)||hint.count<0))throw Error('Invalid rejected photo checkpoint.');
  this.rejectedPhoto=hint||null;
  this.session.restore(saved.session);this.config=Config.normalize(saved.config);this.binding=saved.binding;this.lastAction=saved.pendingAction;this.reservedCount=this.session.count;this.recoveryAttempts=saved.recoveryAttempts;this.nextFeedRefreshAt=saved.nextFeedRefreshAt||0;this.nextFeedRetryAt=saved.nextFeedRetryAt||0;
  this.loadingFeedRelaunched=saved.loadingFeedRelaunched??false;
  this.nextHomeLaunchAt=saved.nextHomeLaunchAt??0;
  this.reason=this.lastAction?'An earlier action is uncertain. It will not be repeated.':this.session.status==='paused'?'Saved progress restored. Resume to revalidate the device and continue within the original deadline.':'';
 }
 token(){return {epoch:this.epoch,serial:this.android.serial,inputEpoch:this.android.inputEpoch,signal:this.abort.signal}}
 assert(t,valid=()=>true){if(t.epoch!==this.epoch||t.serial!==this.android.serial||t.inputEpoch!==this.android.inputEpoch||!t.serial||t.signal.aborted||!valid())throw Error('Mobile action canceled: device, screen ownership, or session changed.');}
 invalidate(reason='Mobile context changed',{stop=false}={}){this.openerArmed=false;this.epoch++;this.abort.abort();this.abort=new AbortController();this.android.cancelInput();stop?this.session.stop():this.session.pause();this.draft=null;this.selectedPhoto=null;this.selectedPrompt=null;this.reviewContext=null;this.screen=null;this.reason=reason;this.notify()}
 drain(){return this.queue.catch(()=>{})}
 enqueue(fn,session=false){const t=this.token();const job=this.queue.then(async()=>{this.assert(t);this.busy=true;this.notify();let result;try{result=await fn(t)}finally{this.busy=false;this.notify()}return session?result:this.snapshot()});this.queue=job.catch(()=>{});return job}
 async refreshEmpty(s,t,valid){
  this.assert(t,valid);if(s.kind!=='empty')return s;
  return this.refreshKnownFeed(s,t,valid);
 }
 async refreshKnownFeed(s,t,valid){
  this.assert(t,valid);
  const loading=s.kind==='feedLoading'&&this.platform==='hinge'&&this.session.status==='running'&&this.isManagedPhone(this.binding)&&!this.draft;
  if(!loading&&s.kind!=='empty'&&!this.resumableLike(s))throw transientError('Cannot reopen the feed from this screen.');
  if(!loading&&this.lastAction)throw Error('An uncertain pending action must be resolved before refreshing the feed.');
  if(this.session.now()<(this.nextFeedRefreshAt||0))return s;
  await this.verifyBinding(t);await this.fresh(s,t,valid);this.assert(t,valid);
  // Reserve the cooldown durably before relaunch, including failed or interrupted attempts.
  this.nextFeedRefreshAt=this.session.now()+300000;this.persist();
  this.reviewContext=null;this.selectedPhoto=null;this.draft=null;this.screen=null;
  if(this.session.status==='running')this.session.phase='refreshing feed';this.notify();this.assert(t,valid);
  // A failed launcher lookup costs the cooldown only. Once force-stop can have run,
  // even a lost acknowledgement must not re-arm recovery on the same blank feed.
  const beforeStop=loading?async()=>{
   await this.fresh(s,t,valid);this.assert(t,valid);
   this.loadingFeedRelaunched=true;this.persist();
  }:undefined;
  await this.android.refreshFeed(this.platform,()=>{try{this.assert(t,valid);return true}catch{return false}},ms=>this.wait(ms,t.signal),beforeStop);
  this.assert(t,valid);
  for(let i=0;i<6;i++){
   await this.pauseFor(1000,t);this.assert(t,valid);s=await this.read(t);this.assert(t,valid);
   if(s.kind!=='blocked')return s;
  }
  return s;
 }
 async waitForDiscover(s,t,valid,sleep){
  const waiting={retryAfter:30000,phase:'waiting for Discover'};
  const owned=()=>this.session.status==='running'&&this.isManagedPhone(this.binding)&&!this.draft&&valid();
  if(!owned()||this.loadingFeedRelaunched||this.session.now()<this.nextFeedRefreshAt)return waiting;
  if(!await sleep(30000,waiting.phase))return waiting;
  this.assert(t,owned);
  const observed=await this.read(t);this.assert(t,owned);
  // The blank shell proves neither that the queue is empty nor that a Like succeeded.
  // A normal loading transition needs no relaunch. Leave any pending action for reconciliation.
  if(observed.kind===s.kind&&observed.screenKey===s.screenKey)await this.refreshKnownFeed(s,t,owned);
  return {retryAfter:1000,phase:this.lastAction?'verifying previous action':'checking next profile'};
 }
 async retryFeed(s,t,valid){
  this.assert(t,valid);
  if(this.platform!=='hinge'||s.kind!=='feedError'||!s.controls.retry)throw transientError('A verified feed retry control is required.');
  const remaining=(this.nextFeedRetryAt||0)-this.session.now();
  if(remaining>0)return {retryAfter:remaining,phase:'waiting to reconnect'};
  await this.verifyBinding(t);await this.fresh(s,t,valid);this.assert(t,valid);
  this.nextFeedRetryAt=this.session.now()+30000;this.persist();
  await this.tap(s,s.controls.retry,t,valid);await this.pauseFor(1000,t);this.assert(t,valid);
  const after=await this.read(t);this.assert(t,valid);
  this.reason=after.kind==='feedError'?'Hinge could not load profiles. Retrying automatically.':'';
  return {retryAfter:after.kind==='feedError'?30000:1000,phase:after.kind==='feedError'?'waiting to reconnect':'checking next profile'};
 }
 resumableLike(s){return this.platform==='hinge'&&this.config.mode==='like'&&this.config.swipe.likeRatio===1&&s.kind==='like'&&Boolean(s.identity)&&s.composerTextVerified===true&&!s.composerText?.trim()&&Boolean(s.controls.sendLike)}
 async recoverFromHome(t,valid){
  const waiting=this.lastAction?this.pendingWait():{retryAfter:30000,phase:'waiting for Hinge'};
  if(this.session.status!=='running'||this.session.now()<this.nextHomeLaunchAt)return waiting;
  const stillValid=()=>this.session.status==='running'&&this.isManagedPhone(this.binding)&&valid();
  try{
   await this.verifyBinding(t);this.assert(t,stillValid);
   const reopened=await this.android.reopenFromHome(this.platform,{
    foreground:this.observedForeground,
    valid:()=>{try{this.assert(t,stillValid);return true}catch{return false}},
    reserve:()=>{this.assert(t,stillValid);this.nextHomeLaunchAt=this.session.now()+300000;this.persist()}
   });
   this.assert(t,stillValid);
   if(reopened)return {retryAfter:2000,phase:this.lastAction?'verifying previous action':'checking next profile'};
  }catch(error){
   this.assert(t,stillValid);
   if(!transientRead.has(error.code))throw error;
   // Lost launcher acknowledgements are observed on the next session step.
   // Never escalate them to a feed force-stop or a device restart.
  }
  return waiting;
 }
 async sessionStep(c,valid,commit,sleep,t){
  // A manual Skip may have consumed the final slot while this worker was queued.
  if(!valid())return;
  try{
   let observed=await this.read(t);this.assert(t,valid);
   if(observed.kind==='blocked'&&this.platform==='hinge'&&this.observedForeground!=='co.hinge.app'
     &&c.allowBackground&&this.session.status==='running'&&this.isManagedPhone(this.binding)){
    return await this.recoverFromHome(t,valid);
   }
   if(this.platform==='hinge'&&observed.kind==='feedLoading')return await this.waitForDiscover(observed,t,valid,sleep);
   if(observed.kind==='feedError')return await this.retryFeed(observed,t,valid);
   if(this.lastAction){
    if(await this.reconcilePending(this.lastAction,t,valid)){this.reason='';this.readFailures=0;return {retryAfter:1000,phase:'checking next profile'}}
    const waiting=this.pendingWait();
    this.offerPendingSkip();
    return waiting;
   }
   if(observed.kind==='empty'){observed=await this.refreshEmpty(observed,t,valid);this.assert(t,valid);if(observed.kind==='empty'){this.readFailures=0;this.persist();return {retryAfter:300000,phase:'waiting for profiles'}}}
   // A previous step may have rejected this form because its profile changed.
   // Reopen Discover so every submitted Like is bound to a new verified review.
   if(this.resumableLike(observed)){
    const after=await this.refreshKnownFeed(observed,t,valid);this.assert(t,valid);
    return this.resumableLike(after)
     ? {retryAfter:Math.max(1000,this.nextFeedRefreshAt-this.session.now()),phase:'waiting to reopen Discover'}
     : {retryAfter:1000,phase:'checking next profile'};
   }
   const kind=this.random()<c.likeRatio?'like':'pass';
   const prepared=await this.review(t,sleep,observed,kind,valid);this.assert(t,valid);
   await this.act(kind,t,valid,commit,prepared);
   this.readFailures=0;this.reason='';
   if(this.screen?.kind==='empty')return {retryAfter:300000,phase:'waiting for profiles'};
  }catch(error){
   this.assert(t);if(!valid())throw error;
   if(['MOBILE_STORAGE_FAILURE','MOBILE_DEVICE_CHANGED'].includes(error.code)||this.storageError)throw error;
   if(this.lastAction)return this.pendingWait(error);
   if(error.code==='MOBILE_PHOTO_MISMATCH')return {retryAfter:1000,phase:'waiting to reopen Discover'};
   if(error.code==='MOBILE_ALTERNATE_UNAVAILABLE'){
    this.reason='No verified alternate Like target on the reviewed card. Waiting for the next profile.';
    return {retryAfter:30000,phase:'waiting for another profile'};
   }
   if(!transientRead.has(error.code))throw error;
   const failures=++this.readFailures,retryAfter=Math.min(60000,5000*2**Math.min(failures-1,4));
   this.reason='Recovering the device screen; no profile action is being retried.';
   if(failures<=2)return {retryAfter,phase:'recovering screen'};
   if(this.recoverDevice&&this.binding?.avd&&this.recoveryAttempts<1&&error.code.startsWith('ANDROID_')){
    this.recoveryAttempts++;this.persist();this.session.phase='recovering device';this.notify();
    const epoch=this.epoch,inputEpoch=this.android.inputEpoch,stillValid=()=>epoch===this.epoch&&!t.signal.aborted&&valid();
    try{
     const result=await this.recoverDevice({avd:this.binding.avd,platform:this.platform,valid:stillValid,wait:ms=>this.wait(ms,t.signal)});
     if(!stillValid()||inputEpoch!==this.android.inputEpoch)throw Error('Device recovery canceled.');
     if(result.restarted){if(result.serial)this.android.serial=result.serial;t.serial=this.android.serial;t.inputEpoch=this.android.inputEpoch;this.assert(t,valid);this.binding={...this.binding,serial:this.android.serial};this.screen=null;this.reviewContext=null;this.selectedPhoto=null;this.persist();return {retryAfter:1500,phase:'revalidating device'}}
    }catch(recoveryError){this.assert(t,valid);if(!transientRead.has(recoveryError.code))throw recoveryError;}
   }
   if(this.android.refreshFeed&&this.session.now()>=(this.nextFeedRefreshAt||0)){
    try{
     const current=await this.read(t);this.assert(t,valid);
     const safe=['profile','empty'].includes(current.kind)||(current.kind==='like'&&current.composerTextVerified===true&&!current.composerText?.trim()&&!this.draft);
     if(safe){await this.verifyBinding(t);await this.fresh(current,t,valid);this.assert(t,valid);this.nextFeedRefreshAt=this.session.now()+300000;this.persist();await this.android.refreshFeed(this.platform,()=>{try{this.assert(t,valid);return true}catch{return false}},ms=>this.wait(ms,t.signal));this.assert(t,valid);this.screen=null;this.selectedPhoto=null;this.reviewContext=null;}
    }catch(refreshError){this.assert(t,valid);if(!transientRead.has(refreshError.code))throw refreshError;}
   }
   return {retryAfter,phase:this.screen?.kind==='blocked'?'waiting for supported screen':'recovering screen'};
  }
 }
 pendingWait(error){
  this.session.count=Math.max(this.session.count,this.reservedCount);
  if(this.session.count>=this.session.config.maxSwipes)this.session.finish('limit');
  const operation=error?.diagnostics?.operation;
  if(error)this.skipOffer=null;
  this.reason='The previous action is still being verified. No duplicate Like will be sent.'+(operation?' Recovering '+operation+'.':'');
  this.persist();return {retryAfter:30000,phase:'verifying previous action'};
 }
 // A Like guard can survive a restart. Permission to Skip belongs only to one live observation.
 eligibleForSkip(){
  const {session,screen,binding,lastAction}=this,skip=screen?.controls?.skip;
  return this.platform==='hinge'&&this.observedForeground==='co.hinge.app'&&this.loaded&&Boolean(this.checkpointStore)&&!this.storageError&&
   session.status==='running'&&session.endsAt>session.now()&&session.count>0&&session.count===this.reservedCount&&session.count<session.config.maxSwipes&&
   !(session.config.breaksEnabled&&(session.breakUntil||session.count>=session.nextBreakAt))&&
   binding?.serial===this.android.serial&&Boolean(binding?.serial)&&!this.draft&&lastAction?.kind==='like'&&Boolean(lastAction.identity)&&!lastAction.offerKey&&
   lastAction.sessionEndsAt===session.endsAt&&screen?.kind==='profile'&&Boolean(screen.identity&&screen.screenKey&&screen.name)&&
   screen.name===lastAction.name&&!screen.composerText?.trim()&&!screen.controls?.composer&&!screen.controls?.sendLike&&
   Boolean(skip?.key&&skip.bounds)&&skip.enabled!==false&&skip.disabled!==true&&skip.label==='Skip '+screen.name;
 }
 currentSkipOffer(){
  const offer=this.skipOffer;
  if(offer&&(!this.eligibleForSkip()||offer.expiresAt<=this.session.now()||offer.guard!==this.lastAction||
    offer.count!==this.session.count||offer.sessionEpoch!==this.session.epoch||offer.epoch!==this.epoch||
    offer.serial!==this.android.serial||offer.inputEpoch!==this.android.inputEpoch||offer.avd!==this.binding?.avd||
    offer.identity!==this.screen.identity||offer.revision!==this.screen.screenKey||offer.skipKey!==this.screen.controls.skip.key)){
   this.skipOffer=null;
  }
  return this.skipOffer||null;
 }
 offerPendingSkip(){
  if(this.currentSkipOffer()||!this.eligibleForSkip())return;
  const {screen,session}=this;
  this.skipOffer={token:randomUUID(),expiresAt:Math.min(session.now()+120000,session.endsAt),name:screen.name,
   guard:this.lastAction,count:session.count,sessionEpoch:session.epoch,epoch:this.epoch,serial:this.android.serial,
   inputEpoch:this.android.inputEpoch,avd:this.binding.avd,identity:screen.identity,revision:screen.screenKey,skipKey:screen.controls.skip.key};
 }
 async confirmPendingSkip(token,t){
  const offer=this.currentSkipOffer();
  if(!offer||offer.token!==token)throw Error('This Skip confirmation expired. Review the current card again.');
  const stillOffered=()=>this.currentSkipOffer()===offer;
  try{
   await this.consent(t);this.assert(t,stillOffered);
   await this.verifyBinding(t);this.assert(t,stillOffered);
   const card=await this.fresh(this.screen,t,stillOffered);
   this.assert(t,stillOffered);
   const skipGuard={kind:'pass',identity:card.identity,name:card.name};
   // One atomic checkpoint replaces the Like guard and charges the Skip, even if the acknowledgement is lost.
   try{this.reserveAction(skipGuard)}catch(error){
    // No input was dispatched. The atomic store kept the previous checkpoint.
    this.lastAction=offer.guard;this.reservedCount=offer.count;this.session.pause();throw error;
   }
   this.session.count=this.reservedCount;
   const ownsReservation=()=>this.lastAction===skipGuard&&!this.storageError&&this.session.epoch===offer.sessionEpoch&&
    this.session.status==='running'&&this.session.now()<offer.expiresAt&&this.session.now()<this.session.endsAt;
   try{
    this.assert(t,ownsReservation);
    await this.finalTap(card.controls.skip,t,ownsReservation,()=>{},'pass');
   }finally{
    if(this.session.count>=this.session.config.maxSwipes&&this.session.status==='running')this.session.finish('limit');
   }
   // The worker verifies the new guard independently before continuing its original session.
   if(this.session.status==='running')this.reason='Skip counted. Verifying that Hinge advanced to the next profile.';
  }finally{this.skipOffer=null}
 }
 async load(t){
  if(!this.loaded){
   if(!this.loading)this.loading=this.service.request('load').then(s=>{this.config=Config.normalize(s.mobileConfig?.[this.platform]||{});this.restoreCheckpoint(this.checkpointStore?.read());this.loaded=true;this.persist()}).finally(()=>{this.loading=null});
   await this.loading;
  }
  if(t)this.assert(t);
 }
 async consent(t){const s=await this.service.request('load');this.assert(t);if(!s.sidebarConsentGiven)throw Error('Complete setup and grant consent in AI settings first.');}
 async read(t){
  // Retry only an observation, never the tap/scroll that may already have reached the device.
  // Rebuild hierarchy and image evidence together so no stale partial read survives recovery.
  try{return await this.readOnce(t)}catch(error){
   this.skipOffer=null;this.assert(t);
   if(!['ANDROID_COMMAND_FAILED','ANDROID_COMMAND_TIMEOUT','COMMENT_FIELD_UNREADABLE','OCR_TIMEOUT','ANDROID_FOREGROUND_UNAVAILABLE'].includes(error.code))throw error;
   await this.pauseFor(750,t);
   return this.readOnce(t);
  }
 }
 async readOnce(t){this.assert(t);const raw=await this.android.hierarchy();this.assert(t);let s=this.readScreen(raw.xml,{platform:this.platform,foreground:raw.foreground});
  if(this.readEvidence||(this.photoHashes&&s.photos?.length)){
   const ev=this.readEvidence?await this.readEvidence(s,t.signal):{hashes:await this.photoHashes(s.photos)};this.assert(t);
   const photos=s.photos.map((p,i)=>({...p,visual:ev.hashes?.[i]||null,visualSquare:ev.squareHashes?.[i]||null}));
   // Recognition must depend only on observed evidence, not which photo the review later selects.
   const photo=photos.find(p=>p.visual);
   s=this.readScreen(raw.xml,{platform:this.platform,foreground:raw.foreground,photoIdentity:!s.identity?photo?.visual:undefined,commentText:ev.commentText});
   s.photos=(s.photos||[]).map(p=>{
    const index=photos.findIndex(original=>original.key===p.key);
    const result={...p,visual:photos[index]?.visual||null,visualSquare:photos[index]?.visualSquare||null};
    if(ev.patchEvidence?.[index])photoPatches.set(result,ev.patchEvidence[index]);
    if(index===0&&s.photos.length===1&&ev.scrollPhoto&&!overlapsPhotoPatch(p.bounds,s.controls?.skip?.bounds))scrollPhotos.set(result,ev.scrollPhoto);
    return result;
   });
   const revisions=s.photos.map(p=>{
    const patch=photoPatches.get(p);
    return patch?[p.visual,p.visualSquare,patch.digest]:[p.visual,p.visualSquare];
   });
   s.screenKey=require('node:crypto').createHash('sha256').update(JSON.stringify([s.screenKey,revisions,ev.commentText])).digest('hex');
  }  if(this.reviewContext&&(this.reviewContext.identity!==s.identity||this.reviewContext.screenKey!==s.screenKey))this.reviewContext=null;
  if(this.loadingFeedRelaunched&&['profile','empty','feedError','like','likeOffer','conversation'].includes(s.kind))this.loadingFeedRelaunched=false;
  this.observedForeground=raw.foreground;this.screen=s;this.reason='';this.notify();return s;
 }
 supported(s,kinds){if(!kinds.includes(s.kind))throw transientError(s.reason||'This screen is not recognized for this action.','MOBILE_SCREEN_UNAVAILABLE');if(!s.identity)throw transientError('Profile identity is incomplete. Read more profile details before acting.');}
 async fresh(expected,t,valid){this.assert(t,valid);const s=await this.read(t);this.assert(t,valid);if(s.kind!==expected.kind||s.identity!==expected.identity||s.screenKey!==expected.screenKey)throw transientError('Screen changed. Refresh context before acting.','MOBILE_SCREEN_CHANGED');return s}
 async tap(expected,control,t,valid=()=>true){if(!control)throw Error(expected.reason||'This action has no supported control on the current screen.');await this.fresh(expected,t,valid);this.assert(t,valid);await this.android.tapControl(control.bounds,()=>{try{this.assert(t,valid);return true}catch{return false}});this.assert(t,valid)}
 async finalTap(control,t,valid=()=>true,commit=()=>{},kind){
  let issued=false;
  const onIssued=()=>{if(issued)return;issued=true;commit()};
  try{await this.android.tapControl(control.bounds,()=>{try{this.assert(t,valid);return true}catch{return false}},onIssued);onIssued()}
  finally{if(issued)await this.record(kind)}
 }
 async pauseFor(ms,t,sleep){if(sleep){if(!await sleep(ms,'photos'))throw Error('Session stopped during profile review.')}else await this.wait(ms,t.signal);this.assert(t)}
 async dismissBumbleReminder(s,t,valid=()=>true){
  if(!dismissibleBumbleScreens.has(s.kind))return s;
  await this.tap(s,s.controls.dismiss,t,valid);await this.pauseFor(700,t);this.assert(t,valid);
  const after=await this.read(t);this.assert(t,valid);
  if(dismissibleBumbleScreens.has(after.kind))throw Error('Bumble popup did not close. No further action was attempted.');
  return after;
 }
 async repositionBumbleFooter(s,t,valid=()=>true){
  await this.verifyBinding(t);const current=await this.fresh(s,t,valid);this.assert(t,valid);
  if(!current.footerScrollSurface)throw transientError('The Bumble footer scroll surface changed.');
  const stillValid=()=>{try{this.assert(t,valid);return true}catch{return false}};
  await this.android.scrollProfile({fraction:.2,direction:'up',duration:550,surface:current.footerScrollSurface},stillValid);
  await this.pauseFor(450,t);this.assert(t,valid);
  const after=await this.read(t);this.assert(t,valid);
  if(after.kind!=='profile'||after.actionStrategy!=='footer'||after.footerScrollSurface||
     !after.controls.profileLike||!after.controls.profilePass)
   throw Error('The ordinary Bumble buttons are still unavailable after repositioning. Check the phone before resuming.');
  return after;
 }
 async reviewBumble(t,sleep,observed){
  this.reviewContext=null;this.selectedPhoto=null;await this.load(t);
  // When review needs no gesture, the current main card can go directly to
  // footerBumble's independent fresh read before its first scroll or vote.
  const reuseMain=sleep&&observed?.kind==='profile'&&observed===this.screen&&observed.actionStrategy==='footer'
   &&observed.identity&&observed.controls.like&&(!this.config.swipe.scrollProfile||this.config.scrollMax===0);
  let s=reuseMain?observed:await this.dismissBumbleReminder(await this.read(t),t);
  const contexts=new Set();let original;
  const verify=()=>{if(s.kind!=='profile')throw transientError(s.reason||'Bumble profile review was interrupted.');if(original&&((s.name&&s.name!==original.name)||(s.profileDiscriminator&&original.profileDiscriminator&&s.profileDiscriminator!==original.profileDiscriminator)))throw transientError('Bumble profile changed during review.');contexts.add(s.context?.bio||'')};verify();
  const move=async(direction,fraction,dwell=true)=>{
   if(s.footerScrollSurface){s=await this.repositionBumbleFooter(s,t);verify();return}
   if(dwell&&this.config.swipe.browsePhotos)await this.pauseFor(1000*(this.config.swipe.minPhotoSeconds+this.random()*(this.config.swipe.maxPhotoSeconds-this.config.swipe.minPhotoSeconds)),t,sleep);
   await this.android.scrollProfile({fraction,direction,duration:Math.round(300+this.random()*400)},()=>{try{this.assert(t);return true}catch{return false}});this.assert(t);await this.pauseFor(450,t,sleep);s=await this.read(t);verify();
  };
  // A session may begin halfway down a profile. Return to its main photo first.
  for(let i=0;!s.controls.like&&i<24;i++)await move('down',.65,false);
  this.supported(s,['profile']);if(!s.controls.like)throw transientError("Could not verify Bumble’s main profile photo.");
  original=s;
  const n=this.config.swipe.scrollProfile?this.config.scrollMin+Math.floor(this.random()*(this.config.scrollMax-this.config.scrollMin+1)):0;
  for(let i=0;i<n;i++)await move('up',this.config.fractionMin+this.random()*(this.config.fractionMax-this.config.fractionMin));
  // Session review and voting share one serialized device operation. Recheck
  // its last observed screen before continuing toward the ordinary voting row.
  if(sleep&&original.actionStrategy==='footer'&&s.actionStrategy==='footer'){
   return {...original,reviewEndpoint:s};
  }
  for(let i=0;!s.controls.like&&i<24;i++)await move('down',.65,false);
  if(!s.controls.like||s.identity!==original.identity)throw transientError("Bumble profile changed during review. Nothing was swiped.");
  this.reviewContext={identity:s.identity,screenKey:s.screenKey,context:{name:s.name,bio:[...contexts].filter(Boolean).join('\n').slice(0,12000),history:[]}};this.notify();return s;
 }
 async reconcileBumble(original,t,valid){if(this.platform!=='bumble')return false;return this.reconcilePending(original,t,valid)}
 async reconcilePending(original,t,valid){
  this.assert(t,valid);
  if(!this.lastAction||this.lastAction.identity!==original.identity||this.lastAction.name!==original.name)return false;
  await this.verifyBinding(t);this.assert(t,valid);
  // Observe the stalled original card again. No swipe, Like, or message is retried.
  const changeKey=observed=>observed.kind==='empty'?'empty':observed.kind==='profile'&&observed.identity&&observed.identity!==original.identity&&(observed.name!==original.name||(this.platform==='bumble'&&distinctBumbleProfile(original,observed)))?JSON.stringify([observed.identity,observed.name,observed.profileDiscriminator]):null;
  let current=await this.read(t);this.assert(t,valid);
  if(this.platform==='bumble')current=await this.dismissBumbleReminder(current,t,valid);
  if(current.footerScrollSurface)return false;
  // A footer has no name/photo. Recover observation by scrolling only, retaining
  // the durable action guard until two main-card observations prove transition.
  if(this.platform==='bumble')for(let i=0;current.kind==='profile'&&current.actionStrategy==='footer'&&!current.identity&&i<24;i++){
   await this.fresh(current,t,valid);this.assert(t,valid);
   await this.android.scrollProfile({fraction:.65,direction:'down',duration:400},()=>{try{this.assert(t,valid);return true}catch{return false}});
   await this.pauseFor(450,t);this.assert(t,valid);current=await this.read(t);this.assert(t,valid);
   if(current.footerScrollSurface)return false;
  }
  const late=changeKey(current);
  if(late){await this.pauseFor(1000,t);this.assert(t,valid);const confirmed=await this.read(t);this.assert(t,valid);if(changeKey(confirmed)!==late)return false;this.lastAction=null;this.persist();return true;}
  if(!this.android.refreshFeed||this.session.now()<(this.nextFeedRefreshAt||0))return false;
  // A changed photo cannot prove a new person, but it must not prevent a read-only refresh.
  const stalledProfile=current.kind==='profile'&&Boolean(current.identity)&&current.name===original.name;
  const stalledLike=this.platform==='hinge'&&current.kind==='like'&&current.name===original.name&&current.composerTextVerified===true&&!current.composerText?.trim();
  if(!stalledProfile&&!stalledLike)return false;
  await this.verifyBinding(t);await this.fresh(current,t,valid);this.assert(t,valid);
  this.skipOffer=null;this.lastAction.refreshAttempted=true;this.nextFeedRefreshAt=this.session.now()+300000;this.persist();
  if(this.session.status==='running'){this.session.phase='checking swipe result';this.notify()}
  await this.android.refreshFeed(this.platform,()=>{try{this.assert(t,valid);return true}catch{return false}},ms=>this.wait(ms,t.signal));this.assert(t,valid);
  let candidate=null;
  for(let i=0;i<6;i++){
   await this.pauseFor(1000,t);this.assert(t,valid);let observed=await this.read(t);this.assert(t,valid);
   if(this.platform==='bumble')observed=await this.dismissBumbleReminder(observed,t,valid);this.assert(t,valid);
   const key=changeKey(observed);
   if(key&&key===candidate){this.lastAction=null;this.persist();return true}
   candidate=key;
   if(observed.kind!=='blocked'&&!key)return false;
  }
  return false;
 }
 async footerBumble(kind,original,t,valid,commit){
  if(this.config.mode!=='like')throw Error('Choose plain Likes for Bumble.');
  let s=await this.fresh(original.reviewEndpoint||original,t,valid);const key=kind==='like'?'profileLike':'profilePass';
  for(let i=0;!s.controls?.[key]&&i<24;i++){
   if(s.footerScrollSurface)s=await this.repositionBumbleFooter(s,t,valid);
   else{
    this.assert(t,valid);await this.android.scrollProfile({fraction:.65,direction:'up',duration:400},()=>{try{this.assert(t,valid);return true}catch{return false}});
    await this.pauseFor(450,t);this.assert(t,valid);s=await this.read(t);this.assert(t,valid);
   }
   if(s.kind!=='profile'||s.actionStrategy!=='footer')throw transientError('Bumble footer review was interrupted.');
   if((s.name&&s.name!==original.name)||(s.profileDiscriminator&&original.profileDiscriminator&&s.profileDiscriminator!==original.profileDiscriminator))throw transientError('Bumble profile changed during footer review.');
  }
  if(!s.controls?.[key])throw transientError('Bumble ordinary Like footer was not reached within the review limit.');
  s=await this.fresh(s,t,valid);this.assert(t,valid);
  this.reserveAction({identity:original.identity,name:original.name,profileDiscriminator:original.profileDiscriminator||null});
  let issued=false;try{await this.finalTap(s.controls[key],t,valid,()=>{issued=true},kind);this.assert(t,valid);await this.transition(original,t,valid)}finally{if(issued)commit()}
  return this.snapshot();
 }
 async swipeBumble(kind,s,t,valid,commit){
  if(this.config.mode!=='like')throw Error('Bumble Compliment/comment automation is not verified. Choose plain Likes.');
  this.supported(s,['profile']);const control=kind==='like'?s.controls.like:s.controls.skip,direction=kind==='like'?'right':'left';
  if(control?.direction!==direction)throw Error('The Bumble swipe card is not verified.');
  await this.fresh(s,t,valid);let issuedCount=0,confirmed=false,reminderDismissed=false;
  const same=after=>after.kind===s.kind&&after.name===s.name&&after.identity===s.identity&&after.screenKey===s.screenKey;
  const budget=()=>this.session.status==='running'&&this.session.count+issuedCount<this.session.config.maxSwipes&&this.session.now()<this.session.endsAt;
  try{
   for(let attempt=0;attempt<2;attempt++){
    let issued=false;
    const onIssued=()=>{if(!issued){issued=true;issuedCount++}};
    this.reserveAction({identity:s.identity,name:s.name,profileDiscriminator:s.profileDiscriminator||null});
    await this.android.swipeProfile(direction,control.bounds,()=>{try{this.assert(t,valid);return true}catch{return false}},onIssued);onIssued();
    let stable=0,retrySafe=true,candidate=null,candidateReads=0;
    for(let i=0;i<5;i++){
     await this.wait(700,t.signal);this.assert(t,valid);let after=await this.read(t);this.assert(t,valid);
     if(dismissibleBumbleScreens.has(after.kind)){
      retrySafe=false;if(reminderDismissed)throw Error('Bumble popup reappeared. No further action was attempted.');
      reminderDismissed=true;after=await this.dismissBumbleReminder(after,t,valid);
     }
     if(after.kind==='swipeConfirm'&&after.swipeDirection===direction&&!confirmed){confirmed=true;retrySafe=false;await this.tap(after,after.controls.confirm,t,valid);continue;}
     if(after.kind==='profile'&&after.identity&&after.identity!==s.identity&&after.name!==s.name){this.lastAction=null;return this.snapshot()}
     if(distinctBumbleProfile(s,after)){
      const key=JSON.stringify([after.identity,after.profileDiscriminator]);candidateReads=key===candidate?candidateReads+1:1;candidate=key;retrySafe=false;
      if(candidateReads>=2){this.lastAction=null;return this.snapshot()}
     }else{candidate=null;candidateReads=0}
     if(after.kind==='empty'){this.lastAction=null;return this.snapshot()}
     if(after.kind==='blocked')throw Error('Bumble action transition requires attention. '+after.reason);
     if(same(after))stable++;else{stable=0;retrySafe=false}
    }
    // Only the original card, stable across independent reads, permits one more input.
    // Any intervening dialog, unknown screen, or changed identity makes retry unsafe.
    if(attempt||confirmed||!retrySafe||stable<2||!budget())break;
    const beforeRetry=await this.fresh(s,t,valid);this.assert(t,valid);
    if(!same(beforeRetry)||!budget())break;
   }
   if(await this.reconcileBumble(s,t,valid))return this.snapshot();
   throw Error('Could not confirm the Bumble swipe transition. It will not be retried on this profile.');
  }finally{if(issuedCount){commit(issuedCount);for(let i=0;i<issuedCount;i++)await this.record(kind)}}
 }
 async scrollHinge(s,options,t,valid=()=>true,requireReviewSurface=false){
  const surfaceKey=requireReviewSurface?'reviewScrollSurface':'scrollSurface';
  const anchored=this.platform==='hinge'&&s.kind==='profile'&&(requireReviewSurface||s.scrollSurface!==undefined);
  const binding=this.binding;
  const current=()=>valid()&&(!anchored||(binding?.serial===t.serial&&this.binding?.serial===t.serial&&this.binding.avd===binding.avd));
  this.assert(t,valid);
  if(anchored){
   if(requireReviewSurface&&!s[surfaceKey])throw alternativeUnavailable();
   if(!s[surfaceKey]||!current()||!this.android.deviceIdentity)throw transientError('A safe profile scroll surface requires the current bound phone.');
   await this.verifyBinding(t);
   s=await this.fresh(s,t,current);
   if(!s[surfaceKey])throw transientError('The profile scroll surface changed.');
   options={...options,surface:s[surfaceKey]};
  }
  await this.android.scrollProfile(options,()=>{try{this.assert(t,current);return true}catch{return false}});
  this.assert(t,current);return s;
 }
 async identifyProfile(s,t,valid=()=>true){
  if(this.platform!=='hinge'||s.kind!=='profile'||s.identity||s.photos?.length||!s.name||!this.config.swipe.scrollProfile)return s;
  const name=s.name;
  for(let i=0;i<3&&!s.identity;i++){
   this.assert(t,valid);
   await this.scrollHinge(s,{fraction:.45,duration:450,direction:'up'},t,valid);
   await this.pauseFor(450,t);this.assert(t,valid);s=await this.read(t);this.assert(t,valid);
   if(s.kind!=='profile')throw transientError('Profile evidence review interrupted: '+(s.reason||'Unrecognized screen.'));
   if(s.name!==name)throw transientError("Profile changed during identity review.");
  }
  return s;
 }
 scopedPhotoRejection(t){
  const hint=this.rejectedPhoto;
  return hint&&hint.endsAt===this.session.endsAt&&hint.count===this.session.count&&hint.serial===t.serial&&hint.avd===(this.binding?.avd||null)?hint:null;
 }
 heldReviewEndpoint(s,t){
  const hint=this.scopedPhotoRejection(t);
  if(!hint?.attempted||s.kind!=='profile'||!s.screenKey||!s.name||nameDigest(s.name)!==hint.nameDigest)return false;
  if(s.screenKey===hint.heldRevision)return true;
  // Observe an unidentified restored poll without attempting any discovery gesture in start().
  const restoredPoll=hint.promptScan==='spent'&&hint.heldIdentity===null&&hint.promptMovesRemaining===undefined&&!s.identity&&!s.photos?.length;
  return (hint.promptScan==='moving'||restoredPoll)&&this.observedForeground==='co.hinge.app'&&this.binding?.serial===t.serial&&
   !this.lastAction&&!this.draft&&this.session.count===this.reservedCount&&this.session.count<this.session.config.maxSwipes&&this.session.now()<hint.endsAt;
 }
 matchesRejectedPhoto(s,h,includeEndpoint=true){
  if(!s.name||nameDigest(s.name)!==h.nameDigest)return false;
  return (s.identity===h.sourceIdentity&&visibleFingerprint(s,h.visual))||
   (s.identity===h.entryIdentity&&(!h.entryVisual||visibleFingerprint(s,h.entryVisual)))||
   (includeEndpoint&&h.heldIdentity!==null&&s.identity===h.heldIdentity);
 }
 async reviewHeldPrompt(s,hint,t,valid,sleep){
  const session=this.session,epoch=session.epoch;
  const owned=()=>valid()&&session.status==='running'&&session.epoch===epoch&&session.now()<session.endsAt&&
   this.scopedPhotoRejection(t)===hint&&this.binding?.serial===t.serial&&this.reservedCount===session.count&&
   session.count<session.config.maxSwipes&&!this.lastAction&&!this.draft&&!this.storageError&&
   session.config.likeRatio===1&&this.config.mode==='like'&&this.config.swipe.scrollProfile&&
   !(session.config.breaksEnabled&&(session.breakUntil||session.count>=session.nextBreakAt));
  const official=card=>this.observedForeground==='co.hinge.app'&&card.kind==='profile'&&card.screenKey&&card.name&&
   nameDigest(card.name)===hint.nameDigest&&!card.composerText?.trim()&&!card.controls?.composer&&!card.controls?.sendLike;
  const nativePrompt=card=>{
   if(!card.identity||card.controls?.skip?.label!=='Skip '+card.name)return null;
   const prompts=card.prompts||[];
   return prompts.find(p=>p.key&&typeof p.text==='string'&&p.text.length>0&&p.like?.key&&p.like.label==='Like prompt'&&
    prompts.filter(other=>other.text===p.text).length===1);
  };
  const route=card=>{
   if(card.reviewScrollSurface)return 'drag';
   const p=card.reviewWheelPoint;
   return this.android.wheelDiscover&&Number.isInteger(p?.x)&&Number.isInteger(p?.y)&&wheelLandmarks(card.reviewScrollFrame)?'wheel':null;
  };
  const legacy=hint.promptScan==='spent';
  const legacyRoute=card=>{
   if(hint.promptMovesRemaining!==undefined||!hint.heldRevision||nativePrompt(card)||!route(card))return false;
   if(card.screenKey===hint.heldRevision)return hint.heldIdentity===(card.identity||null)&&
    (route(card)==='wheel'||card.reviewNewChoiceLane===true);
   // A cold launch may return from an unidentified poll to its original full photo.
   // Rebind that one source exactly. Its image is never a vote target in this scan.
   const photo=card.photos?.[0];
   return hint.heldIdentity===null&&card.identity===hint.sourceIdentity&&card.controls?.skip?.label==='Skip '+card.name&&
    card.photos?.length===1&&photo.visual===hint.visual&&!photo.revealDirection&&['Like photo','Like photo prompt'].includes(photo.like?.label)&&
    photo.bounds?.width>0&&photo.bounds.width===photo.bounds.height;
  };
  const eligible=card=>official(card)&&(legacy?legacyRoute(card):Boolean(route(card)||nativePrompt(card)));
  if(!owned()||!eligible(s)||!this.checkpointStore||!this.android.deviceIdentity)throw alternativeUnavailable();
  await this.consent(t);await this.verifyBinding(t);s=await this.fresh(s,t,owned);
  if(!eligible(s))throw alternativeUnavailable();
  let remaining=promptMoveLimit;
  const hold=card=>{hint.heldIdentity=card.identity||null;hint.heldRevision=card.screenKey;hint.promptScan='spent';hint.promptMovesRemaining=remaining;this.persist()};
  if(!legacy)hold(s);
  for(;;){
   const candidate=nativePrompt(s);
   if(candidate){
    // Discard the rejected photo context. This target belongs only to this newly verified Discover card.
    s=await this.fresh(s,t,owned);const fresh=nativePrompt(s);
    if(!official(s)||!fresh||fresh.key!==candidate.key||fresh.text!==candidate.text||fresh.like.key!==candidate.like.key)throw alternativeUnavailable();
    this.selectedPrompt={...fresh,type:'prompt'};this.selectedPhoto=null;
    this.reviewContext={identity:s.identity,screenKey:s.screenKey,alternate:hint,promptScan:true,expectedTarget:this.selectedPrompt,
     context:{name:s.name,bio:s.context?.bio||'',history:[]}};
    this.notify();return s;
   }
   const method=route(s);
   if(!remaining||!method)throw alternativeUnavailable();
   if(this.config.swipe.browsePhotos)await this.pauseFor(1000*(this.config.swipe.minPhotoSeconds+this.random()*(this.config.swipe.maxPhotoSeconds-this.config.swipe.minPhotoSeconds)),t,sleep);
   await this.verifyBinding(t);const before=await this.fresh(s,t,owned);
   if(!official(before)||nativePrompt(before)||route(before)!==method||(legacy&&remaining===promptMoveLimit&&!legacyRoute(before)))throw alternativeUnavailable();
   const point=before.reviewWheelPoint;
   if(method==='wheel'&&(point.x!==s.reviewWheelPoint.x||point.y!==s.reviewWheelPoint.y||
      before.reviewScrollFrame.ownerKey!==s.reviewScrollFrame.ownerKey||before.reviewScrollFrame.chromeKey!==s.reviewScrollFrame.chromeKey))throw alternativeUnavailable();
   // Charge the shared budget before dispatch. An interrupted movement is never replayed.
   this.assert(t,owned);hint.promptScan='moving';hint.promptMovesRemaining=--remaining;this.persist();
   const current=()=>{try{this.assert(t,owned);return true}catch{return false}};
   if(method==='wheel')await this.android.wheelDiscover(point,current);
   else await this.android.scrollProfile({fraction:.36,duration:450,direction:'up',surface:before.reviewScrollSurface},current);
   await this.pauseFor(450,t,sleep);s=await this.read(t);this.assert(t,owned);
   if(!official(s)){hint.promptScan='spent';hint.promptMovesRemaining=0;this.persist();throw alternativeUnavailable()}
   const advanced=s.screenKey!==before.screenKey&&(method!=='wheel'||wheelAdvanced(before.reviewScrollFrame,s.reviewScrollFrame));
   if(!advanced)remaining=0;
   hold(s);if(!advanced)throw alternativeUnavailable();
  }
 }
 async review(t,sleep,observed,kind,valid=()=>true){
  if(this.platform==='bumble')return this.reviewBumble(t,sleep,observed);
  this.reviewContext=null;this.selectedPhoto=null;this.selectedPrompt=null;await this.load(t);let s=await this.read(t);
  const automaticPlainLike=kind==='like'&&this.config.mode==='like';
  const hint=automaticPlainLike&&this.session.status==='running'?this.scopedPhotoRejection(t):null;
  if(hint?.attempted&&s.kind==='profile'&&s.name&&nameDigest(s.name)===hint.nameDigest){
   if(hint.promptScan==='moving'){
    // A prior worker may have scrolled before it stopped. Observe its endpoint and retire the pass.
    hint.heldIdentity=s.identity||null;hint.heldRevision=s.screenKey;hint.promptScan='spent';hint.promptMovesRemaining=0;this.persist();throw alternativeUnavailable();
   }
   const held=this.heldReviewEndpoint(s,t);
   if(!hint.promptScan&&hint.heldRevision&&(held||this.matchesRejectedPhoto(s,hint,false)))return this.reviewHeldPrompt(s,hint,t,valid,sleep);
   if(hint.promptScan==='spent'&&hint.promptMovesRemaining===undefined&&(held||hint.heldIdentity===null))return this.reviewHeldPrompt(s,hint,t,valid,sleep);
   if(held)throw alternativeUnavailable();
  }
  s=await this.identifyProfile(s,t,valid);this.supported(s,['profile']);
  const name=s.name,contexts=new Set([s.context?.bio||'']);
  const entry={identity:s.identity,visual:s.photos?.find(p=>photoFingerprint(p.visual))?.visual||null};
  const alternate=hint&&this.matchesRejectedPhoto(s,hint)?hint:null;
  // A photo-derived identity changes on a one-bit drift. Its old name plus image may deny
  // a repeat, but only the independent source/entry binding above can enable a new review.
  const denyAlias=screen=>!alternate&&hint&&screen.name&&nameDigest(screen.name)===hint.nameDigest&&visibleFingerprint(screen,hint.visual);
  if(denyAlias(s))throw alternativeUnavailable();
  if(alternate){
   this.assert(t,valid);
   if(alternate.attempted||this.lastAction||this.draft||this.session.now()>=this.session.endsAt||this.reservedCount>=this.session.config.maxSwipes)throw alternativeUnavailable();
   await this.verifyBinding(t);await this.fresh(s,t,valid);this.assert(t,valid);
   // Charge the single alternative review before any navigation; it never authorizes a vote.
   alternate.attempted=true;this.persist();
  }
  let followingRejected=Boolean(alternate&&s.photos?.length===1&&matchesFingerprint(s.photos[0],alternate.visual));
  const move=async (fraction,direction='up')=>{
   if(this.config.swipe.browsePhotos)await this.pauseFor(1000*(this.config.swipe.minPhotoSeconds+this.random()*(this.config.swipe.maxPhotoSeconds-this.config.swipe.minPhotoSeconds)),t,sleep);
   const before=await this.scrollHinge(s,{fraction,duration:Math.round(300+this.random()*400),direction},t,valid,Boolean(alternate));
   await this.pauseFor(450,t,sleep);s=await this.read(t);
   if(s.kind!=='profile')throw transientError('Profile review interrupted: '+(s.reason||'The current screen is not a recognized profile.'));
   if(s.name!==name)throw transientError("Profile changed during review.");
   if(denyAlias(s))throw alternativeUnavailable();
   if(alternate){
    this.assert(t,valid);
    // Even an ambiguous endpoint belongs to this attempted scroll for denial purposes only.
    alternate.heldIdentity=s.identity||null;alternate.heldRevision=s.screenKey;this.persist();
    const adjacent=direction==='up'&&before.photos?.length===1&&s.photos?.length===1&&
     sameScrollPhoto(scrollPhotos.get(before.photos[0]),scrollPhotos.get(s.photos[0]));
    const continuous=adjacent||s.identity===before.identity||before.photos?.some(p=>visibleFingerprint(s,p.visual)||visibleFingerprint(s,p.visualSquare))||
     before.prompts?.some(p=>p.text&&s.prompts?.some(other=>other.text===p.text));
    if(!s.identity||!continuous)throw alternativeUnavailable();
    followingRejected=s.photos?.length===1&&(matchesFingerprint(s.photos[0],alternate.visual)||(followingRejected&&adjacent));
   }
   contexts.add(s.context?.bio||'');
  };
  const n=this.config.swipe.scrollProfile?this.config.scrollMin+Math.floor(this.random()*(this.config.scrollMax-this.config.scrollMin+1)):0;
  for(let i=0;i<n;i++)await move(this.config.fractionMin+this.random()*(this.config.fractionMax-this.config.fractionMin));
  // Random depth selects a different part of the profile; small bounded adjustments expose a full photo.
  const targets=()=>{
   // Discover paints its floating Skip button over the photo, but the Like preview omits it.
   const skip=s.controls.skip;
   const overlay=automaticPlainLike&&skip?.label==='Skip '+s.name?skip.bounds:null;
   const photos=(s.photos||[]).filter(p=>p.like&&!overlapsPhotoPatch(p.bounds,overlay));
   const prompts=(s.prompts||[]).filter(p=>p.like).map(p=>({...p,type:'prompt'}));
   if(alternate){
    if(!s.identity)return [];
    // Non-overlapping six-bit match ranges distinguish this candidate from the rejected source.
    return prompts.length?prompts:photos.filter(p=>!followingRejected&&photoFingerprint(p.visual)&&!matchesFingerprint(p,alternate.visual,12)&&
     !photos.some(other=>other!==p&&matchesFingerprint(other,p.visual,12)));
   }
   return photos.length?photos:prompts;
  };
  let candidates=targets();
  let direction='up';
  const reveal=()=>s.photos?.find(p=>['up','down'].includes(p.revealDirection)&&(!alternate||(!followingRejected&&!matchesFingerprint(p,alternate.visual,12))))?.revealDirection;
  for(let i=0;!candidates.length&&this.config.swipe.scrollProfile&&i<6;i++){const before=s.screenKey;await move(s.photos?.length ? .2 : .55,reveal()||direction);candidates=targets();if(!candidates.length&&s.screenKey===before)direction=direction==='up'?'down':'up';}
  // Reaching a photo at the search boundary still permits two small alignment moves.
  for(let i=0;!candidates.length&&this.config.swipe.scrollProfile&&i<2&&reveal();i++){await move(.2,reveal());candidates=targets();}
  // Videos can keep the screen revision changing at the bottom of a profile.
  // Once forward search is exhausted, return toward earlier photos with a fixed budget.
  const returnToPhotos=!s.photos?.length;
  for(let i=0;!candidates.length&&returnToPhotos&&this.config.swipe.scrollProfile&&i<10;i++){
   await move(reveal() ? .2 : .6,reveal()||'down');
   candidates=targets();
  }
  if(hint&&!alternate&&this.matchesRejectedPhoto(s,hint))throw alternativeUnavailable();
  if(alternate&&!candidates.length)throw alternativeUnavailable();
  if(!candidates.length)throw transientError("No fully visible photo found within the review limit. Scroll manually and read again.");
  const selected=candidates[Math.min(candidates.length-1,Math.floor(this.random()*candidates.length))];this.selectedPhoto=selected.type==='prompt'?null:selected;this.selectedPrompt=selected.type==='prompt'?selected:null;
  this.reviewContext={identity:s.identity,screenKey:s.screenKey,entry,alternate,expectedTarget:alternate?selected:null,context:{name,bio:[...contexts].filter(Boolean).join('\n').slice(0,12000),history:[]}};this.notify();return s;
 } async record(kind){await this.service.request('record',{kind,detail:this.platform==='hinge'?'Hinge desktop':'Bumble desktop'})}
 async transition(before,t,valid=()=>true,allowOffer=false){
  let offerHandled=false,evidenceChecked=false,last,candidate=null,candidateReads=0;
  for(let i=0;i<(allowOffer?6:3);i++){
   await this.wait(700,t.signal);this.assert(t,valid);let after=await this.read(t);this.assert(t,valid);
   if(!evidenceChecked&&after.kind==='profile'&&!after.identity&&after.name&&after.name!==before.name){evidenceChecked=true;after=await this.identifyProfile(after,t,valid);}
   if(this.platform==='bumble'&&dismissibleBumbleScreens.has(after.kind))after=await this.dismissBumbleReminder(after,t,valid);
   last=after;
   if(this.platform==='bumble'&&distinctBumbleProfile(before,after)){const key=JSON.stringify([after.identity,after.profileDiscriminator]);candidateReads=key===candidate?candidateReads+1:1;candidate=key;if(candidateReads>=2){this.lastAction=null;return}}else{candidate=null;candidateReads=0}
   if(after.kind==='empty'){this.lastAction=null;return}
   if(after.kind==='likeOffer'&&allowOffer&&!offerHandled){
    offerHandled=true;if(this.lastAction){this.lastAction.offerKey=after.screenKey;this.persist();}
    await this.tap(after,after.controls.sendLike,t,valid);continue;
   }
   if((after.kind==='profile'||(before.kind!=='likeOffer'&&after.kind==='like'))&&after.identity&&after.name!==before.name){this.lastAction=null;return}
   if(after.kind==='conversation'&&after.identity!==before.identity){this.lastAction=null;return}
  }
  throw Error('Could not confirm the action transition. It will not be retried on this profile.'+(last?.reason?' '+last.reason:''));
 }
 async submitLike(screen,original,t,valid,commit,verifyForm){
  const fresh=await this.fresh(screen,t,valid);this.assert(t,valid);
  if(verifyForm&&!verifyForm(fresh))throw alternativeUnavailable();
  this.reserveAction({identity:original.identity,name:original.name,...(this.session.status==='running'&&this.config.mode==='like'&&screen.kind==='like'?{kind:'like',sessionEndsAt:this.session.endsAt}:{}),...(screen.kind==='likeOffer'?{offerKey:screen.screenKey}:{})});
  let issued=false;const onIssued=()=>{issued=true};
  try{
   await this.android.tapControl(screen.controls.sendLike.bounds,()=>{try{this.assert(t,valid);return true}catch{return false}},onIssued);onIssued();
   this.draft=null;this.assert(t,valid);await this.transition(original,t,valid,screen.kind!=='likeOffer');
  }finally{if(issued){commit();await this.record('like')}}
  return this.snapshot();
 }
 async act(kind,t,valid=()=>true,commit=()=>{},prepared){
  if(!['like','pass'].includes(kind))throw Error('Unknown mobile action.');await this.load(t);await this.consent(t);await this.verifyBinding(t);let s=prepared||await this.read(t);this.supported(s,kind==='like'?['profile','like','likeOffer']:['profile','like']);
  if(this.lastAction&&(this.lastAction.identity===s.identity||this.lastAction.name===s.name||(s.kind==='likeOffer'&&this.lastAction.offerKey===s.screenKey))){
   if(this.platform!=='bumble'||!distinctBumbleProfile(this.lastAction,s))throw Error('An action was already attempted on this profile. Its result is uncertain; change profiles manually before continuing.');
   // A late transition must be independently re-read before releasing its guard.
   s=await this.fresh(s,t,valid);if(!distinctBumbleProfile(this.lastAction,s))throw Error('Profile evidence changed; the previous action remains uncertain.');this.lastAction=null;
  }
  if(this.platform==='bumble')return s.actionStrategy==='footer'?this.footerBumble(kind,s,t,valid,commit):this.swipeBumble(kind,s,t,valid,commit);
  if(s.kind==='likeOffer')return this.submitLike(s,s,t,valid,commit);
  const selection=prepared?this.reviewContext:null;
  const original=s,reviewContext=this.reviewContext?.identity===s.identity&&this.reviewContext.screenKey===s.screenKey?this.reviewContext.context:null;
  if(kind==='pass'){
   await this.fresh(s,t,valid);if(!s.controls.skip)throw Error('No supported Skip control.');this.reserveAction({kind:'pass',identity:s.identity,name:s.name});
   let issued=false;try{await this.finalTap(s.controls.skip,t,valid,()=>{issued=true},'pass');this.assert(t,valid);await this.transition(s,t,valid)}finally{if(issued)commit()}return this.snapshot();
  }
  let verifyForm;
  if(s.kind==='profile'){
   let photo;
   if(selection?.alternate){
    this.assert(t,valid);
    if(this.session.now()>=selection.alternate.endsAt||this.session.count!==selection.alternate.count||
      this.reservedCount>=this.session.config.maxSwipes||this.draft||this.lastAction)throw alternativeUnavailable();
    const expected=selection.expectedTarget;
    const source=expected.type==='prompt'?s.prompts:s.photos;
    photo=source?.find(p=>p.key===expected.key&&p.like&&(expected.type==='prompt'?p.text===expected.text:p.visual===expected.visual));
    if(!photo)throw alternativeUnavailable();
   }else if(prepared&&this.selectedPrompt){
    photo=s.prompts?.find(p=>p.key===this.selectedPrompt.key&&p.like);
    if(!photo)throw transientError('The reviewed prompt is no longer available. Read the profile again.');
   }else{
    photo=this.selectedPhoto&&s.photos?.find(p=>p.key===this.selectedPhoto.key);
    if(!photo){
     const photos=(s.photos||[]).filter(p=>p.like);
     if(photos.length)photo=photos[Math.floor(this.random()*photos.length)];
     else{
      const prompts=(s.prompts||[]).filter(p=>p.like);
      photo=prompts.find(p=>p.key===this.selectedPrompt?.key)||prompts[0];
     }
    }
   }
   if(!photo?.like)throw Error('No supported fully visible photo. Scroll or review again before liking.');this.selectedPhoto=photo;
   await this.tap(s,photo.like,t,valid);await this.pauseFor(900,t);s=await this.read(t);
   // Native keyboard/form animation can briefly expose conflicting background controls.
   // Reread once, retaining every identity, comment and control check below.
   if(s.kind==='blocked'&&s.reason==='An unfamiliar Like control requires user attention.'){await this.pauseFor(750,t);this.assert(t,valid);s=await this.read(t);}
   this.supported(s,['like']);
   for(let attempt=0;!s.controls.sendLike&&s.composerTextVerified===true&&attempt<2;attempt++){await this.pauseFor(750,t);s=await this.read(t);this.supported(s,['like']);}
   if(selection?.promptScan){
    verifyForm=form=>form.kind==='like'&&form.identity&&form.name===original.name&&form.prompts?.length===1&&
     form.prompts[0].text===photo.text&&!form.photos?.length&&['Send like','Send priority like'].includes(form.controls?.sendLike?.label)&&
     form.composerTextVerified===true&&form.composerText===''&&!this.draft&&!this.lastAction&&
     this.scopedPhotoRejection(t)===selection.alternate&&this.reservedCount===this.session.count&&
     this.session.count<this.session.config.maxSwipes&&this.session.now()<this.session.endsAt;
    if(!verifyForm(s))throw alternativeUnavailable();
   }
   const samePrompt=photo.text&&s.prompts?.some(p=>p.text===photo.text);
   let samePhoto=photo.visual&&s.photos?.some(p=>hashDistance(photo.visual,p.visual)<=6||hashDistance(photo.visual,p.visualSquare)<=6);
   if(!samePhoto&&!photo.text&&(selection?.alternate||s.identity!==original.identity)&&s.name===original.name&&this.config.mode==='like'&&!this.lastAction&&!this.draft&&s.composerTextVerified===true&&s.composerText===''&&s.controls.sendLike&&s.photos?.length===1){
    const preview=photoPatches.get(s.photos[0]);
    const matching=original.photos.filter(p=>sameClippedPhoto(photoPatches.get(p),preview));
    samePhoto=matching.length===1&&matching[0]===photo;
   }
   if(s.name!==original.name||(photo.text?!samePrompt:((selection?.alternate||s.identity!==original.identity)&&!samePhoto))){
    if(selection?.alternate)throw alternativeUnavailable();
    if(selection?.entry&&!photo.text&&photoFingerprint(photo.visual)&&s.name===original.name&&this.resumableLike(s)&&
      this.session.status==='running'&&this.session.config.likeRatio===1&&this.binding?.serial===t.serial&&
      !this.draft&&!this.lastAction&&this.session.count===this.reservedCount){
     this.assert(t,valid);
     this.rejectedPhoto={nameDigest:nameDigest(original.name),sourceIdentity:original.identity,visual:photo.visual,entryIdentity:selection.entry.identity,entryVisual:selection.entry.visual,
      heldIdentity:null,heldRevision:null,attempted:false,endsAt:this.session.endsAt,count:this.session.count,serial:t.serial,avd:this.binding.avd||null};
     this.persist();throw transientError('The selected photo could not be verified in the Like form.','MOBILE_PHOTO_MISMATCH');
    }
    throw transientError("Could not verify the selected profile/photo or prompt in the Like confirmation.");
   }
  }
  if(s.composerTextVerified===false)throw Error('The comment field cannot be verified. Nothing was sent.');
  if(s.composerText?.trim())throw Error('An existing comment is present. Review or clear it manually first.');
  if(this.config.mode==='comment'){
   if(!s.controls.comment)throw Error('Photo comments are unavailable on this screen or account.');const result=await this.service.request('generate',{context:reviewContext||s.context,options:this.options('Write a short comment about the supplied profile text. Do not describe unseen photo contents. Use printable ASCII, one line only, maximum 120 characters.')});this.assert(t,valid);const text=this.text(result.response,this.platform==='bumble'?150:120);
   this.draft={text,identity:s.identity,serial:t.serial,kind:'like',contextRevision:s.screenKey};await this.tap(s,s.controls.comment,t,valid);let field=await this.read(t);if(field.name!==s.name||field.composerText?.trim())throw Error('Comment field changed or contains unsent text.');if(!field.controls.composer)throw Error('Comment editor is not recognized. Type the draft manually.');await this.tap(field,field.controls.composer,t,valid);await this.android.type(text);this.assert(t,valid);s=await this.read(t);if(s.composerText!==text)throw Error('Inserted comment could not be verified. Nothing was sent.');
  }
  if(!s.controls.sendLike)throw Error(s.reason||'The ordinary Like confirmation is unsupported; no Like was sent.');return this.submitLike(s,original,t,valid,commit,verifyForm);
 }
 options(extra=''){return {tone:this.config.tone,language:this.config.language,length:this.config.length,instruction:[this.config.instruction,extra].filter(Boolean).join('\n')}}
 text(value,max=2000){if(typeof value!=='string'||!value.trim()||value.length>max||!/^[\x20-\x7e]+$/.test(value))throw Error('Android entry requires one line of printable ASCII characters (no emoji), within the message limit.');return value}
 async generate(t,expected){await this.load(t);let s=await this.read(t);this.supported(s,['profile','like','conversation']);if(expected&&(s.identity!==expected.identity||s.screenKey!==expected.screenKey||!this.emptyOpenerConversation(s)))throw Error('Conversation changed before automatic opener generation.');const identity=s.identity,revision=s.screenKey;const result=await this.service.request('generate',{context:s.context,options:this.options()});this.assert(t);const fresh=await this.read(t);if(fresh.identity!==identity||fresh.screenKey!==revision)throw Error('Conversation or profile changed. Draft discarded.');this.draft={text:result.response,identity,serial:t.serial,kind:s.kind,contextRevision:revision};return this.snapshot()}
 async insert(data,t,expected){const text=this.text(data.text??this.draft?.text);if(!this.draft)throw Error('Generate a context-bound draft first.');let s=await this.read(t);this.supported(s,['conversation','like']);if(expected&&(s.identity!==expected.identity||s.screenKey!==expected.screenKey||!this.emptyOpenerConversation(s)))throw Error('Conversation changed before automatic opener insertion.');if(this.draft.serial!==t.serial||this.draft.identity!==s.identity)throw Error('Draft belongs to another conversation or profile; context changed.');if(s.composerText?.trim())throw Error('An existing unsent message is already in the composer.');if(!s.controls.composer)throw Error('This composer is unsupported; use manual controls.');await this.tap(s,s.controls.composer,t);await this.android.type(text);this.assert(t);s=await this.read(t);if(s.identity!==this.draft.identity||s.composerText!==text||(expected&&s.composerTextVerified!==true))throw Error('Inserted draft could not be verified. Nothing was sent.');this.draft={...this.draft,text,inserted:true};return this.snapshot()}
 async send(data,t,automatic=false){if(!this.draft?.inserted)throw Error('Insert and verify the draft before sending.');const s=await this.read(t);this.supported(s,['conversation']);if(automatic&&s.composerTextVerified!==true)throw Error('Automatic message composer text could not be verified. Nothing was sent.');if(s.identity!==this.draft.identity||t.serial!==this.draft.serial||s.composerText!==this.draft.text)throw Error('Conversation or draft changed. Nothing was sent.');if(!s.controls.sendMessage)throw Error('Message sending is not supported on this screen.');await this.fresh(s,t);const control=s.controls.sendMessage;this.draft=null;await this.finalTap(control,t,()=>true,()=>{},'message');this.assert(t);return this.snapshot()}
 emptyOpenerConversation(s){return s?.kind==='conversation'&&Boolean(s.identity)&&s.emptyConversation===true&&s.composerTextVerified===true&&s.composerText===''&&Boolean(s.controls?.composer)}
 canWatch(){return this.openerArmed&&this.config.autoOpeners===true&&Boolean(this.android.serial)&&this.session.status!=='running'&&(this.visible||this.config.swipe.allowBackground)}
 async watch(){
  // Polling must never join a running session or overlap a pending request.
  if(!this.canWatch()||this.busy||this.watchPending)return this.snapshot();
  this.watchPending=true;
  try{return await this.enqueue(async t=>{
   if(!this.canWatch())return;
   await this.load(t);await this.consent(t);this.assert(t);
   if(!this.canWatch())return;
   const s=await this.read(t);
   if(!this.emptyOpenerConversation(s))return;
   const key=JSON.stringify([t.serial,s.identity]);
   if(this.openerAttempts.has(key))return;
   // Reserve before AI so errors and uncertain sends cannot create a retry loop.
   this.openerAttempts.add(key);
   await this.generate(t,s);this.assert(t);
   if(!this.canWatch())throw Error('Automatic opener canceled.');
   if(this.config.autoSend===true){await this.insert({},t,s);this.assert(t);await this.send({},t,true)}
  })}finally{this.watchPending=false}
 }
 async request(action,data={}){
  if(action==='status'){await this.load();return this.snapshot()}
  if(action==='watch')return this.watch();
  if(action==='pause'||action==='stop'){this.invalidate(action==='stop'?'Stopped.':'Paused.',{stop:action==='stop'});return this.snapshot()}
  if(action==='visibility'){this.visible=data.visible===true;if(!this.visible&&!this.config.swipe.allowBackground)this.invalidate('Paused while the app is hidden.');return this.snapshot()}
  const manual=['review','act','generate','insert','send'].includes(action);
  const assertOwnership=()=>{if(manual&&this.session.status==='running')throw Error('Pause the running session before manual mobile actions.');};assertOwnership();
  return this.enqueue(async t=>{assertOwnership();await this.load(t);if(action==='context'){await this.read(t);return this.snapshot()}
   if(action==='config'){
    if(this.session.status==='running')throw Error('Pause the session before editing its settings.');
    const next=Config.normalize(data,this.config);
    const timingKeys=['randomizeTiming','delaySeconds','minDelaySeconds','maxDelaySeconds'].filter(key=>Object.hasOwn(data.swipe??{},key));
    let pausedConfig;
    if(this.session.status==='paused'&&timingKeys.length){
     pausedConfig={...this.session.config};
     for(const key of timingKeys)pausedConfig[key]=next.swipe[key];
     if(pausedConfig.minDelaySeconds>pausedConfig.maxDelaySeconds)throw Error('Minimum session timing exceeds maximum for the paused session.');
    }
    this.assert(t);await this.service.request('save',{mobileConfig:{[this.platform]:next}});this.assert(t);
    this.config=next;this.openerArmed=next.autoOpeners===true;
    if(pausedConfig){this.session.config=pausedConfig;this.persist()}
    return this.snapshot();
   }
   if(action==='confirmPendingSkip')return this.confirmPendingSkip(data.token,t);
   if(action==='review'){await this.review(t);return this.snapshot()}
   if(action==='start'){if(this.busy&&this.session.status==='running')throw Error('Session is already running.');await this.consent(t);await this.verifyBinding(t);const resuming=['error','paused'].includes(this.session.status);if(this.session.status==='error'&&this.session.endsAt)this.session.restore(this.checkpoint().session);if(resuming&&(this.session.now()>=this.session.endsAt||this.session.count>=this.session.config.maxSwipes)){this.session.finish(this.session.count>=this.session.config.maxSwipes?'limit':'time');return this.snapshot()}let s=await this.read(t);if(this.platform==='bumble'){s=await this.dismissBumbleReminder(s,t);if(!['profile','empty'].includes(s.kind))throw Error(s.reason||'Open Bumble People first.');if(this.config.mode!=='like')throw Error('Bumble comments are not verified. Choose plain Likes.');}else if(!['empty','feedError'].includes(s.kind)&&!(s.kind==='feedLoading'&&this.isManagedPhone(this.binding))&&!this.resumableLike(s)&&!(resuming&&this.heldReviewEndpoint(s,t))){s=await this.identifyProfile(s,t);this.supported(s,['profile']);}if(!this.visible&&!this.config.swipe.allowBackground)throw Error('Show the app before starting this session.');if(this.session.status!=='paused'){this.reservedCount=0;this.recoveryAttempts=0;this.readFailures=0;}this.persist();this.session.start(this.config.swipe);await this.record('session');this.openerArmed=this.config.autoOpeners===true;return this.snapshot()}
   if(action==='act')return this.act(data.kind,t);if(action==='generate')return this.generate(t);if(action==='insert')return this.insert(data,t);if(action==='send')return this.send(data,t);throw Error('Unknown mobile action.');
  });
 }
}
module.exports=MobileController;


