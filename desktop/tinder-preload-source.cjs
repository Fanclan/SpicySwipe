'use strict';
const { ipcRenderer } = require('electron');
// This bridge stays inside Electron's isolated preload world, never the website.
if (window.top === window && ['tinder.com','www.tinder.com'].includes(location.hostname) && location.protocol === 'https:') {
  const listeners = new Set();
  globalThis.SSClient = {
    rpc: (action, data) => ipcRenderer.invoke('tinder:service', action, data),
    refreshEmpty: runId => ipcRenderer.send('tinder:refresh-empty', {documentId,runId}),
    subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); }
  };
  ipcRenderer.on('tinder:settings', (_event, data) => listeners.forEach(fn => fn({type:'settings',data})));
  require('../shared/core.js');
  require('../shared/session.js');
  require('../content/tinder.js');
  let ready = false;
  const documentId = crypto.randomUUID();
  ipcRenderer.on('tinder:command', async (_event, {id,action,data}) => {
    try {
      if (!ready) throw Error('Tinder is loading. Wait a moment and try again.');
      let result;
      if (['prepareLocationReload','prepareEmptyRefresh','restoreLocationReload'].includes(action)) {
        if (data?.documentId !== documentId) throw Error('Tinder document changed during the location reload.');
        if (action === 'prepareLocationReload') result = globalThis.SSTinder.prepareLocationReload();
        else if (action === 'prepareEmptyRefresh') result = globalThis.SSTinder.prepareEmptyRefresh(data.runId);
        else {
          globalThis.SSTinder.restoreLocationReload(data.checkpoint);
          result = globalThis.SSTinder.snapshot().session;
        }
      }
      else result = await globalThis.SSTinder.request(action, data);
      ipcRenderer.send('tinder:result', {id,result});
    } catch (error) { ipcRenderer.send('tinder:result', {id,error:error.message}); }
  });
  window.addEventListener('DOMContentLoaded', async () => {
    try {
      await globalThis.SSTinder.init(); ready = true;
      globalThis.SSTinder.subscribe(event => ipcRenderer.send('tinder:state', event.data));
      ipcRenderer.send('tinder:ready', {documentId, reloaded:performance.getEntriesByType('navigation')[0]?.type === 'reload'});
      ipcRenderer.send('tinder:state', globalThis.SSTinder.snapshot());
    } catch (error) { ipcRenderer.send('tinder:state', {connected:false,error:error.message}); }
  }, {once:true});
}
