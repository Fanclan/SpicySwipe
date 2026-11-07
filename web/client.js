'use strict';
(() => {
  const events = new EventSource('/api/events');
  function returnToSignIn() {
    events.close();
    window.location.replace('/login');
  }
  events.addEventListener('signed-out', returnToSignIn);
  window.addEventListener('pageshow', event => {
    if (event.persisted) window.location.reload();
  });
  const signOut = document.createElement('button');
  signOut.type = 'button';
  signOut.id = 'sign-out';
  signOut.textContent = 'Sign out';
  document.querySelector('.desktop-actions').append(signOut);
  signOut.addEventListener('click', async () => {
    signOut.disabled = true;
    try {
      const response = await fetch('/api/logout', {
        method: 'POST', headers: {'Content-Type':'application/json'}, body: '{}'
      });
      if (!response.ok && response.status !== 401) throw Error();
      returnToSignIn();
    } catch {
      const notice = document.querySelector('#notice');
      notice.textContent = 'Could not sign out. Check your connection and try again.';
      notice.hidden = false;
      signOut.disabled = false;
    }
  });
  async function request(action,data = {}) {
    const response = await fetch('/api/request',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,data})});
    if (response.status === 401) { returnToSignIn(); throw Error('Sign in to continue.'); }
    const body = await response.json();
    if (!response.ok) throw Error(body.error || 'Request failed.');
    return body.result;
  }
  function addLocationControl(frame) {
    const button = document.createElement('button');
    button.id = 'tinder-location';
    button.type = 'button';
    button.hidden = true;
    const message = document.createElement('p');
    message.id = 'tinder-location-note';
    message.setAttribute('role', 'status');
    button.setAttribute('aria-describedby', message.id);
    document.querySelector('#reload-tinder').before(button);
    const form = document.createElement('form');
    form.id = 'tinder-location-fallback';
    form.hidden = true;
    form.method = 'post';
    form.autocomplete = 'off';
    form.setAttribute('aria-label', 'Share your approximate current location');
    form.innerHTML = `
      <p>Enter your current coordinates from a map. They’ll be rounded to two decimal places and shared with Tinder for up to 15 minutes.</p>
      <label>Latitude<input name="latitude" type="number" min="-90" max="90" step="any" required></label>
      <label>Longitude<input name="longitude" type="number" min="-180" max="180" step="any" required></label>
      <div><button type="submit" class="primary">Share approximate location</button>
        <button type="button" id="cancel-location-entry">Cancel</button></div>`;
    frame.prepend(message, form);

    let shared = null, busy = false, revision = 0;
    function closeEntry() {
      form.reset();
      form.hidden = true;
    }
    function showState(next) {
      button.textContent = next ? 'Stop sharing' : 'Share device location';
      if (shared !== next) {
        message.textContent = next ? 'Tinder can use this location for up to 15 minutes.'
          : shared ? 'Location sharing has ended.' : 'Share one location reading with Tinder for up to 15 minutes.';
      }
      if (next) closeEntry();
      shared = next;
      button.disabled = busy;
    }
    async function sync() {
      button.hidden = frame.hidden;
      if (frame.hidden || document.hidden || busy) return;
      const version = ++revision;
      try {
        const result = await request('web:locationStatus');
        if (version === revision) showState(result.shared);
      } catch {
        if (version === revision && shared === null) message.textContent = 'Could not check location sharing. Reopen Tinder to retry.';
      }
    }
    const acquisitionFailed = error => error.code === 2 || error.code === 3;
    async function devicePosition(current) {
      if (!window.isSecureContext) throw Error('Open this workspace over HTTPS or localhost to share your device location.');
      if (!navigator.geolocation) throw Error('This browser does not support location sharing. Open the workspace in a browser with location access.');
      const read = options => new Promise((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(({coords}) => resolve(coords), reject, options));
      try {
        return await read({maximumAge:60000, timeout:8000});
      } catch (error) {
        if (!current() || !acquisitionFailed(error)) throw error;
        message.textContent = 'Trying for a fresh location reading…';
        return read({enableHighAccuracy:true, maximumAge:0, timeout:15000});
      }
    }
    async function changeSharing(entered) {
      if (busy || shared === null || frame.hidden) return;
      busy = true;
      button.disabled = true;
      for (const control of form.elements) control.disabled = true;
      const version = ++revision;
      const current = () => !frame.hidden && version === revision;
      try {
        if (shared) {
          showState((await request('web:locationStop')).shared);
        } else {
          if (!entered) closeEntry();
          message.textContent = entered ? 'Sharing your approximate location…' : 'Waiting for your device’s location…';
          const coords = entered || await devicePosition(current);
          if (!current()) return;
          const {latitude, longitude, accuracy} = coords;
          showState((await request('web:location', {latitude, longitude, accuracy})).shared);
        }
      } catch (error) {
        if (!current()) return;
        if (acquisitionFailed(error)) {
          message.textContent = 'Your browser couldn’t get a location reading. You can retry or enter your current coordinates below.';
          form.hidden = false;
        } else if (error.code === 1) {
          message.textContent = 'Allow location for this site and enable location access for your browser in your device settings.';
        } else {
          message.textContent = error.message || 'Could not share your location. Try again.';
        }
      } finally {
        busy = false;
        button.disabled = shared === null;
        for (const control of form.elements) control.disabled = false;
        if (version !== revision) sync();
      }
    }
    button.addEventListener('click', () => changeSharing());
    form.addEventListener('submit', event => {
      event.preventDefault();
      if (form.hidden || busy || shared !== false || !window.isSecureContext || !form.reportValidity()) return;
      const latitude = form.elements.latitude.valueAsNumber;
      const longitude = form.elements.longitude.valueAsNumber;
      changeSharing({latitude:Number(latitude.toFixed(2)), longitude:Number(longitude.toFixed(2)), accuracy:1000});
    });
    form.querySelector('#cancel-location-entry').addEventListener('click', () => {
      closeEntry();
      message.textContent = 'Location sharing is off.';
      button.focus();
    });
    button.disabled = true;
    button.textContent = 'Share device location';
    new MutationObserver(() => {
      if (frame.hidden !== button.hidden) {
        revision++;
        if (frame.hidden) closeEntry();
        sync();
      }
    }).observe(frame, {attributes:true, attributeFilter:['hidden']});
    document.addEventListener('visibilitychange', sync);
    setInterval(sync, 15000);
    sync();
  }
  document.addEventListener('visibilitychange',()=>request('web:visibility',{visible:!document.hidden}).catch(()=>{}));
  const frame = document.querySelector('#tinder-frame');
  const image = document.createElement('img');
  image.alt = 'Tinder. Click to interact, then type or paste.';
  image.tabIndex = 0;
  const status = document.createElement('small');
  status.setAttribute('role','status');
  frame.replaceChildren(image,status);
  addLocationControl(frame);
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
    web: true,
    signOut: () => signOut.click(),
    request(action,data){
      if(action==='android:docs'){window.open('https://developer.android.com/studio/run/managing-avds','_blank','noopener');return Promise.resolve();}
      return request(action,data);
    },
    subscribe(callback){const fn=event=>callback(JSON.parse(event.data));events.addEventListener('message',fn);return ()=>events.removeEventListener('message',fn);}
  };
})();
