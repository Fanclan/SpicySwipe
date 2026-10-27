/* Main-process settings and AI service. Never expose read() to renderer IPC. */
const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const C=require('../shared/core.js');
const AI=require('../shared/ai.js');
const MobileConfig=require('./mobile-config.cjs');
const credentials=Object.values(C.providers).map(p=>p.key).filter(Boolean);
const allowed=new Set(['activeAI','models',...credentials,'ollamaUrl','swipeConfig','messagingConfig','theme','sidebarConsentGiven','hasCompletedOnboarding','userLanguage','mobileConfig']);
const events=new Set(['like','pass','message','session','pause','stop','error']);
const bools=new Set(['autoSend','autoMessageOnMatch']);
const swipeDefaults=C.swipeSettings();
const isObject=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
function object(value,label){if(!isObject(value))throw Error(`Invalid ${label}.`);return value}
function string(value,label,max=200){if(typeof value!=='string'||value.length>max)throw Error(`Invalid ${label}.`);return value}
function messaging(patch,options=false){
  object(patch,'messaging options');const result={};
  for(const [key,value] of Object.entries(patch)){
    if(key==='tone'){if(!C.tones.includes(value))throw Error('Invalid tone option.')}
    else if(key==='language'){if(typeof value!=='string'||!Object.hasOwn(C.languages,value))throw Error('Invalid language option.')}
    else if(key==='length'){if(!['short','medium'].includes(value))throw Error('Invalid length option.')}
    else if(bools.has(key)&&!options){if(typeof value!=='boolean')throw Error('Invalid messaging option.')}
    else if(key==='instruction'&&options)string(value,'instruction',4000);
    else throw Error('Unknown messaging option.');
    result[key]=value;
  }return result;
}
function patchSettings(current,patch){
  object(patch,'settings');const next={...current};
  for(const [key,value]of Object.entries(patch)){
    if(!allowed.has(key))continue;
    if(key==='mobileConfig'){
      object(value,'mobile settings');next.mobileConfig={...current.mobileConfig};
      for(const [platform,config]of Object.entries(value)){if(!['hinge','bumble'].includes(platform))throw Error('Unknown mobile platform.');next.mobileConfig[platform]=MobileConfig.normalize(config,current.mobileConfig?.[platform]||{});}
    }else if(key==='activeAI'){if(typeof value!=='string'||!Object.hasOwn(C.providers,value))throw Error('Unknown provider.');next[key]=value}
    else if(credentials.includes(key))next[key]=string(value,'API key',8192).trim();
    else if(key==='models'){
      object(value,'models');next.models={...current.models};
      for(const [id,model]of Object.entries(value)){if(!Object.hasOwn(C.providers,id))throw Error('Unknown model provider.');next.models[id]=string(model,'model ID').trim()}
    }else if(key==='messagingConfig')next[key]={...current[key],...messaging(value)};
    else if(key==='swipeConfig'){
      object(value,'swipe settings');const patch={};
      for(const [field,v]of Object.entries(value)){
        if(!Object.hasOwn(swipeDefaults,field))throw Error('Unknown swipe setting.');
        if(typeof v!==typeof swipeDefaults[field]||(typeof v==='number'&&!Number.isFinite(v)))throw Error('Invalid swipe setting.');
        patch[field]=v;
      }next[key]=C.swipeSettings({...current[key],...patch});
    }else if(key==='ollamaUrl')next[key]=C.localURL(string(value,'Ollama URL',2048));
    else if(key==='theme'){if(!['light','dark'].includes(value))throw Error('Invalid theme.');next[key]=value}
    else if(key==='userLanguage'){if(typeof value!=='string'||!Object.hasOwn(C.languages,value))throw Error('Invalid language.');next[key]=value}
    else {if(typeof value!=='boolean')throw Error('Invalid settings flag.');next[key]=value}
  }return C.migrate(next);
}
class Service {
  constructor({file,safeStorage,fetchImpl=globalThis.fetch,onChange=()=>{}}){
    this.file=file;this.safeStorage=safeStorage;this.fetchImpl=fetchImpl;this.onChange=onChange;
    this.queue=Promise.resolve();this.generating=false;this.consentVersion=0;this.secrets=new Set();
  }
  encryptionAvailable(){return Boolean(this.safeStorage?.isEncryptionAvailable())&&this.safeStorage.getSelectedStorageBackend?.()!=='basic_text'}
  remember(settings){for(const field of credentials)if(settings[field])this.secrets.add(settings[field]);return settings}
  redact(value){
    if(typeof value==='string'){for(const secret of this.secrets)value=value.split(secret).join('[redacted]');return value}
    if(Array.isArray(value))return value.map(v=>this.redact(v));
    if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>!(/apikey|token|secret/i.test(key))).map(([key,v])=>[key,this.redact(v)]));
    return value;
  }
  public(settings){return this.redact(C.publicSettings(settings))}
  async read(){await this.queue;return this.readFile()}
  async readFile(){
    let raw;
    try{raw=await fs.readFile(this.file,'utf8')}
    catch(error){if(error.code==='ENOENT')return C.migrate({activeAI:'ollama',ollamaUrl:'http://localhost:11434',models:{ollama:''}});throw Error('Could not read desktop settings.')}
    let envelope;
    try{envelope=JSON.parse(raw);if(envelope.version!==1||!isObject(envelope.settings)||!isObject(envelope.credentials)||credentials.some(k=>Object.hasOwn(envelope.settings,k))||Object.keys(envelope.credentials).some(k=>!credentials.includes(k)||typeof envelope.credentials[k]!=='string'))throw Error()}
    catch{throw Error('Desktop settings are corrupt. Restore or repair the settings file before continuing.')}
    const result=C.migrate(envelope.settings);
    if(Object.keys(envelope.credentials).length){
      if(!this.encryptionAvailable())throw Error('Secure OS encryption is unavailable. Unlock your keychain to read saved credentials.');
      try{for(const [field,encrypted]of Object.entries(envelope.credentials))result[field]=this.safeStorage.decryptString(Buffer.from(encrypted,'base64'))}
      catch{throw Error('Saved credentials could not be decrypted. Restore access to the original OS keychain.')}
    }
    return this.remember(result);
  }
  async writeFile(settings){
    const stored={...settings},encrypted={};
    for(const field of credentials){
      if(stored[field]){
        if(!this.encryptionAvailable())throw Error('Secure OS encryption is unavailable. API keys cannot be saved without a keychain.');
        encrypted[field]=this.safeStorage.encryptString(stored[field]).toString('base64');
      }delete stored[field];
    }
    const temporary=this.file+'.'+randomUUID()+'.tmp';
    await fs.mkdir(path.dirname(this.file),{recursive:true});
    try{await fs.writeFile(temporary,JSON.stringify({version:1,settings:stored,credentials:encrypted}),{mode:0o600,flag:'wx'});await fs.rename(temporary,this.file)}
    catch{throw Error('Could not save desktop settings.')}
    finally{await fs.rm(temporary,{force:true}).catch(()=>{})}
    this.remember(settings);
  }
  transaction(update){
    const work=this.queue.then(async()=>{const current=await this.readFile();const next=await update(current);await this.writeFile(next);const result=this.public(next);try{this.onChange(result)}catch{}return result});
    this.queue=work.catch(()=>{});return work;
  }
  record(kind,detail=''){
    return this.transaction(data=>{
      const deltas={like:{swipes:1,likes:1},pass:{swipes:1,nopes:1},message:{messages:1},draft:{drafts:1}};
      if(data.sessionAnalytics.date!==C.today())data.sessionAnalytics={...C.counts(),date:C.today()};
      for(const [k,v]of Object.entries(deltas[kind]||{})){data.allTimeAnalytics[k]+=v;data.sessionAnalytics[k]+=v}
      data.activity.unshift({id:randomUUID(),kind,detail:this.redact(detail).slice(0,140),time:Date.now()});data.activity=data.activity.slice(0,100);return data;
    });
  }
  async request(action,data={}){
    try{return this.redact(await this.route(action,data))}
    catch(error){throw Error(this.redact(error?.message||'Desktop request failed.'))}
  }
  async route(action,data){
    switch(action){
      case 'load':return this.public(await this.read());
      case 'save':return this.transaction(settings=>{const next=patchSettings(settings,data);if(settings.sidebarConsentGiven&&!next.sidebarConsentGiven)this.consentVersion++;return next});
      case 'models':case 'test':{
        object(data,'provider request');const settings=await this.read();
        if(data.provider!==undefined){if(typeof data.provider!=='string'||!Object.hasOwn(C.providers,data.provider))throw Error('Unknown provider.');settings.activeAI=data.provider}
        if(settings.activeAI==='ollama')settings.ollamaUrl=C.localURL(data.ollamaUrl??settings.ollamaUrl);
        const models=await AI.listModels(settings,this.fetchImpl);
        return {models,message:models.length?`Connected. Found ${models.length} ${settings.activeAI==='ollama'?'installed':'text'} model${models.length===1?'':'s'}. No message was generated.`:'Connected, but no models were found.'};
      }
      case 'generate':{
        if(this.generating)throw Error('A draft is already being generated.');this.generating=true;
        const version=this.consentVersion;
        try{
          const settings=await this.read();if(!settings.sidebarConsentGiven)throw Error('Finish setup and grant consent before generating a draft.');
          object(data,'generation request');object(data.context,'context');
          let context;try{context=JSON.stringify(data.context)}catch{throw Error('Invalid context.')}
          if(context.length>18000||context==='{}')throw Error('Add context using fewer than 18000 characters.');
          const options={...settings.messagingConfig,...messaging(data.options===undefined?{}:data.options,true)};
          const result=await AI.generate(settings,C.prompt(data.context,options),this.fetchImpl);
          await this.queue;
          if(version!==this.consentVersion||!(await this.read()).sidebarConsentGiven)throw Error('Consent was revoked. Draft discarded.');
          await this.record('draft',`${C.providers[result.provider].short} · ${result.modelUsed}`);return result;
        }finally{this.generating=false}
      }
      case 'record':object(data,'activity event');if(!events.has(data.kind))throw Error('Invalid activity event.');return this.record(data.kind,string(data.detail??'','activity detail',2000));
      case 'clearActivity':return this.transaction(settings=>({...settings,activity:[]}));
      case 'revoke':this.consentVersion++;return this.transaction(settings=>({...settings,sidebarConsentGiven:false,hasCompletedOnboarding:false,messagingConfig:{...settings.messagingConfig,autoSend:false,autoMessageOnMatch:false}}));
      default:throw Error('Unknown workspace action.');
    }
  }
}
module.exports=Service;
