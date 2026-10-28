const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const Android = require('../desktop/android.cjs');

// Each test file runs in its own process. Exercise synthetic SDK discovery,
// independent of Android SDK paths inherited from a developer or CI runner.
delete process.env.ANDROID_HOME;
delete process.env.ANDROID_SDK_ROOT;

function fixture(t, options = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'spicyswipe-android-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const platform = options.platform || 'darwin';
  const relative = platform === 'darwin' ? 'Library/Android/sdk' : platform === 'win32' ? 'AppData/Local/Android/Sdk' : 'Android/Sdk';
  const sdkRoot = path.join(home, relative);
  for (const bin of ['platform-tools/adb', 'emulator/emulator']) {
    const file = path.join(sdkRoot, bin + (platform === 'win32' ? '.exe' : ''));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '');
  }
  const calls = [], children = [];
  const png = Buffer.from('89504e470d0a1a0a0000000d494844520000043800000960', 'hex');
  let devices = 'List of devices attached\nemulator-5554\tdevice product:sdk\nemulator-5556\toffline\n';
  let handler;
  const execFile = (file, args, settings, callback) => {
    calls.push({ file, args, settings });
    let result;
    try {
      result = handler?.(args);
      if (result === undefined) {
        if (args[0] === '-list-avds') result = 'Pixel_6_API_34\n';
        else if (args[0] === 'devices') result = devices;
        else if (args.includes('screencap')) result = png;
        else if (args.includes('size')) result = 'Physical size: 1080x2400\n';
        else if (args.includes('packages')) result = args.at(-1) === 'co.hinge.app' ? 'package:co.hinge.app\n' : '';
        else result = '';
      }
      queueMicrotask(() => callback(null, result, ''));
    } catch (error) { queueMicrotask(() => callback(error, '', '')); }
  };
  const spawn = (file, args, settings) => {
    const child = new EventEmitter();
    child.killed = false; child.exitCode = null;
    child.kill = () => { child.killed = true; child.emit('exit', 0, 'SIGTERM'); return true; };
    children.push({ file, args, settings, child });
    queueMicrotask(() => child.emit('spawn'));
    return child;
  };
  const android = new Android({ home, platform, arch: 'arm64', execFile, spawn, graphicsMode:options.graphicsMode });
  t.after(() => android.dispose());
  return { android, calls, children, home, sdkRoot, png, setDevices: value => { devices = value; }, setHandler: value => { handler = value; } };
}

test('missing SDK reports setup steps and never executes an arbitrary PATH binary', async () => {
  let called = false;
  const android = new Android({ sdkRoot: '/not-a-real-android-sdk', execFile: () => { called = true; } });
  const status = await android.status();
  assert.equal(status.available, false);
  assert.match(status.issues.join(' '), /Android Studio|SDK/);
  await assert.rejects(android.select('emulator-5554'), /SDK|adb/i);
  assert.equal(called, false);
});

for (const platform of ['darwin', 'win32', 'linux']) {
  test(`${platform} discovers its SDK default and executable suffix`, async t => {
    const f = fixture(t, { platform });
    const status = await f.android.status();
    assert.equal(status.sdkRoot, f.sdkRoot);
    assert.equal(status.available, true);
    assert.equal(status.recommendedAbi, 'arm64-v8a');
    assert.deepEqual(status.avds, ['Pixel_6_API_34']);
    assert.deepEqual(status.devices, [{ id: 'emulator-5554', state: 'device' }, { id: 'emulator-5556', state: 'offline' }]);
    assert.ok(f.calls.every(c => c.file.startsWith(f.sdkRoot)));
    assert.ok(f.calls.every(c => c.file.endsWith('.exe') === (platform === 'win32')));
    assert.ok(f.calls.every(c => c.settings.shell === false && c.settings.timeout > 0 && c.settings.maxBuffer > 0));
  });
}

test('requires explicit online selection and never switches to another attached device', async t => {
  const f = fixture(t);
  await assert.rejects(f.android.tap(10, 10), /select/i);
  await assert.rejects(f.android.select('emulator-5556'), /offline|online/i);
  await assert.rejects(f.android.select('emulator-5554; touch x'), /serial|device/i);
  await f.android.select('emulator-5554');
  const info = await f.android.inspect();
  assert.deepEqual(info, { serial: 'emulator-5554', apps: { hinge: true, bumble: false }, width: 1080, height: 2400 });
  f.setDevices('List of devices attached\nemulator-5558\tdevice\n');
  await assert.rejects(f.android.back(), /disconnect|online|unavailable/i);
  assert.equal(f.calls.some(c => c.args.includes('keyevent')), false);
});

