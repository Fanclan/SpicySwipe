'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');

const id=value=>typeof value==='string'&&/^[a-f0-9]{32}$/.test(value);
const keys=(value,fields)=>value&&typeof value==='object'&&!Array.isArray(value)&&
  Object.keys(value).length===fields.length&&fields.every(field=>Object.hasOwn(value,field));
const validSource=s=>keys(s,['version','runId','count','limit','endsAt'])&&s.version===1&&id(s.runId)&&
  Number.isInteger(s.count)&&Number.isInteger(s.limit)&&s.count>0&&s.count<s.limit&&s.limit<=10000&&s.endsAt===null;
const sameSource=(a,b)=>Object.keys(a).every(k=>a[k]===b[k]);
const idle=s=>s?.status==='idle'&&s.phase==='idle'&&s.count===0&&s.runId===null&&s.endsAt===null&&
  s.nextActionAt===null&&s.completionReason===''&&s.error==='';
const stages=['held','acknowledged','complete','stopped','archived-complete','archived-stopped'];

function read(file){
  try{return JSON.parse(fs.readFileSync(file,'utf8'))}
  catch(error){if(error.code==='ENOENT')return undefined;throw error}
}
// Exclusive creation prevents a second host process spending the same dispatch.
// Rename updates are atomic; sync the directory so the reservation survives a reboot.
function write(file,value,exclusive=false){
  const dir=path.dirname(file),temp=file+'.'+randomUUID()+'.tmp';
  fs.mkdirSync(dir,{recursive:true,mode:0o700});
  const fd=fs.openSync(temp,'wx',0o600);
  try{
    try{fs.writeFileSync(fd,JSON.stringify(value));fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
    if(exclusive)fs.linkSync(temp,file);else fs.renameSync(temp,file);
    const directory=fs.openSync(dir,'r');try{fs.fsyncSync(directory)}finally{fs.closeSync(directory)}
  }finally{fs.rmSync(temp,{force:true})}
}

function validRecord(record){
  if(!keys(record,['source','stage','successorId','successorCount'])||!validSource(record.source)||!stages.includes(record.stage))return false;
  const {source,stage,successorId,successorCount}=record,remaining=source.limit-source.count;
  if(stage==='held')return successorId===null&&successorCount===0;
  return id(successorId)&&successorId!==source.runId&&Number.isInteger(successorCount)&&
    successorCount>=0&&successorCount<=remaining&&(!stage.endsWith('complete')||successorCount===remaining);
}
// Only public session metadata can leave this module as the renderer readback.
function metadata(s){
  if(!s||typeof s!=='object')return null;
  const fields=['status','phase','count','limit','error','runId','endsAt','nextActionAt','completionReason'];
  return Object.fromEntries(fields.filter(k=>Object.hasOwn(s,k)).map(k=>[k,s[k]]));
}

class TinderHeldSession{
  constructor(file,seed){
    this.file=file;this.claim=file+'.dispatch';this.epoch=0;
    try{
      let record=read(file);
      if(record!==undefined){
        if(!validRecord(record))throw Error();
        this.record=record;
      }
      if(seed!==undefined&&seed!==null&&seed!==''){
        const source=JSON.parse(seed);
        if(!validSource(source))throw Error();
        if(!record){
          const initial={source,stage:'held',successorId:null,successorCount:0};
          try{write(file,initial,true);record=initial}
          catch(error){if(error.code!=='EEXIST')throw error;record=read(file)}
          if(!validRecord(record))throw Error();
          this.record=record;
        }
        if(!sameSource(record.source,source))throw Error();
      }
      const claim=read(this.claim);
      if(claim!==undefined){
        if(!this.record||!keys(claim,['runId'])||claim.runId!==this.record.source.runId)throw Error();
        this.claimed=true;
      }else if(this.record&&this.record.stage!=='held')throw Error();
    }catch{this.invalid=true}
  }
  get stage(){
    if(this.invalid)return 'invalid';
    if(this.claimed&&this.record?.stage==='held')return 'dispatching';
    return this.record?.stage;
  }
  save(change){
    const next={...this.record,...change};
    try{write(this.file,next);this.record=next}
    catch{this.invalid=true;throw Error('Tinder could not save recovery progress.')}
  }
  matches(s,runId){
    const {source,successorCount}=this.record,limit=source.limit-source.count;
    return s&&id(s.runId)&&s.runId!==source.runId&&(!runId||s.runId===runId)&&
      s.limit===limit&&s.endsAt===null&&Number.isInteger(s.count)&&s.count>=successorCount&&s.count<=limit&&
      ['running','paused','idle','error','complete'].includes(s.status)&&
      (s.status==='complete'?(s.phase==='complete'&&s.count===limit&&s.completionReason==='limit'):s.completionReason==='');
  }
  project(raw){
    if(!this.stage)return raw;
    if(this.stage.startsWith('archived-')){
      const {source,successorCount}=this.record;
      return {...raw,tinderHandoffArchived:{source:{...source},count:source.count+successorCount,status:this.stage.slice('archived-'.length)}};
    }
    const segment=raw?.connected===true?metadata(raw.session):null;
    const accepted=this.stage==='acknowledged'&&this.matches(segment,this.record.successorId);
    if(accepted&&(segment.count>this.record.successorCount||segment.status==='complete')){
      try{this.save({successorCount:segment.count,stage:segment.status==='complete'?'complete':'acknowledged'})}catch{}
    }
    const stage=this.stage,source=this.record?.source;
    const minimumOnly=stage==='dispatching'||stage==='invalid'||(stage==='acknowledged'&&(!accepted||segment.status==='idle'));
    let session={status:'held',phase:'held',runId:source?.runId??null,count:source?source.count+this.record.successorCount:null,
      limit:source?.limit??null,endsAt:null,nextActionAt:null,completionReason:'',error:''};
    if(stage==='complete')Object.assign(session,{status:'complete',phase:'complete',completionReason:'limit'});
    else if(stage==='stopped')Object.assign(session,{status:'idle',phase:'idle'});
    else if(accepted&&!minimumOnly)Object.assign(session,{status:segment.status,phase:segment.phase,error:segment.error,nextActionAt:segment.nextActionAt});
    else session.error=stage==='invalid'?'Tinder recovery data needs repair.':minimumOnly?
      'The successor could not be confirmed. Showing the minimum recorded count.':'The last Tinder Like was unconfirmed before deployment.';
    return {...raw,connected:raw?.connected===true,session,tinderHandoff:{stage,source:source?{...source}:null,minimumOnly,rendererSession:segment}};
  }
  async continue(data,send,prepare){
    const {source}=this.record,remaining=source.limit-source.count;
    if(this.stage!=='held'||this.preparing||!keys(data,['sourceRunId','sourceCount','remaining','acceptPossibleRepeat'])||
        data.sourceRunId!==source.runId||data.sourceCount!==source.count||data.remaining!==remaining||data.acceptPossibleRepeat!==true)
      throw Error('Review the current held Tinder run before continuing.');
    const epoch=this.epoch;
    this.preparing=true;
    const guard={budgetGuard:{previousStatus:'idle',previousRunId:null,previousCount:0,maxSwipes:remaining,allowPossibleRepeat:true}};
    try{
      const before=await send('context',{});
      if(!before?.connected||before.capabilities?.budgetGuard!==1||!idle(before.session))throw Error('The Tinder predecessor changed.');
      if(typeof prepare!=='function'||this.epoch!==epoch)throw Error('Tinder recovery changed.');
      await prepare(remaining,{...source});
      const ready=await send('context',guard);
      if(this.epoch!==epoch||this.stage!=='held'||ready?.capabilities?.budgetGuard!==1||ready.guardedStartReady!==true||
          !ready.connected||!idle(ready.session))throw Error('Waiting for an eligible Tinder profile and matching settings.');
      try{write(this.claim,{runId:source.runId},true);this.claimed=true}
      catch(error){
        if(error.code==='EEXIST')this.claimed=true;else this.invalid=true;
        throw Error('Tinder recovery was already reserved or could not be saved.');
      }
      const answer=await send('start',guard);
      if(this.epoch!==epoch||!answer?.connected||!this.matches(answer.session)||answer.session.status==='idle')
        throw Error('The Tinder successor was not confirmed. Its Start will not be repeated.');
      this.save({stage:'acknowledged',successorId:answer.session.runId,successorCount:answer.session.count});
      return this.project(answer);
    }finally{this.preparing=false}
  }
  async control(action,data,send,prepare){
    if(action==='archiveHeld'){
      if(!['complete','stopped'].includes(this.stage)||!keys(data,['sourceRunId','finalCount'])||
          data.sourceRunId!==this.record.source.runId||data.finalCount!==this.record.source.count+this.record.successorCount)
        throw Error('Only a confirmed finished or stopped Tinder run can be archived.');
      this.save({stage:'archived-'+this.stage});
      return this.control('context',{},send);
    }
    if(!this.stage){
      if(action==='continueHeld')throw Error('There is no held Tinder run.');
      return send(action,data);
    }
    if(action==='context'){
      try{return this.project(await send(action,data))}catch{return this.project({connected:false})}
    }
    if(action==='continueHeld'){
      if(this.stage!=='held')throw Error('The Tinder successor is unavailable or already reserved.');
      return this.continue(data,send,prepare);
    }
    if(this.stage.startsWith('archived-'))return this.project(await send(action,data));
    if(action==='start'){
      if(this.stage!=='acknowledged'||Object.keys(data||{}).length)throw Error('The Tinder run is held. Review its recovery choice.');
      const d=await send('context',{});
      if(!d?.connected||!this.matches(d.session,this.record.successorId)||d.session.status!=='paused')throw Error('The Tinder successor is not paused.');
      return this.project(await send('start',{resumeRunId:this.record.successorId,expectedCount:d.session.count}));
    }
    if(action==='stop'||action==='pause'){
      this.epoch++;
      if(!['acknowledged','dispatching'].includes(this.stage)&&!(this.invalid&&this.claimed))throw Error('The held Tinder budget is preserved.');
      const d=await send(action,data);
      if(action==='stop'&&this.stage==='acknowledged'&&d?.connected&&this.matches(d.session,this.record.successorId)&&d.session.status==='idle')
        this.save({stage:'stopped',successorCount:d.session.count});
      return this.project(d);
    }
    return this.project(await send(action,data));
  }
}
module.exports=TinderHeldSession;
