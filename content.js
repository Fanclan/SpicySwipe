/* Extension entry point. The UI lives in a Shadow DOM to isolate it from Tinder. */
(async()=>{
  if(document.getElementById('spicyswipe-root'))return;
  const host=document.createElement('div');host.id='spicyswipe-root';
  host.style.cssText='all:initial;position:fixed;inset:0 0 0 auto;width:0;z-index:2147483646;';
  const shadow=host.attachShadow({mode:'closed'});document.documentElement.append(host);
  const style=document.createElement('style');style.textContent=`:host{all:initial}.ss-container{position:fixed;top:10px;right:10px;bottom:10px;width:min(470px,calc(100vw - 20px));overflow:auto;border-radius:16px;box-shadow:0 12px 80px #15251b40;border:1px solid #8e9b8b30;background:#f8f9fb}.ss-container[hidden]{display:none}.ss-launcher{position:fixed;right:20px;bottom:20px;width:48px;height:48px;border:1px solid #fff8;border-radius:16px;background:#e87560;color:#fff;box-shadow:0 5px 20px #63372525;cursor:pointer;display:grid;place-items:center}.ss-launcher svg{width:25px;height:25px}.ss-launcher:focus-visible{outline:3px solid #e87560;outline-offset:3px}.ss-container .ss-app{min-height:100%}`;shadow.append(style);
  const css=document.createElement('link');css.rel='stylesheet';css.href=chrome.runtime.getURL('ui/styles.css');shadow.append(css);
  const container=document.createElement('div');container.className='ss-container';container.hidden=true;shadow.append(container);
  const launcher=document.createElement('button');launcher.className='ss-launcher';launcher.setAttribute('aria-label','Open SpicySwipe');launcher.setAttribute('aria-expanded','false');launcher.innerHTML=SSIcons('bolt');shadow.append(launcher);
  let ui;
  function show(open=true){container.hidden=!open;launcher.hidden=open;launcher.setAttribute('aria-expanded',String(open));if(open)container.querySelector('button')?.focus();else launcher.focus()}
  launcher.onclick=()=>show(true);
  await SSTinder.init();
  const bridge={compact:true,load:()=>SSClient.rpc('load'),save:data=>SSClient.rpc('save',data),request:SSClient.rpc,page:SSTinder.request,close:()=>show(false),subscribe:fn=>{const a=SSClient.subscribe(fn),b=SSTinder.subscribe(fn);return()=>{a();b()}}};
  ui=await SSWorkspace.mount(container,bridge);
  const initial=await bridge.load();if(!initial.hasCompletedOnboarding)show(true);
  chrome.runtime.onMessage.addListener((message,sender,respond)=>{
    if(message?.type!=='ss:page'||sender.id!==chrome.runtime.id)return false;
    if(message.action==='show'){show(true);ui.navigate(message.data?.view||'overview');respond({ok:true});return false}
    SSTinder.request(message.action,message.data).then(respond,error=>respond({error:error.message}));return true;
  });
})().catch(error=>console.error('[SpicySwipe] Unable to initialize:',error.message));
