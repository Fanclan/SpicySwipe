(async()=>{
  const target=document.getElementById('workspace');
  if(globalThis.chrome?.runtime?.id){
    await SSWorkspace.mount(target,{load:()=>SSClient.rpc('load'),save:data=>SSClient.rpc('save',data),request:SSClient.rpc,authorizeOllama:SSClient.authorizeOllama,subscribe:SSClient.subscribe,page:async(action,data)=>{const result=await SSClient.rpc('page',{action,data});if(result?.error)throw new Error(result.error);return result}});
    return;
  }
  // Browser preview only: no real keys, provider requests, or Tinder actions.
  const C=SSCore;
  let stored={};try{stored=JSON.parse(localStorage.getItem('ss-preview')||'{}')}catch{}
  const now=Date.now();
  let data=C.migrate({activeAI:'gemini',sidebarConsentGiven:true,hasCompletedOnboarding:true,sessionAnalytics:{date:C.today(),swipes:24,likes:16,drafts:5,messages:3},allTimeAnalytics:{swipes:182,likes:116,drafts:32,messages:19},activity:[{id:'1',kind:'draft',detail:'Gemini · A playful conversation starter',time:now-5*60000},{id:'2',kind:'message',detail:'A message with a little personality',time:now-18*60000},{id:'3',kind:'session',detail:'24 profiles · A session at your pace',time:now-39*60000}],...stored});
  const listeners=new Set();const snapshot=()=>({...C.publicSettings(data),credentials:{gemini:true,chatgpt:false,claude:false,deepseek:false,ollama:true}});
  const context={conversationId:'preview-alex',name:'Alex · Preview conversation',bio:'Weekend hikes, good coffee, and finding new corners of the city.',history:[{text:'I just found a little coffee place near the trail. New weekend favorite.'}],canMessage:true,page:'/app/messages/preview-alex'};
  const notify=()=>listeners.forEach(fn=>fn({type:'settings',data:snapshot()}));
  const session=new SSSession({act:async(config,valid,commit,sleep)=>{
    if(config.browsePhotos){const photos=Math.floor(Math.random()*config.maxPhotos)+1;for(let i=0;i<photos&&config.maxPhotos>0;i++)if(!await sleep((config.minPhotoSeconds+Math.random()*(config.maxPhotoSeconds-config.minPhotoSeconds))*1000,'photos'))return}
    if(config.scrollProfile&&!await sleep(config.minPhotoSeconds*1000,'reading'))return;
    if(!valid())return;
    commit();const kind=Math.random()<config.likeRatio?'likes':'nopes';data.sessionAnalytics.swipes++;data.allTimeAnalytics.swipes++;data.sessionAnalytics[kind]++;data.allTimeAnalytics[kind]++;notify();
  },changed:()=>listeners.forEach(fn=>fn({type:'page',data:{connected:true,context,session:session.snapshot()}}))});
  window.addEventListener('pagehide',()=>session.stop());
  const save=async patch=>{for(const key of Object.keys(patch))if(/key/i.test(key))delete patch[key];data=C.migrate({...data,...patch});localStorage.setItem('ss-preview',JSON.stringify({theme:data.theme,activeAI:data.activeAI,models:data.models,swipeConfig:data.swipeConfig,messagingConfig:data.messagingConfig,ollamaUrl:data.ollamaUrl}));notify();return snapshot()};
  function record(kind,detail){data.activity.unshift({id:String(Date.now()),kind,detail,time:Date.now()});if(kind==='draft'){data.sessionAnalytics.drafts++;data.allTimeAnalytics.drafts++}notify()}
  await SSWorkspace.mount(target,{preview:true,authorizeOllama:async()=>true,load:async()=>snapshot(),save,subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn)},
    request:async(action,payload)=>{
      if(['test','models'].includes(action))return {models:(payload?.provider||data.activeAI)==='ollama'?[{id:'qwen3:8b',name:'qwen3:8b'},{id:'gemma3:12b',name:'gemma3:12b'},{id:'llama3.2:latest',name:'llama3.2:latest'}]:[{id:C.providers[payload?.provider||data.activeAI].model,name:'Preview model'}],message:'Preview connection successful. No provider was contacted.'};
      if(action==='generate'){await new Promise(r=>setTimeout(r,850));record('draft','Preview · Sample generated draft');return {response:payload.options?.tone==='witty'?'A great trail AND a coffee spot? That’s a suspiciously strong weekend itinerary. Which one should I try first?':'A coffee stop after a hike sounds like my kind of weekend. What’s the trail you keep going back to?',modelUsed:data.models[data.activeAI]||'local model',provider:data.activeAI,durationMs:850}}
      if(action==='openTinder')throw new Error('Preview only. Load the extension in Chrome to connect Tinder.');
      if(action==='clearActivity'){data.activity=[];notify();return snapshot()}
      if(action==='revoke'){await save({sidebarConsentGiven:false,hasCompletedOnboarding:false});return snapshot()}
      return {ok:true};
    },
    page:async(action)=>{
      if(action==='start')session.start(data.swipeConfig);
      if(action==='pause')session.pause();
      if(action==='stop')session.stop();
      if(action==='send'||action==='insert')return {ok:true};
      return {connected:true,context,session:session.snapshot()};
    }
  });
})().catch(error=>{document.getElementById('workspace').textContent='Unable to load SpicySwipe. '+error.message});
