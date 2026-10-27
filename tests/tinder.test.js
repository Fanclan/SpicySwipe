const {test}=require('node:test');const assert=require('node:assert/strict');const {JSDOM}=require('jsdom');const fs=require('node:fs');const C=require('../shared/core');
async function setup(t,html,options={}){
 const dom=new JSDOM(html,{url:options.url||'https://tinder.com/app/messages/A',runScripts:'outside-only',pretendToBeVisual:true});t.after(()=>dom.window.close());
 dom.window.HTMLElement.prototype.getClientRects=function(){return [{width:10,height:10}]};
 let state=C.publicSettings(C.migrate({sidebarConsentGiven:true,hasCompletedOnboarding:true,swipeConfig:options.config||{},messagingConfig:options.messaging||{}}));const calls=[];let subscriber;
 dom.window.SSClient={rpc:async(action,data)=>{calls.push({action,data});return state},subscribe:fn=>{subscriber=fn}};
 for(const file of ['shared/core.js','shared/session.js'])dom.window.eval(fs.readFileSync(file,'utf8'));
 if(options.wait){const Original=dom.window.SSSession;dom.window.SSSession=class extends Original {constructor(args){super({...args,wait:options.wait})}}}
 dom.window.eval(fs.readFileSync('content/tinder.js','utf8'));
 await dom.window.SSTinder.init();return {dom,api:dom.window.SSTinder,calls,update:patch=>{state={...state,...patch};subscriber({type:"settings",data:state})}};
}
test('inserting a draft rejects a different conversation identity',async t=>{
 const x=await setup(t,'<main><form><textarea id="chat-text-area"></textarea><button type="submit">Send</button></form></main>');
 await assert.rejects(x.api.request('insert',{text:'Hello A',conversationId:'B'}),/changed/);assert.equal(x.dom.window.document.querySelector('textarea').value,'');
});
test('send selects the composer form button, never another send control',async t=>{
 const x=await setup(t,'<button aria-label="Send" id="unrelated">Send unrelated</button><main><form><textarea id="chat-text-area"></textarea><button type="submit" id="actual">Send</button></form></main>');
 let wrong=0,right=0;x.dom.window.document.querySelector('#unrelated').onclick=()=>wrong++;
 x.dom.window.document.querySelector('#actual').onclick=e=>{e.preventDefault();right++;x.dom.window.document.querySelector('textarea').value=''};
 await x.api.request('send',{text:'Hello A',conversationId:'A'});assert.equal(wrong,0);assert.equal(right,1);
 assert.equal(x.calls.filter(c=>c.action==='record'&&c.data.kind==='message').length,1);
});
test('missing history selectors are not proof that a conversation is empty',async t=>{
 const x=await setup(t,'<main><form><textarea id="chat-text-area"></textarea></form></main>');
 assert.equal(x.api.context().emptyConversationConfirmed,false);
});
test('simultaneous send requests cannot duplicate a message',async t=>{
 const x=await setup(t,'<main><form><textarea id="chat-text-area"></textarea><button type="submit">Send</button></form></main>');let clicks=0;
 x.dom.window.document.querySelector('button').onclick=e=>{e.preventDefault();clicks++;x.dom.window.document.querySelector('textarea').value=''};
 const sends=await Promise.allSettled([x.api.request('send',{text:'Hi',conversationId:'A'}),x.api.request('send',{text:'Hi',conversationId:'A'})]);
 assert.equal(clicks,1);assert.equal(sends.filter(s=>s.status==='rejected').length,1);
});

