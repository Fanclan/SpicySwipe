'use strict';
const Session=require('../shared/session.js');
const Config=require('./mobile-config.cjs');
const delay=(ms,signal)=>new Promise(resolve=>{const done=()=>{clearTimeout(timer);signal?.removeEventListener('abort',done);resolve()};const timer=setTimeout(done,ms);signal?.addEventListener('abort',done,{once:true});if(signal?.aborted)done()});
const hashDistance=(a,b)=>{if(!a||!b||a.length!==b.length)return Infinity;let n=0;for(let i=0;i<a.length;i++){let x=parseInt(a[i],16)^parseInt(b[i],16);while(x){n+=x&1;x>>=1}}return n};
// Pixel changes alone cannot establish a new same-name Bumble profile.
const distinctBumbleProfile=(before,after)=>after.kind==='profile'&&Boolean(after.identity)&&after.identity!==before.identity&&after.name===before.name&&Boolean(before.profileDiscriminator)&&Boolean(after.profileDiscriminator)&&after.profileDiscriminator!==before.profileDiscriminator&&after.controls?.like?.direction==='right';
class MobileController{
 constructor({android,service,platform,changed=()=>{},random=Math.random,wait=delay,readScreen,photoHashes,readEvidence}){
  if(!['hinge','bumble'].includes(platform))throw Error('Unknown mobile platform.');
  Object.assign(this,{android,service,platform,changed,random,wait,photoHashes,readEvidence});this.readScreen=readScreen||require('./mobile-screen.cjs').readScreen;
  this.config=Config.normalize();this.screen=null;this.draft=null;this.selectedPhoto=null;this.queue=Promise.resolve();this.epoch=0;this.busy=false;this.loaded=false;this.loading=null;this.reviewContext=null;this.visible=true;this.lastAction=null;this.openerAttempts=new Set();this.openerArmed=false;this.watchPending=false;this.abort=new AbortController();
  this.session=new Session({random,wait,act:(c,valid,commit,sleep)=>this.enqueue(async token=>{const prepared=await this.review(token,sleep);this.assert(token,valid);await this.act(this.random()<c.likeRatio?'like':'pass',token,valid,commit,prepared)},true),changed:()=>this.notify()});
 }
 snapshot(){return {platform:this.platform,session:this.session.snapshot(),screen:this.screen,config:this.config,draft:this.draft,selectedPhoto:this.selectedPhoto,busy:this.busy,openerArmed:this.openerArmed,reason:this.reason||''}}
 notify(){this.changed(this.snapshot())}
 token(){return {epoch:this.epoch,serial:this.android.serial,inputEpoch:this.android.inputEpoch,signal:this.abort.signal}}
 assert(t,valid=()=>true){if(t.epoch!==this.epoch||t.serial!==this.android.serial||t.inputEpoch!==this.android.inputEpoch||!t.serial||t.signal.aborted||!valid())throw Error('Mobile action canceled: device, screen ownership, or session changed.');}
 invalidate(reason='Mobile context changed',{stop=false}={}){this.openerArmed=false;this.epoch++;this.abort.abort();this.abort=new AbortController();this.android.cancelInput();stop?this.session.stop():this.session.pause();this.draft=null;this.selectedPhoto=null;this.reviewContext=null;this.screen=null;this.reason=reason;this.notify()}
 drain(){return this.queue.catch(()=>{})}
 enqueue(fn,session=false){const t=this.token();const job=this.queue.then(async()=>{this.assert(t);this.busy=true;this.notify();try{await fn(t)}finally{this.busy=false;this.notify()}return this.snapshot()});this.queue=job.catch(()=>{});return job}
 async load(t){
  if(!this.loaded){
   if(!this.loading)this.loading=this.service.request('load').then(s=>{this.config=Config.normalize(s.mobileConfig?.[this.platform]||{});this.loaded=true}).finally(()=>{this.loading=null});
   await this.loading;
  }
  if(t)this.assert(t);
 }
 async consent(t){const s=await this.service.request('load');this.assert(t);if(!s.sidebarConsentGiven)throw Error('Complete setup and grant consent in AI settings first.');}
 async read(t){
  // Retry only an observation, never the tap/scroll that may already have reached the device.
  // Rebuild hierarchy and image evidence together so no stale partial read survives recovery.
  try{return await this.readOnce(t)}catch(error){
   this.assert(t);
   if(!['ANDROID_COMMAND_FAILED','ANDROID_COMMAND_TIMEOUT'].includes(error.code))throw error;
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
   s.photos=(s.photos||[]).map(p=>({...p,visual:photos.find(original=>original.key===p.key)?.visual||null,visualSquare:photos.find(original=>original.key===p.key)?.visualSquare||null}));
   s.screenKey=require('node:crypto').createHash('sha256').update(JSON.stringify([s.screenKey,s.photos.map(p=>[p.visual,p.visualSquare]),ev.commentText])).digest('hex');
  }  if(this.reviewContext&&(this.reviewContext.identity!==s.identity||this.reviewContext.screenKey!==s.screenKey))this.reviewContext=null;
  this.screen=s;this.reason='';this.notify();return s;
 }
 supported(s,kinds){if(!kinds.includes(s.kind))throw Error(s.reason||'This screen is not recognized for this action.');if(!s.identity)throw Error('Profile identity is incomplete. Read more profile details before acting.');}
 async fresh(expected,t,valid){this.assert(t,valid);const s=await this.read(t);this.assert(t,valid);if(s.kind!==expected.kind||s.identity!==expected.identity||s.screenKey!==expected.screenKey)throw Error('Screen changed. Refresh context before acting.');return s}
 async tap(expected,control,t,valid=()=>true){if(!control)throw Error(expected.reason||'This action has no supported control on the current screen.');await this.fresh(expected,t,valid);this.assert(t,valid);await this.android.tapControl(control.bounds,()=>{try{this.assert(t,valid);return true}catch{return false}});this.assert(t,valid)}
 async finalTap(control,t,valid=()=>true,commit=()=>{},kind){
  let issued=false;
  const onIssued=()=>{if(issued)return;issued=true;commit()};
  try{await this.android.tapControl(control.bounds,()=>{try{this.assert(t,valid);return true}catch{return false}},onIssued);onIssued()}
  finally{if(issued)await this.record(kind)}
 }
 async pauseFor(ms,t,sleep){if(sleep){if(!await sleep(ms,'photos'))throw Error('Session stopped during profile review.')}else await this.wait(ms,t.signal);this.assert(t)}
 async reviewBumble(t,sleep){
  this.reviewContext=null;this.selectedPhoto=null;await this.load(t);let s=await this.read(t);const contexts=new Set();
  const verify=()=>{if(s.kind!=='profile')throw Error(s.reason||'Bumble profile review was interrupted.');contexts.add(s.context?.bio||'')};verify();
  const move=async(direction,fraction)=>{
   if(this.config.swipe.browsePhotos)await this.pauseFor(1000*(this.config.swipe.minPhotoSeconds+this.random()*(this.config.swipe.maxPhotoSeconds-this.config.swipe.minPhotoSeconds)),t,sleep);
   await this.android.scrollProfile({fraction,direction,duration:Math.round(300+this.random()*400)},()=>{try{this.assert(t);return true}catch{return false}});this.assert(t);await this.pauseFor(450,t,sleep);s=await this.read(t);verify();
  };
  // A session may begin halfway down a profile. Return to its main photo first.
  for(let i=0;!s.controls.like&&i<8;i++)await move('down',.65);
  this.supported(s,['profile']);if(!s.controls.like)throw Error('Could not verify Bumble’s main profile photo.');
  const original=s;
  const n=this.config.swipe.scrollProfile?this.config.scrollMin+Math.floor(this.random()*(this.config.scrollMax-this.config.scrollMin+1)):0;
  for(let i=0;i<n;i++)await move('up',this.config.fractionMin+this.random()*(this.config.fractionMax-this.config.fractionMin));
  for(let i=0;!s.controls.like&&i<8;i++)await move('down',.65);
  if(!s.controls.like||s.identity!==original.identity)throw Error('Bumble profile changed during review. Nothing was swiped.');
  this.reviewContext={identity:s.identity,screenKey:s.screenKey,context:{name:s.name,bio:[...contexts].filter(Boolean).join('\n').slice(0,12000),history:[]}};this.notify();return s;
 }
 async swipeBumble(kind,s,t,valid,commit){
  if(this.config.mode!=='like')throw Error('Bumble Compliment/comment automation is not verified. Choose plain Likes.');
  this.supported(s,['profile']);const control=kind==='like'?s.controls.like:s.controls.skip,direction=kind==='like'?'right':'left';
  if(control?.direction!==direction)throw Error('The Bumble swipe card is not verified.');
  await this.fresh(s,t,valid);this.lastAction={identity:s.identity,name:s.name,profileDiscriminator:s.profileDiscriminator||null};let issuedCount=0,confirmed=false,empty=false;
  const same=after=>after.kind===s.kind&&after.name===s.name&&after.identity===s.identity&&after.screenKey===s.screenKey;
  const budget=()=>this.session.status==='running'&&this.session.count+issuedCount<this.session.config.maxSwipes&&this.session.now()<this.session.endsAt;
  try{
   for(let attempt=0;attempt<2;attempt++){
    let issued=false;
    const onIssued=()=>{if(!issued){issued=true;issuedCount++}};
    await this.android.swipeProfile(direction,control.bounds,()=>{try{this.assert(t,valid);return true}catch{return false}},onIssued);onIssued();
    let stable=0,retrySafe=true,candidate=null,candidateReads=0;
    for(let i=0;i<5;i++){
     await this.wait(700,t.signal);this.assert(t,valid);const after=await this.read(t);this.assert(t,valid);
     if(after.kind==='swipeConfirm'&&after.swipeDirection===direction&&!confirmed){confirmed=true;retrySafe=false;await this.tap(after,after.controls.confirm,t,valid);continue;}
     if(after.kind==='profile'&&after.identity&&after.identity!==s.identity&&after.name!==s.name){this.lastAction=null;return this.snapshot()}
     if(distinctBumbleProfile(s,after)){
      const key=JSON.stringify([after.identity,after.profileDiscriminator]);candidateReads=key===candidate?candidateReads+1:1;candidate=key;retrySafe=false;
      if(candidateReads>=2){this.lastAction=null;return this.snapshot()}
     }else{candidate=null;candidateReads=0}
     if(after.kind==='empty'){empty=true;this.lastAction=null;return this.snapshot()}
     if(after.kind==='blocked')throw Error('Bumble action transition requires attention. '+after.reason);
     if(same(after))stable++;else{stable=0;retrySafe=false}
    }
    // Only the original card, stable across independent reads, permits one more input.
    // Any intervening dialog, unknown screen, or changed identity makes retry unsafe.
    if(attempt||confirmed||!retrySafe||stable<2||!budget())break;
    const beforeRetry=await this.fresh(s,t,valid);this.assert(t,valid);
    if(!same(beforeRetry)||!budget())break;
   }
   throw Error('Could not confirm the Bumble swipe transition. It will not be retried on this profile.');
  }finally{if(issuedCount){commit(issuedCount);if(empty)this.session.finish('no more profiles');for(let i=0;i<issuedCount;i++)await this.record(kind)}}
 }
 async identifyProfile(s,t,valid=()=>true){
  if(this.platform!=='hinge'||s.kind!=='profile'||s.identity||s.photos?.length||!s.name||!this.config.swipe.scrollProfile)return s;
  const name=s.name;
  for(let i=0;i<3&&!s.identity;i++){
   this.assert(t,valid);
   await this.android.scrollProfile({fraction:.45,duration:450,direction:'up'},()=>{try{this.assert(t,valid);return true}catch{return false}});
   await this.pauseFor(450,t);this.assert(t,valid);s=await this.read(t);this.assert(t,valid);
   if(s.kind!=='profile')throw Error('Profile evidence review interrupted: '+(s.reason||'Unrecognized screen.'));
   if(s.name!==name)throw Error('Profile changed during identity review.');
  }
  return s;
 }
 async review(t,sleep){
  if(this.platform==='bumble')return this.reviewBumble(t,sleep);
  this.reviewContext=null;this.selectedPhoto=null;await this.load(t);let s=await this.identifyProfile(await this.read(t),t);this.supported(s,['profile']);
  const name=s.name,contexts=new Set([s.context?.bio||'']);
  const move=async (fraction,direction='up')=>{
   if(this.config.swipe.browsePhotos)await this.pauseFor(1000*(this.config.swipe.minPhotoSeconds+this.random()*(this.config.swipe.maxPhotoSeconds-this.config.swipe.minPhotoSeconds)),t,sleep);
   this.assert(t);await this.android.scrollProfile({fraction,duration:Math.round(300+this.random()*400),direction},()=>{try{this.assert(t);return true}catch{return false}});this.assert(t);
   await this.pauseFor(450,t,sleep);s=await this.read(t);
   if(s.kind!=='profile')throw Error('Profile review interrupted: '+(s.reason||'The current screen is not a recognized profile.'));
   if(s.name!==name)throw Error('Profile changed during review.');contexts.add(s.context?.bio||'');
  };
  const n=this.config.swipe.scrollProfile?this.config.scrollMin+Math.floor(this.random()*(this.config.scrollMax-this.config.scrollMin+1)):0;
  for(let i=0;i<n;i++)await move(this.config.fractionMin+this.random()*(this.config.fractionMax-this.config.fractionMin));
  // Random depth selects a different part of the profile; small bounded adjustments expose a full photo.
  let candidates=(s.photos||[]).filter(p=>p.like);
  let direction='up';
  const reveal=()=>s.photos?.find(p=>['up','down'].includes(p.revealDirection))?.revealDirection;
  for(let i=0;!candidates.length&&this.config.swipe.scrollProfile&&i<6;i++){const before=s.screenKey;await move(s.photos?.length ? .2 : .55,reveal()||direction);candidates=(s.photos||[]).filter(p=>p.like);if(!candidates.length&&s.screenKey===before)direction=direction==='up'?'down':'up';}
  // Reaching a photo at the search boundary still permits two small alignment moves.
  for(let i=0;!candidates.length&&this.config.swipe.scrollProfile&&i<2&&reveal();i++){await move(.2,reveal());candidates=(s.photos||[]).filter(p=>p.like);}
  // Videos can keep the screen revision changing at the bottom of a profile.
  // Once forward search is exhausted, return toward earlier photos with a fixed budget.
  const returnToPhotos=!s.photos?.length;
  for(let i=0;!candidates.length&&returnToPhotos&&this.config.swipe.scrollProfile&&i<10;i++){
   await move(reveal() ? .2 : .6,reveal()||'down');
   candidates=(s.photos||[]).filter(p=>p.like);
  }
  if(!candidates.length)throw Error('No fully visible photo found within the review limit. Scroll manually and read again.');
  this.selectedPhoto=candidates[Math.min(candidates.length-1,Math.floor(this.random()*candidates.length))];
  this.reviewContext={identity:s.identity,screenKey:s.screenKey,context:{name,bio:[...contexts].filter(Boolean).join('\n').slice(0,12000),history:[]}};this.notify();return s;
 } async record(kind){await this.service.request('record',{kind,detail:this.platform==='hinge'?'Hinge desktop':'Bumble desktop'})}
 async transition(before,t,valid=()=>true,allowOffer=false){
  let offerHandled=false,evidenceChecked=false,last;
  for(let i=0;i<(allowOffer?6:3);i++){
   await this.wait(700,t.signal);this.assert(t,valid);let after=await this.read(t);this.assert(t,valid);
   if(!evidenceChecked&&after.kind==='profile'&&!after.identity&&after.name&&after.name!==before.name){evidenceChecked=true;after=await this.identifyProfile(after,t,valid);}
   last=after;
   if(after.kind==='likeOffer'&&allowOffer&&!offerHandled){
    offerHandled=true;if(this.lastAction)this.lastAction.offerKey=after.screenKey;
    await this.tap(after,after.controls.sendLike,t,valid);continue;
   }
   if((after.kind==='profile'||(before.kind!=='likeOffer'&&after.kind==='like'))&&after.identity&&after.name!==before.name){this.lastAction=null;return}
   if(after.kind==='conversation'&&after.identity!==before.identity){this.lastAction=null;return}
  }
  throw Error('Could not confirm the action transition. It will not be retried on this profile.'+(last?.reason?' '+last.reason:''));
 }
 async submitLike(screen,original,t,valid,commit){
  await this.fresh(screen,t,valid);this.assert(t,valid);
  this.lastAction={identity:original.identity,name:original.name,...(screen.kind==='likeOffer'?{offerKey:screen.screenKey}:{})};
  let issued=false;const onIssued=()=>{issued=true};
  try{
   await this.android.tapControl(screen.controls.sendLike.bounds,()=>{try{this.assert(t,valid);return true}catch{return false}},onIssued);onIssued();
   this.draft=null;this.assert(t,valid);await this.transition(original,t,valid,screen.kind!=='likeOffer');
  }finally{if(issued){commit();await this.record('like')}}
  return this.snapshot();
 }
 async act(kind,t,valid=()=>true,commit=()=>{},prepared){
  if(!['like','pass'].includes(kind))throw Error('Unknown mobile action.');await this.load(t);await this.consent(t);let s=prepared||await this.read(t);this.supported(s,kind==='like'?['profile','like','likeOffer']:['profile','like']);
  if(this.lastAction&&(this.lastAction.identity===s.identity||this.lastAction.name===s.name||(s.kind==='likeOffer'&&this.lastAction.offerKey===s.screenKey))){
   if(this.platform!=='bumble'||!distinctBumbleProfile(this.lastAction,s))throw Error('An action was already attempted on this profile. Its result is uncertain; change profiles manually before continuing.');
   // A late transition must be independently re-read before releasing its guard.
   s=await this.fresh(s,t,valid);if(!distinctBumbleProfile(this.lastAction,s))throw Error('Profile evidence changed; the previous action remains uncertain.');this.lastAction=null;
  }
  if(this.platform==='bumble')return this.swipeBumble(kind,s,t,valid,commit);
  if(s.kind==='likeOffer')return this.submitLike(s,s,t,valid,commit);
  const original=s,reviewContext=this.reviewContext?.identity===s.identity&&this.reviewContext.screenKey===s.screenKey?this.reviewContext.context:null;
  if(kind==='pass'){
   await this.fresh(s,t,valid);if(!s.controls.skip)throw Error('No supported Skip control.');this.lastAction={identity:s.identity,name:s.name};
   let issued=false;try{await this.finalTap(s.controls.skip,t,valid,()=>{issued=true},'pass');this.assert(t,valid);await this.transition(s,t,valid)}finally{if(issued)commit()}return this.snapshot();
  }
  if(s.kind==='profile'){
   const photo=this.selectedPhoto&&s.photos.find(p=>p.key===this.selectedPhoto.key)||s.photos?.filter(p=>p.like)[Math.floor(this.random()*(s.photos?.filter(p=>p.like).length||1))];
   if(!photo?.like)throw Error('No supported fully visible photo. Scroll or review again before liking.');this.selectedPhoto=photo;
   await this.tap(s,photo.like,t,valid);await this.pauseFor(900,t);s=await this.read(t);this.supported(s,['like']);
   for(let attempt=0;!s.controls.sendLike&&s.composerTextVerified===true&&attempt<2;attempt++){await this.pauseFor(750,t);s=await this.read(t);this.supported(s,['like']);}
   const samePhoto=photo.visual&&s.photos?.some(p=>hashDistance(photo.visual,p.visual)<=6||hashDistance(photo.visual,p.visualSquare)<=6);
   if(s.name!==original.name||(s.identity!==original.identity&&!samePhoto))throw Error('Could not verify the selected profile/photo in the Like confirmation.');
  }
  if(s.composerTextVerified===false)throw Error('The comment field cannot be verified. Nothing was sent.');
  if(s.composerText?.trim())throw Error('An existing comment is present. Review or clear it manually first.');
  if(this.config.mode==='comment'){
   if(!s.controls.comment)throw Error('Photo comments are unavailable on this screen or account.');const result=await this.service.request('generate',{context:reviewContext||s.context,options:this.options('Write a short comment about the supplied profile text. Do not describe unseen photo contents. Use printable ASCII, one line only, maximum 120 characters.')});this.assert(t,valid);const text=this.text(result.response,this.platform==='bumble'?150:120);
   this.draft={text,identity:s.identity,serial:t.serial,kind:'like',contextRevision:s.screenKey};await this.tap(s,s.controls.comment,t,valid);let field=await this.read(t);if(field.name!==s.name||field.composerText?.trim())throw Error('Comment field changed or contains unsent text.');if(!field.controls.composer)throw Error('Comment editor is not recognized. Type the draft manually.');await this.tap(field,field.controls.composer,t,valid);await this.android.type(text);this.assert(t,valid);s=await this.read(t);if(s.composerText!==text)throw Error('Inserted comment could not be verified. Nothing was sent.');
  }
  if(!s.controls.sendLike)throw Error(s.reason||'The ordinary Like confirmation is unsupported; no Like was sent.');return this.submitLike(s,original,t,valid,commit);
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
   if(action==='config'){if(this.session.status==='running')throw Error('Pause the session before editing its settings.');const next=Config.normalize(data,this.config);this.assert(t);await this.service.request('save',{mobileConfig:{[this.platform]:next}});this.assert(t);this.config=next;this.openerArmed=next.autoOpeners===true;return this.snapshot()}
   if(action==='review'){await this.review(t);return this.snapshot()}
   if(action==='start'){if(this.busy&&this.session.status==='running')throw Error('Session is already running.');await this.consent(t);let s=await this.read(t);if(this.platform==='bumble'){if(s.kind==='empty'){this.session.start(this.config.swipe);this.session.finish('no more profiles');return this.snapshot()}if(s.kind!=='profile')throw Error(s.reason||'Open Bumble People first.');if(this.config.mode!=='like')throw Error('Bumble comments are not verified. Choose plain Likes.');}else{s=await this.identifyProfile(s,t);this.supported(s,['profile']);}if(!this.visible&&!this.config.swipe.allowBackground)throw Error('Show the app before starting this session.');this.session.start(this.config.swipe);await this.record('session');this.openerArmed=this.config.autoOpeners===true;return this.snapshot()}
   if(action==='act')return this.act(data.kind,t);if(action==='generate')return this.generate(t);if(action==='insert')return this.insert(data,t);if(action==='send')return this.send(data,t);throw Error('Unknown mobile action.');
  });
 }
}
module.exports=MobileController;


