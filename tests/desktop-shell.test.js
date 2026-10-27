const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');const {EventEmitter}=require('node:events');
const P=require('../desktop/policy.cjs');
async function setup(androidConfig){
 const handlers={},events={},windows=[],views=[],opened=[],commands=[],savedAndroid=[],androidOptions=[];let commandGate;let promptAnswer=0,settings={sidebarConsentGiven:true,messagingConfig:{autoSend:true}};
 class Contents extends EventEmitter{constructor(){super();this.mainFrame={url:''};this.messages=[];this.session={setPermissionRequestHandler:fn=>this.permissionRequest=fn,setPermissionCheckHandler:fn=>this.permissionCheck=fn};}getURL(){return this.mainFrame.url}isDestroyed(){return false}setWindowOpenHandler(fn){this.open=fn}send(channel,data){this.messages.push({channel,data});if(channel==='tinder:command')queueMicrotask(()=>events['tinder:result']({sender:this,senderFrame:this.mainFrame},{id:data.id,result:{connected:true,session:{status:'paused'}}}));}async loadURL(url){this.mainFrame.url=url}close(){}reload(){}}
 class Window extends EventEmitter{constructor(options){super();this.options=options;this.webContents=new Contents();this.contentView={addChildView:()=>{}};windows.push(this);}async loadFile(file){this.webContents.mainFrame.url=require('node:url').pathToFileURL(file).href;}getContentSize(){return [1200,800]}isDestroyed(){return Boolean(this.destroyed)}show(){} focus(){} close(){this.destroyed=true;this.emit('closed');} }
 class View{constructor(){this.webContents=new Contents();views.push(this)}setVisible(v){this.visible=v}setBounds(b){this.bounds=b}}
 class Service{async request(action){return settings}}
 class Android{constructor(options){androidOptions.push(options);this.serial=null;this.inputEpoch=0}cancelInput(){this.inputEpoch++}async type(text){commands.push(text);if(commandGate)await commandGate;return {ok:true}}async select(serial){this.serial=serial;return {serial}}async inspect(){if(!this.serial)throw Error('Select a device');return {serial:this.serial}}async screenshot(){return 'frame'}async key(key){commands.push(key);return {key}}async status(){return {devices:[]}}dispose(){}}
 const app=new EventEmitter();Object.assign(app,{requestSingleInstanceLock:()=>true,whenReady:()=>Promise.resolve(),getPath:()=>'/tmp/spicy-test',getVersion:()=> '3.0.0',quit:()=>{}});
 const electron={app,BrowserWindow:Window,WebContentsView:View,ipcMain:{handle:(name,fn)=>handlers[name]=fn,on:(name,fn)=>events[name]=fn},safeStorage:{},shell:{openExternal:async url=>opened.push(url)},dialog:{showMessageBox:async()=>({response:promptAnswer}),showErrorBox:()=>{}},Menu:{buildFromTemplate:x=>x,setApplicationMenu:()=>{}}};
 const filename=path.resolve('desktop/main.cjs');const context={require:name=>name==='node:fs/promises'?{readFile:async()=>{if(androidConfig)return JSON.stringify(androidConfig);throw Error('No saved setup')},writeFile:async(_file,text)=>savedAndroid.push(JSON.parse(text))}:name==='electron'?electron:name==='./service.cjs'?Service:name==='./android.cjs'?Android:name==='./policy.cjs'?P:name==='./mobile-controller.cjs'?require('../desktop/mobile-controller.cjs'):require(name),__dirname:path.dirname(filename),process,setTimeout,clearTimeout,console};
 vm.runInNewContext(fs.readFileSync(filename,'utf8'),context,{filename});for(let i=0;i<8;i++)await new Promise(r=>setImmediate(r));
 const ui=windows[0].webContents,event={sender:ui,senderFrame:ui.mainFrame};
 return {app,windows,commands,savedAndroid,androidOptions,setGate:gate=>commandGate=gate,call:(action,data)=>handlers['desktop:request'](event,action,data),handlers,ui,event,views,opened,allow:()=>promptAnswer=1};
}
test('desktop IPC rejects foreign contents and subframes',async()=>{const x=await setup();await assert.rejects(x.handlers['desktop:request']({sender:{},senderFrame:{}},'load'),/Untrusted/);await assert.rejects(x.handlers['desktop:request']({...x.event,senderFrame:{url:x.ui.mainFrame.url}},'load'),/Untrusted/);assert.equal((await x.call('load')).sidebarConsentGiven,true);});
test('setup guide and disconnected context work before opening Tinder',async()=>{const x=await setup();await x.call('android:docs');assert.equal(x.opened[0],'https://developer.android.com/studio/run/managing-avds');assert.equal((await x.call('page',{action:'context'})).connected,false);});
test('platform switching preserves Tinder consent and running controls',async()=>{const x=await setup();await x.call('openTinder');const wc=x.views[0].webContents;await x.call('platform',{platform:'hinge'});const sent=wc.messages.findLast(m=>m.channel==='tinder:settings');assert.equal(sent.data.sidebarConsentGiven,true);assert.equal(sent.data.desktopActive,true);assert.equal(wc.messages.some(m=>m.channel==='tinder:command'&&m.data.action==='pause'),false);await x.handlers['tinder:service']({sender:wc,senderFrame:wc.mainFrame},'generate',{});await assert.rejects(x.handlers['tinder:service']({sender:wc,senderFrame:wc.mainFrame},'save',{}),/Untrusted/);});
test('only an explicit location approval grants exact Tinder main-frame geolocation',async()=>{const x=await setup();await x.call('openTinder');const wc=x.views[0].webContents;const permission=(kind,details={isMainFrame:true,requestingUrl:'https://tinder.com/app/recs'})=>new Promise(resolve=>wc.permissionRequest(wc,kind,resolve,details));assert.equal(await permission('geolocation'),false);x.allow();assert.equal(await permission('geolocation'),true);assert.equal(await permission('camera'),false);assert.equal(await permission('geolocation',{isMainFrame:false,requestingUrl:'https://tinder.com'}),false);assert.equal(await permission('geolocation',{isMainFrame:true,requestingUrl:'https://evil.test'}),false);assert.equal(wc.permissionCheck(wc,'geolocation','https://tinder.com',{isMainFrame:true}),true);assert.equal(wc.permissionCheck(wc,'geolocation','https://evil.test',{isMainFrame:true}),false);});