const tick=()=>new Promise(r=>setImmediate(r));
const profile='<button aria-label="Next photo" id="outside">Unrelated</button><article data-testid="recs-card" data-user-id="person-a"><h2>Alex</h2><img src="https://example.test/1.jpg"><button aria-label="Next photo" id="photo">Next</button></article><button data-testid="gamepad-like" id="like">Like</button>';
async function swipeSetup(t,config={}){
 const waits=[];const x=await setup(t,profile,{url:'https://tinder.com/app/recs',config:{maxSwipes:2,delaySeconds:3,browsePhotos:true,maxPhotos:1,minPhotoSeconds:1,maxPhotoSeconds:1,likeRatio:1,...config},wait:()=>new Promise(r=>waits.push(r))});return {...x,waits};
}
test('photo review uses only controls in the current card and rejects an unchanged card after swiping',async t=>{
 const x=await swipeSetup(t);let photo=0,outside=0,likes=0;const d=x.dom.window.document;
 d.querySelector('#outside').onclick=()=>outside++;d.querySelector('#photo').onclick=()=>{photo++;d.querySelector('img').src='https://example.test/2.jpg'};d.querySelector('#like').onclick=()=>likes++;
 await x.api.request('start');x.waits.shift()();await tick();assert.equal(photo,1);assert.equal(likes,0);assert.equal(outside,0);
 x.waits.shift()();await tick();assert.equal(likes,1);x.waits.shift()();await tick();assert.equal(likes,1);assert.equal(x.api.snapshot().session.status,'error');
});
test('stop during photo dwell prevents the later swipe',async t=>{
 const x=await swipeSetup(t);let likes=0;x.dom.window.document.querySelector('#like').onclick=()=>likes++;
 await x.api.request('start');x.waits.shift()();await tick();assert.equal(x.api.snapshot().session.phase,'photos');await x.api.request('stop');x.waits.shift()();await tick();assert.equal(likes,0);assert.equal(x.api.snapshot().session.count,0);
});
test('a replacement profile during photo dwell is never swiped',async t=>{
 const x=await swipeSetup(t);let likes=0;x.dom.window.document.querySelector('#like').onclick=()=>likes++;
 await x.api.request('start');x.waits.shift()();await tick();x.dom.window.document.querySelector('article').dataset.userId='person-b';x.waits.shift()();await tick();assert.equal(likes,0);assert.equal(x.api.snapshot().session.status,'error');
});
test('a blocking dialog prevents photo and swipe actions',async t=>{
 const x=await swipeSetup(t);let clicks=0;for(const b of x.dom.window.document.querySelectorAll('button'))b.onclick=()=>clicks++;
 x.dom.window.document.body.insertAdjacentHTML('beforeend','<div role="dialog">Out of likes</div>');await x.api.request('start');x.waits.shift()();await tick();assert.equal(clicks,0);assert.equal(x.api.snapshot().session.status,'error');
});
test('hidden tabs run only when background operation is explicitly enabled',async t=>{
 for(const allowBackground of [false,true]){
  const x=await swipeSetup(t,{allowBackground,browsePhotos:false,maxSwipes:1});Object.defineProperty(x.dom.window.document,'hidden',{value:true,configurable:true});let clicks=0;x.dom.window.document.querySelector('#like').onclick=()=>clicks++;
  await x.api.request('start');x.waits.shift()();await tick();assert.equal(clicks,allowBackground?1:0);
 }
});
test('changing gallery images after an ignored swipe cannot bypass the duplicate-profile guard',async t=>{
 const x=await swipeSetup(t,{browsePhotos:false});let likes=0;x.dom.window.document.querySelector('#like').onclick=()=>likes++;
 await x.api.request('start');x.waits.shift()();await tick();assert.equal(likes,1);
 x.dom.window.document.querySelector('img').src='https://example.test/another-photo.jpg';x.waits.shift()();await tick();assert.equal(likes,1);assert.equal(x.api.snapshot().session.status,'error');
});
test('profile scrolling stays inside the card and returns before swiping',async t=>{
 const x=await swipeSetup(t,{browsePhotos:false,scrollProfile:true,maxSwipes:1});const card=x.dom.window.document.querySelector('article');Object.defineProperties(card,{scrollHeight:{value:1000},clientHeight:{value:200}});let clicks=0;x.dom.window.document.querySelector('#like').onclick=()=>{assert.equal(card.scrollTop,0);clicks++};
 await x.api.request('start');x.waits.shift()();await tick();assert.ok(card.scrollTop>0);assert.equal(x.api.snapshot().session.phase,'reading');assert.equal(clicks,0);x.waits.shift()();await tick();assert.equal(clicks,1);assert.equal(card.scrollTop,0);
});

