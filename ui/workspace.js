(function(root){
 const C=SSCore,I=SSIcons;
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const title=s=>s.charAt(0).toUpperCase()+s.slice(1);
 const views={overview:['Your workspace','A little spark. A better connection.'],messages:['Messages','Find the words. Keep your voice.'],swiping:['Swiping','Your pace. Your preferences.'],activity:['Activity','A clear view of your progress.'],settings:['Settings','Make this workspace yours.']};
 const button=(label,action,icon,kind='secondary',attrs='')=>`<button class="btn ${kind}" data-action="${action}" ${attrs}>${icon?I(icon):''}<span>${label}</span></button>`;
 const empty=(icon,heading,text)=>`<div class="empty-state">${I(icon)}<h3>${heading}</h3><p>${text}</p></div>`;
 async function mount(target,bridge){
  let state=await bridge.load(),view='overview',page={connected:false,context:{},session:{status:'idle',count:0,limit:30}},context={},draft='',draftMeta='',busy=false,models=[],settingsProvider=state.activeAI;
  let toastTimer,polling=false,disposed=false,lastAutoDraft=null,draftContext={},messageInputs={},discoveryEpoch=0;
  target.innerHTML=`<div class="ss-app" data-theme="${state.theme}"><div class="workspace-shell">
   <aside class="nav-rail"><a class="brand" href="#overview" data-view="overview"><span class="brand-mark">${I('bolt')}</span><span>spicy<span class="brand-light">swipe</span><small>YOUR DATING COPILOT</small></span></a>
    <span class="nav-label">WORKSPACE</span><nav aria-label="Workspace navigation">${Object.keys(views).map((v,i)=>`<button class="nav-item ${i===0?'selected':''}" data-view="${v}" aria-label="${title(v)}">${I({overview:'home',messages:'message',swiping:'swipe',activity:'activity',settings:'settings'}[v])}<span>${title(v)}</span>${v==='messages'?'<span class="nav-new">AI</span>':''}</button>`).join('')}</nav>
    <div class="rail-bottom"><div class="local-note">${I('shield')}<div><strong>Your space. Your control.</strong><p>Settings stay on this device.</p></div></div><div class="rail-version"><span class="tiny-logo">S</span> SpicySwipe <span class="version">${esc(bridge.version||'3.0')}</span></div></div>
   </aside>
   <div class="workspace-body"><header class="topbar"><div class="breadcrumb">Workspace ${I('chevron')} <strong id="crumb">Overview</strong></div><div class="top-actions"><span id="connection" class="connection"><span class="dot"></span> Tinder not connected</span><button class="icon-btn" data-action="theme" aria-label="Toggle color theme">${I('moon')}</button>${bridge.compact?`<button class="icon-btn" data-action="close" aria-label="Close sidebar">${I('close')}</button>`:`<span class="avatar">S</span>`}</div></header>
    ${bridge.preview?'<div class="preview-banner">INTERACTIVE PREVIEW <span>Sample activity · no Tinder actions or AI calls</span></div>':''}
    <main class="main"><div class="page-heading"><div><span class="eyebrow">A LITTLE MORE YOU</span><h1 id="page-title">Your workspace<span class="heading-dot">.</span></h1><p id="page-subtitle">A little spark. A better connection.</p></div><div id="heading-action"></div></div><div id="view-content"></div><footer class="workspace-footer"><span>${I('leaf')} Less overthinking. More connecting.</span><span>Made for real conversations.</span></footer></main>
   </div></div><div class="toast" role="status" aria-live="polite" hidden></div><div class="modal-layer" hidden></div></div>`;
  const app=target.querySelector('.ss-app'),$=s=>target.querySelector(s),content=$('#view-content');
  function toast(message,error=false){const el=$('.toast');el.textContent=message;el.classList.toggle('error',error);el.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.hidden=true,error?8000:4500)}
  function metrics(){const s=state.sessionAnalytics.date===C.today()?state.sessionAnalytics:C.counts();return `<div class="metric-grid">${[['swipe','Swipes today',s.swipes,'A pace that works for you'],['heart','Likes today',s.likes,'A chance to connect'],['spark','AI drafts',s.drafts,'A starting point, in your voice'],['send','Messages sent',s.messages,'Submitted through SpicySwipe']].map(([icon,label,n,note])=>`<article class="metric"><div class="metric-label">${label}${I(icon)}</div><strong>${Number(n)||0}</strong><span>${note}</span></article>`).join('')}</div>`}
  function modelCard(){const p=C.providers[state.activeAI],ready=state.credentials?.[state.activeAI];return `<article class="panel model-panel"><div class="section-heading"><h2>Your AI connection</h2><span class="mini-label">${state.activeAI==='ollama'?'LOCAL':'CLOUD'}</span></div><div class="provider-summary"><span class="provider-mark ${state.activeAI}">${p.mark}</span><div><strong>${p.name}</strong><span>${esc(state.models[state.activeAI]||'Choose a model')}</span></div></div><div class="status-note"><span class="dot ${ready?'green':''}"></span>${ready?'Configured · test in Settings':'Add a key to get started'}</div><p>${p.note}</p>${button('Manage connection','settings','arrow','text')}</article>`}
  function eventRows(limit=5){const events=state.activity.slice(0,limit);if(!events.length)return empty('activity','Your story starts here','Draft a message or start a session. Your activity will appear here.');return `<div class="event-list">${events.map(e=>`<div class="event-row"><span class="event-icon ${esc(e.kind)}">${I({draft:'spark',message:'send',like:'heart',pass:'swipe',session:'play',pause:'pause',stop:'stop',error:'info'}[e.kind]||'activity')}</span><div><strong>${esc({draft:'A little inspiration',message:'Message sent',like:'A new like',pass:'Passed a profile',session:'Session started',pause:'Taking a breather',stop:'Session stopped',error:'Needs your attention'}[e.kind]||'Workspace activity')}</strong><p>${esc(e.detail)}</p></div><time>${new Date(e.time).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}</time></div>`).join('')}</div>`}
  function overview(){return `<section class="hero"><div class="hero-copy"><span class="hero-tag">${I('spark')} A LITTLE HELP. A LOT OF YOU.</span><h2>More connection.<br><em>Less overthinking.</em></h2><p>Break the ice, find your rhythm, and let your personality do the rest.</p><div class="hero-actions">${button('Find my words','messages','spark','primary')}${button('Start a session','swiping','arrow','hero-secondary')}</div></div><div class="hero-art" aria-hidden="true"><div class="orbit orbit-one"></div><div class="orbit orbit-two"></div><div class="art-star star-one">✳</div><div class="art-star star-two">✧</div><div class="art-bubble bubble-back">${I('heart')}</div><div class="art-bubble bubble-front">${I('message')}<span>hey, you.</span></div><span class="art-caption">good things start with hello</span></div></section>
   <div id="metrics">${metrics()}</div>
   <div class="overview-columns"><div class="primary-column"><div class="section-heading"><h2>Make your next move</h2><span class="muted">Two ways to get going</span></div><div class="workflow-grid"><article class="workflow-card"><span class="feature-icon peach">${I('message')}</span><span class="mini-label">YOUR CONVERSATION COPILOT</span><h3>A better first hello.</h3><p>Turn a profile detail into a message that sounds like you.</p><div class="card-bottom">${button('Open messages','messages','arrow','text')}<span class="subtle-tag">AI assisted</span></div></article><article class="workflow-card"><span class="feature-icon sage">${I('swipe')}</span><span class="mini-label">A SESSION ON YOUR TERMS</span><h3>Find your rhythm.</h3><p>Set a comfortable pace, choose your limits, and stay in control.</p><div class="card-bottom">${button('Open swiping','swiping','arrow','text')}<span class="subtle-tag">Your pace</span></div></article></div><article class="panel recent-panel"><div class="section-heading"><h2>Recent activity</h2>${button('View all','activity','arrow','text')}</div><div id="recent-events">${eventRows(3)}</div></article></div><div class="secondary-column"><div id="model-card">${modelCard()}</div><article class="tip-card"><span class="tip-label">${I('spark')} A SMALL SPARK</span><blockquote>Be curious.<br>Be specific.<br><em>Be yourself.</em></blockquote><p>The best opener starts with something you actually want to know.</p><div class="tip-line"></div><span>A little intention goes a long way.</span></article></div></div>`}
  function messages(){const mc=state.messagingConfig;return `<div class="editor-layout"><section class="panel composer"><div class="section-heading"><h2>${I('message')} Your next message</h2><span class="subtle-tag">Review before sending</span></div><div class="context-banner"><span class="context-avatar">${I('heart')}</span><div><strong id="context-name">${esc(context.name||'No conversation selected')}</strong><span id="context-status">${context.canMessage?'Context from your open Tinder conversation':'Open a match on Tinder, then refresh context.'}</span></div><button class="icon-btn" data-action="refreshContext" aria-label="Refresh conversation context">${I('refresh')}</button></div>
   <form id="message-form"><div class="form-row"><label>Tone<select name="tone">${C.tones.map(t=>`<option ${mc.tone===t?'selected':''} value="${t}">${title(t)}</option>`).join('')}</select></label><label>Language<select name="language">${Object.entries(C.languages).map(([id,l])=>`<option value="${id}" ${mc.language===id?'selected':''}>${l}</option>`).join('')}</select></label><label>Length<select name="length"><option value="short" ${mc.length==='short'?'selected':''}>Short & sweet</option><option value="medium" ${mc.length==='medium'?'selected':''}>A little more</option></select></label></div><label>A little context <span class="optional">optional</span><textarea name="instruction" rows="3" maxlength="1200" placeholder="They love hiking. Ask about their favorite trail…"></textarea></label><div class="composer-note">${I('shield')} Only the context you provide and the detected conversation go to your selected AI.</div>${button(busy?'Finding your words…':'Generate a draft','generate','spark','primary wide',busy?'disabled':'')}</form>
   <div class="draft-section"><div class="section-heading"><h3>Your draft</h3><span id="draft-count">${draft.length} characters</span></div><label class="sr-only" for="draft-text">Edit your message</label><textarea id="draft-text" rows="5" maxlength="4000" placeholder="A little inspiration will appear here. Make it your own before sending.">${esc(draft)}</textarea><div class="draft-meta" id="draft-meta">${esc(draftMeta||'Your words, with a little help.')}</div><div class="draft-actions">${button('Copy','copy','copy')}${button('Insert in Tinder','insert',null)}${button('Send message','send','send','primary')}</div></div></section><aside class="editor-aside"><article class="panel"><span class="feature-icon peach">${I('spark')}</span><h3>Sound like yourself.</h3><p>A draft is a starting point. Keep what feels natural, change what doesn’t.</p><ul class="advice-list"><li>${I('check')} Mention a real profile detail</li><li>${I('check')} Ask one easy question</li><li>${I('check')} Leave room for a reply</li></ul></article>${modelCard()}<details class="panel context-details"><summary>Included conversation context</summary><pre id="context-preview">${esc(JSON.stringify(context,null,2))}</pre></details></aside></div>`}
  function swiping(){
    const c=C.swipeSettings(state.swipeConfig);
    const number=(name,label,min,max,help='')=>`<label>${label}<input name="${name}" type="number" min="${min}" max="${max}" step="1" value="${c[name]}" required>${help?`<span class="field-help">${help}</span>`:''}</label>`;
    const toggle=(name,label,help='')=>`<label class="check-row"><input name="${name}" type="checkbox" ${c[name]?'checked':''}><span>${label}${help?`<small>${help}</small>`:''}</span></label>`;
    return `<div class="editor-layout swipe-layout"><section class="panel swipe-config"><div class="section-heading"><h2>${I('swipe')} Set your rhythm</h2><span class="subtle-tag">At your pace</span></div><p class="panel-intro">A little variety. A little time to look around.</p>
    <div class="session-presets">${button('Quick session','quickPreset','sun')}${button('Overnight · 8 hours','overnightPreset','moon')}<span>Presets fill in your preferences. You choose when to start.</span></div>
    <form id="swipe-form">
    <fieldset class="pacing-section"><legend>01 <span>Session limits</span></legend><div class="form-row">${number('maxSwipes','Profile limit',1,10000,'Stop after this many profiles.')}${number('sessionMinutes','End after (minutes)',1,720,'The session ends at whichever limit comes first.')}</div>
    <label class="range-label">Like ratio <strong id="ratio-output">${Math.round(c.likeRatio*100)}%</strong><input name="likeRatio" type="range" min="0" max="100" value="${Math.round(c.likeRatio*100)}"></label><div class="range-endpoints"><span>More selective</span><span>More open</span></div><p class="field-help">A probability for each swipe, not an AI assessment of the person.</p></fieldset>
    <fieldset class="pacing-section"><legend>02 <span>Time between profiles</span></legend>${toggle('randomizeTiming','Vary the wait between profiles','A fresh random delay for each profile.')}
    <div class="form-row" id="random-timing">${number('minDelaySeconds','Minimum (seconds)',3,600)}${number('maxDelaySeconds','Maximum (seconds)',3,600)}</div><div id="fixed-timing">${number('delaySeconds','Fixed wait (seconds)',3,600)}</div></fieldset>
    <fieldset class="pacing-section"><legend>03 <span>Look around</span></legend>${toggle('browsePhotos','Browse profile photos','Advance a variable number of photos when a recognized control is available.')}
    <div class="form-row">${number('maxPhotos','Maximum photo advances',0,10)}${number('minPhotoSeconds','Shortest look (seconds)',1,30)}${number('maxPhotoSeconds','Longest look (seconds)',1,30)}</div>
    ${toggle('scrollProfile','Scroll the visible profile','Read down the profile’s own scroll area, then return before swiping.')}</fieldset>
    <fieldset class="pacing-section"><legend>04 <span>Take a breather</span></legend>${toggle('breaksEnabled','Include occasional breaks')}
    <div class="form-row">${number('breakEvery','Break every (profiles)',1,1000)}${number('breakMinSeconds','Shortest break (seconds)',10,1800)}${number('breakMaxSeconds','Longest break (seconds)',10,1800)}</div></fieldset>
    ${toggle('allowBackground','Continue when Tinder is in the background','Keep Chrome open and your computer awake. Browser throttling can lengthen waits; closing or reloading Tinder ends the session.')}
    ${button('Save preferences','saveSwiping','check')}</form></section>
    <aside class="editor-aside swipe-status"><article class="panel live-session"><div class="section-heading"><h2>Current session</h2><span id="session-badge" class="badge">Idle</span></div><div class="session-progress"><strong id="session-count">0</strong><span>of <b id="session-limit">${c.maxSwipes}</b> profiles</span></div><progress id="session-progress" max="${c.maxSwipes}" value="0"></progress><p id="session-message" role="status">Ready when you are.</p><p id="session-deadline" class="session-deadline"></p><div class="session-controls">${button('Start session','start','play','primary')}${button('Pause','pause','pause')}${button('Stop','stop','stop')}</div><p class="field-help">Pause keeps the original end time. Preference changes apply to your next new session.</p></article>
    <article class="tip-card"><span class="tip-label">${I('moon')} ROOM TO BREATHE</span><blockquote>A little less rush.<br><em>A little more rhythm.</em></blockquote><p>Varied waits, a few photos, and time between sessions.</p></article><article class="panel"><h3>Before you start</h3><ul class="advice-list"><li>${I('check')} Open Tinder Discover</li><li>${I('check')} Keep your computer awake</li><li>${I('check')} Unrecognized dialogs and missing controls stop the session</li></ul>${button('Open Tinder','openTinder','external','text')}</article></aside></div>`;
  }
  function updateTimingFields(){
    const random=$('[name="randomizeTiming"]')?.checked;
    if($('#random-timing'))$('#random-timing').hidden=!random;
    if($('#fixed-timing'))$('#fixed-timing').hidden=random;
  }
  function applySwipePreset(overnight){
    const values=overnight?{maxSwipes:500,sessionMinutes:480,randomizeTiming:true,minDelaySeconds:15,maxDelaySeconds:45,browsePhotos:true,maxPhotos:4,minPhotoSeconds:2,maxPhotoSeconds:6,scrollProfile:true,breaksEnabled:true,breakEvery:25,breakMinSeconds:120,breakMaxSeconds:300,allowBackground:true}:{maxSwipes:30,sessionMinutes:30,randomizeTiming:true,minDelaySeconds:8,maxDelaySeconds:25,browsePhotos:true,maxPhotos:3,minPhotoSeconds:2,maxPhotoSeconds:5,scrollProfile:false,breaksEnabled:false,allowBackground:false};
    for(const [key,value]of Object.entries(values)){const field=$(`#swipe-form [name="${key}"]`);if(field.type==='checkbox')field.checked=value;else field.value=value}
    updateTimingFields();toast('Preset applied. Review your preferences, then start when ready.');
  }
  function activity(){const a=state.allTimeAnalytics;return `<div class="activity-stats">${[['swipe','Swipes',a.swipes],['heart','Likes',a.likes],['spark','Drafts',a.drafts],['send','Messages',a.messages]].map(([ic,l,n])=>`<div class="metric"><div class="metric-label">${l}${I(ic)}</div><strong>${n||0}</strong><span>All time · tracked by SpicySwipe</span></div>`).join('')}</div><article class="panel"><div class="section-heading"><div><h2>Your recent activity</h2><p class="muted">Up to 100 events, stored on this device. No message text is kept here.</p></div>${button('Clear history','clearActivity',null,'text')}</div><div id="activity-events">${eventRows(100)}</div></article>`}
  function settingsView(){const p=C.providers[settingsProvider];return `<div class="settings-layout"><section class="panel"><div class="section-heading"><h2>${I('spark')} AI connection</h2><span class="subtle-tag">Bring your own key</span></div><p class="panel-intro">Choose the intelligence behind your next hello.</p><form id="settings-form"><div class="provider-grid">${Object.entries(C.providers).map(([id,pr])=>`<button type="button" class="provider-option ${settingsProvider===id?'chosen':''}" data-provider="${id}" aria-pressed="${settingsProvider===id}"><span class="provider-mark ${id}">${pr.mark}</span><strong>${pr.short}</strong>${settingsProvider===id?I('check'):''}</button>`).join('')}</div><div id="provider-fields">${providerFields(p)}</div><div class="form-actions">${button(settingsProvider==='ollama'?'Save & discover':'Save connection','saveConnection','check','primary')}${button('Test connection','test','bolt')}${button('Refresh models','models','refresh')}</div><p class="field-help">Connection tests list available models. They don’t generate a message or verify generation access.</p><div id="connection-result" class="inline-result" role="status" hidden></div></form></section><aside class="editor-aside"><article class="panel"><span class="feature-icon sage">${I('shield')}</span><h3>Private by design.<br>Clear by default.</h3><p>${bridge.desktop?'Your settings stay on this computer. API keys are encrypted using your operating system’s secure storage.':'Your settings and keys are stored in this browser, without application-level encryption.'}</p><p>Cloud providers receive the context used to generate drafts. Ollama sends context to your configured server. Use a downloaded model there for local inference.</p></article></aside>
   <section class="panel preferences-panel"><h2>Make it yours</h2><div class="preference-row"><div><strong>Color theme</strong><p>A comfortable space, day or night.</p></div>${button(state.theme==='dark'?'Dark':'Light','theme',state.theme==='dark'?'moon':'sun')}</div><div class="preference-row"><div><strong>Draft an opener automatically</strong><p>When Tinder explicitly marks the open conversation as empty. Review is the default.</p></div><label class="switch"><input id="auto-draft" type="checkbox" ${state.messagingConfig.autoMessageOnMatch?'checked':''} aria-label="Draft an opener automatically"><span></span></label></div><div class="preference-row"><div><strong>Send automatic openers</strong><p>Opt in to sending the generated opener in the conversation you opened. Check context detection first.</p></div><label class="switch"><input id="auto-send" type="checkbox" ${state.messagingConfig.autoSend?'checked':''} aria-label="Send automatic openers"><span></span></label></div><div class="preference-row"><div><strong>Workspace access</strong><p>Turn off page actions and automatic messages.</p></div>${button('Revoke access','revoke',null,'text danger')}</div></section></div>`}
  function providerFields(p){if(bridge.compact&&p.key)return `<div class="info-box">${I('key')}<span>${state.credentials?.[settingsProvider]?'API key saved.':'No API key saved.'} Manage credentials in the extension workspace, separate from Tinder.</span></div>${button('Manage API key','dashboard','external')}<label>Model<input name="model" list="model-options" value="${esc(state.models[settingsProvider]||'')}" maxlength="200"><datalist id="model-options">${models.map(m=>`<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('')}</datalist></label>`;return `${p.key?`<label>API key <span class="optional">${state.credentials?.[settingsProvider]?'saved on this device':''}</span><input name="apiKey" type="password" autocomplete="off" placeholder="${state.credentials?.[settingsProvider]?'Leave blank to keep your saved key':'Paste your API key'}"><span class="field-help"><a href="${p.url}" target="_blank" rel="noreferrer">Get a ${p.short} API key ${I('external')}</a>${state.credentials?.[settingsProvider]?'<button type="button" class="text-link danger" data-action="removeKey">Remove saved key</button>':''}</span></label>`:`<label>Ollama server URL<input name="ollamaUrl" type="url" value="${esc(state.ollamaUrl)}"><span class="field-help">Use localhost or a LAN address, such as http://192.168.1.50:11434. Models load automatically. Save to allow access to a new server.</span></label>${bridge.compact?button('Allow server access in workspace','dashboard','external'):''}<label>Installed models<select id="installed-models" disabled><option value="">Discovering models…</option></select><span class="field-help">Choose a chat model installed on this server, or enter its exact ID below.</span></label>`}<label>Model<input name="model" list="model-options" value="${esc(state.models[settingsProvider]||'')}" placeholder="${settingsProvider==='ollama'?'Refresh models or enter an installed model':'Enter a model ID'}" maxlength="200"><datalist id="model-options">${models.map(m=>`<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('')}</datalist><span class="field-help">Choose an available text model or enter its exact ID.</span></label>`}
  function render(){
    $('#crumb').textContent=title(view);$('#page-title').innerHTML=views[view][0]+'<span class="heading-dot">.</span>';$('#page-subtitle').textContent=views[view][1];
    target.querySelectorAll('[data-view]').forEach(el=>{el.classList.toggle('selected',el.dataset.view===view);if(el.tagName==='BUTTON')el.setAttribute('aria-current',el.dataset.view===view?'page':'false')});
    $('#heading-action').innerHTML=view==='overview'?button('Open Tinder','openTinder','external'):'';
    content.innerHTML=({overview,messages,swiping,activity,settings:settingsView})[view]();
    if(!state.hasCompletedOnboarding&&state.sidebarConsentGiven)content.insertAdjacentHTML('afterbegin',`<div class="setup-banner"><div><strong>Make yourself at home.</strong><p>Connect an AI provider for drafts, or get started with swiping.</p></div>${button('Finish setup','finishSetup','check','primary')}</div>`);
    if(view==='messages')for(const [name,value]of Object.entries(messageInputs)){const field=$(`#message-form [name="${name}"]`);if(field)field.value=value}
    if(view==='swiping')updateTimingFields();
    updatePage();
  }
  function navigate(next){if(!views[next])return;discoveryEpoch++;if(next==='messages'&&!draft)context=page.context||context;view=next;render();if(view==='settings'&&settingsProvider==='ollama')discoverModels();$('.main').scrollTop=0;pollPage()}
  function updatePage(){
    const conn=$('#connection');conn.innerHTML=`<span class="dot ${page.connected?'green':''}"></span> ${bridge.preview?'Preview mode':page.connected?'Tinder connected':'Tinder not connected'}`;
    if(view==='swiping'){
      const s=page.session||{},active=s.status==='running';
      $('#session-badge').textContent=active?({break:'On a break',photos:'Browsing photos',reading:'Reading profile',reviewing:'Reviewing',waiting:'Waiting'}[s.phase]||'Running'):title(s.status||'idle');
      $('#session-count').textContent=s.count||0;$('#session-limit').textContent=s.limit||state.swipeConfig.maxSwipes;
      const progress=$('#session-progress');progress.max=s.limit||state.swipeConfig.maxSwipes;progress.value=s.count||0;
      const seconds=Math.max(0,Math.ceil(((s.nextActionAt||Date.now())-Date.now())/1000));
      const countdown=seconds>=60?`${Math.floor(seconds/60)}m ${seconds%60}s`:`${seconds}s`;
      $('#session-message').textContent=s.error||(active?({break:`Taking a breather. Continuing in ${countdown}.`,photos:`Looking at a photo · ${countdown} remaining.`,reading:`Reading the profile · ${countdown} remaining.`,waiting:`Next profile review in ${countdown}.`,reviewing:'Reviewing the current profile.'}[s.phase]||'Session in progress.'):s.status==='paused'?'Paused. Resume when you’re ready.':s.status==='complete'?(s.completionReason==='time'?'Your session time is up.':'Profile limit reached. All done.'):'Open Tinder Discover, review your preferences, and start when ready.');
      $('#session-deadline').textContent=s.endsAt&&['running','paused'].includes(s.status)?`Ends at ${new Date(s.endsAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}`:'';
      $('[data-action="start"]').disabled=active;$('[data-action="start"] span').textContent=s.status==='paused'?'Resume session':'Start session';$('[data-action="pause"]').disabled=!active;

    }
  }
  async function pollPage(){if(polling||disposed)return;polling=true;try{const result=await bridge.page('context');if(result?.error)throw new Error(result.error);page=result;updatePage();if(result.automaticDraft&&result.automaticDraft!==lastAutoDraft&&result.automaticDraft.response!==lastAutoDraft?.response){lastAutoDraft=result.automaticDraft;draft=result.automaticDraft.response;context=result.automaticDraft.context;draftContext={...context};draftMeta=`${result.automaticDraft.modelUsed} · Automatic draft`;navigate('messages');toast('An opener is ready to review.')}}catch{page={...page,connected:false};updatePage()}finally{polling=false}}
  async function refreshContext(){const result=await bridge.page('context');if(result.error)throw new Error(result.error);page=result;const next=result.context||{};if(draft&&context.conversationId&&context.conversationId!==next.conversationId){draft='';draftContext={};draftMeta='Conversation changed. Generate a fresh draft.'}context=next;if(view==='messages')render();updatePage()}
  async function save(patch){state=await bridge.save(patch);app.dataset.theme=state.theme;return state}
  async function connectionSave(authorize=false,current=()=>true){
    const f=new FormData($('#settings-form')),p=C.providers[settingsProvider];const patch={activeAI:settingsProvider,models:{...state.models,[settingsProvider]:String(f.get('model')||'').trim()}};
    if(p.key&&f.get('apiKey'))patch[p.key]=String(f.get('apiKey')).trim();
    if(!p.key){
      patch.ollamaUrl=C.localURL(String(f.get('ollamaUrl')));
      if(authorize){
        if(bridge.authorizeOllama)await bridge.authorizeOllama(patch.ollamaUrl);
        else await bridge.request('ollamaAccess',{ollamaUrl:patch.ollamaUrl});
      }
    }
    if(!current())return null;
    await save(patch);return patch;
  }
  function updateModelChoices(){
    const input=$('[name="model"]');
    $('#model-options').innerHTML=models.map(m=>`<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('');
    const select=$('#installed-models');if(!select)return;
    select.disabled=!models.length;
    select.innerHTML=`<option value="">${models.length?'Choose an installed model':'No models discovered'}</option>`+models.map(m=>`<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('');
    select.value=models.some(m=>m.id===input.value)?input.value:'';
  }
  async function discoverModels({action='models',saveConnection=false}={}){
    const provider=settingsProvider,url=$('[name="ollamaUrl"]')?.value,epoch=++discoveryEpoch;
    const current=()=>!disposed&&view==='settings'&&provider===settingsProvider&&epoch===discoveryEpoch&&url===$('[name="ollamaUrl"]')?.value;
    const resultEl=$('#connection-result');resultEl.hidden=false;resultEl.classList.remove('error');resultEl.textContent='Discovering available models…';
    try{
      if(saveConnection){await connectionSave(true,current);if(!current())return}
      const result=await bridge.request(action,{provider,...(provider==='ollama'?{ollamaUrl:C.localURL(url)}:{})});
      if(!current())return;
      models=result.models;const input=$('[name="model"]');
      if(!input.value&&models.length){
        input.value=models[0].id;
        // Only an explicit save persists an automatically selected model.
        if(saveConnection)await save({models:{...state.models,[provider]:input.value}});
        if(!current())return;
      }
      updateModelChoices();resultEl.textContent=result.message;
    }catch(error){if(current()){models=[];updateModelChoices();resultEl.textContent=error.message;resultEl.classList.add('error')}}
  }
  function onboarding(){const layer=$('.modal-layer');layer.hidden=false;layer.innerHTML=`<section class="welcome-dialog" role="dialog" aria-modal="true" aria-labelledby="welcome-title"><span class="brand-mark">${I('bolt')}</span><span class="eyebrow">WELCOME TO SPICYSWIPE</span><h2 id="welcome-title">A little help.<br><em>A lot of possibility.</em></h2><p>A thoughtful copilot for messages and swiping, right where you connect.</p><div class="welcome-features"><div>${I('message')} Draft, edit, and send in your voice.</div><div>${I('swipe')} Run sessions with clear limits.</div><div>${I('shield')} Choose cloud AI or local Ollama.</div></div><p class="consent-copy">Enable SpicySwipe to read visible Tinder context and use page controls when you ask. Draft generation sends context to your selected provider. Automatic actions are off by default for new setups.</p>${button('Set up my workspace','accept','arrow','primary wide')}</section>`;setTimeout(()=>$('[data-action="accept"]')?.focus(),0)}
  function confirmDialog(heading,text,action,label){const layer=$('.modal-layer');layer.hidden=false;layer.innerHTML=`<section class="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title"><h2 id="confirm-title">${heading}</h2><p>${text}</p><div class="form-actions">${button('Cancel','dismiss',null)}${button(label,action,null,'primary')}</div></section>`;setTimeout(()=>$('[data-action="dismiss"]')?.focus(),0)}
  async function action(name){
    if(views[name])return navigate(name);
    if(name==='theme'){await save({theme:state.theme==='dark'?'light':'dark'});if(view==='settings')navigate('settings');return}
    if(name==='close')return bridge.close?.();
    if(name==='openTinder')return bridge.request('openTinder');
    if(name==='dashboard')return bridge.request('dashboard');
    if(name==='dismiss'){$('.modal-layer').hidden=true;return}
    if(name==='accept'){await save({sidebarConsentGiven:true});$('.modal-layer').hidden=true;navigate('settings');return}
    if(name==='finishSetup'){await save({hasCompletedOnboarding:true});navigate('overview');toast('Your workspace is ready.');return}
    if(name==='refreshContext')return refreshContext();
    if(name==='saveConnection'){if(settingsProvider==='ollama')return discoverModels({saveConnection:true});await connectionSave();render();toast('Connection saved. Test it when you’re ready.');return}
    if(name==='removeKey'){await save({[C.providers[settingsProvider].key]:''});render();toast('Saved API key removed.');return}
    if(name==='models'||name==='test')return discoverModels({action:name,saveConnection:true});
    if(name==='generate'){
      if(busy)return;if(!state.sidebarConsentGiven)return onboarding();
      const f=new FormData($('#message-form')),options=Object.fromEntries(f);await save({messagingConfig:{...state.messagingConfig,tone:options.tone,language:options.language,length:options.length}});
      // Refresh identity before generation; never silently carry a draft to another conversation.
      try{const current=await bridge.page('context');if(!current.error)context=current.context||{}}catch{context={}}
      if(!context.canMessage&&!options.instruction.trim())throw new Error('Open a Tinder conversation or add a little context first.');
      const generationContext=JSON.parse(JSON.stringify(context));busy=true;const btn=$('[data-action="generate"]');btn.disabled=true;btn.querySelector('span').textContent='Finding your words…';
      try{const result=await bridge.request('generate',{context:generationContext,options});if(context.conversationId!==generationContext.conversationId){toast('Conversation changed. Discarded the earlier draft.');return}draft=result.response;draftContext=generationContext;draftMeta=`${result.modelUsed} · ${(result.durationMs/1000).toFixed(1)}s · Edit to make it yours`;if(view==='messages'){const instruction=options.instruction;render();$('[name="instruction"]').value=instruction}toast('Your draft is ready. Make it your own.')}
      finally{busy=false;if(view==='messages'){const b=$('[data-action="generate"]');b.disabled=false;b.querySelector('span').textContent='Generate a draft'}}return;
    }
    if(name==='copy'){if(!draft.trim())throw new Error('Generate or write a draft first.');await navigator.clipboard.writeText(draft);toast('Draft copied.');return}
    if(name==='insert'||name==='send'){
      if(!draft.trim())throw new Error('Generate or write a draft first.');
      const result=await bridge.page(name,{text:draft,conversationId:draftContext.conversationId});if(result?.error)throw new Error(result.error);
      if(name==='send'){draft='';if($('#draft-text'))$('#draft-text').value='';await bridge.page('dismissDraft').catch(()=>{});toast('Message submitted to Tinder.')}else toast('Draft inserted. Review it in Tinder.');return;
    }
    if(name==='quickPreset'||name==='overnightPreset'){applySwipePreset(name==='overnightPreset');return}
    if(name==='saveSwiping'){
      const form=$('#swipe-form');if(!form.reportValidity())return false;
      const f=new FormData(form),config={};
      for(const key of ['maxSwipes','sessionMinutes','delaySeconds','minDelaySeconds','maxDelaySeconds','maxPhotos','minPhotoSeconds','maxPhotoSeconds','breakEvery','breakMinSeconds','breakMaxSeconds'])config[key]=Number(f.get(key));
      for(const key of ['randomizeTiming','browsePhotos','scrollProfile','breaksEnabled','allowBackground'])config[key]=f.has(key);
      config.likeRatio=Number(f.get('likeRatio'))/100;
      for(const [low,high,label]of [['minDelaySeconds','maxDelaySeconds','Profile wait'],['minPhotoSeconds','maxPhotoSeconds','Photo dwell'],['breakMinSeconds','breakMaxSeconds','Break']])if(config[low]>config[high])throw new Error(`${label}: the maximum must be at least the minimum.`);
      await save({swipeConfig:config});toast('Session preferences saved.');return;
    }
    if(['start','pause','stop'].includes(name)){if(name==='start'){if(!state.sidebarConsentGiven)return onboarding();if(await action('saveSwiping')===false)return}const result=await bridge.page(name);if(result.error)throw new Error(result.error);page=result;updatePage();return}
    if(name==='clearActivity')return confirmDialog('Clear activity history?','This removes the recent event list. Your all-time totals and settings stay saved.','confirmClear','Clear history');
    if(name==='confirmClear'){state=await bridge.request('clearActivity');$('.modal-layer').hidden=true;render();return}
    if(name==='revoke')return confirmDialog('Turn off workspace access?','This stops swiping and automatic openers. Your settings and API keys stay saved.','confirmRevoke','Revoke access');
    if(name==='confirmRevoke'){await bridge.page('stop').catch(()=>{});state=await bridge.request('revoke');$('.modal-layer').hidden=true;onboarding();return}
  }
  target.addEventListener('click',async e=>{
    const viewBtn=e.target.closest('[data-view]');if(viewBtn){e.preventDefault();navigate(viewBtn.dataset.view);return}
    const providerBtn=e.target.closest('[data-provider]');if(providerBtn){discoveryEpoch++;settingsProvider=providerBtn.dataset.provider;models=[];render();if(settingsProvider==='ollama')discoverModels();return}
    const btn=e.target.closest('[data-action]');if(!btn||btn.disabled)return;e.preventDefault();const name=btn.dataset.action;
    // Disable side-effect controls until their asynchronous action settles.
    btn.disabled=true;try{await action(name)}catch(error){toast(error.message,true)}finally{if(btn.isConnected)btn.disabled=false;updatePage()}
  });
  target.addEventListener('submit',e=>e.preventDefault());
  target.addEventListener('input',e=>{
    if(e.target.name==='ollamaUrl'){
      discoveryEpoch++;models=[];updateModelChoices();
      const result=$('#connection-result');result.hidden=false;result.classList.remove('error');result.textContent='Save & discover to connect to this server.';
    }
    if(e.target.name==='model'&&$('#installed-models'))$('#installed-models').value=models.some(m=>m.id===e.target.value)?e.target.value:'';
    if(e.target.closest('#message-form')&&e.target.name)messageInputs[e.target.name]=e.target.value;
    if(e.target.id==='draft-text'){if(!draft)draftContext={...context};draft=e.target.value;$('#draft-count').textContent=`${draft.length} characters`}
    if(e.target.name==='likeRatio')$('#ratio-output').textContent=e.target.value+'%';
  });
  target.addEventListener('change',async e=>{
    if(e.target.name==='randomizeTiming')updateTimingFields();
    if(e.target.id==='installed-models'&&e.target.value){$('[name="model"]').value=e.target.value;toast('Model selected. Save the connection to use it.')}
    if(e.target.closest('#message-form')&&e.target.name)messageInputs[e.target.name]=e.target.value;
    if(['auto-draft','auto-send'].includes(e.target.id)){
      try{await save({messagingConfig:{...state.messagingConfig,[e.target.id==='auto-draft'?'autoMessageOnMatch':'autoSend']:e.target.checked}});toast('Messaging preference saved.')}catch(error){e.target.checked=!e.target.checked;toast(error.message,true)}
    }
  });
  target.addEventListener('keydown',e=>{
    const modal=$('.modal-layer');if(modal.hidden)return;
    if(e.key==='Escape'&&$('[data-action="dismiss"]'))modal.hidden=true;
    if(e.key==='Tab'){const focusable=[...modal.querySelectorAll('button,a,input,select,textarea')].filter(el=>!el.disabled);const first=focusable[0],last=focusable.at(-1),active=target.getRootNode().activeElement||document.activeElement;if(e.shiftKey&&active===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&active===last){e.preventDefault();first.focus()}}
  });
  const unsub=bridge.subscribe?.(event=>{
    if(event.type==='settings'){state=event.data;app.dataset.theme=state.theme;if(view==='overview'){$('#metrics').innerHTML=metrics();$('#recent-events').innerHTML=eventRows(3);$('#model-card').innerHTML=modelCard()}if(view==='activity'){$('#activity-events').innerHTML=eventRows(100)}}
    if(event.type==='page'){page=event.data;updatePage()}
  });
  render();pollPage();const timer=setInterval(pollPage,2500);if(!state.sidebarConsentGiven&&!bridge.preview)onboarding();
  return {navigate,destroy(){disposed=true;clearInterval(timer);clearTimeout(toastTimer);unsub?.()}};
 }
 root.SSWorkspace={mount};
})(globalThis);
