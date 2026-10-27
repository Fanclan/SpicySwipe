'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('spicyDesktop', Object.freeze({
  request: async (action, data) => {try{return await ipcRenderer.invoke('desktop:request', action, data);}catch(error){throw new Error(error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ''));}},
  subscribe: callback => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('desktop:event', listener);
    return () => ipcRenderer.removeListener('desktop:event', listener);
  }
}));
