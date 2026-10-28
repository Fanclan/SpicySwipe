'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const childProcess = require('node:child_process');
const { randomUUID } = require('node:crypto');

const APPS = Object.freeze({ hinge: 'co.hinge.app', bumble: 'com.bumble.app' });
const KEYS = Object.freeze({ Backspace: 67, Delete: 112, Enter: 66, Tab: 61, ArrowLeft: 21, ArrowRight: 22, ArrowUp: 19, ArrowDown: 20, Escape: 4, Home: 122, End: 123 });
const PNG = Buffer.from('89504e470d0a1a0a', 'hex');
const quote = value => "'" + value.replace(/'/g, "'\\''") + "'";

class Android {
  constructor({ sdkRoot, graphicsMode, platform = process.platform, arch = process.arch, home = os.homedir(), execFile = childProcess.execFile, spawn = childProcess.spawn } = {}) {
    this.platform = platform;
    this.graphicsMode = graphicsMode === 'host-opengl' ? 'host-opengl' : 'software';
    this.arch = arch;
    this.execFile = execFile;
    this.spawn = spawn;
    this.serial = null;
    this.inputEpoch = 0;
    this.children = new Map();
    this.launchFailures = new Map();
    this.processIssue = '';
    this.disposed = false;
    const suffix = platform === 'win32' ? '.exe' : '';
    const fallback = platform === 'darwin' ? path.join(home, 'Library', 'Android', 'sdk') : platform === 'win32' ? path.join(home, 'AppData', 'Local', 'Android', 'Sdk') : path.join(home, 'Android', 'Sdk');
    const candidates = sdkRoot ? [sdkRoot] : [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, fallback].filter(Boolean);
    this.sdkRoot = candidates.find(root => fs.existsSync(path.join(root, 'platform-tools', 'adb' + suffix))) || candidates[0] || fallback;
    this.adb = path.join(this.sdkRoot, 'platform-tools', 'adb' + suffix);
    this.emulator = path.join(this.sdkRoot, 'emulator', 'emulator' + suffix);
  }

  _run(file, args, binary = false) {
    if (this.disposed) return Promise.reject(new Error('Android connection has closed. Reopen SpicySwipe.'));
    if (!fs.existsSync(file)) return Promise.reject(new Error('Android SDK tool is missing. Install Android Studio and its SDK platform-tools and emulator.'));
    return new Promise((resolve, reject) => {
      this.execFile(file, args, { shell: false, windowsHide: true, timeout: 15000, maxBuffer: binary ? 25 * 1024 * 1024 : 1024 * 1024, encoding: binary ? null : 'utf8' }, (error, stdout) => {
        if (this.disposed) return reject(new Error('Android connection has closed. Reopen SpicySwipe.'));
        if (error) {
          const timedOut = error.killed || error.code === 'ETIMEDOUT';
          reject(Object.assign(new Error(timedOut ? 'Android command timed out. Check the selected device and try again.' : 'Android command failed. Check the SDK, device connection and USB debugging authorization.'), {
            code: timedOut ? 'ANDROID_COMMAND_TIMEOUT' : 'ANDROID_COMMAND_FAILED'
          }));
        } else resolve(binary ? Buffer.from(stdout) : String(stdout));
      });
    });
  }

  async _devices() {
    const output = await this._run(this.adb, ['devices', '-l']);
    return output.split(/\r?\n/).flatMap(line => {
      const match = line.match(/^([A-Za-z0-9][A-Za-z0-9_.:\[\]-]{0,199})\s+(device|offline|unauthorized|recovery|sideload|bootloader|no permissions)(?:\s|$)/);
      return match ? [{ id: match[1], state: match[2] }] : [];
    });
  }

  async _avds() {
    const output = await this._run(this.emulator, ['-list-avds']);
    return output.split(/\r?\n/).map(s => s.trim()).filter(s => /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(s));
  }

  async status() {
    const issues = [];
    const available = fs.existsSync(this.adb);
    const hasEmulator = fs.existsSync(this.emulator);
    if (!available) issues.push('Install Android Studio and SDK Platform-Tools, or configure your Android SDK folder.');
    if (!hasEmulator) issues.push('Install Android Emulator through Android Studio’s SDK Manager to use virtual devices.');
    const [devices, avds] = await Promise.all([
      available ? this._devices().catch(error => { issues.push(error.message); return []; }) : [],
      hasEmulator ? this._avds().catch(error => { issues.push(error.message); return []; }) : []
    ]);
    if (hasEmulator && !avds.length) issues.push('Create a Google Play virtual device in Android Studio’s Device Manager.');
    if (this.processIssue) issues.push(this.processIssue);
    return { sdkRoot: this.sdkRoot, available, architecture: this.arch, recommendedAbi: this.arch === 'arm64' ? 'arm64-v8a' : 'x86_64', avds, devices, selectedSerial: this.serial, issues };
  }

  async bootStatus(avd) {
    if (typeof avd !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(avd)) throw new Error('Choose a valid existing AVD.');
    if (this.launchFailures.has(avd)) throw new Error(this.launchFailures.get(avd));
    const devices = await this._devices();
    // Inspect emulator identity directly. Never infer the requested AVD from the first online serial.
    for (const device of devices.filter(d => /^emulator-\d+$/.test(d.id) && d.state === 'device')) {
      const name = await this._run(this.adb, ['-s', device.id, 'emu', 'avd', 'name']).catch(() => '');
      if (name.split(/\r?\n/)[0].trim() !== avd) continue;
      const boot = await this._run(this.adb, ['-s', device.id, 'shell', 'getprop', 'sys.boot_completed']).catch(() => '');
      return { avd, serial: device.id, phase: boot.trim() === '1' ? 'ready' : 'booting' };
    }
    if (this.launchFailures.has(avd)) throw new Error(this.launchFailures.get(avd));
    return { avd, phase: 'waiting' };
  }

  async start(avd) {
    if (typeof avd !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(avd)) throw new Error('Choose a valid existing AVD.');
    if (!(await this._avds()).includes(avd)) throw new Error('That AVD does not exist. Create it in Android Studio first.');
    this.launchFailures.delete(avd);
    this.processIssue = '';
    const existing = await this.bootStatus(avd);
    if (existing.serial) return { ...existing, starting: existing.phase !== 'ready', alreadyRunning: true };
    if (this.disposed) throw new Error('Android connection has closed. Reopen SpicySwipe.');
    if (this.children.has(avd)) return { avd, starting: true, alreadyRunning: true };
    this.processIssue = '';
    // Default to software; native OpenGL is an explicit per-device workaround for software-renderer crashes.
    const renderer=this.graphicsMode==='host-opengl'?['-gpu','host','-feature','-Vulkan']:['-gpu','swiftshader'];
    const graphics=this.platform==='win32'?[...renderer,'-no-snapshot-load']:[];
    const child = this.spawn(this.emulator, ['-avd', avd, '-no-window', '-no-boot-anim', ...graphics], { shell: false, windowsHide: true, stdio: 'ignore' });
    this.children.set(avd, child);
    child.on('exit', code => {
      if (this.children.get(avd) === child) this.children.delete(avd);
      if (!this.disposed) {
        this.processIssue = 'The emulator exited. Check its system image and hardware acceleration in Android Studio.';
        this.launchFailures.set(avd, this.processIssue);
      }
    });
    child.on('error', () => {
      if (this.children.get(avd) === child) this.children.delete(avd);
      this.processIssue = 'The emulator could not start. Check Android Studio’s Device Manager.';
      this.launchFailures.set(avd, this.processIssue);
    });
    await new Promise((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', () => reject(new Error('The emulator could not start. Check Android Studio’s Device Manager.')));
    });
    return { avd, starting: true };
  }

  cancelInput() { this.inputEpoch++; }

  async select(serial) {
    this.cancelInput();const selectionEpoch=this.inputEpoch;
    if (typeof serial !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:\[\]-]{0,199}$/.test(serial)) throw new Error('Invalid Android device serial.');
    const devices = await this._devices();
    if(this.disposed||selectionEpoch!==this.inputEpoch)throw new Error('Device selection changed or was canceled.');
    if (!devices.some(device => device.id === serial && device.state === 'device')) throw new Error('Selected device is not online. Wait for boot or approve USB debugging.');
    this.serial = serial;
    return { serial };
  }

  async _selected() {
    const serial = this.serial;
    if (!serial) throw new Error('Select an Android device first.');
    const devices = await this._devices();
    if (this.serial !== serial) throw new Error('Device selection changed. Try again.');
    if (!devices.some(device => device.id === serial && device.state === 'device')) throw new Error('Selected Android device disconnected or is unavailable. Reconnect it and select it again.');
    return serial;
  }

  async _on(serial, args, binary = false) {
    if (serial !== this.serial) throw new Error('Device selection changed. Try again.');
    const result = await this._run(this.adb, ['-s', serial, ...args], binary);
    if (serial !== this.serial) throw new Error('Device selection changed. Try again.');
    return result;
  }

  async _inputOn(serial, args, epoch) {
    if (epoch !== this.inputEpoch) throw new Error('Android input context changed. Pending input was canceled.');
    const result = await this._on(serial, args);
    if (epoch !== this.inputEpoch) throw new Error('Android input context changed. Pending input was canceled.');
    return result;
  }

  async _capture(serial) {
    const bytes = await this._on(serial, ['exec-out', 'screencap', '-p'], true);
    if (bytes.length < 24 || !bytes.subarray(0, 8).equals(PNG)) throw new Error('Android did not return a PNG screenshot. Wait for boot and try again.');
    const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
    if (width < 1 || height < 1 || width > 16384 || height > 16384) throw new Error('Invalid Android screenshot size.');
    return { bytes, width, height };
  }

  async _dimensions(serial) {
    // InputReader's logical frame follows rotation; wm size only reports the natural size.
    // Read it fresh for every action, avoiding an expensive PNG capture before each tap.
    const output = await this._on(serial, ['shell', 'dumpsys', 'input']).catch(() => '');
    const dimensions = new Map();
    for (const line of output.split(/\r?\n/)) {
      if (!/\bViewport\b/.test(line) || !/\bdisplayId=0(?:,|\s|$)/.test(line) || !/\bisActive=\[1\]/.test(line)) continue;
      const match = line.match(/\blogicalFrame=\[0,\s*0,\s*(\d+),\s*(\d+)\]/);
      if (!match) continue;
      const width = Number(match[1]), height = Number(match[2]);
      if (width > 0 && height > 0 && width <= 16384 && height <= 16384) dimensions.set(width + 'x' + height, { width, height });
    }
    if (dimensions.size === 1) return dimensions.values().next().value;
    // Older devices/OEM formats may omit this metadata. Keep the verified screenshot fallback.
    const { width, height } = await this._capture(serial);
    return { width, height };
  }

  async _installed(serial, app) {
    return (await this._on(serial, ['shell', 'pm', 'list', 'packages', app])).split(/\r?\n/).some(line => line.trim() === 'package:' + app);
  }

  async inspect() {
    const serial = await this._selected();
    const [dimensions, hinge, bumble] = await Promise.all([this._dimensions(serial), this._installed(serial, APPS.hinge), this._installed(serial, APPS.bumble)]);
    return { serial, apps: { hinge, bumble }, ...dimensions };
  }

  _app(platform) {
    if (typeof platform !== 'string' || !Object.hasOwn(APPS, platform)) throw new Error('Choose Hinge or Bumble as the Android platform.');
    return APPS[platform];
  }

  async openApp(platform) {
    const inputEpoch = this.inputEpoch;
    const app = this._app(platform), serial = await this._selected();
    if (!await this._installed(serial, app)) throw new Error('Install this app from Google Play on the selected device first.');
    const output = await this._inputOn(serial, ['shell', 'monkey', '-p', app, '-c', 'android.intent.category.LAUNCHER', '1'], inputEpoch);
    if (/no activities|aborted|error|exception/i.test(output)) throw new Error('Could not launch this app. Open it manually on the device and check its setup.');
    return { opened: platform };
  }

  async openStore(platform) {
    const inputEpoch = this.inputEpoch;
    const app = this._app(platform), serial = await this._selected();
    const output = await this._inputOn(serial, ['shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', quote('market://details?id=' + app)], inputEpoch);
    if (/error|exception/i.test(output)) throw new Error('Could not open Google Play. Use a Google Play system image and complete its setup.');
    return { opened: 'store', platform };
  }

  async screenshot() {
    const serial = await this._selected();
    const { bytes } = await this._capture(serial);
    return 'data:image/png;base64,' + bytes.toString('base64');
  }

  _guard(serial, epoch, valid) {
    if (this.disposed || this.serial !== serial || this.inputEpoch !== epoch || (valid && valid() !== true)) throw new Error('Android context changed. Pending operation was canceled.');
  }

  async _guardedOn(serial, epoch, args, valid) {
    this._guard(serial, epoch, valid);
    const output = await this._on(serial, args);
    this._guard(serial, epoch, valid);
    return output;
  }

  async _foreground(serial, epoch) {
    const output = await this._guardedOn(serial, epoch, ['shell', 'dumpsys', 'activity', 'activities']);
    const packages = new Set();
    for (const line of output.split(/\r?\n/)) {
      if (!/\b(?:mResumedActivity|topResumedActivity)\s*[:=]/.test(line)) continue;
      const match = line.match(/\bu\d+\s+([A-Za-z][A-Za-z0-9_.]+)\/[A-Za-z0-9_.$]+/);
      if (match) packages.add(match[1]);
    }
    if (packages.size !== 1) throw new Error('Android foreground app could not be verified. Open Hinge and try again.');
    return [...packages][0];
  }

  async hierarchy() {
    const epoch = this.inputEpoch, serial = await this._selected();
    this._guard(serial, epoch);
    const foreground = await this._foreground(serial, epoch);
    const dumpPath = '/data/local/tmp/spicyswipe-' + randomUUID() + '.xml';
    // A fresh random path prevents failed dumps from reusing earlier profiles.
    // Remove only this internally generated file; cleanup is read-only-device bookkeeping.
    try {
      const status = await this._guardedOn(serial, epoch, ['shell', 'uiautomator', 'dump', dumpPath]);
      if (/error|exception|could not|failed/i.test(status)) throw new Error('Android screen hierarchy is unavailable. Close overlays and try again.');
      const xml = await this._guardedOn(serial, epoch, ['shell', 'cat', dumpPath]);
      if (!xml.trim().startsWith('<') || Buffer.byteLength(xml) > 1024 * 1024) throw new Error('Android returned an invalid or oversized screen hierarchy.');
      const after = await this._foreground(serial, epoch);
      if (foreground !== after) throw new Error('Android foreground app changed while reading the screen.');
      return { xml, foreground };
    } finally {
      // Never run a late cleanup command after device/session invalidation.
      if (!this.disposed && this.serial === serial && this.inputEpoch === epoch) await this._guardedOn(serial, epoch, ['shell', 'rm', '-f', dumpPath]).catch(() => {});
      this._guard(serial, epoch);
    }
  }

  async tapControl(bounds, valid, onIssued) {
    const epoch = this.inputEpoch;
    if (!bounds || typeof bounds !== 'object' || !['x', 'y', 'width', 'height'].every(k => Number.isInteger(bounds[k])) || bounds.x < 0 || bounds.y < 0 || bounds.width <= 0 || bounds.height <= 0) throw new Error('Control bounds must be positive whole screen coordinates.');
    if (typeof valid !== 'function') throw new Error('A current control validity check is required.');
    const serial = await this._selected(); this._guard(serial, epoch, valid);
    const { width, height } = await this._dimensions(serial); this._guard(serial, epoch, valid);
    if (bounds.x + bounds.width > width || bounds.y + bounds.height > height) throw new Error('Control bounds are outside the current display.');
    const x = Math.floor(bounds.x + bounds.width / 2), y = Math.floor(bounds.y + bounds.height / 2);
    this._guard(serial,epoch,valid);
    const pending=this._on(serial,['shell','input','tap',String(x),String(y)]);
    try{onIssued?.()}catch(error){await pending.catch(()=>{});throw error}
    await pending;this._guard(serial,epoch,valid);
    return { ok: true };
  }

  async swipeProfile(direction, bounds, valid, onIssued) {
    const epoch=this.inputEpoch;
    if(!['left','right'].includes(direction))throw new Error('Profile swipe direction must be left or right.');
    if(!bounds||!['x','y','width','height'].every(k=>Number.isInteger(bounds[k]))||bounds.x<0||bounds.y<0||bounds.width<200||bounds.height<200)throw new Error('Invalid profile swipe bounds.');
    if(typeof valid!=='function')throw new Error('A current profile validity check is required.');
    const serial=await this._selected();this._guard(serial,epoch,valid);
    const {width,height}=await this._dimensions(serial);this._guard(serial,epoch,valid);
    if(bounds.x+bounds.width>width||bounds.y+bounds.height>height)throw new Error('Profile bounds are outside the current display.');
    const left=Math.round(bounds.x+bounds.width*.15),right=Math.round(bounds.x+bounds.width*.85),y=Math.round(bounds.y+bounds.height*.5);
    const points=direction==='right'?[left,y,right,y]:[right,y,left,y];
    this._guard(serial,epoch,valid);
    const pending=this._on(serial,['shell','input','swipe',...points.map(String),'450']);
    try{onIssued?.()}catch(error){await pending.catch(()=>{});throw error}
    await pending;this._guard(serial,epoch,valid);return {ok:true};
  }

  async scrollProfile({ fraction = .4, duration = 400, direction = 'up' } = {}, valid) {
    const epoch = this.inputEpoch;
    if (!Number.isFinite(fraction) || fraction < .2 || fraction > .65 || !Number.isInteger(duration) || duration < 250 || duration > 900 || !['up', 'down'].includes(direction)) throw new Error('Profile scroll requires fraction 0.2–0.65, duration 250–900 ms, and direction up or down.');
    if (valid !== undefined && typeof valid !== 'function') throw new Error('Invalid profile scroll validity check.');
    const serial = await this._selected(); this._guard(serial, epoch, valid);
    const { width, height } = await this._dimensions(serial); this._guard(serial, epoch, valid);
    // Keep every point inside the central content area, away from filters and bottom navigation.
    const x = Math.floor(width * .5), distance = Math.round(height * .65 * fraction);
    const low = Math.round(height * .525 - distance / 2), high = Math.round(height * .525 + distance / 2);
    const points = direction === 'up' ? [x, high, x, low] : [x, low, x, high];
    await this._guardedOn(serial, epoch, ['shell', 'input', 'swipe', ...points.map(String), String(duration)], valid);
    return { ok: true };
  }
  async tap(x, y) {
    const inputEpoch = this.inputEpoch;
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0) throw new Error('Tap coordinates must be positive whole numbers within the screen bounds.');
    const serial = await this._selected();
    const { width, height } = await this._dimensions(serial);
    if (x >= width || y >= height) throw new Error('Tap coordinates are outside the screen bounds.');
    await this._inputOn(serial, ['shell', 'input', 'tap', String(x), String(y)], inputEpoch);
    return { ok: true };
  }

  async swipe(direction) {
    const inputEpoch = this.inputEpoch;
    if (!['up', 'down', 'left', 'right'].includes(direction)) throw new Error('Choose up, down, left or right as the swipe direction.');
    const serial = await this._selected();
    const { width, height } = await this._dimensions(serial);
    const x = Math.round(width / 2), y = Math.round(height / 2);
    const lowX = Math.round(width * 0.28), highX = Math.round(width * 0.72);
    const lowY = Math.round(height * 0.28), highY = Math.round(height * 0.72);
    const points = { up: [x, highY, x, lowY], down: [x, lowY, x, highY], left: [highX, y, lowX, y], right: [lowX, y, highX, y] }[direction];
    await this._inputOn(serial, ['shell', 'input', 'swipe', ...points.map(String), '400'], inputEpoch);
    return { ok: true };
  }

  async back() {
    const inputEpoch = this.inputEpoch;
    const serial = await this._selected();
    await this._inputOn(serial, ['shell', 'input', 'keyevent', '4'], inputEpoch);
    return { ok: true };
  }

  async type(text) {
    const inputEpoch = this.inputEpoch;
    if (typeof text !== 'string' || !text.length || text.length > 2000 || !/^[\x20-\x7e]+$/.test(text)) throw new Error('Android text entry supports 1–2000 printable ASCII characters on one line. Unicode and emoji need the device keyboard.');
    const serial = await this._selected();
    // adb shell joins arguments before Android parses them: host execFile alone is not sufficient quoting.
    // Separate literal percent signs so Android cannot interpret a user-supplied %s as a space.
    for (const part of text.split(/(%)/).filter(Boolean)) {
      await this._inputOn(serial, ['shell', 'input', 'text', quote(part.replace(/ /g, '%s'))], inputEpoch);
    }
    return { ok: true };
  }

  async key(key) {
    const inputEpoch = this.inputEpoch;
    if (typeof key !== 'string' || !Object.hasOwn(KEYS, key)) throw new Error('Unsupported Android keyboard key.');
    const serial = await this._selected();
    await this._inputOn(serial, ['shell', 'input', 'keyevent', String(KEYS[key])], inputEpoch);
    return { ok: true };
  }

  dispose() {
    this.cancelInput();
    this.disposed = true;
    for (const child of this.children.values()) {
      if (!child.killed && child.exitCode === null) child.kill();
    }
    this.children.clear();
    this.serial = null;
  }
}

module.exports = Android;
