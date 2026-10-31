'use strict';
const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
// Main-process only. Never accept filenames or checkpoint contents from renderer IPC.
class MobileCheckpoint{
 constructor(file){this.file=file}
 read(){try{const value=JSON.parse(fs.readFileSync(this.file,'utf8'));if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid checkpoint');return value}catch(error){if(error.code==='ENOENT')return null;throw Error('Mobile checkpoint could not be read. Repair the local checkpoint before starting.')}}
 write(value){
  const temp=this.file+'.'+randomUUID()+'.tmp';let fd;
  try{fs.mkdirSync(path.dirname(this.file),{recursive:true});fd=fs.openSync(temp,'wx',0o600);fs.writeFileSync(fd,JSON.stringify(value));fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.renameSync(temp,this.file)}
  catch{throw Error('Mobile checkpoint could not be saved. Check available disk space and permissions before resuming.')}
  finally{if(fd!==undefined)fs.closeSync(fd);try{fs.rmSync(temp,{force:true})}catch{}}
 }
}
module.exports=MobileCheckpoint;
