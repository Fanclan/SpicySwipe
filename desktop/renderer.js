(async()=>{
 'use strict';
 const api=window.spicyDesktop,$=s=>document.querySelector(s);
 let platform='tinder', live=false, settingsOpen=false, selected=false, deviceBusy=false, deviceEpoch=0, toastTimer;
 let frameTask=null, frameRequested=false, previewTimer, previewFailed=false, popoutOpen=false;
 let bootAttempt=null, bootTimer, bootPollTask=null, devicesStatus=null, connectingDevice=false, devicesRefreshEpoch=0;
 let setupEpoch=0, rememberedSerial='', rememberedAvd='', connectingSetup=null, programmaticDeviceCloses=0, preparingMobile=null;
 const listeners=new Set(), mobileDrafts={}, deviceStates={}, sessionStates={};
 const dedicatedAvds={hinge:"SpicySwipe_Phone_API_36",bumble:"SpicySwipe_Bumble_API_36"};
 function notice(message,error=false){const inDialog=$('#devices-dialog').open,el=$(inDialog?'#device-notice':'#notice');el.textContent=message;el.classList.toggle('error',error);el.hidden=false;clearTimeout(toastTimer);if(inDialog){el.scrollIntoView?.({block:'nearest'});return;}toastTimer=setTimeout(()=>el.hidden=true,error?9000:4500);}
 const request=(action,data)=>api.request(action,action.startsWith('android:')||action==='mobile:request'?{...data,platform:data?.platform||platform}:data);
 function bind(id,fn){$(id).addEventListener('click',async event=>{const button=event.currentTarget;if(button.disabled)return;button.disabled=true;try{await fn();}catch(e){notice(e.message,true);}finally{button.disabled=false;}});}
 async function bounds(){const el=$('#tinder-frame'),r=el.getBoundingClientRect();await request('bounds',{x:r.x,y:r.y,width:r.width,height:r.height,visible:platform==='tinder'&&live&&!$('#devices-dialog').open&&!settingsOpen&&Boolean($('#workspace .modal-layer')?.hidden)}).catch(()=>{});}
 function layout(){
  const showTinder=platform==='tinder'||settingsOpen;
  $('#tinder-area').hidden=!showTinder;$('#android-area').hidden=showTinder;
  $('#tinder-frame').hidden=!live||settingsOpen||platform!=='tinder';
  $('#tinder-layout').classList.toggle('split',live&&!settingsOpen&&platform==='tinder');
  $('#toggle-tinder').textContent=live?'Hide Tinder':'Open Tinder alongside workspace ↗';
  $('#reload-tinder').hidden=!live||platform!=='tinder';$('#toggle-tinder').hidden=platform!=='tinder';$('#workspace-label').textContent=settingsOpen?'Shared AI settings':'Your Tinder workspace';$('#settings-button').textContent=settingsOpen?'Back to app':'AI settings';
  $('#platform-name').textContent=platform==='bumble'?'Bumble':'Hinge';
  document.querySelectorAll('[data-platform]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.platform===platform)));
  mobileAutomation?.setConnected(selected);
  for(const target of ['hinge','bumble'])request('mobile:request',{platform:target,action:'visibility',data:{visible:!document.hidden}}).catch(()=>{});
  requestAnimationFrame(bounds);scheduleScreen(0);
 }
 async function openTinder(){if(platform!=='tinder')await choosePlatform('tinder');settingsOpen=false;await request('openTinder');live=true;layout();}
 const bridge={desktop:true,version:'3.0',load:()=>request('load'),save:data=>request('save',data),authorizeOllama:()=>Promise.resolve({granted:true}),subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},page:(action,data)=>request('page',{action,data}),request:(action,data)=>action==='openTinder'?openTinder():action==='dashboard'?Promise.resolve():request(action,data)};
 let workspace, mobileAutomation;
 try{workspace=await SSWorkspace.mount($('#workspace'),bridge);}catch(error){notice(error.message,true);$('#workspace').textContent='Unable to open your saved workspace: '+error.message;return;}
 mobileAutomation=SSMobileAutomation.mount($('#mobile-automation'),{platform,notify:notice,prepareStart:prepareSession,request:(action,data)=>platform==='tinder'?Promise.resolve(null):request('mobile:request',{action,data})});
 api.subscribe(event=>{if(event.type==='page'){const tab=document.querySelector('[data-platform="tinder"]');if(tab)tab.dataset.status=event.data.session?.status||'idle';}if(event.type==='mobile:state'){sessionStates[event.data.platform]=event.data;mobileAutomation.handleState(event.data);const tab=document.querySelector('[data-platform="'+event.data.platform+'"]');if(tab){tab.dataset.status=event.data.session?.status||'idle';tab.setAttribute('title',event.data.platform+': '+tab.dataset.status)}}if(event.type==='android:popout'){popoutOpen=event.data.open;deviceEpoch++;$('#phone-screen').hidden=true;$('#phone-empty').hidden=popoutOpen||selected;$('#phone-detached').hidden=!popoutOpen;$('#popout-device').textContent=popoutOpen?'Show window ↗':'Pop out ↗';$('#preview-status').textContent=popoutOpen?'Open in separate window':'Connecting…';scheduleScreen(0);}listeners.forEach(fn=>fn(event));if(event.type==='notice')notice(event.data.message,event.data.error);});
 function closeDevicesProgrammatically(){
  if(!$('#devices-dialog').open)return;
  // Native close events are queued, so retain ownership until the event arrives.
  programmaticDeviceCloses++;$('#devices-dialog').close();
 }
 function setupCurrent(setup){return setup.epoch===setupEpoch&&setup.platform===platform&&platform!=='tinder'}
 async function choosePlatform(next){
  if(deviceBusy)throw Error('Wait for the current device action to finish.');
  if(next===platform&&bootAttempt?.auto&&bootBusy())return;
  const revision=++setupEpoch;devicesRefreshEpoch++;
  if(bootAttempt?.auto){bootAttempt=null;clearTimeout(bootTimer);renderStartup()}
  closeDevicesProgrammatically();
  await request('platform',{platform:next});if(revision!==setupEpoch)return;
  if(platform!=='tinder')mobileDrafts[platform]=Object.fromEntries(['context','instruction','draft','tone'].map(key=>[key,$('#mobile-'+key).value]));
  if(platform!=='tinder')deviceStates[platform]={selected,rememberedSerial,rememberedAvd};
  platform=next;({selected=false,rememberedSerial='',rememberedAvd=''}=deviceStates[platform]||{});mobileAutomation.setPlatform(platform);mobileAutomation.setConnected(selected);
  for(const key of ['context','instruction','draft','tone'])$('#mobile-'+key).value=mobileDrafts[platform]?.[key]||(key==='tone'?'friendly':'');
  settingsOpen=false;deviceEpoch++;$('#phone-screen').hidden=true;$('#phone-empty').hidden=false;layout();
  if(platform!=='tinder'){if(selected){mobileAutomation.handleState(sessionStates[platform]);$('#device-label').textContent=rememberedSerial;}else await prepareMobile({epoch:revision,platform});}
 }
 async function prepareSession(valid){
  const revision=setupEpoch,target=platform,wasReady=selected&&!connectingDevice&&!preparingMobile;
  const current=()=>valid()&&revision===setupEpoch&&target===platform&&!settingsOpen;
  if(!['hinge','bumble'].includes(target))throw Error('Choose Hinge or Bumble to start a session.');
  if(!current())throw Error('Session start canceled.');
  if(!selected&&!preparingMobile&&!connectingDevice&&!bootBusy())await prepareMobile({epoch:revision,platform:target});
  const deadline=Date.now()+190000;
  while(current()){
   if(selected&&!preparingMobile&&!connectingDevice&&!bootBusy()){

    if(!current())throw Error('Session start canceled.');return;
   }
   if(!preparingMobile&&!connectingDevice&&!bootBusy())throw Error(bootAttempt?.phase==='error'?bootAttempt.detail:'Choose and connect an Android device in Devices, then press Start session.');
   if(Date.now()>=deadline)throw Error('Android is taking longer than expected. Check Devices, then press Start session.');
   await new Promise(resolve=>setTimeout(resolve,300));
  }
  throw Error('Session start canceled.');
 }
 async function prepareMobile(setup){
  preparingMobile=setup;setup.automatic=true;
  $('#preview-status').textContent='Finding your Android device…';
  try{
   const status=await refreshDevices();if(!setupCurrent(setup)||!status)return;
   const online=status.devices.filter(d=>d.state==='device');
   // The main process may already own a running session before this tab is visited.
   // Adopt that connection without reselecting the device or issuing manual app input.
   if(status.selectedSerial&&online.some(d=>d.id===status.selectedSerial)){
    const snapshot=await request('mobile:request',{platform:setup.platform,action:'status'});if(!setupCurrent(setup))return;
    selected=true;rememberedSerial=status.selectedSerial;deviceEpoch++;$('#device-label').textContent=rememberedSerial;
    sessionStates[setup.platform]=snapshot;layout();mobileAutomation.handleState(snapshot);return;
   }
   const avdName=status.preferredAvd||dedicatedAvds[setup.platform];
   const boot=await request('android:boot',{avd:avdName,platform:setup.platform});if(!setupCurrent(setup))return;
   const verifiedSerial=boot?.phase==='ready'?boot.serial:null;
   const physicalSerial=[rememberedSerial,status.preferredSerial].find(serial=>typeof serial==='string'&&!serial.startsWith('emulator-')&&online.some(d=>d.id===serial));
   const preferred=[verifiedSerial,physicalSerial].find(serial=>online.some(d=>d.id===serial));
   if(status.available!==false&&preferred){await connectDevice(preferred,setup);return}
   await openDevices({knownStatus:status,setup});if(!setupCurrent(setup))return;
   if(status.available===false){notice('Choose your Android SDK folder or install SDK Platform-Tools to continue.',true);return}
   const avd=[rememberedAvd,status.preferredAvd,dedicatedAvds[setup.platform]].find(name=>status.avds.includes(name));
   if(avd){$('#avd-select').value=avd;await startEmulator(avd,setup)}
   else notice(status.avds.length?'Choose an emulator, then click Start emulator.':'Connect a phone or create a Google Play emulator in Android Studio.');
  }catch(error){if(setupCurrent(setup)){await openDevices({knownStatus:devicesStatus,setup});if(setupCurrent(setup))notice(error.message,true)}}finally{if(preparingMobile===setup)preparingMobile=null}
 }
 document.querySelectorAll('[data-platform]').forEach(el=>el.addEventListener('click',()=>choosePlatform(el.dataset.platform).catch(e=>notice(e.message,true))));
 bind('#settings-button',async()=>{settingsOpen=!settingsOpen;layout();if(settingsOpen)workspace.navigate('settings');});
 bind('#toggle-tinder',async()=>{if(live){live=false;layout();}else await openTinder();});
 bind('#reload-tinder',()=>request('reloadTinder'));
 new MutationObserver(bounds).observe($('#workspace .modal-layer'),{attributes:true,attributeFilter:['hidden']});
 const observer=new ResizeObserver(bounds);observer.observe($('#tinder-frame'));window.addEventListener('resize',bounds);
 async function refreshDevices(){
  const revision=++devicesRefreshEpoch;let status;
  try{status=await request('android:status');}catch(error){if(revision!==devicesRefreshEpoch)return devicesStatus;throw error;}
  if(revision!==devicesRefreshEpoch)return devicesStatus;
  $('#sdk-details').textContent=`${status.architecture==='arm64'?'Apple Silicon / ARM64':'Architecture: '+status.architecture} · Recommended image: ${status.recommendedAbi}\nSDK: ${status.sdkRoot}`;
  devicesStatus=status;
  const avd=$('#avd-select'),previousAvd=avd.value;avd.replaceChildren(...status.avds.map(v=>new Option(v,v)));if(!status.avds.length)avd.add(new Option('No virtual devices found',''));else if(status.avds.includes(previousAvd))avd.value=previousAvd;else if(status.avds.includes(rememberedAvd||status.preferredAvd))avd.value=rememberedAvd||status.preferredAvd;
  const serial=$('#serial-select'),previousSerial=serial.value;serial.replaceChildren(...status.devices.map(d=>new Option(`${d.id} · ${d.state}`,d.id,false,d.id===status.selectedSerial)));for(const option of serial.options)option.disabled=!status.devices.some(d=>d.id===option.value&&d.state==='device');
  if(status.devices.some(d=>d.id===previousSerial&&d.state==='device'))serial.value=previousSerial;
  const online=status.devices.filter(d=>d.state==='device');if(!online.length)serial.add(new Option(bootBusy()?'Waiting for Android to start…':'No online devices — start an emulator',''));else if(!online.some(d=>d.id===serial.value))serial.value=online[0].id;
  renderStartup();
  $('#device-issues').textContent=status.issues.join(' ');
  if(selected&&!online.some(d=>d.id===(rememberedSerial||status.selectedSerial))){selected=false;mobileAutomation?.setConnected(false);deviceEpoch++;$('#phone-screen').hidden=true;$('#phone-empty').hidden=false;$('#device-label').textContent='Device disconnected';}
  return status;
 }
 async function openDevices({knownStatus,setup}={}){
  await request('bounds',{x:0,y:0,width:0,height:0,visible:false});if(setup&&!setupCurrent(setup))return;
  if(!$('#devices-dialog').open)$('#devices-dialog').showModal();$('#device-notice').hidden=true;
  if(!knownStatus)await refreshDevices();if(setup&&!setupCurrent(setup))return;
  if(bootBusy())await pollBoot();
 }
 bind('#device-button',openDevices);bind('#connect-device',openDevices);bind('#close-devices',()=>{$('#devices-dialog').close();layout();});$('#devices-dialog').addEventListener('close',()=>{
  clearTimeout(bootTimer);
  const programmatic=programmaticDeviceCloses>0;if(programmatic)programmaticDeviceCloses--;
  if(!programmatic&&((bootBusy()&&bootAttempt.auto)||connectingSetup?.automatic===true||connectingSetup?.readingContext===true)){
   if(bootAttempt?.auto)bootAttempt.auto=false;
   setupEpoch++;
  }
  layout();
 });
 bind('#refresh-devices',refreshDevices);
 bind('#sdk-folder',async()=>{setupEpoch++;bootAttempt=null;devicesRefreshEpoch++;clearTimeout(bootTimer);const result=await request('android:sdk');if(result?.canceled)return;for(const key of Object.keys(deviceStates))delete deviceStates[key];for(const key of Object.keys(sessionStates))delete sessionStates[key];rememberedSerial='';rememberedAvd='';selected=false;mobileAutomation?.setConnected(false);deviceEpoch++;$('#phone-screen').hidden=true;$('#phone-empty').hidden=false;$('#device-label').textContent='No device selected';await refreshDevices();});
 bind('#android-help',()=>request('android:docs'));
 function bootBusy(){return bootAttempt&&['starting','waiting','booting'].includes(bootAttempt.phase);}
 function renderStartup(){
  const busy=Boolean(bootBusy()),panel=$('#emulator-progress');
  panel.hidden=!bootAttempt;
  if(bootAttempt){
   $('#emulator-progress-title').textContent=bootAttempt.phase==='ready'?'Ready to connect':bootAttempt.phase==='error'?'Startup needs attention':'Starting '+bootAttempt.avd;
   $('#emulator-progress-detail').textContent=bootAttempt.detail;
   $('#emulator-spinner').hidden=!busy;
   panel.classList.toggle('error',bootAttempt.phase==='error');
  }
  $('#start-emulator').disabled=busy||connectingDevice||!devicesStatus?.avds.length;
  $('#start-emulator').textContent=busy?'Starting…':bootAttempt?.phase==='error'?'Try again':'Start emulator';
  $('#avd-select').disabled=busy;$('#sdk-folder').disabled=busy;
  $('#select-device').disabled=busy||connectingDevice||!devicesStatus?.devices.some(d=>d.state==='device');
  $('#select-device').textContent=connectingDevice?'Connecting…':'Connect selected device';
 }
 function pollBoot(){
  if(bootPollTask)return bootPollTask;
  if(!bootBusy()||!$('#devices-dialog').open)return Promise.resolve();
  clearTimeout(bootTimer);const attempt=bootAttempt;
  bootPollTask=(async()=>{
   try{
    const result=await request('android:boot',{avd:attempt.avd});
    if(attempt!==bootAttempt||(attempt.auto&&!setupCurrent(attempt.setup)))return;
    const status=await refreshDevices();if(attempt!==bootAttempt||(attempt.auto&&!setupCurrent(attempt.setup)))return;
    if(result.phase==='ready'&&status?.devices.some(d=>d.id===result.serial&&d.state==='device')){
     attempt.phase='ready';attempt.detail=attempt.avd+' is ready. Click Connect selected device to open its screen.';
     $('#serial-select').value=result.serial;
     if(attempt.auto){attempt.detail='Android is ready. Connecting…';await connectDevice(result.serial,attempt.setup);}
    }else if(Date.now()>=attempt.deadline){
     throw Error('Android is taking longer than expected (3 minutes). Check the emulator in Android Studio, then try again.');
    }else{
     attempt.phase=result.phase==='booting'?'booting':'waiting';
     attempt.detail=attempt.phase==='booting'?'Android is booting. We’ll enable Connect when it is ready.':'Waiting for the emulator to appear. The device list updates automatically.';
    }
   }catch(error){if(attempt===bootAttempt){attempt.phase='error';attempt.detail=error.message;}}
   finally{
    bootPollTask=null;renderStartup();
    if(bootBusy()&&$('#devices-dialog').open)bootTimer=setTimeout(()=>pollBoot(),1500);
   }
  })();return bootPollTask;
 }
 async function startEmulator(avd,setup){
  if(bootBusy()||!avd)return;
  const attempt={avd,auto:Boolean(setup),setup,phase:'starting',deadline:Date.now()+180000,detail:'Launching the emulator. Your existing Android data is kept.'};
  bootAttempt=attempt;rememberedAvd=avd;$('#device-notice').hidden=true;renderStartup();
  try{await request('android:start',{avd});if(attempt!==bootAttempt||(setup&&!setupCurrent(setup)))return;attempt.phase='waiting';await pollBoot();}
  catch(error){if(attempt===bootAttempt){attempt.phase='error';attempt.detail=error.message;}}
  finally{renderStartup();}
 }
 $('#start-emulator').addEventListener('click',async()=>{if($('#start-emulator').disabled)return;await startEmulator($('#avd-select').value)});
 $('#avd-select').addEventListener('change',()=>{if(!bootBusy()){bootAttempt=null;renderStartup();}});
 async function readOpenedContext(current,openedPlatform){
  let lastReason='The app has not finished loading.',lastError=false;
  for(let attempt=0;attempt<5;attempt++){
   if(!current())return;
   try{
    const snapshot=await request('mobile:request',{platform:openedPlatform,action:'context',data:{}});if(!current())return;
    mobileAutomation.handleState(snapshot);
    const kind=snapshot?.screen?.kind;
    if(['profile','like','conversation','likeOffer','empty'].includes(kind)||(openedPlatform==='bumble'&&kind==='unsupported'))return;
    lastReason=snapshot?.screen?.reason||snapshot?.reason||'The app screen is not recognized yet.';lastError=false;
   }catch(error){if(!current())return;lastReason=error.message;lastError=true;}
   if(attempt<4)await new Promise(resolve=>setTimeout(resolve,700));
  }
  if(current())notice(lastReason+' Open '+(openedPlatform==='hinge'?'Hinge':'Bumble')+' on the device, finish any sign-in or loading screen, then click Read screen.',lastError);
 }
 async function connectDevice(serial,setup){
  if(!setup)setup={epoch:++setupEpoch,platform};
  const current=()=>setup.epoch===setupEpoch&&setup.platform===platform;
  if(!current())return;
  connectingSetup=setup;connectingDevice=true;renderStartup();selected=false;mobileAutomation?.setConnected(false);deviceEpoch++;$('#phone-screen').hidden=true;$('#preview-status').textContent='Connecting to '+serial+'…';
  try{
   await request('android:select',{serial,platform:setup.platform});if(!current())return;
   const info=await request('android:inspect');if(!current())return;
   if(info.serial!==serial)throw Error('Device selection changed. Choose the intended device again.');
   selected=true;rememberedSerial=serial;deviceEpoch++;$('#device-label').textContent=info.serial;
   closeDevicesProgrammatically();layout();
   if(platform==='tinder'){notice('Device connected. Choose Hinge or Bumble to open it.');return}
   let opened=false;
   if(info.apps?.[platform]){try{await request('android:open');opened=true}catch(error){if(current())notice(error.message,true)}}
   else notice('Connected. Install '+(platform==='hinge'?'Hinge':'Bumble')+' from Play Store using Devices.');
   if(!current())return;await refreshScreen();if(!current())return;
   if(opened){setup.readingContext=true;try{await readOpenedContext(current,platform)}finally{setup.readingContext=false}}
  }finally{if(connectingSetup===setup){connectingDevice=false;connectingSetup=null;renderStartup()}}
 }
 bind('#select-device',()=>connectDevice($('#serial-select').value));
 function previewVisible(){return selected&&!popoutOpen&&platform!=='tinder'&&!document.hidden&&!settingsOpen&&!$('#devices-dialog').open;}
 function scheduleScreen(delay=80){
  clearTimeout(previewTimer);
  previewTimer=setTimeout(()=>{
   if(previewVisible())refreshScreen().catch(()=>{});
   else scheduleScreen(250);
  },delay);
 }
 function refreshScreen(){
  if(!previewVisible())return Promise.resolve();
  // A user action during capture requests one fresh frame afterward, never a second parallel capture.
  if(frameTask){frameRequested=true;return frameTask;}
  clearTimeout(previewTimer);
  const epoch=deviceEpoch;
  frameTask=(async()=>{
   try{
    const image=await request('android:screenshot');
    if(epoch!==deviceEpoch||!previewVisible())return;
    $('#phone-screen').src=image;$('#phone-screen').hidden=false;$('#phone-empty').hidden=true;
    $('#preview-status').textContent='Live preview';previewFailed=false;
   }catch(error){
    if(epoch===deviceEpoch&&previewVisible()){
     $('#phone-screen').hidden=true;
     $('#preview-status').textContent='Preview interrupted — retrying…';
     if(!previewFailed)notice(error.message,true);
     previewFailed=true;
    }
    throw error;
   }finally{
    frameTask=null;
    const immediate=frameRequested;frameRequested=false;
    scheduleScreen(previewFailed?1500:immediate?0:80);
   }
  })();
  return frameTask;
 }
 const controls=SSAndroidControls.create({
  image:$('#phone-screen'),keyboard:$('#phone-keyboard'),send:request,
  active:()=>selected&&platform!=='tinder'&&!popoutOpen&&!settingsOpen,
  epoch:()=>deviceEpoch,onBusy:value=>{deviceBusy=value;},
  onUpdate:()=>refreshScreen().catch(()=>{}),onError:error=>notice(error.message,true)
 });
 const deviceAction=(action,data)=>controls.run(action,data);
 bind('#popout-device',async()=>{if(deviceBusy)throw Error('Wait for keyboard input to finish.');if(!selected)throw Error('Connect a device first.');await request('android:popout');});
 bind('#dock-device',()=>request('android:dock'));
 bind('#enlarge-device',()=>{const enlarged=$('#android-area').classList.toggle('device-theater');$('#enlarge-device').setAttribute('aria-pressed',String(enlarged));$('#enlarge-device').textContent=enlarged?'Exit large view':'Larger view';});
 bind('#refresh-screen',refreshScreen);bind('#launch-app',()=>deviceAction('android:open'));bind('#install-app',async()=>{await deviceAction('android:store');closeDevicesProgrammatically();layout();});
 document.querySelectorAll('[data-scroll]').forEach(el=>el.addEventListener('click',()=>deviceAction('android:swipe',{direction:el.dataset.scroll}).catch(e=>notice(e.message,true))));
 document.querySelectorAll('[data-device]').forEach(el=>el.addEventListener('click',()=>deviceAction('android:'+el.dataset.device).catch(e=>notice(e.message,true))));
 bind('#mobile-generate',async()=>{const context=$('#mobile-context').value.trim();if(!context)throw Error('Add a profile detail or conversation first.');const current=platform,epoch=deviceEpoch;const result=await request('generate',{context:{name:current==='bumble'?'Bumble conversation':'Hinge conversation',bio:context,history:[]},options:{tone:$('#mobile-tone').value,instruction:$('#mobile-instruction').value}});if(platform!==current||epoch!==deviceEpoch)return;$('#mobile-draft').value=result.response;notice('Draft ready. Review it before using it.');});
 bind('#copy-mobile',async()=>{const value=$('#mobile-draft').value;if(!value.trim())throw Error('Generate or write a draft first.');await navigator.clipboard.writeText(value);notice('Draft copied.');});
 bind('#type-mobile',()=>deviceAction('android:type',{text:$('#mobile-draft').value}));
 document.addEventListener('visibilitychange',()=>{scheduleScreen(0);for(const target of ['hinge','bumble'])request('mobile:request',{platform:target,action:'visibility',data:{visible:!document.hidden}}).catch(()=>{});});
 window.addEventListener('pagehide',()=>{setupEpoch++;clearTimeout(previewTimer);clearTimeout(bootTimer);bootAttempt=null;});
 const info=await request('info');$('#machine-label').textContent=`v${info.version} · ${info.arch==='arm64'?'ARM64':info.arch}`;
 layout();
})().catch(error=>{document.getElementById('notice').textContent=error.message;document.getElementById('notice').hidden=false;});