test('device commands use exact serial, bounds and shell-safe text without accidental send', async t => {
  const f = fixture(t);
  await f.android.select('emulator-5554');
  await f.android.tap(30, 40);
  await f.android.swipe('up');
  await f.android.back();
  await f.android.type("Hi; $(touch x) & 'hello'");
  const input = f.calls.filter(c => c.args[2] === 'shell' && c.args[3] === 'input');
  assert.ok(input.every(c => c.args[0] === '-s' && c.args[1] === 'emulator-5554'));
  assert.deepEqual(input[0].args.slice(2), ['shell', 'input', 'tap', '30', '40']);
  assert.deepEqual(input[1].args.slice(2), ['shell', 'input', 'swipe', '540', '1728', '540', '672', '400']);
  assert.deepEqual(input[2].args.slice(2), ['shell', 'input', 'keyevent', '4']);
  assert.equal(input[3].args.at(-1), "'Hi;%s$(touch%sx)%s&%s'\\''hello'\\''' ".trim());
  await assert.rejects(f.android.tap(-1, 0), /coordinate|bounds/i);
  await assert.rejects(f.android.tap(1080, 40), /coordinate|bounds/i);
  await assert.rejects(f.android.swipe('up; reboot'), /direction/i);
  await assert.rejects(f.android.type('hello\nSEND'), /ASCII|line|control/i);
  await assert.rejects(f.android.type('hi 😊'), /ASCII|Unicode/i);
  assert.equal(f.calls.filter(c => c.args[2] === 'shell' && c.args[3] === 'input').length, 4);
});

test('app launches are allowlisted and missing apps link to official Play listing', async t => {
  const f = fixture(t);
  await f.android.select('emulator-5554');
  await assert.rejects(f.android.openApp('bumble'), /install/i);
  await assert.rejects(f.android.openApp('com.attacker.app'), /platform|app/i);
  await f.android.openApp('hinge');
  await f.android.openStore('bumble');
  assert.ok(f.calls.some(c => c.args.includes('monkey') && c.args.includes('co.hinge.app')));
  assert.ok(f.calls.some(c => c.args.includes("'market://details?id=com.bumble.app'")));
});

test('screenshots retain binary PNG and reject invalid device output', async t => {
  const f = fixture(t);
  await f.android.select('emulator-5554');
  assert.equal(await f.android.screenshot(), 'data:image/png;base64,' + f.png.toString('base64'));
  f.setHandler(args => args.includes('screencap') ? Buffer.from('error: no image') : undefined);
  await assert.rejects(f.android.screenshot(), /PNG|screenshot/i);
});

test('starts only an existing AVD without shell and disposes only its own process', async t => {
  const f = fixture(t);
  await assert.rejects(f.android.start('Pixel_6_API_34; touch x'), /AVD/i);
  await assert.rejects(f.android.start('Missing_AVD'), /AVD/i);
  assert.equal(f.children.length, 0);
  assert.deepEqual(await f.android.start('Pixel_6_API_34'), { avd: 'Pixel_6_API_34', starting: true });
  assert.equal(f.children[0].settings.shell, false);
  assert.deepEqual(f.children[0].args, ['-avd', 'Pixel_6_API_34', '-no-window', '-no-boot-anim']);
  assert.equal((await f.android.status()).selectedSerial, null);
  f.android.dispose();
  assert.equal(f.children[0].child.killed, true);
  assert.equal(f.calls.some(c => c.args.includes('kill') || c.args.includes('kill-server')), false);
});


test('package inspection distinguishes exact installed IDs and unavailable launchers', async t => {
  const f = fixture(t);
  await f.android.select('emulator-5554');
  f.setHandler(args => args.includes('packages') ? 'package:co.hinge.app.clone\n' : undefined);
  assert.equal((await f.android.inspect()).apps.hinge, false);
  f.setHandler(args => args.includes('monkey') ? '** No activities found to run, monkey aborted.\n' : undefined);
  await assert.rejects(f.android.openApp('hinge'), /launch|open/i);
  await assert.rejects(f.android.openApp(['hinge']), /platform|app/i);
});

test('screen coordinates follow current screenshot orientation', async t => {
  const f = fixture(t);
  await f.android.select('emulator-5554');
  const landscape = Buffer.from(f.png);
  landscape.writeUInt32BE(2400, 16); landscape.writeUInt32BE(1080, 20);
  f.setHandler(args => args.includes('screencap') ? landscape : undefined);
  await f.android.tap(2000, 500);
  await assert.rejects(f.android.tap(500, 2000), /bounds/i);
});