const liveCard=(name,age,active)=>`<div data-keyboard-gamepad="true" aria-hidden="${!active}" ${active?'':'inert'}><div aria-label="${name}'s photos"><button aria-label="Next Photo">Next</button></div><button><span class="activity">Recently Active</span><span itemprop="name">${name}</span><span itemprop="age">${age}</span><span class="bio">About me</span></button></div>`;
async function stackSetup(t){
 const waits=[];
 const x=await setup(t,`<div class="recsCardboard__cardsContainer"><div class="recsCardboard__cards">${liveCard('Taylor',28,false)}${liveCard('Alex',25,true)}</div></div><button data-testid="gamepad-like" id="like">Like</button>`,{url:'https://tinder.com/app/recs',config:{maxSwipes:2,delaySeconds:3,browsePhotos:true,maxPhotos:1,minPhotoSeconds:1,maxPhotoSeconds:1,likeRatio:1},wait:()=>new Promise(r=>waits.push(r))});
 return {...x,waits};
}
test('current Tinder stack reviews only the active card and ignores changing details',async t=>{
 const x=await stackSetup(t),d=x.dom.window.document;let hiddenPhotos=0,photos=0,likes=0;
 d.querySelector('[inert] button').onclick=()=>hiddenPhotos++;
 d.querySelector('[aria-hidden="false"] button').onclick=()=>photos++;
 d.querySelector('#like').onclick=()=>likes++;
 await x.api.request('start');x.waits.shift()();await tick();
 assert.equal(photos,1);assert.equal(hiddenPhotos,0);assert.equal(likes,0);
 d.querySelector('[aria-hidden="false"] .activity').textContent='Active now';
 d.querySelector('[aria-hidden="false"] .bio').textContent='A newly loaded detail';
 d.querySelector('[inert] [itemprop="name"]').textContent='Someone else';
 x.waits.shift()();await tick();assert.equal(likes,1);
 d.querySelector('[aria-hidden="false"] .bio').textContent='Another photo caption';
 x.waits.shift()();await tick();assert.equal(likes,1);assert.match(x.api.snapshot().session.error,/has not changed/);
});
test('a redraw of the same identified card continues review using its new controls',async t=>{
 const x=await swipeSetup(t,{maxPhotos:2,maxSwipes:1});const d=x.dom.window.document;let photos=0,likes=0;
 x.dom.window.Math.random=()=>0.9;
 d.querySelector('#photo').onclick=()=>{photos++;const old=d.querySelector('article'),replacement=old.cloneNode(true);replacement.querySelector('#photo').onclick=()=>photos++;old.replaceWith(replacement)};
 d.querySelector('#like').onclick=()=>likes++;
 await x.api.request('start');x.waits.shift()();await tick();assert.equal(photos,1);
 x.waits.shift()();await tick();assert.equal(photos,2);
 x.waits.shift()();await tick();assert.equal(likes,1);assert.equal(x.api.snapshot().session.status,'complete');
});
test('an active-card switch is rejected even if the old card stays in the stack',async t=>{
 const x=await stackSetup(t),d=x.dom.window.document;let likes=0;d.querySelector('#like').onclick=()=>likes++;
 await x.api.request('start');x.waits.shift()();await tick();
 const active=d.querySelector('[aria-hidden="false"]'),queued=d.querySelector('[inert]');
 active.setAttribute('aria-hidden','true');active.setAttribute('inert','');queued.removeAttribute('inert');queued.setAttribute('aria-hidden','false');
 x.waits.shift()();await tick();assert.equal(likes,0);assert.match(x.api.snapshot().session.error,/changed during review/);
});
test('cards without stable identity cannot trigger a swipe',async t=>{
 const x=await swipeSetup(t,{browsePhotos:false});const d=x.dom.window.document;let likes=0;
 d.querySelector('article').removeAttribute('data-user-id');d.querySelector('h2').remove();d.querySelector('#like').onclick=()=>likes++;
 await x.api.request('start');x.waits.shift()();await tick();assert.equal(likes,0);assert.equal(x.api.snapshot().session.status,'error');
});
test('semantic name and age survive a card redraw without an exposed user ID',async t=>{
 const x=await stackSetup(t),d=x.dom.window.document;let likes=0;d.querySelector('#like').onclick=()=>likes++;
 await x.api.request('start');x.waits.shift()();await tick();
 const card=d.querySelector('[aria-hidden="false"]'),replacement=card.cloneNode(true);replacement.querySelector('.bio').textContent='New photo caption';card.replaceWith(replacement);
 x.waits.shift()();await tick();assert.equal(likes,1);
});
test('switching to a queued card with the same name and age still stops review',async t=>{
 const x=await stackSetup(t),d=x.dom.window.document;let likes=0;d.querySelector('#like').onclick=()=>likes++;
 const active=d.querySelector('[aria-hidden="false"]'),queued=d.querySelector('[inert]');
 queued.querySelector('[itemprop="name"]').textContent='Alex';queued.querySelector('[itemprop="age"]').textContent='25';
 await x.api.request('start');x.waits.shift()();await tick();
 active.setAttribute('aria-hidden','true');active.setAttribute('inert','');queued.removeAttribute('inert');queued.setAttribute('aria-hidden','false');
 x.waits.shift()();await tick();assert.equal(likes,0);assert.match(x.api.snapshot().session.error,/changed during review/);
});

