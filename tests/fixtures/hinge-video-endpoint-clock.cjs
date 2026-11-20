'use strict';
// Anonymous native geometry captured after a scroll: the earlier video and both
// Like buttons are clipped, while a tall interactive video prompt fills Discover.
const node=(id,kind,box,children='',attrs='')=>`<node resource-id="${id}" package="co.hinge.app" class="${kind}" text="" enabled="true" clickable="false" scrollable="false" focusable="false" bounds="${box}" ${attrs}>${children}</node>`;
const view=(id,box,children='',attrs='')=>node(id,'android.view.View',box,children,attrs);
const player=(prefix,box)=>node(prefix+'-player','ycl',box,node(prefix+'-frame','android.widget.FrameLayout',box,node(prefix+'-texture','android.view.TextureView',box)));
const button=(id,box,label)=>node(id,'android.widget.Button',box,'',`content-desc="${label}"`).replace('clickable="false"','clickable="true"');
function videoEndpointClock(seconds=7){
 const first='[40,137][680,210]',lower='[40,250][680,1112]';
 const firstCard=view('first-wrapper','[40,0][680,210]',view('first-card',first,
  view('first-body',first,view('first-media',first,'','content-desc="Example&apos;s video"')+player('first','[40,-363][680,459]'))+
  view('first-controls','[544,74][680,210]',view('first-button-wrapper','[544,74][680,210]',button('first-like','[564,94][660,190]','Like video prompt')))));
 const lowerBody=view('lower-body',lower,view('lower-media',lower,'','content-desc="Video prompt: Example activity"')+
  player('lower','[40,162][680,1373]')).replace('clickable="false"','clickable="true"').replace('focusable="false"','focusable="true"');
 const lowerCard=view('lower-wrapper',lower,view('lower-card',lower,lowerBody+
  view('lower-overlay','[40,250][680,490]')+view('lower-controls','[72,258][648,354]',
   view('lower-timer','[585,282][648,330]','',`content-desc="Elapsed time: ${seconds} seconds"`))+
  view('lower-like-wrapper','[544,1074][680,1112]',button('lower-like','[564,1094][660,1112]','Like'))));
 const owner=view('endpoint-viewport','[0,137][720,1112]',firstCard+lowerCard).replace('scrollable="false"','scrollable="true"');
 const discover=view('endpoint-discover','[0,1112][144,1232]','','content-desc="Discover" selected="true"');
 const skip=button('endpoint-skip','[40,948][164,1072]','Skip Example');
 return '<hierarchy>'+node('endpoint-root','android.widget.FrameLayout','[0,0][720,1280]',owner+discover+skip)+'</hierarchy>';
}
module.exports={videoEndpointClock};
