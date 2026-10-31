(function(root){
  const C=root.SSCore || require('./core');
  function waitFor(ms,signal){return new Promise(resolve=>{
    if(signal?.aborted)return resolve();
    const done=()=>{clearTimeout(timer);signal?.removeEventListener('abort',done);resolve()};
    const timer=setTimeout(done,ms);signal?.addEventListener('abort',done,{once:true});
  })}
  class Session {
    constructor({wait=waitFor,act,changed=()=>{},now=Date.now,random=Math.random}){
      Object.assign(this,{wait,act,changed,now,random,status:'idle',phase:'idle',count:0,epoch:0,error:'',endsAt:null,nextActionAt:null,completionReason:''});
      this.config=C.swipeSettings();
    }
    snapshot(){return {status:this.status,phase:this.phase,count:this.count,limit:this.config.maxSwipes,error:this.error,endsAt:this.endsAt,nextActionAt:this.nextActionAt,completionReason:this.completionReason}}
    checkpoint(){return {...this.snapshot(),config:{...this.config},nextBreakAt:this.nextBreakAt??this.config.breakEvery,breakUntil:this.breakUntil??null}}
    restore(saved){
      if(!saved||!['idle','running','paused','error','complete'].includes(saved.status)||!Number.isInteger(saved.count)||saved.count<0||!saved.config||!Number.isFinite(saved.config.maxSwipes)||!Number.isFinite(saved.config.sessionMinutes)||!(saved.endsAt===null||Number.isFinite(saved.endsAt))||(!['idle'].includes(saved.status)&&saved.endsAt===null)||!Number.isFinite(saved.nextBreakAt)||!(saved.breakUntil===null||Number.isFinite(saved.breakUntil)))throw Error('Saved session is invalid. Repair the checkpoint before starting.');
      const config=C.swipeSettings(saved.config);
      if(config.maxSwipes!==saved.config.maxSwipes||config.sessionMinutes!==saved.config.sessionMinutes)throw Error('Saved session budget is invalid.');
      this.controller?.abort();this.epoch++;this.config=config;this.count=saved.count;this.endsAt=saved.endsAt;this.nextBreakAt=saved.nextBreakAt;this.breakUntil=saved.breakUntil;
      this.status=['running','error'].includes(saved.status)?'paused':saved.status;this.phase=this.status;this.error='';this.nextActionAt=null;this.completionReason=saved.completionReason||'';
      if(this.status==='paused'&&(this.now()>=this.endsAt||this.count>=config.maxSwipes)){this.status='complete';this.phase='complete';this.completionReason=this.count>=config.maxSwipes?'limit':'time';}
    }
    notify(){this.changed(this.snapshot())}
    finish(reason){this.status='complete';this.phase='complete';this.completionReason=reason;this.nextActionAt=null;this.controller?.abort();this.notify()}
    valid(epoch){
      if(this.status!=='running'||this.epoch!==epoch)return false;
      if(this.now()>=this.endsAt){this.finish('time');return false}
      return true;
    }
    sample(min,max){return Math.round((min+(max-min)*this.random())*1000)}
    async sleep(ms,phase,epoch){
      if(!this.valid(epoch))return false;
      const delay=Math.min(ms,Math.max(0,this.endsAt-this.now()));
      this.phase=phase;this.nextActionAt=this.now()+delay;this.notify();
      await this.wait(delay,this.controller.signal);
      if(!this.valid(epoch))return false;
      this.nextActionAt=null;return true;
    }
    start(config){
      if(this.status==='running')return;
      if(this.status!=='paused'){
        this.count=0;this.config=C.swipeSettings({...this.config,...config});this.endsAt=this.now()+this.config.sessionMinutes*60000;
        this.nextBreakAt=this.config.breakEvery;this.breakUntil=null;this.completionReason='';
      }
      this.controller?.abort();this.controller=new AbortController();
      this.status='running';this.error='';const epoch=++this.epoch;
      if(!this.valid(epoch))return;
      this.run(epoch);
    }
    async run(epoch){
      try{
        while(this.valid(epoch)&&this.count<this.config.maxSwipes){
          const c=this.config;
          if(c.breaksEnabled&&this.count>=this.nextBreakAt){
            this.breakUntil??=this.now()+this.sample(c.breakMinSeconds,c.breakMaxSeconds);
            if(!await this.sleep(Math.max(0,this.breakUntil-this.now()),'break',epoch))return;
            this.breakUntil=null;this.nextBreakAt=this.count+c.breakEvery;
          }
          const delay=c.randomizeTiming?this.sample(c.minDelaySeconds,c.maxDelaySeconds):c.delaySeconds*1000;
          if(!await this.sleep(delay,'waiting',epoch))return;
          this.phase='reviewing';this.notify();let committed=false;
          // The page calls commit immediately after a click, even if that click caused a pause.
          const commit=(count=1)=>{if(committed)return;if(!Number.isInteger(count)||count<1)throw Error('Action count must be a positive integer.');committed=true;this.count+=count;if(this.count>=c.maxSwipes)this.finish('limit');else this.notify()};
          const outcome=await this.act(c,()=>this.valid(epoch),commit,(ms,phase='photos')=>this.sleep(ms,phase,epoch));
          if(this.epoch!==epoch||!this.valid(epoch))return;
          if(outcome&&Number.isFinite(outcome.retryAfter)&&outcome.retryAfter>0){
            if(!await this.sleep(outcome.retryAfter,outcome.phase||'recovering',epoch))return;
            continue;
          }
          if(!committed)commit();
        }
      }catch(error){
        if(this.epoch!==epoch||(this.status!=='running'&&!(this.status==='complete'&&this.completionReason==='limit')))return;
        this.completionReason='';this.status='error';this.phase='error';this.nextActionAt=null;this.error=error.message;this.notify();
      }
    }
    pause(){if(this.status==='running'){this.epoch++;this.status='paused';this.phase='paused';this.nextActionAt=null;this.controller?.abort();this.notify()}}
    stop(){this.epoch++;this.status='idle';this.phase='idle';this.nextActionAt=null;this.controller?.abort();this.notify()}
  }
  root.SSSession=Session;if(typeof module!=='undefined')module.exports=Session;
})(globalThis);
