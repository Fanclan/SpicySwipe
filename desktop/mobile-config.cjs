'use strict';
const C=require('../shared/core.js');
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
function normalize(patch={},base={}){
 if(!object(patch)||!object(base))throw Error('Invalid mobile settings.');
 const defaults={mode:'like',scrollMin:1,scrollMax:4,fractionMin:.25,fractionMax:.6,autoOpeners:false,autoSend:false,tone:'friendly',language:'en',length:'short',instruction:'',swipe:C.swipeSettings({randomizeTiming:true,minDelaySeconds:15,maxDelaySeconds:45,browsePhotos:true,scrollProfile:true,minPhotoSeconds:2,maxPhotoSeconds:5,breaksEnabled:true})};
 const allowed=new Set(Object.keys(defaults));for(const key of Object.keys(patch))if(!allowed.has(key))throw Error('Unknown mobile setting.');
 const out={...defaults,...base,...patch,swipe:{...defaults.swipe,...base.swipe,...patch.swipe}};
 if(!['like','comment'].includes(out.mode))throw Error('Invalid mobile mode.');
 for(const k of ['autoOpeners','autoSend'])if(typeof out[k]!=='boolean')throw Error('Invalid mobile messaging setting.');
 for(const k of ['scrollMin','scrollMax'])if(!Number.isInteger(out[k])||out[k]<0||out[k]>10)throw Error('Invalid scroll count (0–10).');
 if(out.scrollMin>out.scrollMax)throw Error('Minimum scroll count exceeds maximum.');
 for(const k of ['fractionMin','fractionMax'])if(typeof out[k]!=='number'||!Number.isFinite(out[k])||out[k]<.2||out[k]>.65)throw Error('Invalid scroll distance (20–65%).');
 if(out.fractionMin>out.fractionMax)throw Error('Minimum scroll distance exceeds maximum.');
 if(!C.tones.includes(out.tone)||!Object.hasOwn(C.languages,out.language)||!['short','medium'].includes(out.length))throw Error('Invalid mobile draft options.');
 if(typeof out.instruction!=='string'||out.instruction.length>1200)throw Error('Invalid mobile instruction.');
 if(patch.swipe!==undefined&&!object(patch.swipe))throw Error('Invalid session settings.');
 const schema=C.swipeSettings();for(const [k,v]of Object.entries(out.swipe)){if(!Object.hasOwn(schema,k)||typeof v!==typeof schema[k]||(typeof v==='number'&&!Number.isFinite(v)))throw Error('Invalid session setting.');}
 for(const [a,b]of [['minDelaySeconds','maxDelaySeconds'],['minPhotoSeconds','maxPhotoSeconds'],['breakMinSeconds','breakMaxSeconds']])if(out.swipe[a]>out.swipe[b])throw Error('Minimum session timing exceeds maximum.');
 out.swipe=C.swipeSettings(out.swipe);return out;
}
module.exports={normalize};