test('timeout and Android activity errors surface rather than reporting a successful open', async t => {
  const f = fixture(t);
  await f.android.select('emulator-5554');
  f.setHandler(args => args.includes('am') ? 'Error: Activity not started, unable to resolve Intent' : undefined);
  await assert.rejects(f.android.openStore('hinge'), /Google Play|open/i);
  f.setHandler(args => { if (args.includes('screencap')) throw Object.assign(new Error('arbitrary command payload'), { killed: true }); });
  await assert.rejects(f.android.screenshot(), /timed out/i);
});

test('closing during AVD lookup cannot launch a late emulator process', async t => {
  const f = fixture(t);
  let finish;
  f.android.execFile = (file, args, options, callback) => { finish = callback; };
  const start = f.android.start('Pixel_6_API_34');
  f.android.dispose();
  finish(null, 'Pixel_6_API_34\n', '');
  await assert.rejects(start, /closed/i);
  assert.equal(f.children.length, 0);
});

test('switching devices discards screenshot results from the previous device', async t => {
  const f = fixture(t);
  await f.android.select('emulator-5554');
  const original = f.android.execFile;
  let finish;
  f.android.execFile = (file, args, options, callback) => {
    if (args.includes('screencap')) finish = callback;
    else original(file, args, options, callback);
  };
  const pending = f.android.screenshot();
  await new Promise(resolve => setImmediate(resolve));
  f.setDevices('List of devices attached\nemulator-5554\tdevice\nemulator-5558\tdevice\n');
  await f.android.select('emulator-5558');
  finish(null, f.png, '');
  await assert.rejects(pending, /selection changed/i);
});

test('tap and scroll validate the active display without encoding another screenshot', async t => {
  const f = fixture(t);
  await f.android.select('emulator-5554');
  f.setHandler(args => args.includes('dumpsys') ? 'Viewport INTERNAL: displayId=0, orientation=0, logicalFrame=[0, 0, 1080, 2400], isActive=[1]' : undefined);
  await f.android.tap(30, 40);
  await f.android.swipe('up');
  await assert.rejects(f.android.tap(1080, 40), /bounds/);
  assert.equal(f.calls.filter(c => c.args.includes('screencap')).length, 0);
  assert.deepEqual(f.calls.find(c => c.args.includes('swipe')).args.slice(-5), ['540', '1728', '540', '672', '400']);
});

test('display validation reads fresh logical dimensions after rotation', async t => {
  const f = fixture(t);
  await f.android.select('emulator-5554');
  let dimensions = '1080, 2400';
  f.setHandler(args => args.includes('dumpsys') ? `Viewport INTERNAL: displayId=0, logicalFrame=[0, 0, ${dimensions}], isActive=[1]` : undefined);
  await f.android.tap(500, 2000);
  dimensions = '2400, 1080';
  await f.android.tap(2000, 500);
  await assert.rejects(f.android.tap(500, 2000), /bounds/);
});

test('unavailable or ambiguous display metadata falls back to screenshot bounds', async t => {
  const f = fixture(t);
  await f.android.select('emulator-5554');
  const invalid = [
    'Viewport INTERNAL: displayId=1, logicalFrame=[0, 0, 2400, 1080], isActive=[1]',
    'Viewport INTERNAL: displayId=0, logicalFrame=[0, 0, 2400, 1080], isActive=[0]',
    'Viewport INTERNAL: displayId=0, logicalFrame=[0, 0, 99999, 99999], isActive=[1]',
    'Viewport INTERNAL: displayId=0, logicalFrame=[1, 0, 2400, 1080], isActive=[1]',
    'Viewport INTERNAL: displayId=0, logicalFrame=[0, 0, 2400, 1080], isActive=[1]\nViewport INTERNAL: displayId=0, logicalFrame=[0, 0, 1080, 2400], isActive=[1]'
  ];
  for (const output of invalid) {
    f.setHandler(args => args.includes('dumpsys') ? output : undefined);
    await assert.rejects(f.android.tap(2000, 500), /bounds/);
  }
  assert.equal(f.calls.filter(c => c.args.includes('screencap')).length, invalid.length);
});

