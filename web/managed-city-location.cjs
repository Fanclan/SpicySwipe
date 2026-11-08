'use strict';
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {promisify}=require('node:util');
const exec=promisify(require('node:child_process').execFile);
const {setTimeout:delay}=require('node:timers/promises');
const Android=require('../desktop/android.cjs');
const {phones}=require('../desktop/managed-phone.cjs');
const receiptDir=path.join(os.tmpdir(),'spicyswipe-managed-city');
const bootIdPattern=/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;

function parseCityLocation(value){
 if(value===undefined||value==='')return null;
 const parts=value.split(',').map(part=>part.trim());
 if(parts.length!==2||parts.some(part=>!/^[-+]?\d{1,3}(?:\.\d{1,2})?$/.test(part))||
    Math.abs(Number(parts[0]))>90||Math.abs(Number(parts[1]))>180)
  throw Error('Managed city location must be latitude,longitude in range with up to two decimal places.');
 return {latitude:String(Number(parts[0])),longitude:String(Number(parts[1]))};
}
function receiptPath(serial){
 if(!Object.values(phones).some(phone=>phone.serial===serial))throw Error('Unknown managed phone.');
 return path.join(receiptDir,serial);
}
async function readReceipt(serial){
 try{return await fs.readFile(receiptPath(serial),'utf8')}catch(error){if(error.code==='ENOENT')return null;throw error}
}
async function writeReceipt(serial,id){
 const file=receiptPath(serial),temp=file+'.'+randomUUID();
 await fs.mkdir(receiptDir,{recursive:true,mode:0o700});
 try{await fs.writeFile(temp,id,{mode:0o600,flag:'wx'});await fs.rename(temp,file)}
 finally{await fs.rm(temp,{force:true})}
}

async function applyCityLocation(phone,location,io){
 if(!location)return true;
 if(!Object.values(phones).some(p=>p.serial===phone.serial&&p.avd===phone.avd))return false;
 const boot=await io.boot(phone.serial,phone.avd);
 if(boot.phase!=='ready'||!bootIdPattern.test(boot.bootId))return false;
 if(await io.readReceipt(phone.serial)===boot.bootId)return true;
 const reply=await io.fix(['-s',phone.serial,'emu','geo','fix',location.longitude,location.latitude]);
 if(reply.trim()!=='OK')return false;
 // A reconnected AVD must acknowledge its own boot. This records console
 // acceptance only; guest apps receive fixes through their location providers.
 const after=await io.boot(phone.serial,phone.avd);
 if(after.phase!=='ready'||after.bootId!==boot.bootId)return false;
 await io.writeReceipt(phone.serial,boot.bootId);
 return true;
}

async function main(){
 const location=parseCityLocation(process.env.SPICYSWIPE_ANDROID_CITY_LOCATION);
 const [avd,serial,pid]=process.argv.slice(2);
 if(!location||avd==='validate')return;
 if(!Object.values(phones).some(p=>p.avd===avd&&p.serial===serial)||!/^\d+$/.test(pid)||Number(pid)<2)
  throw Error('Invalid managed phone.');
 const android=new Android({sdkRoot:process.env.ANDROID_HOME});
 const io={boot:(s,a)=>android.managedBoot(s,a),readReceipt,writeReceipt,
  fix:async args=>(await exec(android.adb,args,{timeout:8000,maxBuffer:4096})).stdout};
 // Continue checking boot IDs so an in-guest reboot also receives the fix.
 let failures=0;
 for(;;){
  try{process.kill(Number(pid),0)}catch(error){if(error.code==='ESRCH')return;throw error}
  let ready=false;
  try{ready=await applyCityLocation({avd,serial},location,io)}catch{/* ADB can disconnect during startup. */}
  failures=ready?0:failures+1;
  if(failures===20)console.error('Waiting for the managed phone to accept its configured city location.');
  await delay(ready?15000:3000);
 }
}
if(require.main===module)main().catch(()=>{console.error('Managed city location configuration or startup failed.');process.exitCode=1});
module.exports={parseCityLocation,applyCityLocation,readReceipt};
