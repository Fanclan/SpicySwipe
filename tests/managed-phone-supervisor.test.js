'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');

const hinge = 'SpicySwipe_Phone_API_36';
const bumble = 'SpicySwipe_Bumble_API_36';

function fixture(t, scenario) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-supervisor-'));
  const sdk = path.join(home, 'android-runtime/sdk');
  function write(name, source) {
    const file = path.join(home, name);
    fs.mkdirSync(path.dirname(file), {recursive:true});
    fs.writeFileSync(file, source, {mode:0o700});
  }
  write('android-runtime/sdk/system-images/android-36/google_apis_playstore/x86_64/system.img', '');
  write('android-runtime/sdk/platform-tools/adb', `#!/bin/sh
if [ "$1" = start-server ]; then exit 0; fi
[ "$*" = '-s emulator-5554 shell getprop sys.boot_completed' ] || exit 1
touch "$HOME/probed"
if [ "$SCENARIO" != failed ] && [ ! -e "$HOME/restarted" ]; then echo 1; fi
`);
  write('android-runtime/sdk/emulator/emulator', `#!/bin/sh
if [ "$1" = -accel-check ]; then exit 0; fi
printf '%s\\n' "$@" > "$HOME/args-\${1#@}"
if [ "$1" = '@${bumble}' ] || [ "$SCENARIO" = shutdown ] || [ "$SCENARIO" = city-shutdown ]; then exec /bin/sleep 60; fi
if [ -e "$HOME/started" ]; then
  if [ "$SCENARIO" = city ]; then
    # Inspect the first helper at launch, even when this guest's own helper is also running.
    if kill -0 "$(cat "$HOME/first-watcher-pid")" 2>/dev/null; then echo 'old watcher still active'; fi
    while [ ! -f "$HOME/watcher-ready-$$" ]; do /bin/sleep .01; done
    echo 'replacement watcher ready'
  fi
  echo 'replacement launched'
  touch "$HOME/restarted"
  exit 1
fi
touch "$HOME/started"
# A fake Android boot can complete (or fail) before the process exits.
for i in $(seq 1 100); do
  if [ "$SCENARIO" = city ]; then [ -f "$HOME/watcher-ready-$$" ] && break
  elif [ -e "$HOME/clock-read" ] || { [ "$SCENARIO" = failed ] && [ -e "$HOME/probed" ]; }; then break; fi
  /bin/sleep .01
done
echo 1400 > "$HOME/clock"
ulimit -c 0
kill -ABRT "$$"
`);
  write('bash-env', `
function /opt/electron/electron() {
  [[ $1 == */managed-city-location.cjs && $2 == "$HINGE" ]] || return 0
  if [[ ! -e "$HOME/first-city-attempt" ]]; then
    touch "$HOME/first-city-attempt"; echo 'city helper transient failure'; return 1
  fi
  # Model a city helper sleeping between its 15-second boot-ID checks.
  trap 'trap "" TERM; echo "city helper stopped"; exit 0' TERM
  if [[ ! -e "$HOME/first-watcher-pid" ]]; then echo "$BASHPID" > "$HOME/first-watcher-pid"; fi
  echo 'city helper watching'
  touch "$HOME/watcher-ready-$4"
  while true; do /bin/sleep .02; done
}
date() {
  cat "$HOME/clock"
  if [[ $avd == $HINGE && -e "$HOME/probed" ]]; then touch "$HOME/clock-read"; fi
}
sleep() {
  if [[ $1 == 30 || $1 == 2 ]]; then
    echo "backoff $avd $1"
    if [[ -e "$HOME/restarted" || $SCENARIO == failed ]]; then /bin/sleep 60; fi
  else
    /bin/sleep .01
  fi
}
`);
  write('clock', '1000\n');
  const child = spawn('bash', [require.resolve('../web/managed-phones.sh')], {
    detached:true, stdio:['ignore','pipe','pipe'],
    env:{...process.env, HOME:home, ANDROID_HOME:sdk, ANDROID_AVD_HOME:path.join(home,'avd'),
      SPICYSWIPE_ANDROID_CITY_LOCATION:scenario.startsWith('city') ? '12.34,-56.78' : '',
      BASH_ENV:path.join(home,'bash-env'), SCENARIO:scenario, HINGE:hinge}
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const closed = new Promise(resolve => child.once('close', resolve));
  const stop = () => { try { process.kill(-child.pid, 'SIGTERM'); } catch (e) { if(e.code !== 'ESRCH') throw e; } };
  t.after(async () => { stop(); await closed; fs.rmSync(home, {recursive:true, force:true}); });
  return {stop, closed, output:() => output,
    args:avd => fs.readFileSync(path.join(home, 'args-' + avd), 'utf8').trim().split('\n'),
    async until(wanted) {
    for (let i=0; i<400 && !output.includes(wanted); i++) await delay(10);
    assert.ok(output.includes(wanted), output);
  }};
}

const linux = {skip:process.platform !== 'linux'};
test('a native fault after a sustained Android boot gets a fast retry, then a failed restart backs off', linux, async t => {
  const f = fixture(t, 'recovered');
  await f.until('backoff ' + hinge + ' 30');
  const output = f.output();
  assert.match(output, /status=134 signal=6/);
  assert.match(output, /backoff SpicySwipe_Phone_API_36 2[\s\S]*status=1[\s\S]*backoff SpicySwipe_Phone_API_36 30/);
  assert.equal(output.split('Starting ' + bumble).length - 1, 1);
  for (const [avd, gpu] of [[hinge, 'swangle'], [bumble, 'swiftshader']]) {
    const args = f.args(avd);
    assert.equal(args[args.indexOf('-gpu') + 1], gpu, avd + ' renderer');
  }
});

test('a native fault before Android finishes booting keeps the long retry', linux, async t => {
  const f = fixture(t, 'failed');
  await f.until('backoff ' + hinge + ' 30');
  assert.match(f.output(), /status=134 signal=6/);
  assert.doesNotMatch(f.output(), /backoff .* 2\b/);
});

test('Coolify process group shutdown exits both phone supervisors without another launch', linux, async t => {
  const f = fixture(t, 'shutdown');
  await f.until('Starting ' + hinge);
  await f.until('Starting ' + bumble);
  f.stop();
  await f.closed;
  assert.doesNotMatch(f.output(), /backoff/);
  assert.equal(f.output().split('Starting ').length - 1, 2);
});

test('a slow city watcher is stopped and reaped before a replacement phone launches', linux, async t => {
  const f = fixture(t, 'city');
  await f.until('backoff ' + hinge + ' 30');
  assert.match(f.output(), /city helper transient failure[\s\S]*city helper watching[\s\S]*status=134 signal=6/);
  assert.match(f.output(), /city helper stopped[\s\S]*replacement watcher ready[\s\S]*replacement launched/);
  assert.match(f.output(), /backoff SpicySwipe_Phone_API_36 2/);
  assert.doesNotMatch(f.output(), /old watcher still active/);
});

test('Coolify shutdown stops the active city watcher and never launches a replacement', linux, async t => {
  const f = fixture(t, 'city-shutdown');
  await f.until('city helper watching');
  f.stop();
  await f.closed;
  assert.match(f.output(), /city helper stopped/);
  assert.doesNotMatch(f.output(), /replacement launched|backoff/);
});