function upgradePrompt(d,{title='Upgrade Your Like!',disabled=false}={}){
 const dialog=d.createElement('div');dialog.setAttribute('role','dialog');
 dialog.innerHTML=`<h2>${title}</h2><p>You just liked a popular profile.</p><button id="super-like">Send Super Like</button><button id="no-thanks" ${disabled?'disabled':''}><span>No Thanks</span></button>`;
 d.body.append(dialog);return dialog;
}
test('declines the like-upgrade offer before reviewing the next profile',async t=>{
 const x=await swipeSetup(t,{browsePhotos:false}),d=x.dom.window.document;let likes=0,declines=0,upgrades=0;
 d.querySelector('#like').onclick=()=>{likes++;if(likes===1){const dialog=upgradePrompt(d);dialog.querySelector('#super-like').onclick=()=>upgrades++;dialog.querySelector('#no-thanks').onclick=()=>{declines++;dialog.remove();d.querySelector('article').dataset.userId='person-b'}}};
 await x.api.request('start');x.waits.shift()();await tick();assert.equal(likes,1);
 x.waits.shift()();await tick();assert.equal(declines,1);assert.equal(likes,1);
 x.waits.shift()();await tick();assert.equal(likes,2);assert.equal(upgrades,0);assert.equal(x.api.snapshot().session.count,2);
});
test('a like-upgrade prompt during photo review is dismissed without changing the reviewed person',async t=>{
 const x=await swipeSetup(t,{maxSwipes:1}),d=x.dom.window.document;let likes=0,declines=0;
 d.querySelector('#like').onclick=()=>likes++;
 await x.api.request('start');x.waits.shift()();await tick();
 const dialog=upgradePrompt(d);dialog.querySelector('#no-thanks').onclick=()=>{declines++;dialog.remove()};
 x.waits.shift()();await tick();assert.equal(declines,1);assert.equal(likes,0);
 x.waits.shift()();await tick();assert.equal(likes,1);
});
test('unrecognized dialogs and disabled decline controls remain blocking',async t=>{
 for(const options of [{title:'Enable notifications'},{disabled:true}]){
  const x=await swipeSetup(t,{browsePhotos:false}),d=x.dom.window.document;let clicks=0;
  const dialog=upgradePrompt(d,options);for(const b of d.querySelectorAll('button'))b.onclick=()=>clicks++;
  await x.api.request('start');x.waits.shift()();await tick();assert.equal(clicks,0);assert.equal(x.api.snapshot().session.status,'error');assert.ok(dialog.isConnected);
 }
});
test('a stuck upgrade dialog is clicked once and stops the session without a swipe',async t=>{
 const x=await swipeSetup(t,{browsePhotos:false}),d=x.dom.window.document;let likes=0,declines=0;
 const dialog=upgradePrompt(d);dialog.querySelector('#no-thanks').onclick=()=>declines++;d.querySelector('#like').onclick=()=>likes++;
 await x.api.request('start');x.waits.shift()();await tick();assert.equal(declines,1);
 for(let i=0;i<40&&x.api.snapshot().session.status==='running';i++){assert.ok(x.waits.length);x.waits.shift()();await tick()}
 assert.equal(declines,1);assert.equal(likes,0);assert.equal(x.api.snapshot().session.status,'error');
});
test('stopping while an upgrade dialog closes prevents the next swipe',async t=>{
 const x=await swipeSetup(t,{browsePhotos:false}),d=x.dom.window.document;let likes=0,declines=0;
 const dialog=upgradePrompt(d);dialog.querySelector('#no-thanks').onclick=()=>{declines++;dialog.remove()};d.querySelector('#like').onclick=()=>likes++;
 await x.api.request('start');x.waits.shift()();await tick();assert.equal(declines,1);
 await x.api.request('stop');x.waits.shift()();await tick();assert.equal(likes,0);assert.equal(x.api.snapshot().session.count,0);
});
test('declining an upgrade cannot bypass the identity check during review',async t=>{
 const x=await swipeSetup(t),d=x.dom.window.document;let likes=0;d.querySelector('#like').onclick=()=>likes++;
 await x.api.request('start');x.waits.shift()();await tick();
 const dialog=upgradePrompt(d);dialog.querySelector('#no-thanks').onclick=()=>{dialog.remove();d.querySelector('article').dataset.userId='person-b'};
 x.waits.shift()();await tick();x.waits.shift()();await tick();assert.equal(likes,0);assert.match(x.api.snapshot().session.error,/changed during review/);
});

