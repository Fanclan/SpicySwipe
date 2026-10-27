/* Shared, focus-scoped Android controls for the workspace and detached window. */
(() => {
 'use strict';
 const keys = new Set(['Backspace','Delete','Enter','Tab','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Escape','Home','End']);
 function create({image,keyboard,send,active,epoch,onBusy=()=>{},onUpdate=()=>{},onError=()=>{}}) {
  const queue=[];
  let running=false;
  function run(action,data){
   if(!active())return Promise.reject(Error('Connect an active Android preview first.'));
   if(queue.length>=100)return Promise.reject(Error('Keyboard input is catching up. Wait a moment before typing more.'));
   const result=new Promise((resolve,reject)=>queue.push({action,data,epoch:epoch(),resolve,reject}));
   onBusy(true);
   if(!running){running=true;queueMicrotask(drain);}
   return result;
  }
  async function drain(){
   try{
    while(queue.length){
     const item=queue.shift(),batch=[item];
     let data=item.data;
     // Batch adjacent characters, but never move text past a tap, Backspace, Tab or Enter.
     if(item.action==='android:type'){
      data={text:item.data.text};
      while(queue[0]?.action===item.action&&queue[0].epoch===item.epoch&&data.text.length+queue[0].data.text.length<=2000){const next=queue.shift();batch.push(next);data.text+=next.data.text;}
     }
     try{
      if(!active()||epoch()!==item.epoch)throw Error('Android device or view changed. Pending input was canceled.');
      const result=await send(item.action,data);
      batch.forEach(task=>task.resolve(result));
      onUpdate();
     }catch(error){
      [...batch,...queue.splice(0)].forEach(task=>task.reject(error));
     }
    }
   }finally{running=false;onBusy(false);}
  }
  const report=promise=>promise.catch(onError);
  const focused=()=>active()&&!image.hidden&&keyboard.ownerDocument.activeElement===keyboard;
  function type(text){
   if(!text)return;
   if(text.length>2000||!/^[\x20-\x7e]+$/.test(text)){onError(Error('Use up to 2000 plain keyboard characters on one line. For Unicode or emoji, use the Android keyboard.'));return;}
   report(run('android:type',{text}));
  }
  image.addEventListener('click',event=>{
   if(image.hidden||!active())return;
   keyboard.focus({preventScroll:true});
   const r=image.getBoundingClientRect();
   if(!r.width||!r.height||!image.naturalWidth||!image.naturalHeight)return;
   const x=Math.max(0,Math.min(image.naturalWidth-1,Math.floor((event.clientX-r.left)*image.naturalWidth/r.width)));
   const y=Math.max(0,Math.min(image.naturalHeight-1,Math.floor((event.clientY-r.top)*image.naturalHeight/r.height)));
   report(run('android:tap',{x,y}));
  });
  keyboard.addEventListener('keydown',event=>{
   if(!focused()||event.isComposing||event.metaKey||event.ctrlKey||event.altKey)return;
   if(keys.has(event.key)){event.preventDefault();report(run('android:key',{key:event.key}));}
   else if(event.key.length===1){event.preventDefault();type(event.key);}
  });
  keyboard.addEventListener('paste',event=>{
   if(!focused())return;
   event.preventDefault();keyboard.value='';type(event.clipboardData?.getData('text/plain')||'');
  });
  keyboard.addEventListener('input',event=>{
   if(event.isComposing)return;
   const text=keyboard.value;keyboard.value='';if(focused())type(text);
  });
  keyboard.addEventListener('blur',()=>{keyboard.value='';});
  return {run};
 }
 window.SSAndroidControls={create};
})();
