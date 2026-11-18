'use strict';
// Anonymous native geometry: an inert named video above a clipped, playing video prompt.
const node=(id,kind,box,children='',attrs='')=>`<node resource-id="${id}" package="co.hinge.app" class="${kind}" text="" enabled="true" clickable="false" scrollable="false" focusable="false" bounds="${box}" ${attrs}>${children}</node>`;
const view=(id,box,children='',attrs='')=>node(id,'android.view.View',box,children,attrs);
const player=(prefix,box)=>node(prefix+'-player','ycl',box,node(prefix+'-frame','android.widget.FrameLayout',box,node(prefix+'-texture','android.view.TextureView',box)));
function videoPairClock(seconds=0){
 const first='[40,137][680,573]',lower='[40,613][680,1112]';
 const media=view('first-media',first,'','content-desc="Example&apos;s video"');
 const body=view('first-body',first,media+player('first','[40,0][680,822]'));
 const like=node('first-like','android.widget.Button','[564,457][660,553]','','content-desc="Like video prompt"').replace('clickable="false"','clickable="true"');
 const firstCard=view('first-wrapper','[40,89][680,573]',view('first-card',first,
  view('first-caption','[40,89][612,137]')+body+view('first-controls','[544,437][680,573]',view('first-button-wrapper','[544,437][680,573]',like))));
 const lowerMedia=view('lower-media',lower,'','content-desc="Video prompt: Example activity"');
 const lowerBody=view('lower-body',lower,lowerMedia+player('lower','[40,525][680,1280]')).replace('clickable="false"','clickable="true"').replace('focusable="false"','focusable="true"');
 const timer=view('lower-timer','[585,645][648,693]','',`content-desc="Elapsed time: ${seconds} seconds"`);
 const lowerCard=view('lower-wrapper',lower,view('lower-card',lower,lowerBody+
  view('lower-overlay','[40,613][680,853]')+view('lower-controls','[72,621][648,717]',timer)));
 const owner=view('pair-viewport','[0,137][720,1112]',firstCard+lowerCard).replace('scrollable="false"','scrollable="true"');
 const discover=view('pair-discover','[0,1112][144,1232]','','content-desc="Discover" selected="true"');
 const skip=node('pair-skip','android.widget.Button','[40,948][164,1072]','','content-desc="Skip Example"').replace('clickable="false"','clickable="true"');
 return '<hierarchy>'+node('pair-root','android.widget.FrameLayout','[0,0][720,1280]',owner+discover+skip)+'</hierarchy>';
}
module.exports={videoPairClock};
