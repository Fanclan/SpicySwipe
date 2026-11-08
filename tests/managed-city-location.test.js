'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn,spawnSync}=require('node:child_process');
const {setTimeout:delay}=require('node:timers/promises');
const {phones,ManagedPhone}=require('../desktop/managed-phone.cjs');
const {parseCityLocation,applyCityLocation}=require('../web/managed-city-location.cjs');
const boot1='11111111-1111-4111-8111-111111111111',boot2='22222222-2222-4222-8222-222222222222';

test('managed city location is optional and accepts only bounded city-level decimal degrees',()=>{
 assert.equal(parseCityLocation(),null);assert.equal(parseCityLocation(''),null);
 assert.deepEqual(parseCityLocation('12.34, -56.78'),{latitude:'12.34',longitude:'-56.78'});
 assert.deepEqual(parseCityLocation('-90,180'),{latitude:'-90',longitude:'180'});
 for(const bad of ['91,0','0,-181','12.345,32','0,1;bad','1e1,30','1,2,3','  '])
  assert.throws(()=>parseCityLocation(bad),error=>!error.message.includes(bad)&&/city location/i.test(error.message));
});

test('only a stable matching boot receives longitude first, and the receipt is reused until the guest reboots',async()=>{
 for(const phone of Object.values(phones)){
  const point=parseCityLocation('12.34,-56.78'),calls=[];let current=boot1,receipt,ready=false;
  const state={
   boot:async(serial,avd)=>{assert.equal(serial,phone.serial);assert.equal(avd,phone.avd);return {phase:ready?'ready':'booting',bootId:current}},
   readReceipt:async()=>receipt,writeReceipt:async(serial,id)=>{assert.equal(serial,phone.serial);receipt=id},
   fix:async args=>{calls.push(args);return 'OK\r\n'},
  };
  assert.equal(await applyCityLocation(phone,null,{boot:()=>assert.fail('unset must not contact ADB')}),true);
  assert.equal(await applyCityLocation(phone,point,state),false);assert.deepEqual(calls,[]);
  ready=true;
  assert.equal(await applyCityLocation(phone,point,state),true);assert.equal(receipt,boot1);
  assert.equal(await applyCityLocation(phone,point,state),true);assert.equal(calls.length,1);
  assert.deepEqual(calls[0],['-s',phone.serial,'emu','geo','fix','-56.78','12.34']);
  current=boot2;assert.equal(await applyCityLocation(phone,point,state),true);assert.equal(calls.length,2);assert.equal(receipt,boot2);
 }
});

test('a wrong managed binding, unstable boot, or rejected GPS command cannot publish readiness',async()=>{
 const phone=phones.bumble;const point=parseCityLocation('12.34,-56.78');
 const state={boot:async()=>({phase:'ready',bootId:boot1}),readReceipt:async()=>null,
  writeReceipt:()=>assert.fail('no receipt'),fix:async()=> 'OK'};
 assert.equal(await applyCityLocation({...phone,serial:phones.hinge.serial},point,{...state,boot:()=>assert.fail('wrong serial')}),false);
 assert.equal(await applyCityLocation(phone,point,{...state,fix:async()=> 'KO: rejected'}),false);
 let reads=0;
 assert.equal(await applyCityLocation(phone,point,{...state,boot:async()=>({phase:'ready',bootId:++reads===1?boot1:boot2})}),false);
});

test('managed preparation waits for the current boot command receipt and never depends on a guest app requesting GPS',async()=>{
 let receipt=boot1;const calls=[];
 const device={serial:phones.bumble.serial,managedBoot:async()=>({phase:'ready',bootId:boot2}),
  isAppInstalled:async()=>true,openApp:async()=>calls.push('app')};
 const managed=new ManagedPhone('bumble',device,async serial=>{assert.equal(serial,device.serial);return receipt});
 assert.equal((await managed.prepare(()=>true)).ready,false);assert.deepEqual(calls,[]);
 receipt=boot2;assert.equal((await managed.prepare(()=>true)).ready,true);assert.deepEqual(calls,['app']);
});

test('Linux supervisor worker uses the verified ADB target and records only its boot ID',{skip:process.platform!=='linux'},async t=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'managed-city-test-'));
 t.after(()=>fs.rmSync(tmp,{recursive:true,force:true}));
 const script=require.resolve('../web/managed-city-location.cjs'),phone=phones.bumble;
 const args=[script,phone.avd,phone.serial,String(process.pid)];
 const env={...process.env,ANDROID_HOME:tmp,TMPDIR:tmp,SPICYSWIPE_ANDROID_CITY_LOCATION:''};
 // The unconfigured worker does not need an SDK.
 assert.equal(spawnSync(process.execPath,args,{env,timeout:5000}).status,0);
 env.SPICYSWIPE_ANDROID_CITY_LOCATION='12.34,-56.78';
 fs.mkdirSync(path.join(tmp,'platform-tools'));
 const adb=path.join(tmp,'platform-tools','adb');
 fs.writeFileSync(adb,`#!/bin/sh
if [ "$1" = devices ]; then echo 'emulator-5556 device'; exit; fi
[ "$1" = -s ] && [ "$2" = emulator-5556 ] || exit 1
shift 2
case "$*" in
 'shell getprop sys.boot_completed') echo 1 ;;
 'emu avd name') echo SpicySwipe_Bumble_API_36; echo OK ;;
 'shell cat /proc/sys/kernel/random/boot_id') echo ${boot1} ;;
 'emu geo fix -56.78 12.34') echo OK ;;
 *) exit 1 ;;
esac
`,{mode:0o700});
 const child=spawn(process.execPath,args,{env,stdio:['ignore','pipe','pipe']});
 const exited=new Promise(resolve=>child.once('exit',resolve));
 t.after(async()=>{child.kill();await exited});
 let output='';child.stdout.on('data',s=>output+=s);child.stderr.on('data',s=>output+=s);
 const receipt=path.join(tmp,'spicyswipe-managed-city',phone.serial);
 const until=Date.now()+7000;
 while(!fs.existsSync(receipt)&&Date.now()<until)await delay(25);
 assert.equal(fs.readFileSync(receipt,'utf8'),boot1);
 assert.equal(fs.statSync(receipt).mode&0o777,0o600);
 assert.doesNotMatch(output,/12\.34|56\.78/);
});
