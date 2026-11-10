'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const { quarantineStaleLocks } = require('../web/managed-avd-locks.cjs');

const phone = 'SpicySwipe_Bumble_API_36';
const markers = ['snapshot.lock.lock', 'hardware-qemu.ini.lock'];
function fixture(t) {
 const base = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'avd-lock-test-'));
 t.after(() => fs.rmSync(base,{recursive:true,force:true}));
 const avd = path.join(base,phone+'.avd'), proc = path.join(base,'proc');
 fs.mkdirSync(avd);fs.mkdirSync(proc);
 const boot = Math.floor(Date.now()/1000)-120;
 fs.writeFileSync(path.join(proc,'stat'),'btime '+boot+'\n');
 function processEntry(pid,exe,start) {
  const dir=path.join(proc,String(pid));fs.mkdirSync(path.join(dir,'fd'),{recursive:true});
  fs.symlinkSync('/bin/'+exe,path.join(dir,'exe'));
  fs.writeFileSync(path.join(dir,'stat'),pid+' ('+exe+') S '+'0 '.repeat(18)+(start*100)+' 0\n');
 }
 processEntry(1,'docker-init',80);processEntry(39,'electron',84);
 function stamp(file,seconds) { fs.utimesSync(path.join(avd,file),boot+seconds,boot+seconds); }
 for (const name of markers) {
  fs.writeFileSync(path.join(avd,name),Buffer.from('39\0'),{mode:0o600});stamp(name,70);
 }
 fs.writeFileSync(path.join(avd,'multiinstance.lock'),'');
 fs.writeFileSync(path.join(avd,'userdata-qemu.img'),'session data');
 const share = () => true;
 // The simulated Linux process owns the fixture files, including on hosts without getuid().
 const ownerUid = fs.statSync(avd).uid;
 return {avd,base,proc,stamp,processEntry,ownerUid,
  run:(name=phone,lock=share)=>quarantineStaleLocks(base,name,{proc,ticks:100,lockShare:lock,ownerUid})};
}
test('older managed PID markers are archived intact before boot, including PID reuse',t=>{
 const f=fixture(t);const original=fs.statSync(path.join(f.avd,markers[0]));
 const count=f.run();
 assert.equal(count,2);
 const archive=fs.readdirSync(f.avd).find(name=>name.startsWith('.stale-pid-locks-'));
 assert.ok(archive);
 const copy=path.join(f.avd,archive,markers[0]);
 assert.deepEqual(fs.readFileSync(copy),Buffer.from('39\0'));
 assert.equal(fs.statSync(copy).ino,original.ino);assert.equal(fs.statSync(copy).mode,original.mode);
 assert.equal(fs.statSync(path.join(f.avd,'multiinstance.lock')).size,0);
 assert.equal(fs.readFileSync(path.join(f.avd,'userdata-qemu.img'),'utf8'),'session data');
 assert.equal(f.run(),0);
});
test('a missing PID must have a marker older than the container, and a lone stale lock can be recovered',t=>{
 const f=fixture(t);
 fs.unlinkSync(path.join(f.avd,markers[1]));
 fs.writeFileSync(path.join(f.avd,markers[0]),'4321\0');
 f.stamp(markers[0],83);assert.equal(f.run(),0);
 f.stamp(markers[0],76);assert.equal(f.run(),1);
});
test('an unknown or different owner leaves the managed PID markers in place',t=>{
 const f=fixture(t);
 for (const ownerUid of [null,f.ownerUid+1]) {
  assert.equal(quarantineStaleLocks(f.base,phone,{proc:f.proc,ticks:100,lockShare:()=>true,ownerUid}),0);
  assert.ok(markers.every(name=>fs.existsSync(path.join(f.avd,name))));
 }
});
test('a symlinked managed AVD is never followed during recovery',t=>{
 const f=fixture(t),other='SpicySwipe_Phone_API_36';
 fs.symlinkSync(f.avd,path.join(f.base,other+'.avd'),'junction');
 assert.equal(f.run(other),0);
 assert.ok(markers.every(name=>fs.existsSync(path.join(f.avd,name))));
});
test('the production lock probe honors both kernel lock families',t=>{
 if (!spawnSync('flock',['--help'],{encoding:'utf8'}).stdout?.includes('--fcntl')) return t.skip('requires the production util-linux OFD locking API');
 const f=fixture(t);
 const file=path.join(f.avd,'multiinstance.lock'),fd=fs.openSync(file,'r+');
 const run=()=>quarantineStaleLocks(f.base,phone,{proc:f.proc,ticks:100});
 try {
  for (const flags of [[],['--fcntl']]) {
   const flock=op=>spawnSync('flock',[...flags,op,'3'],{stdio:['ignore','ignore','ignore',fd]}).status;
   assert.equal(flock('--exclusive'),0);assert.equal(run(),0);assert.equal(flock('--unlock'),0);
  }
 } finally { fs.closeSync(fd); }
 assert.equal(run(),2);
});
for (const scenario of ['recent marker','live QEMU','open disk','locked share','replaced share','missing share','invalid marker','symlink','custom phone','unknown process']) {
 test('managed AVD recovery keeps markers when ownership is uncertain: '+scenario,t=>{
  const f=fixture(t);let name=phone,lock=()=>true;
  if(scenario==='recent marker')f.stamp(markers[0],86);
  if(scenario==='live QEMU')f.processEntry(41,'qemu-system-x86_64',95);
  if(scenario==='open disk')fs.symlinkSync(path.join(f.avd,'userdata-qemu.img'),path.join(f.proc,'39','fd','4'));
  if(scenario==='locked share')lock=()=>false;
  if(scenario==='replaced share')lock=()=>{fs.renameSync(path.join(f.avd,'multiinstance.lock'),path.join(f.avd,'old-share'));fs.writeFileSync(path.join(f.avd,'multiinstance.lock'),'');return true;};
  if(scenario==='missing share')fs.unlinkSync(path.join(f.avd,'multiinstance.lock'));
  if(scenario==='invalid marker')fs.writeFileSync(path.join(f.avd,markers[0]),'not a PID');
  if(scenario==='symlink'){fs.unlinkSync(path.join(f.avd,markers[0]));fs.symlinkSync('userdata-qemu.img',path.join(f.avd,markers[0]));}
  if(scenario==='custom phone'){name='CustomPhone';fs.symlinkSync(f.avd,path.join(f.base,name+'.avd'));}
  if(scenario==='unknown process')fs.unlinkSync(path.join(f.proc,'39','exe'));
  assert.equal(f.run(name,lock),0);
  assert.ok(markers.every(m=>fs.existsSync(path.join(f.avd,m))));
  assert.equal(fs.readdirSync(f.avd).some(n=>n.startsWith('.stale-pid-locks-')),false);
 });
}
