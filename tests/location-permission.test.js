const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const LocationPermission=require('../desktop/location-permission.cjs');
async function fixture(t,options={}){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'spicy-location-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const file=path.join(dir,'location-permission.json');let url='https://tinder.com/app/recs',prompts=0,answer=true;const errors=[];
 const wc={getURL:()=>url,isDestroyed:()=>false};
 const create=(extra={})=>new LocationPermission({file,getContents:()=>wc,prompt:async()=>{prompts++;return answer},onError:error=>errors.push(error),...options,...extra});
 const policy=create();await policy.load();
 const request=(permission='geolocation',details={isMainFrame:true,requestingUrl:'https://tinder.com/app/recs'},contents=wc)=>new Promise(resolve=>policy.request(contents,permission,resolve,details));
 return {file,dir,wc,policy,create,request,errors,get prompts(){return prompts},setAnswer:value=>answer=value,navigate:value=>url=value};
}
test('allow is persisted atomically, restored, and remains restricted to Tinder main frame',async t=>{
 const x=await fixture(t);assert.equal(await x.request(),true);assert.equal(x.prompts,1);
 const restored=x.create();await restored.load();assert.equal(restored.check(x.wc,'geolocation','https://tinder.com',{isMainFrame:true}),true);
 for(const [kind,origin,details,wc] of [['camera','https://tinder.com',{isMainFrame:true},x.wc],['geolocation','https://evil.test',{isMainFrame:true},x.wc],['geolocation','https://tinder.com.evil.test',{isMainFrame:true},x.wc],['geolocation','https://tinder.com',{isMainFrame:false},x.wc],['geolocation','https://tinder.com',{},x.wc],['geolocation','https://tinder.com',{isMainFrame:true},{}]])assert.equal(restored.check(wc,kind,origin,details),false);
 assert.deepEqual(await fs.readdir(x.dir),['location-permission.json']);
 x.navigate('https://evil.test');assert.equal(await x.request(),false);
});
test('denial and malformed saved approval fail closed without granting other permissions',async t=>{
 const x=await fixture(t);x.setAnswer(false);assert.equal(await x.request(),false);
 assert.equal(await x.request('geolocation',{isMainFrame:false,requestingUrl:'https://tinder.com'}),false);
 assert.equal(await x.request('geolocation',{isMainFrame:true,requestingUrl:'https://evil.test'}),false);
 assert.equal(await x.request('geolocation',{}),false);assert.equal(await x.request('camera'),false);assert.equal(x.prompts,1);
 for(const data of ['bad json','null','{"version":1,"tinderGeolocation":"true"}','{"version":2,"tinderGeolocation":true}']){await fs.writeFile(x.file,data);const policy=x.create();await policy.load();assert.equal(policy.allowed,false)}
});
test('revocation denies immediately, persists across restart, and invalidates an open prompt',async t=>{
 const x=await fixture(t);await x.policy.setAllowed(true);const revoke=x.policy.setAllowed(false);assert.equal(x.policy.allowed,false);await revoke;
 const restored=x.create();await restored.load();assert.equal(restored.allowed,false);
 let finish;const policy=x.create({prompt:()=>new Promise(resolve=>finish=resolve)});await policy.load();
 const pending=new Promise(resolve=>policy.request(x.wc,'geolocation',resolve,{isMainFrame:true,requestingUrl:'https://tinder.com'}));
 await policy.setAllowed(false);finish(true);assert.equal(await pending,false);assert.equal(policy.allowed,false);
});
test('failed writes never grant permission and failed revocation denies the current session',async t=>{
 const x=await fixture(t,{fsImpl:{...fs,rename:async()=>{throw Error('disk unavailable')}}});
 assert.equal(await x.request(),false);assert.equal(x.policy.allowed,false);assert.equal(x.errors.length,1);assert.deepEqual(await fs.readdir(x.dir),[]);
 const working=x.create({fsImpl:fs});await working.setAllowed(true);await x.policy.load();assert.equal(x.policy.allowed,true);
 await assert.rejects(x.policy.setAllowed(false),/disk unavailable/);assert.equal(x.policy.allowed,false);
});
test('navigation during an approval prompt cannot grant the new page location',async t=>{
 let finish;const x=await fixture(t,{prompt:()=>new Promise(resolve=>finish=resolve)});const pending=x.request();x.navigate('https://evil.test');finish(true);assert.equal(await pending,false);assert.equal(x.policy.allowed,false);
});
test('overlapping approval and revocation settle to the latest choice',async t=>{
 const x=await fixture(t);const allow=x.policy.setAllowed(true);const revoke=x.policy.setAllowed(false);await Promise.all([allow,revoke]);assert.equal(x.policy.allowed,false);const restored=x.create();await restored.load();assert.equal(restored.allowed,false);
});