test('reopening a Mac window resets main platform to the new renderer default',async()=>{const x=await setup();await x.call('platform',{platform:'hinge'});x.windows[0].emit('closed');x.app.emit('activate');for(let i=0;i<4;i++)await new Promise(r=>setImmediate(r));const wc=x.windows.at(-1).webContents;const event={sender:wc,senderFrame:wc.mainFrame};await x.handlers['desktop:request'](event,'openTinder');const remote=x.views.at(-1).webContents;const state=await x.handlers['tinder:service']({sender:remote,senderFrame:remote.mainFrame},'load');assert.equal(state.desktopActive,true);});


test('Android pop-out is a sandboxed singleton with a restricted IPC surface',async()=>{
 const x=await setup();await x.call('platform',{platform:'hinge'});
 await assert.rejects(x.call('android:popout'),/Select|device/i);
 await x.call('android:select',{serial:'emulator-5554'});
 await x.call('android:popout');await x.call('android:popout');
 assert.equal(x.windows.length,2);
 const child=x.windows[1],wc=child.webContents,event={sender:wc,senderFrame:wc.mainFrame};
 assert.equal(child.options.webPreferences.sandbox,true);assert.equal(child.options.webPreferences.nodeIntegration,false);
 assert.equal((await x.handlers['android:request'](event,'state')).serial,'emulator-5554');
 assert.equal((await x.handlers['android:request'](event,'android:key',{key:'Enter'})).key,'Enter');
 await assert.rejects(x.handlers['desktop:request'](event,'load'),/Untrusted/);
 await assert.rejects(x.handlers['android:request'](event,'save',{}),/Untrusted|Unsupported/);
 await assert.rejects(x.handlers['android:request']({...event,senderFrame:{url:wc.mainFrame.url}},'state'),/Untrusted/);
 let blocked=false;wc.emit('will-navigate',{preventDefault:()=>blocked=true},'https://evil.test');assert.equal(blocked,true);
 assert.equal(wc.open({url:'https://evil.test'}).action,'deny');
 child.close();assert.equal(x.ui.messages.findLast(m=>m.data.type==='android:popout').data.data.open,false);
 await assert.rejects(x.handlers['android:request'](event,'android:key',{key:'Enter'}),/Untrusted/);
});

test('switching device or platform closes detached Android controls',async()=>{
 const x=await setup();await x.call('platform',{platform:'hinge'});await x.call('android:select',{serial:'emulator-5554'});
 await x.call('android:popout');const first=x.windows[1];
 await x.call('android:select',{serial:'emulator-5556'});assert.equal(first.destroyed,true);
 await x.call('android:popout');const second=x.windows[2];
 await x.call('platform',{platform:'tinder'});assert.equal(second.destroyed,true);
});


test('docking cancels queued pop-out input and serializes new workspace input after in-flight work',async()=>{
 const x=await setup();await x.call('platform',{platform:'hinge'});await x.call('android:select',{serial:'emulator-5554'});await x.call('android:popout');
 const wc=x.windows[1].webContents,event={sender:wc,senderFrame:wc.mainFrame};let finish;x.setGate(new Promise(r=>finish=r));
 const typing=x.handlers['android:request'](event,'android:type',{text:'pending'});await new Promise(r=>setImmediate(r));
 const queued=x.handlers['android:request'](event,'android:key',{key:'Enter'});const rejection=assert.rejects(queued,/changed|cancel/i);
 await x.handlers['android:request'](event,'dock');
 const backspace=x.call('android:key',{key:'Backspace'});await new Promise(r=>setImmediate(r));assert.deepEqual(x.commands,['pending']);
 finish();await typing;await rejection;await backspace;assert.deepEqual(x.commands,['pending','Backspace']);
});