function homeScreenPrompt(d,title='Add Tinder to your Home Screen'){
 const dialog=d.createElement('div');dialog.setAttribute('role','dialog');
 dialog.innerHTML=`<h2>${title}</h2><p>Get Tinder easily and quickly by adding it to your Home Screen</p><button id="add-home">Add</button><button id="decline-home"><span>Not interested</span></button>`;
 d.body.append(dialog);return dialog;
}
test('declines the home-screen offer using only its own Not interested button',async t=>{
 const x=await swipeSetup(t,{browsePhotos:false,maxSwipes:1}),d=x.dom.window.document;let likes=0,declines=0,adds=0,outside=0;
 const unrelated=d.createElement('button');unrelated.textContent='Not interested';unrelated.onclick=()=>outside++;d.body.prepend(unrelated);
 const dialog=homeScreenPrompt(d,'Add Tinder to your\n Home Screen');dialog.querySelector('#add-home').onclick=()=>adds++;
 dialog.querySelector('#decline-home').onclick=()=>{declines++;dialog.remove()};d.querySelector('#like').onclick=()=>likes++;
 await x.api.request('start');x.waits.shift()();await tick();assert.equal(declines,1);assert.equal(likes,0);
 x.waits.shift()();await tick();assert.equal(likes,1);assert.equal(adds,0);assert.equal(outside,0);assert.equal(x.api.snapshot().session.count,1);
});
test('Not interested in an unrelated dialog is never auto-clicked',async t=>{
 const x=await swipeSetup(t,{browsePhotos:false}),d=x.dom.window.document;let clicks=0;
 homeScreenPrompt(d,'Try a different feature');for(const b of d.querySelectorAll('button'))b.onclick=()=>clicks++;
 await x.api.request('start');x.waits.shift()();await tick();assert.equal(clicks,0);assert.equal(x.api.snapshot().session.status,'error');
});
test('home-screen offers with unavailable or missing controls stay blocking',async t=>{
 for(const state of ['disabled','aria-disabled','missing-add']){
  const x=await swipeSetup(t,{browsePhotos:false}),d=x.dom.window.document;let clicks=0;const dialog=homeScreenPrompt(d);
  if(state==='missing-add')dialog.querySelector('#add-home').remove();else dialog.querySelector('#decline-home').setAttribute(state,'true');
  for(const b of d.querySelectorAll('button'))b.onclick=()=>clicks++;
  await x.api.request('start');x.waits.shift()();await tick();assert.equal(clicks,0);assert.equal(x.api.snapshot().session.status,'error');
 }
});

