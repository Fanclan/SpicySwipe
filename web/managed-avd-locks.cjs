'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const managed = new Set(['SpicySwipe_Phone_API_36','SpicySwipe_Bumble_API_36']);
const markerNames = ['snapshot.lock.lock','hardware-qemu.ini.lock'];

function lockShare(fd) {
 // Both Linux lock families must be free, including owners in another PID namespace.
 // The children inherit this open file description, so both locks last until fd closes.
 return [[],['--fcntl']].every(flags =>
  spawnSync('flock',[...flags,'--nonblock','--exclusive','3'],{stdio:['ignore','ignore','ignore',fd]}).status === 0);
}

function processStarts(proc, ticks, avd) {
 const boot = /^btime (\d+)$/m.exec(fs.readFileSync(path.join(proc,'stat'),'utf8'));
 if (!boot || !Number.isSafeInteger(ticks) || ticks <= 0) return;
 const starts = new Map();
 for (const pid of fs.readdirSync(proc).filter(p => /^\d+$/.test(p))) {
  const dir = path.join(proc,pid);
  try {
   const stat = fs.readFileSync(path.join(dir,'stat'),'utf8');
   const fields = stat.slice(stat.lastIndexOf(')')+2).split(' ');
   const tick = Number(fields[19]);
   if (!Number.isSafeInteger(tick) || tick < 0) return;
   starts.set(pid,Number(boot[1])*1000 + tick*1000/ticks);
   const exe = path.basename(fs.readlinkSync(path.join(dir,'exe')));
   if (/^(?:qemu(?:$|[-.])|emulator(?:$|[-.])|snapshot)/i.test(exe)) return;
   if (proc === '/proc' && Number(pid) === process.pid) continue; // Our own multiinstance fd.
   const fds = path.join(dir,'fd');
   for (const n of fs.readdirSync(fds)) {
    let target;
    try { target = fs.readlinkSync(path.join(fds,n)); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (target === avd || target.startsWith(avd + '/')) return;
   }
  } catch (error) {
   if (error.code === 'ENOENT' && !fs.existsSync(dir)) { starts.delete(pid); continue; }
   throw error;
  }
 }
 if (starts.has('1')) return starts;
}

function sameFile(a,b) {
 return a.dev === b.dev && a.ino === b.ino && a.ctimeMs === b.ctimeMs && a.size === b.size;
}
function readMarker(file) {
 const before = fs.lstatSync(file,{throwIfNoEntry:false});
 if (!before) return null;
 if (!before.isFile() || before.nlink !== 1 || before.uid !== process.getuid() || before.size > 16) throw Error('Unexpected lock marker.');
 const fd = fs.openSync(file,fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
 try {
  if (!sameFile(before,fs.fstatSync(fd))) throw Error('Lock marker changed.');
  const pid = /^([1-9]\d{0,9})(?:\x00|\n)?$/.exec(fs.readFileSync(fd,'latin1'));
  if (!pid || Number(pid[1]) > 4194304) throw Error('Unknown Linux PID marker.');
  return {file,stat:before,pid:pid[1]};
 } finally { fs.closeSync(fd); }
}

function quarantineStaleLocks(home, name, {proc='/proc',ticks,lockShare:acquire=lockShare}={}) {
 if (!managed.has(name)) return 0;
 const avd = path.resolve(home,name+'.avd'), sharePath = path.join(avd,'multiinstance.lock');
 let share, archived=0;
 try {
  if (fs.realpathSync(avd) !== avd) return 0;
  const markers = markerNames.map(n => readMarker(path.join(avd,n))).filter(Boolean);
  if (!markers.length) return 0;
  // Open only the native, existing multiinstance lock. Never create or truncate it.
  share = fs.openSync(sharePath,fs.constants.O_RDWR | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  const info = fs.fstatSync(share);
  if (!info.isFile() || info.nlink !== 1 || info.size !== 0 || info.uid !== process.getuid() || !acquire(share)) return 0;
  const starts = processStarts(proc,ticks ?? Number(execFileSync('getconf',['CLK_TCK'],{encoding:'utf8'})),avd);
  if (!starts || !markers.every(m => m.stat.mtimeMs + 2000 < (starts.get(m.pid) ?? starts.get('1')))) return 0;
  if (!sameFile(info,fs.lstatSync(sharePath)) || !markers.every(m => sameFile(m.stat,fs.lstatSync(m.file)))) return 0;
  const archive = fs.mkdtempSync(path.join(avd,'.stale-pid-locks-'));
  for (const marker of markers) {
   if (!sameFile(marker.stat,fs.lstatSync(marker.file))) break;
   fs.renameSync(marker.file,path.join(archive,path.basename(marker.file)));
   archived++;
  }
 } catch {
  // Unverifiable or changing files are left for the native emulator.
 } finally { if (share !== undefined) fs.closeSync(share); }
 return archived;
}

if (require.main === module) {
 for (const name of managed) {
  if (quarantineStaleLocks(process.env.ANDROID_AVD_HOME,name)) console.log('Archived stale Android lock markers for '+name+'.');
 }
}
module.exports = { quarantineStaleLocks };