test('mobile IPC is restricted to the selected Android platform and trusted workspace',async()=>{
 const x=await setup();await assert.rejects(x.call('mobile:request',{action:'status'}),/Hinge|Bumble|platform/i);await x.call('platform',{platform:'hinge'});assert.equal((await x.call('mobile:request',{action:'status'})).platform,'hinge');await assert.rejects(x.handlers['desktop:request']({sender:{},senderFrame:{}},'mobile:request',{action:'start'}),/Untrusted/);
});
test('selected Android device is remembered for the next setup without starting automation',async()=>{
 const x=await setup();await x.call('platform',{platform:'hinge'});await x.call('android:select',{serial:'emulator-5554'});assert.equal(x.savedAndroid.at(-1).platforms.hinge.preferredSerial,'emulator-5554');assert.equal((await x.call('android:status')).preferredSerial,'emulator-5554');assert.equal((await x.call('mobile:request',{action:'status'})).session.status,'idle');
});

test('explicit platform dispatch keeps device lanes independent across tab switches',async()=>{
 const x=await setup();await x.call('android:select',{platform:'hinge',serial:'hinge-phone'});await x.call('android:select',{platform:'bumble',serial:'bumble-phone'});
 let finish;x.setGate(new Promise(r=>finish=r));const typing=x.call('android:type',{platform:'hinge',text:'hinge-input'});await new Promise(r=>setImmediate(r));
 await x.call('platform',{platform:'tinder'});assert.equal((await x.call('android:key',{platform:'bumble',key:'Enter'})).key,'Enter');
 assert.equal((await x.call('android:inspect',{platform:'hinge'})).serial,'hinge-phone');assert.equal((await x.call('android:inspect',{platform:'bumble'})).serial,'bumble-phone');finish();await typing;
 assert.equal((await x.call('android:status',{platform:'hinge'})).preferredSerial,'hinge-phone');assert.equal((await x.call('android:status',{platform:'bumble'})).preferredSerial,'bumble-phone');
});
test('one serial cannot be assigned to both platform sessions',async()=>{const x=await setup();await x.call('android:select',{platform:'hinge',serial:'dedicated'});await assert.rejects(x.call('android:select',{platform:'bumble',serial:'dedicated'}),/another platform/);assert.equal((await x.call('android:inspect',{platform:'hinge'})).serial,'dedicated');});

test('concurrent device reservations reject duplicate serials before either selection drains',async()=>{const x=await setup();const first=x.call('android:select',{platform:'hinge',serial:'reserved'});await assert.rejects(x.call('android:select',{platform:'bumble',serial:'reserved'}),/another platform/);await first;});
test('changing one device cancels its queued input without changing the other binding',async()=>{const x=await setup();await x.call('android:select',{platform:'hinge',serial:'old'});await x.call('android:select',{platform:'bumble',serial:'bumble'});let finish;x.setGate(new Promise(r=>finish=r));const typing=x.call('android:type',{platform:'hinge',text:'in-flight'});await new Promise(r=>setImmediate(r));const queued=x.call('android:key',{platform:'hinge',key:'Enter'});const rejected=assert.rejects(queued,/changed|canceled/);await x.call('android:select',{platform:'hinge',serial:'new'});assert.equal((await x.call('android:inspect',{platform:'bumble'})).serial,'bumble');finish();await typing;await rejected;assert.equal(x.commands.includes('Enter'),false);});

test('Stop cancels a start waiting behind input without stopping another platform',async()=>{const x=await setup();await x.call('android:select',{platform:'hinge',serial:'hinge'});let finish;x.setGate(new Promise(r=>finish=r));const typing=x.call('android:type',{platform:'hinge',text:'pending'});await new Promise(r=>setImmediate(r));const start=x.call('mobile:request',{platform:'hinge',action:'start'});const rejected=assert.rejects(start,/changed/);await x.call('mobile:request',{platform:'hinge',action:'stop'});assert.equal((await x.call('mobile:request',{platform:'bumble',action:'status'})).session.status,'idle');finish();await typing;await rejected;});

test('canceled selection releases a reservation even when revision changes before selecting',async()=>{const x=await setup();const choosing=x.call('android:select',{platform:'hinge',serial:'released'});const rejected=assert.rejects(choosing,/changed/);await x.call('mobile:request',{platform:'hinge',action:'stop'});await rejected;await x.call('android:select',{platform:'bumble',serial:'released'});assert.equal((await x.call('android:inspect',{platform:'bumble'})).serial,'released');});

test('saved Hinge graphics override stays separate from Bumble and survives device preference writes',async()=>{const x=await setup({platforms:{hinge:{graphicsMode:'host-opengl'}}});await x.call('android:status',{platform:'hinge'});await x.call('android:status',{platform:'bumble'});assert.equal(x.androidOptions[0].graphicsMode,'host-opengl');assert.equal(x.androidOptions[1].graphicsMode,undefined);await x.call('android:select',{platform:'hinge',serial:'emulator-5554'});assert.equal(x.savedAndroid.at(-1).platforms.hinge.graphicsMode,'host-opengl');});
