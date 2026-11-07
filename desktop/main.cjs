'use strict';
const {app,BrowserWindow,WebContentsView,ipcMain,safeStorage,shell,dialog,Menu,net,nativeImage} = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const {pathToFileURL} = require('node:url');
const {randomUUID} = require('node:crypto');
const Service = require('./service.cjs');
const Android = require('./android.cjs');
const MobileController = require('./mobile-controller.cjs');
const { phones, usesManagedPhone, ManagedPhone } = require('./managed-phone.cjs');
const P = require('./policy.cjs');
const LocationPermission = require('./location-permission.cjs');
const androidURL = pathToFileURL(path.join(__dirname,'android.html')).href;
let androidWindow, popoutSerial, popoutPlatform;
let mobileWatchTimer, quitting=false;
const mobileSessions=new Map();
function mobileSession(platform) {
  if (!Object.hasOwn(phones, platform)) throw Error('Choose Hinge or Bumble first.');
  if (!mobileSessions.has(platform)) {
    const device = new Android({sdkRoot:androidPreferences.sdkRoot, graphicsMode:androidPreferences.platforms?.[platform]?.graphicsMode});
    mobileSessions.set(platform, {device, managed:new ManagedPhone(platform,device), commands:Promise.resolve(), revision:0});
  }
  return mobileSessions.get(platform);
}
const uiURL = pathToFileURL(path.join(__dirname,'index.html')).href;
let locationPermission;
let window, tinder, service, activePlatform = 'tinder', viewVisible = false;
const webMode = process.env.SPICYSWIPE_WEB === '1';
const managedAndroid = webMode && process.env.SPICYSWIPE_MANAGED_ANDROID === '1';
let webServer, loginPopup, webVisible = false;
const webLocation = webMode ? new (require('../web/location.cjs'))({getContents:()=>tinder?.webContents}) : null;
const pending = new Map();
let androidPreferences={},androidPreferenceWrites=Promise.resolve();
async function persistAndroid(patch,platform){
 androidPreferences=platform?{...androidPreferences,platforms:{...androidPreferences.platforms,[platform]:{...androidPreferences.platforms?.[platform],...patch}}}:{...androidPreferences,...patch};const snapshot=JSON.stringify(androidPreferences);
 androidPreferenceWrites=androidPreferenceWrites.catch(()=>{}).then(()=>fs.writeFile(path.join(app.getPath('userData'),'android.json'),snapshot,{mode:0o600}));await androidPreferenceWrites;
}
const mobileControllers = new Map();
function invalidateMobile(reason,force=false,platform){
 for(const [key,session] of mobileSessions)if(!platform||key===platform)session.revision++;
 for(const [key,c] of mobileControllers)if((!platform||key===platform)&&(force||c.busy||c.screen||c.draft||c.session.status==='running'))c.invalidate(reason,{stop:force});
}
const drainMobile=platform=>Promise.all([...mobileControllers].filter(([key])=>!platform||key===platform).map(([,c])=>c.drain()));
function getMobile(platform=activePlatform){
 if(!['hinge','bumble'].includes(platform))throw Error('Choose Hinge or Bumble first.');
 if(!mobileControllers.has(platform)){
  const device=mobileSession(platform).device;
  mobileControllers.set(platform,new MobileController({android:device,service,platform:platform,recoverDevice:options=>device.recover({...options,supervised:managedAndroid&&device.serial===phones[platform].serial}),checkpointStore:new (require('./mobile-checkpoint.cjs'))(path.join(app.getPath('userData'),'sessions',platform+'.json')),changed:state=>send('mobile:state',state),readEvidence:async (screen,signal)=>{
   const picture=nativeImage.createFromDataURL(await device.screenshot());
   return require('./mobile-vision.cjs').evidence(picture,screen,{signal,fromBitmap:(bytes,size)=>nativeImage.createFromBitmap(bytes,size)});  }}));
 }
 return mobileControllers.get(platform);
}
const send = (type,data) => { webServer?.emit({type,data}); if (window && !window.isDestroyed()) window.webContents.send('desktop:event',{type,data}); };
function trusted(event) { return window && event.sender === window.webContents && event.senderFrame === event.sender.mainFrame && P.isTrustedUI(event.senderFrame.url,uiURL); }
function trustedTinder(event) { return tinder && !tinder.webContents.isDestroyed() && event.sender === tinder.webContents && event.senderFrame === event.sender.mainFrame && P.isTinderURL(event.senderFrame.url); }
function tinderSettings(data) { return {...data,desktopActive:true,desktopHost:true,desktopVisible:webMode ? webVisible : !!window&&!window.isMinimized?.()&&window.isVisible?.()!==false}; }
function cancelPending() { for (const p of pending.values()) { clearTimeout(p.timer); p.reject(Error('Tinder navigated or closed. Refresh its context before continuing.')); } pending.clear(); }
function page(action,data) {
  if (!['context','insert','send','start','pause','stop','discover','dismissDraft'].includes(action)) return Promise.reject(Error('Unknown page action.'));
  if (!tinder || tinder.webContents.isDestroyed() || !P.isTinderURL(tinder.webContents.getURL())) return Promise.reject(Error('Open Tinder in the app and sign in first.'));
  return new Promise((resolve,reject) => {
    const id = randomUUID();
    const timer = setTimeout(() => { pending.delete(id); reject(Error('Tinder did not respond. Wait for the page to load or reload Tinder.')); },15000);
    pending.set(id,{resolve,reject,timer});
    tinder.webContents.send('tinder:command',{id,action,data});
  });
}
function guardNavigation(contents, local = false) {
  contents.on('will-navigate', (event,url) => { if (local ? !P.isTrustedUI(url,uiURL) : !P.isLoginURL(url)) event.preventDefault(); });
  contents.on('will-redirect', (event,url) => { if (local ? !P.isTrustedUI(url,uiURL) : !P.isLoginURL(url)) event.preventDefault(); });
  contents.setWindowOpenHandler(({url}) => {
    if (!local && P.isLoginURL(url)) return {action:'allow',overrideBrowserWindowOptions:{width:520,height:760,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,preload:undefined,partition:'persist:tinder'}}};
    if (local && /^https:\/\//.test(url)) shell.openExternal(url).catch(()=>{});
    return {action:'deny'};
  });
  contents.on('did-create-window', child => {
    guardNavigation(child.webContents);
    if(webMode && !local) loginPopup = child;
  });
}
function ensureTinder() {
  if (tinder && !tinder.webContents.isDestroyed()) return;
  tinder = new WebContentsView({webPreferences:{preload:path.join(__dirname,'generated','tinder-preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false,partition:'persist:tinder',backgroundThrottling:false}});
  window.contentView.addChildView(tinder); tinder.setVisible(false);
  guardNavigation(tinder.webContents);
  (webLocation || locationPermission).attach(tinder.webContents.session);
  tinder.webContents.on('did-start-navigation', (_event,_url,_inPlace,isMainFrame) => { if (isMainFrame) {cancelPending();if(webMode && !P.isTinderURL(_url))webLocation.stop(undefined,false);} });
  tinder.webContents.on('render-process-gone', () => {cancelPending();send('page',{connected:false,error:'Tinder closed unexpectedly. Reload it to reconnect.'});});
  tinder.webContents.on('did-fail-load', (_event,code,description,_url,isMainFrame) => {if(isMainFrame && code!==-3)send('notice',{message:'Tinder could not load: '+description,error:true});});
  tinder.webContents.loadURL('https://tinder.com/app/recs').catch(error=>send('notice',{message:error.message,error:true}));
}
function closeAndroidWindow(){if(androidWindow&&!androidWindow.isDestroyed())androidWindow.close();}
async function openAndroidWindow(platform=activePlatform){
  const android=mobileSession(platform).device,info=await android.inspect();
  if(!window||window.isDestroyed())throw Error('Workspace closed. Reopen SpicySwipe.');
  if(platform==='tinder')throw Error('Choose Hinge or Bumble first.');
  if(androidWindow&&!androidWindow.isDestroyed()){androidWindow.show();androidWindow.focus();return {open:true};}
  popoutSerial=info.serial;popoutPlatform=platform;
  const child=new BrowserWindow({width:560,height:1000,minWidth:360,minHeight:500,show:false,title:'Android · SpicySwipe',backgroundColor:'#faf8f4',webPreferences:{preload:path.join(__dirname,'android-preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false}});
  androidWindow=child;
  const wc=child.webContents;
  for(const eventName of ['will-navigate','will-redirect'])wc.on(eventName,(event,url)=>{if(!P.isTrustedUI(url,androidURL))event.preventDefault();});
  wc.setWindowOpenHandler(()=>({action:'deny'}));
  wc.on('will-attach-webview',event=>event.preventDefault());
  wc.session.setPermissionRequestHandler((_wc,_permission,cb)=>cb(false));
  child.once('ready-to-show',()=>child.show());
  child.on('closed',()=>{if(androidWindow===child){androidWindow=null;popoutSerial=null;popoutPlatform=null;send('android:popout',{open:false});}});
  send('android:popout',{open:true});
  try{await child.loadFile(path.join(__dirname,'android.html'));}catch(error){closeAndroidWindow();throw error;}
  return {open:true};
}
const popoutActions=new Set(['android:screenshot','android:tap','android:swipe','android:back','android:key','android:type','android:open','android:store']);
ipcMain.handle('android:request',async(event,action,data={})=>{
  const wc=androidWindow?.webContents;
  if(!wc||androidWindow.isDestroyed()||event.sender!==wc||event.senderFrame!==wc.mainFrame||!P.isTrustedUI(event.senderFrame.url,androidURL))throw Error('Untrusted Android request.');
  if(action==='dock'){invalidateMobile('Android window changed.',false,popoutPlatform);mobileSession(popoutPlatform).device.cancelInput();closeAndroidWindow();return {ok:true};}
  if(!popoutPlatform||!popoutSerial||mobileSession(popoutPlatform).device.serial!==popoutSerial)throw Error('Android device changed. Reopen the preview.');
  if(action==='state')return {serial:popoutSerial,platform:popoutPlatform};
  if(!popoutActions.has(action))throw Error('Unsupported Android request.');
  return dispatch(action,{...data,platform:popoutPlatform});
});
async function dispatch(action,data={}) {
  const platform=data.platform??activePlatform;
  const session=(action.startsWith('android:')&&!['android:docs','android:sdk'].includes(action))||action==='mobile:request'?mobileSession(platform):null;
  const android=session?.device;

  if(action==='revoke'||(action==='save'&&data.sidebarConsentGiven===false))invalidateMobile('Consent revoked.',true);
  if (['load','save','models','test','generate','record','clearActivity','revoke'].includes(action)) return service.request(action,data);
  if(action==='mobile:request'){
    if(!data||typeof data.action!=='string'||(data.data!==undefined&&(!data.data||typeof data.data!=='object'||Array.isArray(data.data))))throw Error('Invalid mobile request.');
    const c=getMobile(platform),revision=session.revision,device=android;
    if(['pause','stop'].includes(data.action))session.revision++;
    if(['status','pause','stop','visibility'].includes(data.action))return c.request(data.action,data.data);
    await session.commands;
    if(revision!==session.revision||device!==session.device)throw Error('Mobile context changed. Retry from the current screen.');
    return c.request(data.action,data.data);
  }
  if (action==='ollamaAccess') return {granted:true};
  if (action==='info') return {version:app.getVersion(),platform:process.platform,arch:process.arch};
  if (action==='platform') {
    if (!['tinder','hinge','bumble'].includes(data.platform)) throw Error('Unknown platform.');
    if(activePlatform!==data.platform)closeAndroidWindow();
    activePlatform=data.platform; if(tinder){tinder.setVisible(activePlatform==='tinder'&&viewVisible);tinder.webContents.send('tinder:settings',tinderSettings(await service.request('load')));} return {platform:activePlatform};
  }
  if (action==='openTinder') {ensureTinder();return {opened:true};}
  if (action==='reloadTinder') {ensureTinder();await page('stop').catch(()=>{});tinder.webContents.reload();return {ok:true};}
  if (action==='bounds') {
    const [width,height]=window.getContentSize(); const bounds=P.validateBounds(data,{width,height});
    viewVisible=Boolean(data.visible)&&activePlatform==='tinder';
    if(tinder){tinder.setBounds(bounds);tinder.setVisible(viewVisible && bounds.width>0 && bounds.height>0);}return {ok:true};
  }
  if(action==='page') {
    if(data.action==='context'&&(activePlatform!=='tinder'||!tinder||tinder.webContents.isDestroyed()))return {connected:false,context:{},session:{status:'idle'}};
    return page(data.action,data.data);
  }
  if(action==='android:status') {
    const preference=androidPreferences.platforms?.[platform];
    return {...await android.status(),preferredSerial:preference?.preferredSerial||null,preferredAvd:preference?.preferredAvd||phones[platform].avd,
      managedSerial:managedAndroid?phones[platform].serial:null,managedSerials:managedAndroid?Object.values(phones).map(phone=>phone.serial):[],
      usesManagedDevice:usesManagedPhone(platform,preference,managedAndroid)};
  }
  if(action==='android:prepareManaged') {
    const current=()=>usesManagedPhone(platform,androidPreferences.platforms?.[platform],managedAndroid)&&!session.selectionToken;
    if(!current())throw Error('Choose the managed phone in Advanced settings first.');
    if(session.preparing)return session.preparing;
    const revision=session.revision;
    const preparation=session.commands.then(async()=>{
      const statusFile=path.join(process.env.HOME,'android-runtime','status');
      const stage=await fs.readFile(statusFile,'utf8').then(s=>s.trim()).catch(()=>'');
      const detail={
        installing:'Downloading and verifying Android for the first installation. Both phones will start automatically.',
        retrying:'The Android download failed. The server will retry automatically.',
        unsupported:'The managed Android image requires an x86-64 server.'
      }[stage];
      if(detail)return {ready:false,phase:stage,detail,serial:phones[platform].serial,needsInstall:false};
      return session.managed.prepare(()=>revision===session.revision&&current()).catch(error=>{
        // ADB can briefly disconnect while Android restarts system services on first boot.
        if(!Android.transientCommandFailure(error)&&error.code!=='ANDROID_DEVICE_UNAVAILABLE')throw error;
        return {ready:false,phase:'booting',detail:'Android is reconnecting. Your phone will open automatically.',serial:phones[platform].serial,needsInstall:false};
      });
    });
    session.commands=preparation.catch(()=>{});
    session.preparing=preparation;
    try{return await preparation;}finally{if(session.preparing===preparation)session.preparing=null;}
  }
  if(action==='android:useManaged') {
    if(!managedAndroid)throw Error('Managed phones are unavailable on this installation.');
    invalidateMobile('Device changed.',false,platform);
    const revision=session.revision;
    android.cancelInput();
    await drainMobile(platform);
    if(revision!==session.revision)throw Error('Device selection changed.');
    android.serial=null;
    session.managed.opened=null;
    await persistAndroid({deviceChoice:'managed',preferredSerial:null,preferredAvd:phones[platform].avd},platform);
    return {ok:true};
  }
  if(action==='android:sdk') {
    const result=await dialog.showOpenDialog(window,{title:'Choose Android SDK folder',properties:['openDirectory']});
    if(result.canceled)return {canceled:true};
    const next=new Android({sdkRoot:result.filePaths[0]});
    const status=await next.status();if(!status.available)throw Error('This folder does not contain platform-tools/adb. Choose the Android SDK folder.');
    invalidateMobile('Android SDK changed.');await drainMobile();closeAndroidWindow();for(const state of mobileSessions.values())state.device.dispose();mobileSessions.clear();mobileControllers.clear();
    await persistAndroid({sdkRoot:status.sdkRoot});return status;
  }
  if(action==='android:start'){
    if(managedAndroid&&Object.values(phones).some(phone=>phone.avd===data.avd))throw Error('Assigned phones start automatically.');
    const result=await android.start(data.avd);await persistAndroid({preferredAvd:data.avd},platform);return result;
  }
  if(action==='android:boot')return android.bootStatus(data.avd);
  if(action==='android:select'){
    if(managedAndroid&&Object.entries(phones).some(([key,phone])=>key!==platform&&phone.serial===data.serial))throw Error('This phone is reserved for the other app.');
    if([...mobileSessions].some(([key,state])=>key!==platform&&(state.device.serial===data.serial||state.pendingSerial===data.serial)))throw Error('This device belongs to another platform. Choose its dedicated emulator.');
    const selectionToken={};session.selectionToken=selectionToken;session.pendingSerial=data.serial;
    invalidateMobile('Device changed.',false,platform);const revision=session.revision,device=android;
    try{
      android.cancelInput();
      await drainMobile(platform);
      if(revision!==session.revision)throw Error('Device selection changed.');if(popoutPlatform===platform)closeAndroidWindow();
      const result=await device.select(data.serial);if(revision!==session.revision||device.serial!==data.serial)throw Error('Device selection changed.');
      session.managed.opened=null;
      const choice=managedAndroid?{deviceChoice:data.serial===phones[platform].serial?'managed':'custom'}:{};
      await persistAndroid({preferredSerial:data.serial,...choice},platform);return result;
    }finally{if(session.selectionToken===selectionToken){session.pendingSerial=null;session.selectionToken=null;}}
  }
  if(action==='android:popout'){invalidateMobile('Android window changed.',false,platform);await drainMobile(platform);return openAndroidWindow(platform);}
  if(action==='android:dock'){invalidateMobile('Android window changed.',false,platform);android.cancelInput();closeAndroidWindow();return {ok:true};}
  if(action==='android:inspect')return android.inspect();
  if(action==='android:screenshot')return android.screenshot();
  if(action==='android:docs'){await shell.openExternal('https://developer.android.com/studio/run/managing-avds');return {ok:true};}
  const mutations={
    'android:open':device=>device.openApp(platform),'android:store':device=>device.openStore(platform),
    'android:settings':device=>device.openSettings(),
    'android:tap':device=>device.tap(data.x,data.y),'android:swipe':device=>device.swipe(data.direction),
    'android:back':device=>device.back(),'android:key':device=>device.key(data.key),'android:type':device=>device.type(data.text)
  };
  if(Object.hasOwn(mutations,action)){
    invalidateMobile('Manual device input.',false,platform);
    if(platform==='tinder')throw Error('Choose Hinge or Bumble first.');
    const device=android,serial=device.serial,epoch=device.inputEpoch;
    // Each platform owns a mutation lane shared by its docked and detached controls.
    const revision=session.revision;const task=session.commands.then(async()=>{
      await drainMobile(platform);
      if(revision!==session.revision||device!==session.device||serial!==device.serial||epoch!==device.inputEpoch)throw Error('Android input context changed. Pending input was canceled.');
      return mutations[action](device);
    });
    session.commands=task.catch(()=>{});
    return task;
  }
  throw Error('Unknown desktop action.');
}
ipcMain.handle('desktop:request',async(event,action,data)=>{if(!trusted(event)||typeof action!=='string')throw Error('Untrusted desktop request.');return dispatch(action,data);});
ipcMain.handle('tinder:service',async(event,action,data)=>{if(!trustedTinder(event)||!P.allowedTinderAction(action))throw Error('Untrusted Tinder request.');const result=await service.request(action,data);return action==='load'?tinderSettings(result):result;});
ipcMain.on('tinder:result',(event,data)=>{if(!trustedTinder(event))return;const p=pending.get(data?.id);if(!p)return;pending.delete(data.id);clearTimeout(p.timer);data.error?p.reject(Error(data.error)):p.resolve(data.result);});
ipcMain.on('tinder:state',(event,data)=>{if(trustedTinder(event))send('page',data);});
function scheduleMobileWatch(){
 if(quitting)return;
 mobileWatchTimer=setTimeout(async()=>{
  for(const [platform,c] of mobileControllers){
   if(window&&!window.isDestroyed()&&c.openerArmed&&mobileSession(platform).device.serial&&!c.busy){
    try{await dispatch('mobile:request',{platform,action:'watch'})}catch(error){c.invalidate('Opener watcher stopped: '+error.message);}
   }
  }
  scheduleMobileWatch();
 },15000);mobileWatchTimer.unref?.();
}
async function createWindow() {
  activePlatform='tinder';viewVisible=false;
  window = new BrowserWindow({width:1460,height:960,minWidth:1050,minHeight:700,show:false,title:'SpicySwipe',backgroundColor:'#faf8f4',webPreferences:{preload:path.join(__dirname,'preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false}});
  guardNavigation(window.webContents,true);
  window.webContents.session.setPermissionRequestHandler((_wc,_permission,cb)=>cb(false));
  window.webContents.on('will-attach-webview',event=>event.preventDefault());
  window.once('ready-to-show',()=>window.show());
  for(const event of ['minimize','hide'])window.on(event,()=>{if(tinder)service.request('load').then(settings=>tinder?.webContents.send('tinder:settings',{...tinderSettings(settings),desktopVisible:false}));for(const c of mobileControllers.values())c.request('visibility',{visible:false});});
  for(const event of ['restore','show'])window.on(event,()=>{if(tinder)service.request('load').then(settings=>tinder?.webContents.send('tinder:settings',{...tinderSettings(settings),desktopVisible:true}));for(const c of mobileControllers.values())c.request('visibility',{visible:true});});
  window.on('closed',()=>{invalidateMobile('Workspace closed.');closeAndroidWindow();cancelPending();if(tinder&&!tinder.webContents.isDestroyed())tinder.webContents.close();tinder=null;window=null;});
  if(webMode){window.show();return;}
  await window.loadFile(path.join(__dirname,'index.html'));
}
if(!app.requestSingleInstanceLock())app.quit();
else {
 app.on('second-instance',()=>{if(window){if(window.isMinimized())window.restore();window.focus();}});
 app.whenReady().then(async()=>{
  service = new Service({file:path.join(app.getPath('userData'),'settings.json'),safeStorage:webMode ? require('../web/server.cjs').credentialStore(process.env.SPICYSWIPE_STORAGE_KEY) : safeStorage,fetchImpl:(input,init)=>net.fetch(input,{...init,credentials:'omit',bypassCustomProtocolHandlers:true}),onChange:data=>{send('settings',data);if(tinder&&!tinder.webContents.isDestroyed()&&P.isTinderURL(tinder.webContents.getURL()))tinder.webContents.send('tinder:settings',tinderSettings(data));}});
  let androidConfig={};try{androidConfig=JSON.parse(await fs.readFile(path.join(app.getPath('userData'),'android.json'),'utf8'));}catch{}
  androidPreferences={...(typeof androidConfig.sdkRoot==='string'?{sdkRoot:androidConfig.sdkRoot}:{}),...(typeof androidConfig.preferredSerial==='string'?{preferredSerial:androidConfig.preferredSerial}:{}),...(typeof androidConfig.preferredAvd==='string'?{preferredAvd:androidConfig.preferredAvd}:{})};
  androidPreferences.platforms=androidConfig.platforms||{hinge:{preferredSerial:androidConfig.preferredSerial,preferredAvd:androidConfig.preferredAvd}};
  locationPermission=new LocationPermission({file:path.join(app.getPath('userData'),'location-permission.json'),fsImpl:fs,getContents:()=>tinder?.webContents,
   prompt:async()=>{if(webMode)return false;const result=await dialog.showMessageBox(window,{type:'question',title:'Tinder location access',message:'Allow Tinder to use your location?',detail:'Tinder uses your device location to show nearby profiles. SpicySwipe will remember your approval. You can turn access off in the Privacy menu.',buttons:['Not now','Allow location'],defaultId:0,cancelId:0});return result.response===1;},
   onChange:allowed=>{const item=Menu.getApplicationMenu()?.getMenuItemById('tinder-location');if(item)item.checked=allowed;},
   onError:error=>dialog.showErrorBox('Location permission could not be saved',error.message)
  });
  if(!webMode)await locationPermission.load();
  Menu.setApplicationMenu(Menu.buildFromTemplate([...(process.platform==='darwin'?[{label:'SpicySwipe',submenu:[{role:'about'},{type:'separator'},{role:'hide'},{role:'quit'}]}]:[]),{label:'Edit',submenu:[{role:'undo'},{role:'redo'},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]},{label:'Privacy',submenu:[{id:'tinder-location',label:'Allow Tinder location',type:'checkbox',checked:locationPermission.allowed,click:async item=>{const revoking=!item.checked;try{await locationPermission.setAllowed(item.checked);}catch(error){item.checked=locationPermission.allowed;dialog.showErrorBox('Location permission could not be saved',error.message+' Your change may not survive restarting SpicySwipe.');}finally{if(revoking&&tinder&&!tinder.webContents.isDestroyed())tinder.webContents.reload();}}}]},{label:'Window',submenu:[{role:'minimize'},{role:'zoom'},{role:'close'}]}]));
  await createWindow();
  if(webMode){
    webServer = await require('../web/server.cjs').start({password:process.env.SPICYSWIPE_PASSWORD,onPresence:visible=>{
      webVisible=visible;
      if(!visible)for(const c of mobileControllers.values())c.request('visibility',{visible:false}).catch(()=>{});
      if(tinder&&!tinder.webContents.isDestroyed())service.request('load').then(settings=>tinder?.webContents.send('tinder:settings',tinderSettings(settings))).catch(()=>{});
    },onSessionDisconnect:session=>webLocation.stop(session),request:async(action,data,session)=>{
      if(action==='web:location'){
        if(!session.streams.size)throw Error('Reconnect to the workspace before sharing location.');
        return webLocation.share(data,session);
      }
      if(action==='web:locationStop')return webLocation.stop();
      if(action==='web:locationStatus')return webLocation.status();
      if(['android:sdk','android:docs','android:popout','android:dock'].includes(action))throw Error('This action requires a desktop window.');
      if(action==='web:frame'||action==='web:input'){
        const target=loginPopup && !loginPopup.isDestroyed()?loginPopup.webContents:tinder?.webContents;
        return require('../web/tinder.cjs')(action,data,target);
      }
      if(action==='web:visibility'){
        webVisible=data.visible===true;
        if(tinder&&!tinder.webContents.isDestroyed())tinder.webContents.send('tinder:settings',tinderSettings(await service.request('load')));
        return {ok:true};
      }
      if(action==='bounds')data={...data,x:0,y:0,width:Math.max(360,Math.min(1000,data.width||600)),height:780};
      if(action==='android:status' && data.platform==='tinder')data={...data,platform:'hinge'};
      return dispatch(action,data);
    }});
  }
  scheduleMobileWatch();
 }).catch(error=>{if(webMode){console.error(error.message);app.exit(1);}else{dialog.showErrorBox('SpicySwipe could not start',error.message);app.quit();}});
 app.on('activate',()=>{if(!window&&service)createWindow();});
 app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
 app.on('before-quit',()=>{quitting=true;clearTimeout(mobileWatchTimer);invalidateMobile('Application closed.');for(const state of mobileSessions.values())state.device.dispose();});
}
