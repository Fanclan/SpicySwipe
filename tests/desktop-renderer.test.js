const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
async function fixture(t, options = {}) {
  const dom = new JSDOM(fs.readFileSync('desktop/index.html', 'utf8'), { runScripts: 'outside-only', pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const w = dom.window, calls = [], timers = new Map();
  let start=()=>({starting:true}),boot=async()=>{const value=await status();return value.devices?.length===1?{phase:'ready',serial:value.devices[0].id}:{phase:'waiting'}},status=()=>({architecture:'arm64',recommendedAbi:'arm64-v8a',sdkRoot:'/sdk',avds:['Pixel_6_API_34','SpicySwipe_Pixel_8_API_35'],devices:[{id:'emulator-5556',state:'device'},{id:'other-phone',state:'device'}],selectedSerial:null,issues:[]});
  let selectedPlatform='tinder';
  let receive, inspect=()=>({serial:'emulator-5556',apps:{hinge:false}});
  if(options.status)status=options.status;if(options.inspect)inspect=options.inspect;if(options.start)start=options.start;if(options.boot)boot=options.boot;
  let id = 0, capture = () => Promise.resolve('data:image/png;base64,first'), input = () => Promise.resolve({ ok: true });
  w.setTimeout = (fn, ms) => { timers.set(++id, { fn, ms }); return id; };
  w.clearTimeout = key => timers.delete(key);
  w.setInterval = (fn, ms) => { timers.set(++id, { fn, ms, repeat: true }); return id; };
  w.ResizeObserver = class { observe() {} };
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; w.queueMicrotask(() => this.dispatchEvent(new w.Event('close'))); };
  w.SSWorkspace = { mount: async el => { el.innerHTML = '<div class="modal-layer" hidden></div>'; return { navigate() {} }; } };
  w.spicyDesktop = { subscribe(fn) { receive = fn; }, request: async (action, data) => {
    calls.push({ action, data });
    if(action==='platform')selectedPlatform=data.platform;
    if(action==='mobile:request'&&data.action==='context')return options.context?options.context():{platform:selectedPlatform,screen:{kind:'profile',name:'Ready example',identity:'ready-profile',context:{bio:'Ready context'},controls:{}},session:{status:'idle'}};
    if (action === 'android:sdk') return options.sdk?options.sdk():{};
    if (action === 'android:status') return status();
    if (action === 'android:start') return start();
    if (action === 'android:boot') return boot();
    if (action === 'android:screenshot') return capture();
    if (['android:tap','android:back','android:type','android:key'].includes(action)) return input();
    if (action === 'android:inspect') return inspect();
    if (action === 'info') return { version: '3.0.0', arch: 'arm64' };
    return {};
  } };
  w.eval(fs.readFileSync('shared/core.js', 'utf8'));
  w.eval(fs.readFileSync('desktop/mobile-automation.js', 'utf8'));
  w.eval(fs.readFileSync('desktop/android-controls.js', 'utf8'));
  w.eval(fs.readFileSync('desktop/renderer.js', 'utf8'));
  await tick();
  const click = async selector => { w.document.querySelector(selector).click(); await tick(); };
  await click('[data-platform="'+(options.platform||'hinge')+'"]');
  if (!options.seamless) await click('#select-device');
  const image = w.document.querySelector('#phone-screen');
  Object.defineProperties(image, { naturalWidth: { value: 1080 }, naturalHeight: { value: 2400 } });
  image.getBoundingClientRect = () => ({ left: 0, top: 0, width: 216, height: 480 });
  const tap = async () => { image.dispatchEvent(new w.MouseEvent('click', { clientX: 100, clientY: 100, bubbles: true })); await tick(); };
  const runTimer = async () => {
    const entry = [...timers].filter(([, timer]) => timer.ms < 3000).sort((a, b) => a[1].ms - b[1].ms)[0];
    assert.ok(entry, 'preview should have a scheduled update');
    if (!entry[1].repeat) timers.delete(entry[0]);
    entry[1].fn(); await tick();
    return entry[1].ms;
  };
  return { w, image, calls, timers, setStart:fn=>start=fn, setBoot:fn=>boot=fn, setStatus:fn=>status=fn, setInspect: fn => inspect=fn, emit: event => receive(event), click, tap, runTimer, setCapture: fn => { capture = fn; }, setInput: fn => { input = fn; } };
}

test('a tap reaches the device while a preview frame is in flight', async t => {
  const f = await fixture(t), frame = deferred();
  f.setCapture(() => frame.promise);
  await f.click('#refresh-screen');
  await f.tap();
  assert.deepEqual({ ...f.calls.find(c => c.action === 'android:tap')?.data }, { x: 500, y: 500, platform: 'hinge' });
  frame.resolve('data:image/png;base64,next'); await tick();
});

test('preview updates do not keep input locked after the device command completes', async t => {
  const f = await fixture(t), frame = deferred();
  f.setCapture(() => frame.promise);
  await f.tap();
  await f.click('[data-device="back"]');
  assert.equal(f.calls.filter(c => c.action === 'android:back').length, 1);
  frame.resolve('data:image/png;base64,next'); await tick();
});

test('refresh loop runs promptly and never overlaps captures on a slow device', async t => {
  const f = await fixture(t), frame = deferred();
  f.setCapture(() => frame.promise);
  assert.ok(await f.runTimer() <= 100, 'next capture should start within 100 ms of the previous frame');
  const count = f.calls.filter(c => c.action === 'android:screenshot').length;
  await f.click('#refresh-screen');
  assert.equal(f.calls.filter(c => c.action === 'android:screenshot').length, count);
  frame.resolve('data:image/png;base64,next'); await tick();
  f.setCapture(() => Promise.resolve('data:image/png;base64,after'));
  await f.runTimer();
  assert.equal(f.calls.filter(c => c.action === 'android:screenshot').length, count + 1);
});

test('switching platforms discards the old frame and pauses preview capture', async t => {
  const f = await fixture(t), frame = deferred();
  f.setCapture(() => frame.promise);
  await f.click('#refresh-screen');
  await f.click('[data-platform="tinder"]');
  const count = f.calls.filter(c => c.action === 'android:screenshot').length;
  frame.resolve('data:image/png;base64,stale'); await tick();
  await f.runTimer();
  assert.equal(f.image.hidden, true);
  assert.notEqual(f.image.src, 'data:image/png;base64,stale');
  assert.equal(f.calls.filter(c => c.action === 'android:screenshot').length, count);
});

test('failed automatic capture hides stale controls and reports the connection problem', async t => {
  const f = await fixture(t);
  f.setCapture(() => Promise.reject(Error('Selected Android device disconnected.')));
  await f.runTimer();
  assert.equal(f.image.hidden, true);
  assert.match(f.w.document.querySelector('#notice').textContent, /disconnected/);
  const count = f.calls.filter(c => c.action === 'android:tap').length;
  await f.tap();
  assert.equal(f.calls.filter(c => c.action === 'android:tap').length, count);
  f.setCapture(() => Promise.resolve('data:image/png;base64,recovered'));
  assert.ok(await f.runTimer() >= 1000, 'connection failure should back off');
  assert.equal(f.image.hidden, false);
});

test('an action during capture schedules a fresh frame immediately afterward', async t => {
  const f = await fixture(t), frame = deferred();
  f.setCapture(() => frame.promise);
  await f.click('#refresh-screen');
  await f.tap();
  const count = f.calls.filter(c => c.action === 'android:screenshot').length;
  frame.resolve('data:image/png;base64,before-input'); await tick();
  f.setCapture(() => Promise.resolve('data:image/png;base64,after-input'));
  assert.equal(await f.runTimer(), 0);
  assert.equal(f.calls.filter(c => c.action === 'android:screenshot').length, count + 1);
  assert.equal(f.image.src, 'data:image/png;base64,after-input');
});

test('preview pauses behind settings, setup dialogs and hidden windows', async t => {
  const f = await fixture(t);
  const count = f.calls.filter(c => c.action === 'android:screenshot').length;
  await f.click('#settings-button'); await f.runTimer();
  assert.equal(f.calls.filter(c => c.action === 'android:screenshot').length, count);
  await f.click('#settings-button');
  f.w.document.querySelector('#devices-dialog').showModal(); await f.runTimer();
  assert.equal(f.calls.filter(c => c.action === 'android:screenshot').length, count);
  f.w.document.querySelector('#devices-dialog').close();
  Object.defineProperty(f.w.document, 'hidden', { configurable: true, value: true });
  await f.runTimer();
  assert.equal(f.calls.filter(c => c.action === 'android:screenshot').length, count);
});

test('opening the Play Store closes setup so the device can be used immediately', async t => {
  const f = await fixture(t);
  f.w.document.querySelector('#devices-dialog').showModal();
  await f.click('#install-app');
  assert.ok(f.calls.some(c => c.action === 'android:store'));
  assert.equal(f.w.document.querySelector('#devices-dialog').open, false);
  await f.runTimer();
  assert.equal(f.image.hidden, false);
});


test('detaching pauses embedded capture and closing the pop-out resumes it', async t => {
 const f=await fixture(t);
 await f.click('#popout-device');
 assert.ok(f.calls.some(c=>c.action==='android:popout'));
 f.emit({type:'android:popout',data:{open:true}});
 const count=f.calls.filter(c=>c.action==='android:screenshot').length;
 await f.runTimer();await f.tap();
 assert.equal(f.calls.filter(c=>c.action==='android:screenshot').length,count);
 assert.equal(f.calls.filter(c=>c.action==='android:tap').length,0);
 f.emit({type:'android:popout',data:{open:false}});
 await f.runTimer();
 assert.equal(f.image.hidden,false);
 assert.equal(f.calls.filter(c=>c.action==='android:screenshot').length,count+1);
});


test('selecting a new device cancels queued keys before its inspection finishes', async t => {
 const f=await fixture(t),input=deferred(),inspection=deferred();
 f.setInput(()=>input.promise);const keyboard=f.w.document.querySelector('#phone-keyboard');keyboard.focus();
 keyboard.dispatchEvent(new f.w.KeyboardEvent('keydown',{key:'a'}));await tick();
 keyboard.dispatchEvent(new f.w.KeyboardEvent('keydown',{key:'b'}));
 f.setInspect(()=>inspection.promise);await f.click('#select-device');
 input.resolve({ok:true});await tick();
 assert.deepEqual(f.calls.filter(c=>c.action==='android:type').map(c=>c.data.text),['a']);
 inspection.resolve({serial:'emulator-5558',apps:{hinge:false}});await tick();
});


async function bootTimer(f){const entry=[...f.timers].find(([,v])=>v.ms===1500);assert.ok(entry,'startup should schedule a status check');f.timers.delete(entry[0]);entry[1].fn();await tick();}
async function setupBoot(t){const f=await fixture(t);await f.click('#device-button');f.w.document.querySelector('#avd-select').value='SpicySwipe_Pixel_8_API_35';return f;}

test('startup progress stays inside the dialog and waits for the requested emulator to finish booting',async t=>{
 const f=await setupBoot(t),starting=deferred();f.setStart(()=>starting.promise);
 await f.click('#start-emulator');
 const panel=f.w.document.querySelector('#emulator-progress');assert.ok(panel);assert.equal(panel.closest('dialog').open,true);assert.equal(panel.hidden,false);
 assert.equal(f.w.document.querySelector('#start-emulator').disabled,true);
 assert.equal(f.w.document.querySelector('#select-device').disabled,true);
 starting.resolve({starting:true});f.setBoot(()=>({phase:'booting',serial:'emulator-5558'}));await tick();
 assert.match(panel.textContent,/booting/i);assert.equal(f.w.document.querySelector('#select-device').disabled,true);
 f.setStatus(()=>({architecture:'arm64',recommendedAbi:'arm64-v8a',sdkRoot:'/sdk',avds:['Pixel_6_API_34','SpicySwipe_Pixel_8_API_35'],devices:[{id:'emulator-5556',state:'device'},{id:'emulator-5558',state:'device'}],selectedSerial:'emulator-5556',issues:[]}));
 f.setBoot(()=>({phase:'ready',serial:'emulator-5558'}));await bootTimer(f);
 assert.match(panel.textContent,/ready/i);assert.equal(f.w.document.querySelector('#serial-select').value,'emulator-5558');
 assert.equal(f.w.document.querySelector('#avd-select').value,'SpicySwipe_Pixel_8_API_35');assert.equal(f.w.document.querySelector('#select-device').disabled,false);
 assert.equal(f.calls.filter(c=>c.action==='android:select').length,1,'do not silently change the connected device');
});

test('startup failures are visible in the dialog and allow retry',async t=>{
 const f=await setupBoot(t);f.setStart(()=>Promise.reject(Error('The emulator could not start.')));await f.click('#start-emulator');
 assert.match(f.w.document.querySelector('#emulator-progress').textContent,/could not start/);assert.equal(f.w.document.querySelector('#start-emulator').disabled,false);
 f.setStart(()=>({starting:true}));await f.click('#start-emulator');assert.equal(f.calls.filter(c=>c.action==='android:start').length,2);
});

test('startup polling pauses on close and resumes when setup reopens',async t=>{
 const f=await setupBoot(t);await f.click('#start-emulator');await f.click('#close-devices');
 assert.equal([...f.timers.values()].some(v=>v.ms===1500),false);
 const count=f.calls.filter(c=>c.action==='android:boot').length;await f.click('#device-button');
 assert.equal(f.calls.filter(c=>c.action==='android:boot').length,count+1);
});

test('a slow boot times out with an actionable inline message',async t=>{
 const f=await setupBoot(t);let now=100;f.w.Date.now=()=>now;await f.click('#start-emulator');now+=181000;await bootTimer(f);
 assert.match(f.w.document.querySelector('#emulator-progress').textContent,/taking longer|not ready|timed out/i);
 assert.equal(f.w.document.querySelector('#start-emulator').disabled,false);
});

test('refresh preserves emulator choice and modal errors use an inline notice',async t=>{
 const f=await setupBoot(t);await f.click('#refresh-devices');assert.equal(f.w.document.querySelector('#avd-select').value,'SpicySwipe_Pixel_8_API_35');
 f.setStatus(()=>Promise.reject(Error('SDK is unavailable')));await f.click('#refresh-devices');
 const notice=f.w.document.querySelector('#device-notice');assert.ok(notice);assert.equal(notice.hidden,false);assert.match(notice.textContent,/SDK is unavailable/);
});

test('an older manual refresh cannot replace the emulator selected by startup readiness',async t=>{
 const f=await setupBoot(t),old=deferred();f.setStatus(()=>old.promise);await f.click('#refresh-devices');
 const latest={architecture:'arm64',recommendedAbi:'arm64-v8a',sdkRoot:'/sdk',avds:['Pixel_6_API_34','SpicySwipe_Pixel_8_API_35'],devices:[{id:'emulator-5556',state:'device'},{id:'emulator-5558',state:'device'}],selectedSerial:'emulator-5556',issues:[]};
 f.setStatus(()=>latest);f.setBoot(()=>({phase:'ready',serial:'emulator-5558'}));await f.click('#start-emulator');
 assert.equal(f.w.document.querySelector('#serial-select').value,'emulator-5558');
 old.resolve({...latest,devices:[{id:'emulator-5556',state:'device'}]});await tick();
 assert.equal(f.w.document.querySelector('#serial-select').value,'emulator-5558');
});

test('mobile automation mounts on Hinge, reads through trusted IPC and hides on Tinder', async t => {
 const f=await fixture(t);const panel=f.w.document.querySelector('#mobile-automation');assert.ok(panel);assert.equal(panel.hidden,false);
 await f.click('[data-mobile="read"]');assert.ok(f.calls.some(c=>c.action==='mobile:request'&&c.data.action==='context'));
 f.emit({type:'mobile:state',data:{platform:'hinge',screen:{kind:'profile',name:'Sample',identity:'abc',context:{bio:'Coffee'},controls:{}},session:{status:'idle'}}});
 assert.match(panel.textContent,/Sample/);await f.click('[data-platform="tinder"]');assert.equal(panel.hidden,true);
});

const automaticStatus=(patch={})=>({available:true,architecture:'x64',recommendedAbi:'x86_64',sdkRoot:'/sdk',avds:['SpicySwipe_Phone_API_36'],devices:[{id:'emulator-5556',state:'device'}],selectedSerial:null,preferredSerial:null,preferredAvd:null,issues:[],...patch});
const installedInspect=serial=>({serial,apps:{hinge:true,bumble:true}});
test('choosing Hinge automatically connects the only online device and reads context without starting automation',async t=>{
 const f=await fixture(t,{seamless:true,status:()=>automaticStatus(),inspect:()=>installedInspect('emulator-5556')});
 assert.equal(f.calls.find(c=>c.action==='android:select')?.data.serial,'emulator-5556');assert.ok(f.calls.some(c=>c.action==='android:open'));assert.ok(f.calls.some(c=>c.action==='mobile:request'&&c.data.action==='context'));assert.equal(f.image.hidden,false);
 assert.equal(f.calls.some(c=>c.action==='mobile:request'&&['start','generate','act'].includes(c.data.action)),false);assert.equal(f.w.document.querySelector('#devices-dialog').open,false);
});
test('remembered online device wins when several devices are available',async t=>{
 const f=await fixture(t,{seamless:true,status:()=>automaticStatus({preferredSerial:'remembered-phone',devices:[{id:'emulator-5556',state:'device'},{id:'remembered-phone',state:'device'}]}),inspect:()=>installedInspect('remembered-phone')});
 assert.equal(f.calls.find(c=>c.action==='android:select')?.data.serial,'remembered-phone');assert.equal(f.w.document.querySelector('#device-label').textContent,'remembered-phone');
});
test('unrelated online devices never auto-connect and dedicated emulator setup remains available',async t=>{
 const f=await fixture(t,{seamless:true,status:()=>automaticStatus({devices:[{id:'phone-one',state:'device'},{id:'phone-two',state:'device'}]})});
 assert.equal(f.calls.some(c=>c.action==='android:select'),false);assert.equal(f.calls.some(c=>c.action==='android:start'),true);assert.equal(f.w.document.querySelector('#devices-dialog').open,true);
});
test('a unique emulator starts once then automatically connects when boot completes',async t=>{
 const f=await fixture(t,{seamless:true,status:()=>automaticStatus({devices:[]}),inspect:()=>installedInspect('emulator-5558')});
 assert.equal(f.calls.filter(c=>c.action==='android:start').length,1);assert.equal(f.w.document.querySelector('#devices-dialog').open,true);
 f.setStatus(()=>automaticStatus({devices:[{id:'emulator-5558',state:'device'}]}));f.setBoot(()=>({phase:'ready',serial:'emulator-5558'}));await bootTimer(f);
 assert.equal(f.calls.find(c=>c.action==='android:select')?.data.serial,'emulator-5558');assert.ok(f.calls.some(c=>c.action==='android:open'));assert.equal(f.w.document.querySelector('#devices-dialog').open,false);assert.equal(f.calls.filter(c=>c.action==='android:start').length,1);
});
test('remembered emulator is used when no devices are online and several AVDs exist',async t=>{
 const f=await fixture(t,{seamless:true,status:()=>automaticStatus({devices:[],avds:['Phone_A','Phone_B'],preferredAvd:'Phone_B'})});
 assert.equal(f.calls.find(c=>c.action==='android:start')?.data.avd,'Phone_B');
});
test('a platform switch during discovery prevents late device selection or app launch',async t=>{
 const gate=deferred(),f=await fixture(t,{seamless:true,status:()=>gate.promise});await f.click('[data-platform="tinder"]');gate.resolve(automaticStatus());await tick();
 assert.equal(f.calls.some(c=>c.action==='android:select'),false);assert.equal(f.calls.some(c=>c.action==='android:open'),false);assert.equal(f.w.document.querySelector('#android-area').hidden,true);assert.equal(f.w.document.querySelector('#devices-dialog').open,false);
});
test('a platform switch during automatic startup prevents late boot, connection and launch',async t=>{
 const gate=deferred(),f=await fixture(t,{seamless:true,status:()=>automaticStatus({devices:[]}),start:()=>gate.promise});assert.ok(f.calls.some(c=>c.action==='android:start'));
 await f.click('[data-platform="tinder"]');gate.resolve({starting:true});await tick();assert.equal(f.calls.filter(c=>c.action==='android:boot').length,1);assert.equal(f.calls.some(c=>c.action==='android:select'),false);assert.equal(f.calls.some(c=>c.action==='android:open'),false);
});
test('missing SDK stays actionable without emulator start loops',async t=>{
 const f=await fixture(t,{seamless:true,status:()=>automaticStatus({available:false,devices:[],avds:[],issues:['Install Android SDK Platform-Tools.']})});
 assert.equal(f.w.document.querySelector('#devices-dialog').open,true);assert.match(f.w.document.querySelector('#device-issues').textContent,/Install Android SDK/);assert.equal(f.calls.some(c=>c.action==='android:start'),false);
});
test('large phone view toggle keeps pop-out controls and returns to the workspace',async t=>{
 const f=await fixture(t);await f.click('#enlarge-device');assert.equal(f.w.document.querySelector('#enlarge-device').getAttribute('aria-pressed'),'true');assert.equal(f.w.document.querySelector('#android-area').classList.contains('device-theater'),true);assert.ok(f.w.document.querySelector('#popout-device'));
 await f.click('#enlarge-device');assert.equal(f.w.document.querySelector('#android-area').classList.contains('device-theater'),false);
});
test('switching platforms during device inspection prevents the old app from opening',async t=>{
 const inspection=deferred(),f=await fixture(t,{seamless:true,status:()=>automaticStatus(),inspect:()=>inspection.promise});assert.ok(f.calls.some(c=>c.action==='android:inspect'));
 await f.click('[data-platform="tinder"]');inspection.resolve(installedInspect('emulator-5556'));await tick();assert.equal(f.calls.some(c=>c.action==='android:open'),false);assert.equal(f.calls.some(c=>c.action==='mobile:request'&&c.data.action==='context'),false);
});
test('a manually chosen online device remains preferred when switching mobile platforms',async t=>{
 const f=await fixture(t);f.setInspect(()=>installedInspect('other-phone'));f.w.document.querySelector('#serial-select').value='other-phone';await f.click('#select-device');await f.click('[data-platform="bumble"]');
 assert.equal(f.calls.filter(c=>c.action==='android:select').at(-1)?.data.serial,'other-phone');assert.ok(f.calls.some(c=>c.action==='android:open'));assert.equal(f.w.document.querySelector('#platform-name').textContent,'Bumble');
});
test('an unavailable preferred device falls back to the one online device',async t=>{
 const f=await fixture(t,{seamless:true,status:()=>automaticStatus({preferredSerial:'offline-phone'}),inspect:()=>installedInspect('emulator-5556')});assert.equal(f.calls.find(c=>c.action==='android:select')?.data.serial,'emulator-5556');
});
test('canceling automatic emulator setup stops polling and prevents automatic connection',async t=>{
 const f=await fixture(t,{seamless:true,status:()=>automaticStatus({devices:[]})});await f.click('#close-devices');assert.equal([...f.timers.values()].some(v=>v.ms===1500),false);assert.equal(f.calls.some(c=>c.action==='android:select'),false);
});
test('automatic emulator failure stays visible without a retry loop',async t=>{
 const f=await fixture(t,{seamless:true,status:()=>automaticStatus({devices:[]}),start:()=>Promise.reject(Error('Acceleration is unavailable'))});
 assert.match(f.w.document.querySelector('#emulator-progress').textContent,/Acceleration is unavailable/);assert.equal(f.calls.filter(c=>c.action==='android:start').length,1);assert.equal([...f.timers.values()].some(v=>v.ms===1500),false);
});

test('closing Devices during automatic inspection cancels the ready emulator connection',async t=>{
 const inspection=deferred(),f=await fixture(t,{seamless:true,status:()=>automaticStatus({devices:[]}),inspect:()=>inspection.promise});
 f.setStatus(()=>automaticStatus({devices:[{id:'emulator-5558',state:'device'}]}));f.setBoot(()=>({phase:'ready',serial:'emulator-5558'}));await bootTimer(f);
 assert.equal(f.w.document.querySelector('#devices-dialog').open,true);assert.ok(f.calls.some(c=>c.action==='android:inspect'));
 await f.click('#close-devices');inspection.resolve(installedInspect('emulator-5558'));await tick();
 assert.equal(f.calls.some(c=>c.action==='android:open'),false);assert.equal(f.calls.some(c=>c.action==='mobile:request'&&c.data.action==='context'),false);assert.equal(f.image.hidden,true);
});
test('automatic success-close preserves app launch and context read after the close event is queued',async t=>{
 const f=await fixture(t,{seamless:true,status:()=>automaticStatus({devices:[]}),inspect:()=>installedInspect('emulator-5558')});
 f.setStatus(()=>automaticStatus({devices:[{id:'emulator-5558',state:'device'}]}));f.setBoot(()=>({phase:'ready',serial:'emulator-5558'}));await bootTimer(f);await tick();
 assert.equal(f.w.document.querySelector('#devices-dialog').open,false);assert.ok(f.calls.some(c=>c.action==='android:open'));assert.ok(f.calls.some(c=>c.action==='mobile:request'&&c.data.action==='context'));assert.equal(f.image.hidden,false);
});

async function contextRetry(f){const entry=[...f.timers].find(([,timer])=>timer.ms===700);assert.ok(entry,'context readiness should schedule a bounded retry');f.timers.delete(entry[0]);entry[1].fn();await tick();}
const loadingContext=()=>({platform:'hinge',screen:{kind:'blocked',identity:null,context:{},controls:{},reason:'App is still loading'},session:{status:'idle'}});
const readyContext=()=>({platform:'hinge',screen:{kind:'profile',name:'Ready example',identity:'ready-profile',context:{bio:'Ready after launch'},controls:{}},session:{status:'idle'}});
test('post-launch context retries foreground errors and loading snapshots without relaunching the app',async t=>{
 let attempts=0;const f=await fixture(t,{seamless:true,status:()=>automaticStatus(),inspect:()=>installedInspect('emulator-5556'),context:()=>{attempts++;if(attempts===1)throw Error('Android foreground app could not be verified. Open Hinge and try again.');return attempts===2?loadingContext():readyContext()}});
 await contextRetry(f);await contextRetry(f);assert.equal(attempts,3);assert.equal(f.calls.filter(c=>c.action==='android:open').length,1);assert.match(f.w.document.querySelector('#mobile-automation').textContent,/Ready after launch/);assert.equal(f.w.document.querySelector('#devices-dialog').open,false);assert.equal(f.calls.some(c=>c.action==='mobile:request'&&['start','generate','act'].includes(c.data.action)),false);
});
test('context retries stop after five failures and leave actionable read-only recovery',async t=>{
 let attempts=0;const f=await fixture(t,{seamless:true,status:()=>automaticStatus(),inspect:()=>installedInspect('emulator-5556'),context:()=>{throw Error('Foreground unavailable '+(++attempts))}});
 for(let n=0;n<4;n++)await contextRetry(f);assert.equal(attempts,5);assert.match(f.w.document.querySelector('#notice').textContent,/Foreground unavailable 5/);assert.match(f.w.document.querySelector('#notice').textContent,/Read screen/i);assert.equal(f.w.document.querySelector('#devices-dialog').open,false);assert.equal(f.image.hidden,false);assert.equal([...f.timers.values()].some(timer=>timer.ms===700),false);
});
test('changing platform cancels a pending context readiness retry',async t=>{
 let attempts=0;const f=await fixture(t,{seamless:true,status:()=>automaticStatus(),inspect:()=>installedInspect('emulator-5556'),context:()=>{attempts++;return loadingContext()}});
 await f.click('[data-platform="tinder"]');await contextRetry(f);assert.equal(attempts,1);assert.equal(f.w.document.querySelector('#android-area').hidden,true);
});
test('user closing device setup cancels the pending context readiness retry',async t=>{
 let attempts=0;const f=await fixture(t,{seamless:true,status:()=>automaticStatus(),inspect:()=>installedInspect('emulator-5556'),context:()=>{attempts++;return loadingContext()}});
 await f.click('#device-button');await f.click('#close-devices');await contextRetry(f);assert.equal(attempts,1);
});
test('unsupported Bumble context completes immediately without readiness polling',async t=>{
 let attempts=0;const f=await fixture(t,{seamless:true,platform:'bumble',status:()=>automaticStatus(),inspect:()=>installedInspect('emulator-5556'),context:()=>{attempts++;return {platform:'bumble',screen:{kind:'unsupported',reason:'Bumble reading is not verified',context:{},controls:{}},session:{status:'idle'}}}});
 assert.equal(attempts,1);assert.equal([...f.timers.values()].some(timer=>timer.ms===700),false);assert.match(f.w.document.querySelector('#mobile-automation').textContent,/Bumble reading is not verified/);
});
test('permanent inspection errors remain visible and never become context retries',async t=>{
 const f=await fixture(t,{seamless:true,status:()=>automaticStatus(),inspect:()=>Promise.reject(Error('Device inspection failed'))});assert.match(f.w.document.querySelector('#device-notice').textContent,/Device inspection failed/);assert.equal(f.calls.filter(c=>c.action==='android:inspect').length,1);assert.equal(f.calls.some(c=>c.action==='mobile:request'&&c.data.action==='context'),false);assert.equal([...f.timers.values()].some(timer=>timer.ms===700),false);
});

test('Start waits for automatic device connection then starts once without manual reads',async t=>{const gate=deferred(),f=await fixture(t,{seamless:true,status:()=>automaticStatus(),inspect:()=>gate.promise});await f.click('[data-mobile="start"]');assert.equal(f.calls.some(c=>c.action==='mobile:request'&&c.data.action==='start'),false);gate.resolve(installedInspect('emulator-5556'));await tick();const wait=[...f.timers].find(([,v])=>v.ms===300);assert.ok(wait);f.timers.delete(wait[0]);wait[1].fn();await tick();assert.equal(f.calls.filter(c=>c.action==='mobile:request'&&c.data.action==='start').length,1);assert.equal(f.calls.filter(c=>c.action==='mobile:request'&&c.data.action==='review').length,0);});
test('Stop cancels a Start waiting for automatic connection',async t=>{const gate=deferred(),f=await fixture(t,{seamless:true,status:()=>automaticStatus(),inspect:()=>gate.promise});await f.click('[data-mobile="start"]');await f.click('[data-mobile="stop"]');gate.resolve(installedInspect('emulator-5556'));await tick();const wait=[...f.timers].find(([,v])=>v.ms===300);assert.ok(wait);f.timers.delete(wait[0]);wait[1].fn();await tick();assert.equal(f.calls.some(c=>c.action==='mobile:request'&&c.data.action==='start'),false);});

test('returning to a connected mobile tab retains its device without reopening its app',async t=>{const f=await fixture(t);const opens=f.calls.filter(c=>c.action==='android:open').length,selects=f.calls.filter(c=>c.action==='android:select').length;await f.click('[data-platform="tinder"]');await f.click('[data-platform="hinge"]');assert.equal(f.calls.filter(c=>c.action==='android:open').length,opens);assert.equal(f.calls.filter(c=>c.action==='android:select').length,selects);await f.click('[data-mobile="read"]');assert.equal(f.calls.findLast(c=>c.action==='mobile:request'&&c.data.action==='context').data.platform,'hinge');});

test('verified dedicated AVD identity wins over a stored emulator serial after serial reassignment',async t=>{const f=await fixture(t,{seamless:true,status:()=>automaticStatus({preferredSerial:'emulator-5554',devices:[{id:'emulator-5554',state:'device'},{id:'emulator-5556',state:'device'}]}),boot:()=>({phase:'ready',serial:'emulator-5556'}),inspect:()=>installedInspect('emulator-5556')});assert.equal(f.calls.find(c=>c.action==='android:select')?.data.serial,'emulator-5556');});
test('a stored emulator serial is never auto-selected while its desired AVD is still booting',async t=>{const f=await fixture(t,{seamless:true,status:()=>automaticStatus({preferredSerial:'emulator-5554',devices:[{id:'emulator-5554',state:'device'}]}),boot:()=>({phase:'booting'})});assert.equal(f.calls.some(c=>c.action==='android:select'),false);assert.equal(f.calls.some(c=>c.action==='android:open'),false);assert.equal(f.calls.find(c=>c.action==='android:start')?.data.avd,'SpicySwipe_Phone_API_36');});
test('a wrong stored emulator is not selected when the desired AVD is missing',async t=>{const f=await fixture(t,{seamless:true,status:()=>automaticStatus({preferredSerial:'emulator-5554',avds:[],devices:[{id:'emulator-5554',state:'device'}]}),boot:()=>({phase:'waiting'})});assert.equal(f.calls.some(c=>c.action==='android:select'),false);assert.equal(f.calls.some(c=>c.action==='android:open'),false);assert.equal(f.w.document.querySelector('#devices-dialog').open,true);});

test('successful SDK replacement clears cached connections for every mobile platform',async t=>{const f=await fixture(t);await f.click('[data-platform="bumble"]');await f.click('#select-device');await f.click('[data-platform="hinge"]');await f.click('#sdk-folder');const before=f.calls.filter(c=>c.action==='android:status').length;await f.click('[data-platform="bumble"]');assert.ok(f.calls.filter(c=>c.action==='android:status').length>before,'Bumble must rediscover its adapter rather than reuse its disposed connection');assert.equal(f.w.document.querySelector('[data-mobile="read"]').disabled,true);});
test('canceling SDK replacement preserves all connected platform caches',async t=>{const f=await fixture(t,{sdk:()=>({canceled:true})});await f.click('[data-platform="bumble"]');await f.click('#select-device');await f.click('[data-platform="hinge"]');await f.click('#sdk-folder');const before=f.calls.filter(c=>c.action==='android:status').length;await f.click('[data-platform="bumble"]');assert.equal(f.calls.filter(c=>c.action==='android:status').length,before);assert.equal(f.w.document.querySelector('[data-mobile="read"]').disabled,false);});

test('Bumble empty queue completes setup immediately without loading retries',async t=>{
 let attempts=0;const f=await fixture(t,{seamless:true,platform:'bumble',status:()=>automaticStatus(),inspect:()=>installedInspect('emulator-5556'),context:()=>{attempts++;return {platform:'bumble',screen:{kind:'empty',reason:'No more profiles within your Bumble filters.',context:{},controls:{}},session:{status:'idle'}}}});assert.equal(attempts,1);assert.equal([...f.timers.values()].some(timer=>timer.ms===700),false);assert.equal(f.w.document.querySelector('#notice').textContent.includes('Read screen'),false);
});
