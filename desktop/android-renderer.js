(async()=>{
 'use strict';
 const $=s=>document.querySelector(s),request=(action,data)=>window.spicyAndroid.request(action,data);
 let state,frameTask=null,requested=false,timer,failed=false,noticeTimer;
 function notice(error){$('#notice').textContent=error.message;$('#notice').hidden=false;clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>$('#notice').hidden=true,8000);}
 const active=()=>Boolean(state)&&!document.hidden;
 function schedule(delay=80){clearTimeout(timer);timer=setTimeout(()=>{if(active())refresh().catch(()=>{});else schedule(250);},delay);}
 function refresh(){
  if(!active())return Promise.resolve();
  if(frameTask){requested=true;return frameTask;}
  clearTimeout(timer);
  frameTask=(async()=>{
   try{
    const image=await request('android:screenshot');
    if(!active())return;
    $('#phone-screen').src=image;$('#phone-screen').hidden=false;$('#connecting').hidden=true;failed=false;
    $('#preview-status').textContent='Click the screen to use your keyboard. Paste works; Enter acts on the device.';
   }catch(error){
    $('#phone-screen').hidden=true;$('#connecting').hidden=false;$('#connecting').textContent='Reconnecting…';
    $('#preview-status').textContent='Preview interrupted — retrying…';if(!failed)notice(error);failed=true;
    throw error;
   }finally{frameTask=null;const immediate=requested;requested=false;schedule(failed?1500:immediate?0:80);}
  })();return frameTask;
 }
 const controls=SSAndroidControls.create({image:$('#phone-screen'),keyboard:$('#phone-keyboard'),send:request,active,epoch:()=>state?.serial,onError:notice,onUpdate:()=>refresh().catch(()=>{})});
 const bind=(selector,action,data)=>$(selector).addEventListener('click',()=>controls.run(action,data).catch(notice));
 bind('#back','android:back');bind('#scroll-down','android:swipe',{direction:'up'});bind('#scroll-up','android:swipe',{direction:'down'});bind('#store','android:store');bind('#open-app','android:open');
 $('#dock-device').addEventListener('click',()=>request('dock').catch(notice));
 document.addEventListener('visibilitychange',()=>schedule(0));
 window.addEventListener('pagehide',()=>{state=null;clearTimeout(timer);});
 state=await request('state');$('#device-title').textContent=(state.platform==='bumble'?'Bumble':'Hinge')+' · Android';$('#device-label').textContent=state.serial;
 await refresh();
})().catch(error=>{document.querySelector('#notice').textContent=error.message;document.querySelector('#notice').hidden=false;});
