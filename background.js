/* SpicySwipe 2 service worker: persistence and provider traffic. */
importScripts('shared/core.js','shared/ai.js');
let writeQueue=Promise.resolve();
const clients=new Set();
const inFlight=new Set();
const read=async()=>SSCore.migrate(await chrome.storage.local.get(null));
function transaction(fn){
  const work=writeQueue.then(async()=>{const data=await read();const next=await fn(data);await chrome.storage.local.set(next);broadcast(next);return SSCore.publicSettings(next)});
  writeQueue=work.catch(()=>{});return work;
}
function broadcast(data){for(const port of clients){try{port.postMessage({type:'settings',data:SSCore.publicSettings(data)})}catch{clients.delete(port)}}}
chrome.runtime.onConnect.addListener(port=>{
  if(port.name!=='spicyswipe'||port.sender?.id!==chrome.runtime.id)return;
  clients.add(port);port.onDisconnect.addListener(()=>clients.delete(port));
});
const initialize=()=>transaction(data=>data).catch(()=>{});
chrome.runtime.onInstalled.addListener(initialize);
chrome.runtime.onStartup.addListener(initialize);
const allowedSettings=new Set(['activeAI','models','geminiApiKey','openaiApiKey','anthropicApiKey','deepseekApiKey','ollamaUrl','ollamaModel','swipeConfig','messagingConfig','theme','sidebarConsentGiven','hasCompletedOnboarding','userLanguage']);
async function saveSettings(patch){
  if(!patch||typeof patch!=='object')throw new Error('Invalid settings.');
  return transaction(data=>{
    const next={...data};
    for(const [key,value]of Object.entries(patch)){
      if(!allowedSettings.has(key))continue;
      if(['models','swipeConfig','messagingConfig'].includes(key)){
        if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid settings.');
        next[key]={...data[key],...value};
      }else next[key]=value;
    }
    if(!SSCore.providers[next.activeAI])throw new Error('Unknown provider.');
    for(const p of Object.values(SSCore.providers))if(p.key&&next[p.key]!==undefined&&typeof next[p.key]!=='string')throw new Error('API keys must be text.');
    if(patch.ollamaUrl!==undefined)next.ollamaUrl=SSCore.localURL(patch.ollamaUrl);
    for(const model of Object.values(next.models))if(typeof model!=='string'||model.length>200)throw new Error('Invalid model ID.');
    return SSCore.migrate(next);
  });
}
async function record(kind,detail=''){
  const deltas={like:{swipes:1,likes:1},pass:{swipes:1,nopes:1},message:{messages:1},draft:{drafts:1}};
  return transaction(data=>{
    if(data.sessionAnalytics.date!==SSCore.today())data.sessionAnalytics={...SSCore.counts(),date:SSCore.today()};
    for(const [k,v]of Object.entries(deltas[kind]||{})){data.allTimeAnalytics[k]=(data.allTimeAnalytics[k]||0)+v;data.sessionAnalytics[k]=(data.sessionAnalytics[k]||0)+v}
    data.activity.unshift({id:crypto.randomUUID(),kind,detail:String(detail).slice(0,140),time:Date.now()});
    data.activity=data.activity.slice(0,100);return data;
  });
}
async function tinderTab(){
  const tabs=await chrome.tabs.query({url:['https://tinder.com/*','https://www.tinder.com/*']});
  return tabs.sort((a,b)=>(Number(b.active)-Number(a.active))||((b.lastAccessed||0)-(a.lastAccessed||0)))[0];
}
async function requireOllamaAccess(url){
  const origin=SSCore.ollamaOrigin(url);
  if(!await chrome.permissions.contains({origins:[origin]}))throw new Error('Allow server access: open the extension workspace, select Ollama, then Save & discover to approve this host.');
}
async function route(msg,sender){
  switch(msg.action){
    case 'load':return SSCore.publicSettings(await read());
    case 'save':{
      const hasCredential=Object.keys(msg.data||{}).some(key=>/apikey/i.test(key));
      if(hasCredential&&!sender.url?.startsWith(chrome.runtime.getURL('')))throw new Error('Manage credentials in the extension workspace.');
      return saveSettings(msg.data);
    }
    case 'ollamaAccess':await requireOllamaAccess(msg.data?.ollamaUrl);return {ok:true};
    case 'models':case 'test':{
      const settings=await read();
      if(msg.data?.provider){if(!SSCore.providers[msg.data.provider])throw new Error('Unknown provider.');settings.activeAI=msg.data.provider}
      if(settings.activeAI==='ollama'){
        settings.ollamaUrl=SSCore.localURL(msg.data?.ollamaUrl??settings.ollamaUrl);
        await requireOllamaAccess(settings.ollamaUrl);
      }
      const models=await SSAI.listModels(settings);
      return {models,message:models.length?`Connected. Found ${models.length} ${settings.activeAI==='ollama'?'installed':'text'} model${models.length===1?'':'s'}. No message was generated.`:settings.activeAI==='ollama'?'Connected, but no models are installed. Pull a chat model on your Ollama server, then refresh.':'Connected, but no text models were found.'};
    }
    case 'generate':{
      const id=sender.tab?.id||'dashboard';if(inFlight.has(id))throw new Error('A draft is already being generated.');
      inFlight.add(id);
      try{
        const settings=await read();if(!settings.sidebarConsentGiven)throw new Error('Finish setup before generating a draft.');
        if(settings.activeAI==='ollama')await requireOllamaAccess(settings.ollamaUrl);
        const options={...settings.messagingConfig,...msg.data?.options};
        const result=await SSAI.generate(settings,SSCore.prompt(msg.data?.context||{},options));
        await record('draft',`${SSCore.providers[result.provider].short} · ${result.modelUsed}`);return result;
      }finally{inFlight.delete(id)}
    }
    case 'record':{
      if(!sender.tab||!['like','pass','message','session','pause','stop','error'].includes(msg.data?.kind))throw new Error('Invalid activity event.');
      return record(msg.data.kind,msg.data.detail);
    }
    case 'openTinder':{
      const tab=await tinderTab();if(tab){await chrome.tabs.update(tab.id,{active:true});await chrome.windows.update(tab.windowId,{focused:true})}
      else await chrome.tabs.create({url:'https://tinder.com/app/recs'});return {ok:true};
    }
    case 'dashboard':await chrome.tabs.create({url:chrome.runtime.getURL('ui/dashboard.html')});return {ok:true};
    case 'page':{
      const tab=await tinderTab();if(!tab)throw new Error('Open Tinder to connect your workspace.');
      try{return await chrome.tabs.sendMessage(tab.id,{type:'ss:page',action:msg.data?.action,data:msg.data?.data})}
      catch{throw new Error('Refresh your Tinder tab to connect SpicySwipe.')}
    }
    case 'clearActivity':return transaction(data=>({...data,activity:[]}));
    case 'revoke':return transaction(data=>({...data,sidebarConsentGiven:false,hasCompletedOnboarding:false,messagingConfig:{...data.messagingConfig,autoSend:false,autoMessageOnMatch:false}}));
    default:throw new Error('Unknown workspace action.');
  }
}
chrome.runtime.onMessage.addListener((msg,sender,respond)=>{
  if(msg?.type!=='ss:request')return false;
  if(sender.id!==chrome.runtime.id){respond({error:'Unauthorized sender.'});return false}
  route(msg,sender).then(data=>respond({data}),error=>respond({error:error.message||'Request failed.'}));return true;
});