test('a slow dialog dismissal continues polling without another click or an early swipe',async t=>{
 const x=await swipeSetup(t,{browsePhotos:false,maxSwipes:1}),d=x.dom.window.document;let declines=0,likes=0;
 const dialog=homeScreenPrompt(d);dialog.querySelector('#decline-home').onclick=()=>declines++;d.querySelector('#like').onclick=()=>likes++;
 await x.api.request('start');x.waits.shift()();await tick();assert.equal(declines,1);
 for(let i=0;i<5;i++){x.waits.shift()();await tick();assert.equal(x.api.snapshot().session.status,'running');assert.equal(likes,0)}
 dialog.remove();x.waits.shift()();await tick();assert.equal(likes,1);assert.equal(declines,1);
});
test('CSS-hidden dialog remnants do not block the next swipe',async t=>{
 for(const hide of ['visibility','display','ancestor']){
  const x=await swipeSetup(t,{browsePhotos:false,maxSwipes:1}),d=x.dom.window.document;let likes=0;
  const dialog=homeScreenPrompt(d);dialog.querySelector('#decline-home').onclick=()=>{
   if(hide==='ancestor'){const wrapper=d.createElement('div');dialog.replaceWith(wrapper);wrapper.append(dialog);wrapper.style.visibility='hidden'}
   else dialog.style[hide]=hide==='display'?'none':'hidden';
  };d.querySelector('#like').onclick=()=>likes++;
  await x.api.request('start');x.waits.shift()();await tick();x.waits.shift()();await tick();assert.equal(likes,1);assert.ok(dialog.isConnected);
 }
});
test('a different visible dialog after dismissal still blocks swiping',async t=>{
 const x=await swipeSetup(t,{browsePhotos:false}),d=x.dom.window.document;let likes=0;
 const dialog=homeScreenPrompt(d);dialog.querySelector('#decline-home').onclick=()=>{dialog.remove();upgradePrompt(d,{title:'Out of likes'})};d.querySelector('#like').onclick=()=>likes++;
 await x.api.request('start');x.waits.shift()();await tick();
 for(let i=0;i<40&&x.api.snapshot().session.status==='running';i++){assert.ok(x.waits.length);x.waits.shift()();await tick()}
 assert.equal(likes,0);assert.equal(x.api.snapshot().session.status,'error');
});

