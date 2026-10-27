(function(root){
  const rpc=async(action,data)=>{
    let result;
    try{result=await chrome.runtime.sendMessage({type:'ss:request',action,data})}
    catch{throw new Error('Extension disconnected. Refresh this page after reloading SpicySwipe.')}
    if(result?.error)throw new Error(result.error);
    if(!result||!('data'in result))throw new Error('The extension did not respond. Reload SpicySwipe.');
    return result.data;
  };
  async function authorizeOllama(url){
    // Request before any await to preserve the button's user gesture.
    const granted=await chrome.permissions.request({origins:[SSCore.ollamaOrigin(url)]});
    if(!granted)throw new Error('Server access was not granted. Save the connection again to allow access.');
    return true;
  }
  function subscribe(listener){
    let port,closed=false,timer;
    const connect=()=>{if(closed)return;try{port=chrome.runtime.connect({name:'spicyswipe'});port.onMessage.addListener(listener);port.onDisconnect.addListener(()=>{if(!closed)timer=setTimeout(connect,1500)})}catch{}};
    connect();return()=>{closed=true;clearTimeout(timer);port?.disconnect()};
  }
  root.SSClient={rpc,subscribe,authorizeOllama};
})(globalThis);
