"use strict";
const fs = require('node:fs/promises');
const {randomUUID} = require('node:crypto');
const P = require('./policy.cjs');

class LocationPermission {
 constructor({file,getContents,prompt,onChange=()=>{},onError=()=>{},fsImpl=fs}) {
  this.file=file;this.getContents=getContents;this.prompt=prompt;
  this.onChange=onChange;this.onError=onError;this.fs=fsImpl;
  this.allowed=false;this.prompting=false;this.revision=0;this.writes=Promise.resolve();
 }
 async load() {
  this.allowed=false;
  try {const saved=JSON.parse(await this.fs.readFile(this.file,'utf8'));this.allowed=saved?.version===1&&saved.tinderGeolocation===true;} catch {}
  this.onChange(this.allowed);
  return this.allowed;
 }
 setAllowed(allowed) {
  if(typeof allowed!=='boolean')return Promise.reject(new TypeError('Location permission must be true or false.'));
  const revision=++this.revision;
  // Revocation takes effect before disk I/O, including when persistence fails.
  if(!allowed){this.allowed=false;this.onChange(false);}
  const write=this.writes.catch(()=>{}).then(async()=>{
   const temporary=this.file+'.'+randomUUID()+'.tmp';
   try {
    await this.fs.writeFile(temporary,JSON.stringify({version:1,tinderGeolocation:allowed}),{mode:0o600,flag:'wx'});
    await this.fs.rename(temporary,this.file);
   } finally {await this.fs.unlink(temporary).catch(()=>{});}
   if(revision===this.revision){this.allowed=allowed;this.onChange(allowed);}
   return this.allowed;
  });
  this.writes=write;
  return write;
 }
 trusted(contents,permission,origin,details) {
  return !!contents&&contents===this.getContents()&&!contents.isDestroyed()&&permission==='geolocation'&&details?.isMainFrame===true&&P.isTinderURL(origin)&&P.isTinderURL(contents.getURL());
 }
 check(contents,permission,origin,details) {return this.allowed&&this.trusted(contents,permission,origin,details);}
 async request(contents,permission,callback,details) {
  const trusted=()=>this.trusted(contents,permission,details?.requestingUrl,details);
  if(!trusted())return callback(false);
  if(this.allowed)return callback(true);
  if(this.prompting)return callback(false);
  this.prompting=true;const revision=this.revision;let granted=false;
  try {
   if(await this.prompt()===true&&revision===this.revision&&trusted()){
    await this.setAllowed(true);
    granted=this.allowed&&trusted();
   }
  } catch(error){this.onError(error);} finally {this.prompting=false;}
  callback(granted);
 }
 attach(session) {
  session.setPermissionRequestHandler((...args)=>this.request(...args));
  session.setPermissionCheckHandler((...args)=>this.check(...args));
  return this;
 }
}
module.exports=LocationPermission;
