'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('spicyAndroid', Object.freeze({
 request: async (action,data) => {
  try { return await ipcRenderer.invoke('android:request',action,data); }
  catch(error) { throw new Error(error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/,'')); }
 }
}));