function matchPrompt(d){
 const overlay=d.createElement('section');overlay.innerHTML='<div class="Bg($its-a-match-gradient)"></div><div><h1>You matched with Alex</h1><textarea placeholder="Say something nice!"></textarea><button aria-label="Send message">Send</button><button aria-label="Wave">👋</button></div><div><button title="Back to Tinder"><span class="Hidden">Close</span></button></div><div role="dialog" aria-modal="true" style="visibility:hidden">Hidden sheet</div>';
 d.body.append(overlay);return overlay;
}
async function matchSetup(t,messaging={}){
 const waits=[];const x=await setup(t,profile,{url:'https://tinder.com/app/recs',messaging,config:{maxSwipes:1,browsePhotos:false,likeRatio:1,delaySeconds:3},wait:()=>new Promise(r=>waits.push(r))});
 return {...x,waits};
}
test('closes an unmarked match overlay when automatic messaging is off',async t=>{
 const x=await matchSetup(t),d=x.dom.window.document;let closed=0,likes=0,messages=0;
 const overlay=matchPrompt(d);overlay.querySelector('[title="Back to Tinder"]').onclick=()=>{closed++;overlay.remove()};
 for(const b of overlay.querySelectorAll('[aria-label]'))b.onclick=()=>messages++;
 d.querySelector('#like').onclick=()=>likes++;
 await x.api.request('start');x.waits.shift()();await tick();assert.equal(closed,1);assert.equal(likes,0);
 x.waits.shift()();await tick();assert.equal(likes,1);assert.equal(messages,0);assert.equal(x.api.snapshot().session.count,1);
});
test('match overlays remain open when automatic drafting or sending is enabled',async t=>{
 for(const messaging of [{autoMessageOnMatch:true},{autoSend:true},{autoMessageOnMatch:true,autoSend:true}]){
  const x=await matchSetup(t,messaging),d=x.dom.window.document;let clicks=0;const overlay=matchPrompt(d);
  for(const b of d.querySelectorAll('button'))b.onclick=()=>clicks++;
  await x.api.request('start');x.waits.shift()();await tick();assert.equal(clicks,0);assert.ok(overlay.isConnected);assert.equal(x.api.snapshot().session.status,'error');
 }
});
test('a match with an unsent message is preserved',async t=>{
 const x=await matchSetup(t),d=x.dom.window.document;let clicks=0;const overlay=matchPrompt(d);overlay.querySelector('textarea').value='Hi Alex';
 for(const b of d.querySelectorAll('button'))b.onclick=()=>clicks++;
 await x.api.request('start');x.waits.shift()();await tick();assert.equal(clicks,0);assert.equal(overlay.querySelector('textarea').value,'Hi Alex');assert.equal(x.api.snapshot().session.status,'error');
});
test('a match overlay without an available close control blocks swiping',async t=>{
 for(const disabled of [false,true]){
  const x=await matchSetup(t),d=x.dom.window.document;let likes=0;const overlay=matchPrompt(d),close=overlay.querySelector('[title]');
  if(disabled)close.disabled=true;else close.remove();d.querySelector('#like').onclick=()=>likes++;
  await x.api.request('start');x.waits.shift()();await tick();assert.equal(likes,0);assert.equal(x.api.snapshot().session.status,'error');
 }
});

test('desktop platform inactivity preserves paused session deadline and blocks controls',async t=>{
 const x=await swipeSetup(t,{browsePhotos:false});let clicks=0;x.dom.window.document.querySelector('#like').onclick=()=>clicks++;
 await x.api.request('start');const before=x.api.snapshot().session;
 x.update({desktopActive:false});const paused=x.api.snapshot().session;
 assert.equal(paused.status,'paused');assert.equal(paused.endsAt,before.endsAt);assert.equal(paused.count,before.count);
 await assert.rejects(x.api.request('start'),/active Tinder/);
 x.waits.shift()();await tick();assert.equal(clicks,0);
 x.update({desktopActive:true});assert.equal(x.api.snapshot().session.status,'paused');
 await x.api.request('start');assert.equal(x.api.snapshot().session.endsAt,before.endsAt);
});

test('desktop child view hiding does not pause Tinder while its host remains visible',async t=>{
 const x=await swipeSetup(t);x.update({desktopHost:true,desktopVisible:true,desktopActive:true});
 Object.defineProperty(x.dom.window.document,'hidden',{value:true,configurable:true});x.dom.window.document.dispatchEvent(new x.dom.window.Event('visibilitychange'));
 await x.api.request('start');await tick();assert.equal(x.api.snapshot().session.status,'running');
 x.update({desktopHost:true,desktopVisible:false});assert.equal(x.api.snapshot().session.status,'paused');await x.api.request('stop');
});