test('keyboard navigation is allowlisted and bound to the selected device', async t => {
  const f = fixture(t);
  await f.android.select('emulator-5554');
  for (const key of ['Backspace', 'Delete', 'Enter', 'Tab', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Escape', 'Home', 'End']) await f.android.key(key);
  const keys = f.calls.filter(c => c.args.includes('keyevent'));
  assert.deepEqual(keys.map(c => c.args.at(-1)), ['67','112','66','61','21','22','19','20','4','122','123']);
  assert.ok(keys.every(c => c.args[1] === 'emulator-5554'));
  await assert.rejects(f.android.key('66; reboot'), /key/i);
  await assert.rejects(f.android.key('__proto__'), /key/i);
});

test('typed and pasted percent sequences remain literal with shell quoting', async t => {
  const f = fixture(t);
  await f.android.select('emulator-5554');
  await f.android.type("a%s 100% '$(no)'%");
  const commands = f.calls.filter(c => c.args[3] === 'input');
  assert.deepEqual(commands.map(c => c.args.at(-1)), ["'a'", "'%'", "'s%s100'", "'%'", "'%s'\\''$(no)'\\'''", "'%'"]);
  assert.ok(commands.every(c => c.args[1] === 'emulator-5554' && c.args[4] === 'text'));
});

test('closing the input context cancels remaining chunks of an in-flight paste', async t => {
 const f=fixture(t);await f.android.select('emulator-5554');
 const original=f.android.execFile;let finish;
 f.android.execFile=(file,args,options,callback)=>{if(args[3]==='input'){f.calls.push({args});finish=callback;}else original(file,args,options,callback);};
 const pending=f.android.type('a%s');await new Promise(r=>setImmediate(r));
 f.android.cancelInput();finish(null,'','');
 await assert.rejects(pending,/changed|cancel/i);
 assert.equal(f.calls.filter(c=>c.args[3]==='input').length,1);
});

test('startup readiness identifies the requested AVD and waits for Android boot completion', async t => {
 const f=fixture(t);let boot='0';
 f.setHandler(args=>args.includes('emu')?'Pixel_6_API_34\nOK\n':args.includes('getprop')?boot:undefined);
 assert.deepEqual(await f.android.bootStatus('Another_AVD'),{avd:'Another_AVD',phase:'waiting'});
 assert.deepEqual(await f.android.bootStatus('Pixel_6_API_34'),{avd:'Pixel_6_API_34',serial:'emulator-5554',phase:'booting'});
 boot='1';assert.equal((await f.android.bootStatus('Pixel_6_API_34')).phase,'ready');
 assert.equal((await f.android.status()).selectedSerial,null);
 await assert.rejects(f.android.bootStatus('bad;name'),/AVD/);
});

test('starting an already running AVD reuses it instead of launching a duplicate', async t => {
 const f=fixture(t);f.setHandler(args=>args.includes('emu')?'Pixel_6_API_34\nOK\n':args.includes('getprop')?'1':undefined);
 const result=await f.android.start('Pixel_6_API_34');assert.equal(result.alreadyRunning,true);assert.equal(result.serial,'emulator-5554');assert.equal(f.children.length,0);
});

test('an emulator exit during startup reports failure for that AVD', async t => {
 const f=fixture(t);await f.android.start('Pixel_6_API_34');f.children[0].child.emit('exit',1);
 await assert.rejects(f.android.bootStatus('Pixel_6_API_34'),/exited|start/i);
});

test('hierarchy reads a unique device dump and returns verified foreground on the exact serial', async t => {
 const f = fixture(t); await f.android.select('emulator-5554');
 f.setHandler(args => args.includes('activity') ? 'mResumedActivity: ActivityRecord{123 u0 co.hinge.app/.MainActivity t4}' : args.includes('cat') ? '<?xml version="1.0"?><hierarchy />' : undefined);
 const result = await f.android.hierarchy(); assert.equal(result.foreground, 'co.hinge.app'); assert.equal(result.xml, '<?xml version="1.0"?><hierarchy />');
 const dump=f.calls.find(c=>c.args.includes('uiautomator')); const read=f.calls.find(c=>c.args.includes('cat'));
 assert.equal(dump.args[1], 'emulator-5554'); assert.match(dump.args.at(-1), /^\/data\/local\/tmp\/spicyswipe-[a-f0-9-]+\.xml$/); assert.equal(read.args.at(-1),dump.args.at(-1));
});

test('hierarchy rejects a foreground switch and cannot return stale dumps after cancellation', async t => {
 const f = fixture(t); await f.android.select('emulator-5554'); let foreground=0;
 f.setHandler(args=>args.includes('activity') ? `mResumedActivity: ActivityRecord{1 u0 ${++foreground===1?'co.hinge.app':'com.android.launcher3'}/.Main}` : args.includes('cat') ? '<hierarchy/>' : undefined);
 await assert.rejects(f.android.hierarchy(),/foreground|app changed/i);
 const original=f.android.execFile; let finish;
 f.android.execFile=(file,args,settings,callback)=>{if(args.includes('uiautomator')) finish=callback; else original(file,args,settings,callback);};
 const pending=f.android.hierarchy(); await new Promise(r=>setImmediate(r)); f.android.cancelInput(); finish(null,'dumped','');
 await assert.rejects(pending,/cancel|changed/i); assert.equal(f.calls.filter(c=>c.args.includes('cat')).length,1);
});

test('hierarchy ignores a stale selected-device lookup and never dumps the newly selected device', async t => {
 const f = fixture(t); await f.android.select('emulator-5554'); const original=f.android.execFile; let finish;
 f.android.execFile=(file,args,settings,callback)=>{if(args[0]==='devices') finish=callback; else original(file,args,settings,callback);};
 const pending=f.android.hierarchy(); f.android.serial='emulator-5558'; f.android.cancelInput(); finish(null,'emulator-5554 device\nemulator-5558 device\n','');
 await assert.rejects(pending,/changed|cancel/i); assert.equal(f.calls.some(c=>c.args.includes('uiautomator')),false);
});

test('tapControl validates complete fresh bounds and checks session validity after dimensions', async t => {
 const f=fixture(t); await f.android.select('emulator-5554'); let valid=true;
 f.setHandler(args=>args.includes('dumpsys') ? 'Viewport INTERNAL: displayId=0, logicalFrame=[0, 0, 1080, 2400], isActive=[1]' : undefined);
 await f.android.tapControl({x:100,y:200,width:80,height:60},()=>valid);
 assert.deepEqual(f.calls.find(c=>c.args.includes('tap')).args.slice(-2),['140','230']);
 await assert.rejects(f.android.tapControl({x:1000,y:200,width:100,height:60},()=>true),/bounds/i);
 await assert.rejects(f.android.tapControl({x:1,y:1,width:0,height:30},()=>true),/bounds/i);
 await assert.rejects(f.android.tapControl({x:1,y:1,width:30,height:30},()=>Promise.resolve(true)),/cancel|valid|changed/i);
 const original=f.android.execFile; let finish;
 f.android.execFile=(file,args,settings,callback)=>{if(args.includes('dumpsys')) finish=callback;else original(file,args,settings,callback);};
 const pending=f.android.tapControl({x:100,y:200,width:80,height:60},()=>valid); await new Promise(r=>setImmediate(r)); valid=false; finish(null,'Viewport INTERNAL: displayId=0, logicalFrame=[0, 0, 1080, 2400], isActive=[1]','');
 await assert.rejects(pending,/cancel|valid|changed/i); assert.equal(f.calls.filter(c=>c.args.includes('tap')).length,1);
});

test('scrollProfile bounds vertical review away from app and system navigation', async t => {
 const f=fixture(t);await f.android.select('emulator-5554');
 f.setHandler(args=>args.includes('dumpsys') ? 'Viewport INTERNAL: displayId=0, logicalFrame=[0, 0, 1080, 2400], isActive=[1]' : undefined);
 await f.android.scrollProfile({fraction:.65,duration:900,direction:'up'});
 const command=f.calls.find(c=>c.args.includes('swipe')).args; const coords=command.slice(-5).map(Number);
 assert.equal(coords[0],coords[2]);assert.ok(coords[1]<=2040 && coords[1]>=480);assert.ok(coords[3]>=480 && coords[3]<=2040);assert.ok(coords[1]>coords[3]);assert.equal(coords[4],900);
 for(const options of [{fraction:.7,duration:400,direction:'up'},{fraction:.3,duration:1000,direction:'up'},{fraction:.3,duration:400,direction:'left'}]) await assert.rejects(f.android.scrollProfile(options),/scroll|fraction|duration|direction/i);
});

test('final control dispatch is accounted once even if cancellation occurs during native input', async t=>{
 const f=fixture(t);await f.android.select('emulator-5554');let issued=0,release;
 f.setHandler(args=>args.includes('dumpsys')?'Viewport INTERNAL: displayId=0, logicalFrame=[0, 0, 1080, 2400], isActive=[1]':undefined);
 const original=f.android.execFile;f.android.execFile=(file,args,settings,callback)=>{if(args.includes('tap'))release=callback;else original(file,args,settings,callback)};
 const pending=f.android.tapControl({x:20,y:20,width:60,height:60},()=>true,()=>issued++);await new Promise(r=>setImmediate(r));assert.equal(issued,1);f.android.cancelInput();release(null,'','');await assert.rejects(pending,/canceled|changed/i);assert.equal(issued,1);
});

test('a stale device discovery cannot overwrite a newer selection',async t=>{const {android}=fixture(t);let resolve;android._devices=()=>new Promise(r=>resolve=r);const old=android.select('phone-a');const rejected=assert.rejects(old,/changed|cancel/i);android._devices=async()=>[{id:'phone-b',state:'device'}];await android.select('phone-b');resolve([{id:'phone-a',state:'device'}]);await rejected;assert.equal(android.serial,'phone-b');});

test('Windows headless emulator uses software graphics to avoid host GPU startup hangs',async t=>{const f=fixture(t,{platform:'win32'});await f.android.start('Pixel_6_API_34');assert.deepEqual(f.children[0].args,['-avd','Pixel_6_API_34','-no-window','-no-boot-anim','-gpu','swiftshader','-no-snapshot-load']);assert.equal(f.children[0].settings.windowsHide,true);assert.equal(f.children[0].args.includes('-wipe-data'),false);});

for(const direction of ['left','right'])test('profile '+direction+' swipe uses the verified card and dispatches exactly once',async t=>{
 const f=fixture(t);await f.android.select('emulator-5554');let issued=0;
 await f.android.swipeProfile(direction,{x:40,y:250,width:1000,height:1600},()=>true,()=>issued++);
 const cmd=f.calls.find(c=>c.args.includes('swipe'));assert.ok(cmd);const points=cmd.args.slice(-5,-1).map(Number);
 assert.equal(points[1],points[3]);assert.equal(direction==='right',points[2]>points[0]);assert.ok(points[0]>=40&&points[2]<=1040);assert.equal(issued,1);
});
test('profile swipe rejects stale validity, offscreen cards and invalid directions before input',async t=>{
 const f=fixture(t);await f.android.select('emulator-5554');let issued=0;
 await assert.rejects(f.android.swipeProfile('right',{x:40,y:250,width:1000,height:1600},()=>false,()=>issued++),/cancel|changed/i);
 await assert.rejects(f.android.swipeProfile('right',{x:40,y:250,width:2000,height:1600},()=>true),/bounds|display/i);
 await assert.rejects(f.android.swipeProfile('up',{x:40,y:250,width:1000,height:1600},()=>true),/direction/i);
 assert.equal(issued,0);assert.equal(f.calls.filter(c=>c.args.includes('swipe')).length,0);
});

test('Windows opt-in native OpenGL bypasses the crashing software renderer and disables Vulkan',async t=>{const f=fixture(t,{platform:'win32',graphicsMode:'host-opengl'});await f.android.start('Pixel_6_API_34');assert.deepEqual(f.children[0].args,['-avd','Pixel_6_API_34','-no-window','-no-boot-anim','-gpu','host','-feature','-Vulkan','-no-snapshot-load']);assert.equal(f.children[0].settings.windowsHide,true);assert.equal(f.children[0].args.includes('-wipe-data'),false);});
test('unrecognized graphics modes cannot add emulator arguments',async t=>{const f=fixture(t,{platform:'win32',graphicsMode:'host -wipe-data'});await f.android.start('Pixel_6_API_34');assert.deepEqual(f.children[0].args,['-avd','Pixel_6_API_34','-no-window','-no-boot-anim','-gpu','swiftshader','-no-snapshot-load']);});
test('Windows graphics preference leaves Mac startup unchanged',async t=>{const f=fixture(t,{platform:'darwin',graphicsMode:'host-opengl'});await f.android.start('Pixel_6_API_34');assert.equal(f.children[0].args.includes('-gpu'),false);assert.equal(f.children[0].args.includes('-feature'),false);});


test('Android process failures expose a stable recovery code without command payloads',async t=>{
 const f=fixture(t);await f.android.select('emulator-5554');
 for(const timedOut of [false,true]){f.setHandler(args=>{if(args.includes('screencap'))throw Object.assign(Error('private payload'),{killed:timedOut})});
 await assert.rejects(f.android.screenshot(),error=>error.code===(timedOut?'ANDROID_COMMAND_TIMEOUT':'ANDROID_COMMAND_FAILED')&&!error.message.includes('private payload'));}
});
