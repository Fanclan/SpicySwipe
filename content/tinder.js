/* Page access is deliberately scoped to Tinder controls outside the extension. */
(function(root){
  const C=root.SSCore;
  const visible=el=>el&&!el.disabled&&el.getClientRects().length>0&&!el.closest('#spicyswipe-root,[inert],[hidden],[aria-hidden="true"]');
  function first(selectors,unique=false){
    for(const selector of selectors){
      const elements=[...document.querySelectorAll(selector)];
      const found=elements.find(visible);
      if(found)return unique&&elements.some(el=>el!==found&&visible(el))?null:found;
    }
    return null;
  }
  const input=()=>first(['#chat-text-area','textarea[placeholder*="message" i]','textarea[placeholder*="Type" i]','textarea[aria-label*="message" i]']);
  const conversationId=()=>location.pathname.match(/^\/app\/messages\/([^/]+)/)?.[1]||null;
  const feedCheckInterval=300000;
  const cardRecheckInterval=15000;
  let settings,automaticDraft=null,lastCard=null,nextFeedRefreshAt=0,pendingFeedRefresh=null;
  const subscribers=new Set();
  const notify=()=>subscribers.forEach(fn=>fn({type:'page',data:snapshot()}));
  const rpc=SSClient.rpc;
  function context(){
    const id=conversationId();
    const history=[...document.querySelectorAll('[data-testid="message"], [class*="messageBubble"]')].filter(visible).slice(-16).map(el=>({text:el.textContent.trim().slice(0,1500)})).filter(m=>m.text);
    const heading=first(['[data-testid="chat-header"] h1','[data-testid="chat-header"] h2','main h1','main h2']);
    const card=currentCard();
    const bio=card?.querySelector('[class*="bio"]')?.textContent.trim().slice(0,2000)||'';
    return {conversationId:id,name:heading?.textContent.trim().slice(0,70)||'',bio,history,canMessage:Boolean(id&&input()),emptyConversationConfirmed:Boolean(id&&first(['[data-testid="empty-chat"]','[data-testid="chat-empty-state"]'])),page:location.pathname};
  }
  function snapshot(){return {connected:true,capabilities:{budgetGuard:1},context:context(),session:session.snapshot(),automaticDraft}}
  function requireConsent(){if(settings?.desktopActive===false)throw new Error('Return to the active Tinder workspace before using its controls.');if(!settings?.sidebarConsentGiven)throw new Error('Finish setup before using Tinder controls.')}
  function insertDraft(text,id){
    requireConsent();
    if(!id||id!==conversationId())throw new Error('This conversation changed. Refresh the context and generate a new draft.');
    if(typeof text!=='string'||!text.trim())throw new Error('Write a message first.');
    const el=input();if(!el)throw new Error('Open a conversation with a message box first.');
    const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;
    setter.call(el,text.trim());el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));el.focus();return el;
  }
  let sending=false;
  async function sendDraft(text,id){
    if(sending)throw new Error('A message is already being sent.');
    sending=true;try{return await sendDraftOnce(text,id)}finally{sending=false}
  }
  async function sendDraftOnce(text,id){
    const el=insertDraft(text,id);
    await new Promise(r=>setTimeout(r,100));
    requireConsent();if(id!==conversationId())throw new Error('Conversation changed. Message was not sent.');
    const form=el.closest('form');
    const scope=form||el.closest('[data-testid="chat"], [role="dialog"]');
    const send=[...(scope?.querySelectorAll('button[data-testid="send-message"],button[aria-label="Send" i],button[type="submit"]')||[])].find(visible);
    if(!send)throw new Error('Could not find the send button. Your draft is in Tinder; send it manually.');
    send.click();
    await new Promise(r=>setTimeout(r,350));
    if(el.value.trim())throw new Error('Tinder has not cleared the message box. Check the conversation before retrying.');
    await rpc('record',{kind:'message',detail:'Message submitted to Tinder'});return {ok:true};
  }
  function swipeButton(decision,unique=false){
    const selectors=decision==='like'?['button[data-testid="gamepad-like"]','button[aria-label="Like" i]','button[class*="gamepad-button"][class*="like"]:not([class*="super"])']:['button[data-testid="gamepad-nope"]','button[aria-label="Nope" i]','button[aria-label="Pass" i]','button[class*="gamepad-button"][class*="nope"]'];
    return first(selectors,unique);
  }
  // The cardsContainer/cards wrappers include queued profiles, not just the person on top.
  const currentCard=(unique=false)=>first(['[data-keyboard-gamepad="true"][aria-hidden="false"]','[data-testid="recs-card"]','[class*="recs-card"]','[class*="gamepad-card"]'],unique);
  function cardIdentity(card){
    const id=card.getAttribute('data-user-id')||card.getAttribute('data-profile-id');
    if(id)return {key:JSON.stringify(['id',id]),canRebind:true};
    const text=selector=>card.querySelector(selector)?.textContent.replace(/\s+/g,' ').trim()||'';
    const name=text('[itemprop="name"],[data-testid="profile-name"],h1,h2,h3');
    const age=text('[itemprop="age"],[data-testid="profile-age"]');
    // Bios, badges, photo URLs and captions change during review and cannot identify a person.
    return name?{key:JSON.stringify(['profile',name,age]),canRebind:Boolean(age)}:null;
  }
  function differsFromLastCard(key){
    if(key===lastCard)return false;
    const [previousKind,previousValue,previousAge]=JSON.parse(lastCard);
    const [kind,value,age]=JSON.parse(key);
    // A redraw can temporarily remove the account ID or the age from the same card.
    return kind===previousKind&&(value!==previousValue||Boolean(age&&previousAge&&age!==previousAge));
  }
  const matchMarker='[data-testid="match-overlay"],[class*="its-a-match-gradient"]';
  const messageFields='textarea,input[type="text"],input:not([type]),[contenteditable="true"]';
  function isMatchOverlay(el){
    return (el.matches(matchMarker)||el.querySelector(matchMarker))&&el.querySelector(messageFields)&&
      [...el.querySelectorAll('h1,h2,h3,[role="heading"]')].some(h=>/^you matched with\s+\S/i.test(h.textContent.trim()));
  }
  function matchOverlays(){
    const overlays=new Set();
    // Current Tinder match overlays have no dialog role. Start at their match artwork
    // and choose the smallest container with the match heading and message composer.
    for(const marker of document.querySelectorAll(matchMarker)){
      for(let el=marker;el&&!el.matches('main,body,html');el=el.parentElement){
        if(isMatchOverlay(el)){overlays.add(el);break}
      }
    }
    return [...overlays];
  }
  function currentDialog(){
    return [...document.querySelectorAll('[role="dialog"],[aria-modal="true"],[data-testid="match-overlay"]'),...matchOverlays()].find(el=>{
      if(!visible(el))return false;
      // Tinder can keep a dismissed portal mounted while CSS hides it or its wrapper.
      for(let node=el;node;node=node.parentElement){
        const style=getComputedStyle(node);
        if(style.display==='none'||style.visibility==='hidden'||style.visibility==='collapse')return false;
      }
      return true;
    })||null;
  }
  function promptDecline(dialog){
    if(isMatchOverlay(dialog)){
      const mc=settings.messagingConfig;
      if(mc.autoMessageOnMatch||mc.autoSend)return null;
      if([...dialog.querySelectorAll(messageFields)].some(el=>(el.value??el.textContent??'').trim()))return null;
      return [...dialog.querySelectorAll('button[title="Back to Tinder" i],button[aria-label="Back to Tinder" i],button[aria-label="Close" i]')]
        .find(el=>visible(el)&&el.getAttribute('aria-disabled')!=='true')||null;
    }
    const label=el=>(el.textContent||'').replace(/\s+/g,' ').trim();
    const titles=[...dialog.querySelectorAll('h1,h2,h3,[role="heading"]')].filter(visible).map(label);
    const buttons=[...dialog.querySelectorAll('button,[role="button"]')].filter(el=>visible(el)&&el.getAttribute('aria-disabled')!=='true');
    const prompts=[
      {title:/^upgrade your like!?$/i,accept:/^send super like$/i,decline:/^no thanks$/i},
      {title:/^add tinder to your home screen$/i,accept:/^add$/i,decline:/^not interested$/i}
    ];
    const prompt=prompts.find(p=>titles.some(title=>p.title.test(title))&&buttons.some(el=>p.accept.test(label(el))));
    return prompt?buttons.find(el=>prompt.decline.test(label(el)))||null:null;
  }
  function guardLocation(config){
    requireConsent();
    if(!/^\/app\/(recs|explore)(\/|$)/.test(location.pathname))throw new Error('Open Tinder Discover to continue this session.');
    if((settings?.desktopHost?settings.desktopVisible===false:document.hidden)&&!config.allowBackground)throw new Error('Tinder is in the background. Return to the tab or enable background sessions.');
  }
  async function guardPage(config,valid,sleep){
    if(!valid())return false;
    guardLocation(config);
    const dialog=currentDialog();
    if(dialog){
      const decline=promptDecline(dialog);
      if(!decline)throw new Error('A Tinder dialog needs attention. Close it and resume manually.');
      decline.click();
      // Wait for actual dismissal, not one fixed animation delay. Never click again.
      for(let attempt=0;attempt<20;attempt++){
        if(!await sleep(250,'reviewing'))return false;
        guardLocation(config);
        if(!currentDialog())return valid();
      }
      throw new Error('A Tinder dialog is still open after waiting for it to close. Close it and resume manually.');
    }
    return valid();
  }
  function refreshableFeed(){
    if(currentDialog()||first(['dialog[open]'])||automaticDraft||sending||autoBusy)return false;
    // A reload would discard a draft, including one in a collapsed composer.
    const editors=messageFields+',[role="textbox"],[contenteditable=""],[contenteditable="plaintext-only"]';
    return ![...document.querySelectorAll(editors)].some(el=>visible(el)||(el.value??el.textContent??'').trim());
  }
  function waitForFeed(card,identity){
    const now=Date.now();
    const phase=card?'waiting for next profile':'waiting for profiles';
    if(!nextFeedRefreshAt)nextFeedRefreshAt=now+feedCheckInterval;
    else if(now>=nextFeedRefreshAt){
      nextFeedRefreshAt=now+feedCheckInterval;
      if(SSClient.refreshEmpty&&(!card||(identity?.canRebind&&identity.key===lastCard))&&refreshableFeed()){
        pendingFeedRefresh={card,epoch:session.epoch,url:location.href,phase};
        SSClient.refreshEmpty(session.runId);
      }
    }
    const remaining=Math.max(1000,nextFeedRefreshAt-now);
    return {retryAfter:card?Math.min(cardRecheckInterval,remaining):remaining,phase};
  }
  const session=new SSSession({act:async(config,valid,commit,sleep)=>{
    pendingFeedRefresh=null;
    if(!await guardPage(config,valid,sleep))return;
    let card=currentCard();
    // A transition/loading gap may temporarily remove the initial card. No action has been issued yet.
    for(let attempt=0;!card&&attempt<20;attempt++){
      if(!await sleep(500,'reviewing')||!await guardPage(config,valid,sleep))return;
      card=currentCard();
    }
    // No card is available after the loading grace period. Observe again later; never
    // count a queue check as an action or change filters to manufacture more profiles.
    if(!card)return waitForFeed(null,null);
    const identity=cardIdentity(card);
    if(!identity&&!lastCard)throw new Error('Could not identify the visible profile. Check Tinder before continuing.');
    if(lastCard&&(!identity||!differsFromLastCard(identity.key)))return waitForFeed(card,identity);
    nextFeedRefreshAt=0;
    const check=async()=>{
      if(!await guardPage(config,valid,sleep))return false;
      const active=currentCard();
      if(!active||cardIdentity(active)?.key!==identity.key||(active!==card&&(card.isConnected||!identity.canRebind)))throw new Error('The profile changed during review. Check Tinder before continuing.');
      card=active;
      return true;
    };
    const dwell=()=>Math.round((config.minPhotoSeconds+Math.random()*(config.maxPhotoSeconds-config.minPhotoSeconds))*1000);
    if(config.browsePhotos&&config.maxPhotos>0){
      const advances=1+Math.floor(Math.random()*config.maxPhotos);
      for(let i=0;i<advances;i++){
        if(!await check())return;
        const next=[...card.querySelectorAll('button[data-testid="next-photo"],button[aria-label="Next photo" i],button[aria-label="Next picture" i],[role="button"][aria-label="Next photo" i]')].find(visible);
        if(!next)break;
        next.click();
        if(!await sleep(dwell(),'photos'))return;
      }
    }
    if(config.scrollProfile){
      if(!await check())return;
      const scroller=[card,...card.querySelectorAll('[data-testid="profile-scroll"],[class*="profileContent"],[class*="profile-content"]')].find(el=>visible(el)&&el.scrollHeight>el.clientHeight+20);
      if(scroller){
        const original=scroller.scrollTop;
        // Scroll only the profile's own overflow area, never the page or a message panel.
        scroller.scrollTop=Math.min(scroller.scrollHeight-scroller.clientHeight,original+scroller.clientHeight*(0.4+Math.random()*0.5));
        if(!await sleep(dwell(),'reading')||!await check())return;
        if(card.contains(scroller))scroller.scrollTop=original;
      }
    }
    if(!await check())return;
    const decision=Math.random()<config.likeRatio?'like':'pass';
    const button=swipeButton(decision);if(!button)throw new Error('No available swipe control. Check for a dialog, an empty queue, or your like limit.');
    button.click();lastCard=identity.key;commit();
    await rpc('record',{kind:decision,detail:decision==='like'?'Like submitted to Tinder':'Pass submitted to Tinder'});
  },changed:s=>{notify();if(s.status==='error')rpc('record',{kind:'error',detail:s.error}).catch(()=>{})}});
  function reloadCheckpoint(){return {session:session.checkpoint(),lastCard,nextFeedRefreshAt}}
  function prepareEmptyRefresh(runId){
    if(!runId||session.runId!==runId||!pendingFeedRefresh)return null;
    const request=pendingFeedRefresh;
    pendingFeedRefresh=null;
    if(session.epoch!==request.epoch||session.status!=='running'||session.phase!==request.phase||session.timeExpired()||
        session.nextActionAt-session.now()<1000||location.href!==request.url||
        currentCard()!==request.card||(request.card&&cardIdentity(request.card)?.key!==lastCard)||!refreshableFeed())return null;
    guardLocation(session.config);
    // The worker is waiting on its next feed check. Capturing here cannot interrupt
    // it if the host drops a stale request or a navigation is canceled.
    return reloadCheckpoint();
  }
  function prepareLocationReload(){
    if(!['running','paused'].includes(session.status))return null;
    const saved=reloadCheckpoint();
    session.pause();
    return saved;
  }
  function restoreLocationReload(saved){
    if(session.status!=='idle'||!['running','paused'].includes(saved?.session?.status)||!settings?.sidebarConsentGiven||
       !/^\/app\/(recs|explore)(\/|$)/.test(location.pathname))return;
    session.restore(saved.session);lastCard=saved.lastCard;nextFeedRefreshAt=saved.nextFeedRefreshAt||0;
    const hidden=settings.desktopHost?settings.desktopVisible===false:document.hidden;
    const dialog=currentDialog();
    if(saved.session.status==='running'&&session.status==='paused'&&settings.desktopActive!==false&&
       (!hidden||(session.config.allowBackground&&settings.swipeConfig.allowBackground))&&(!dialog||promptDecline(dialog)))session.start();
    else notify();
  }
  function requireStartBudget(data){
    const invalid='Invalid Tinder start budget guard.';
    if(!data||typeof data!=='object'||Array.isArray(data))throw Error(invalid);
    const options=Object.keys(data);
    if(!options.length)return;
    if(Object.hasOwn(data,'resumeRunId')){
      if(options.length!==2||!Object.hasOwn(data,'expectedCount')||typeof data.resumeRunId!=='string'||
          !/^[a-f0-9]{32}$/.test(data.resumeRunId)||!Number.isInteger(data.expectedCount)||data.expectedCount<0)throw Error(invalid);
      if(session.status!=='paused'||session.runId!==data.resumeRunId||session.count!==data.expectedCount)
        throw Error('The paused Tinder session changed.');
      return;
    }
    if(options.length!==1||options[0]!=='budgetGuard')throw Error(invalid);
    const guard=data.budgetGuard;
    const required=['previousStatus','previousRunId','previousCount','maxSwipes'];
    if(!guard||typeof guard!=='object'||Array.isArray(guard)||required.some(key=>!Object.hasOwn(guard,key))||
        Object.keys(guard).some(key=>!required.includes(key)&&key!=='allowPossibleRepeat')||
        (Object.hasOwn(guard,'allowPossibleRepeat')&&typeof guard.allowPossibleRepeat!=='boolean')||
        !Number.isInteger(guard.maxSwipes)||guard.maxSwipes<1||guard.maxSwipes>10000)throw Error(invalid);
    const {previousStatus,previousRunId,previousCount,maxSwipes}=guard;
    const fresh=previousStatus==='idle'&&previousRunId===null&&previousCount===0;
    const failed=previousStatus==='error'&&typeof previousRunId==='string'&&/^[a-f0-9]{32}$/.test(previousRunId)&&
      Number.isInteger(previousCount)&&previousCount>0;
    if(!fresh&&!failed)throw Error(invalid);
    if(session.status!==previousStatus||session.runId!==previousRunId||session.count!==previousCount||
        (fresh&&(session.epoch!==0||session.endsAt!==null)))throw Error('The Tinder predecessor changed.');
    if(failed&&(session.error!=='The profile has not changed. Check Tinder before continuing.'||!lastCard||
        guard.allowPossibleRepeat!==true||!Number.isInteger(session.config.maxSwipes)||
        maxSwipes>session.config.maxSwipes-session.count))throw Error('The Tinder predecessor does not permit this successor budget.');
    const sw=settings.swipeConfig,mc=settings.messagingConfig;
    if(sw.maxSwipes!==maxSwipes||sw.sessionMinutes!==null||sw.likeRatio!==1||sw.allowBackground!==true||
        mc?.autoMessageOnMatch!==false||mc.autoSend!==false)throw Error('Tinder settings changed. Check the successor budget and messaging settings.');
    const card=currentCard(true),like=swipeButton('like',true);
    if(!/^\/app\/recs\/?$/.test(location.pathname)||!card||!cardIdentity(card)?.canRebind||!like||
        getComputedStyle(card).visibility!=='visible'||getComputedStyle(like).visibility!=='visible'||
        getComputedStyle(like).pointerEvents==='none'||like.closest('[aria-disabled="true" i]')||
        !refreshableFeed())throw Error('Open an ordinary Tinder Discover profile before starting this successor.');
  }
  async function request(action,data={}){
    if(action==='context'){
      const result=snapshot();
      if(data&&Object.hasOwn(data,'budgetGuard')){
        try{requireConsent();requireStartBudget(data);result.guardedStartReady=true}
        catch{result.guardedStartReady=false}
      }
      return result;
    }
    if(action==='insert')return {ok:Boolean(insertDraft(data.text,data.conversationId))};
    if(action==='send')return sendDraft(data.text,data.conversationId);
    if(action==='start'){
      requireConsent();if(!/^\/app\/(recs|explore)(\/|$)/.test(location.pathname))throw new Error('Open Tinder Discover before starting a session.');
      requireStartBudget(data);
      if(!['paused','running'].includes(session.status)){lastCard=null;nextFeedRefreshAt=0;}
      session.start(settings.swipeConfig);
      const startedRunId=session.runId;
      await rpc('record',{kind:'session',detail:'Swipe session started'});
      if((data.budgetGuard||data.resumeRunId)&&session.runId!==startedRunId)throw Error('The Tinder successor changed before Start was acknowledged.');
      return snapshot();
    }
    if(action==='pause'){session.pause();await rpc('record',{kind:'pause',detail:'Swipe session paused'});return snapshot()}
    if(action==='stop'){session.stop();await rpc('record',{kind:'stop',detail:'Swipe session stopped'});return snapshot()}
    if(action==='discover'){location.href='https://tinder.com/app/recs';return {ok:true}}
    if(action==='dismissDraft'){automaticDraft=null;return snapshot()}
    throw new Error('Unknown Tinder action.');
  }
  const autoVisited=new Set();let autoBusy=false;
  async function observe(){
    notify();
    if(!settings?.sidebarConsentGiven||settings.desktopActive===false)return;
    const ctx=context();const mc=settings.messagingConfig;
    if(!mc.autoMessageOnMatch||!ctx.canMessage||!ctx.emptyConversationConfirmed||ctx.history.length||autoVisited.has(ctx.conversationId)||autoBusy)return;
    autoVisited.add(ctx.conversationId);autoBusy=true;
    try{
      const result=await rpc('generate',{context:ctx});
      if(ctx.conversationId!==conversationId()||!settings.sidebarConsentGiven||settings.desktopActive===false||!settings.messagingConfig.autoMessageOnMatch||context().history.length||!context().emptyConversationConfirmed)return;
      automaticDraft={...result,context:ctx};
      if(settings.messagingConfig.autoSend){await sendDraft(result.response,ctx.conversationId);automaticDraft=null}
      notify();
    }catch(error){rpc('record',{kind:'error',detail:error.message}).catch(()=>{})}finally{autoBusy=false}
  }
  async function init(){
    settings=await rpc('load');
    SSClient.subscribe(event=>{if(event.type==='settings'){settings=event.data;if(!settings.sidebarConsentGiven)session.stop();else if(settings.desktopActive===false||(settings.desktopHost&&settings.desktopVisible===false&&!session.config.allowBackground))session.pause();observe()}});
    let timer;new MutationObserver(records=>{
      if(records.every(r=>r.target.nodeType===1&&r.target.closest?.('#spicyswipe-root')))return;
      clearTimeout(timer);timer=setTimeout(observe,600);
    }).observe(document.body,{childList:true,subtree:true});
    document.addEventListener('visibilitychange',()=>{if((settings?.desktopHost?settings.desktopVisible===false:document.hidden)&&!session.config.allowBackground)session.pause()});
    window.addEventListener('pagehide',()=>session.stop());
    setInterval(()=>{if(location.pathname!==lastPath){lastPath=location.pathname;session.pause();observe()}},1000);
    observe();
  }
  let lastPath=location.pathname;
  root.SSTinder={init,context,request,snapshot,prepareLocationReload,prepareEmptyRefresh,restoreLocationReload,subscribe:fn=>{subscribers.add(fn);return()=>subscribers.delete(fn)}};
})(globalThis);
