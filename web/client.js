'use strict';
(() => {
  const events = new EventSource('/api/events');
  async function request(action,data = {}) {
    const response = await fetch('/api/request',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,data})});
    const body = await response.json();
    if (!response.ok) throw Error(body.error || 'Request failed.');
    return body.result;
  }
  document.addEventListener('visibilitychange',()=>request('web:visibility',{visible:!document.hidden}).catch(()=>{}));
  const frame = document.querySelector('#tinder-frame');
  const image = document.createElement('img');
  image.alt = 'Tinder. Click to interact, then type or paste.';
  image.tabIndex = 0;
  const status = document.createElement('small');
  status.setAttribute('role','status');
  frame.replaceChildren(image,status);
  document.querySelector('.setup-tip').textContent = 'Select a device connected to the server. For simultaneous sessions, connect a separate device for each app.';
  const report = error => {status.textContent = error.message;};
  let current, queue = Promise.resolve();
  function input(data) {
    if (!current) return;
    const id = current.id;
    queue = queue.then(()=>request('web:input',{...data,id})).catch(report);
  }
  function point(event) {
    const rect = image.getBoundingClientRect();
    return {x:Math.floor((event.clientX-rect.left)*current.width/rect.width),y:Math.floor((event.clientY-rect.top)*current.height/rect.height)};
  }
  image.onclick = event => {if(current){image.focus();input({type:'click',...point(event)});}};
  image.onwheel = event => {if(current){event.preventDefault();input({type:'wheel',...point(event),delta:event.deltaY});}};
  image.onpaste = event => {event.preventDefault();input({type:'text',text:event.clipboardData.getData('text')});};
  image.onkeydown = event => {
    if(event.ctrlKey || event.metaKey || event.altKey)return;
    if(event.key.length === 1 || ['Enter','Tab','Backspace','Escape','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Delete'].includes(event.key)){
      event.preventDefault();input(event.key.length === 1 ? {type:'text',text:event.key} : {type:'key',key:event.key});
    }
  };
  async function refresh(){
    try {
      if (!document.hidden && frame.getClientRects().length && !frame.hidden) {
        const next = await request('web:frame');
        image.src = next.image; current = next; status.textContent = '';
      }
    } catch(error){current=null;report(error);}
    setTimeout(refresh,650);
  }
  setTimeout(refresh,650);
  window.spicyDesktop = {
    request(action,data){
      if(action==='android:docs'){window.open('https://developer.android.com/studio/run/managing-avds','_blank','noopener');return Promise.resolve();}
      return request(action,data);
    },
    subscribe(callback){const fn=event=>callback(JSON.parse(event.data));events.addEventListener('message',fn);return ()=>events.removeEventListener('message',fn);}
  };
})();
