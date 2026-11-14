'use strict';
// Anonymous native structure: a video prompt clips at the Discover viewport.
const node=(id,kind,box,children='',attrs='')=>`<node resource-id="${id}" package="co.hinge.app" class="${kind}" text="" enabled="true" clickable="false" scrollable="false" focusable="false" bounds="${box}" ${attrs}>${children}</node>`;
function clippedVideoClock(){
 const frame='[40,1031][680,1112]',paint='[40,943][680,1280]';
 const texture=node('clock-texture','android.view.TextureView',paint);
 const player=node('clock-player','ycl',paint,node('clock-frame','android.widget.FrameLayout',paint,texture));
 const media=node('clock-media','android.view.View',frame,'','content-desc="Video prompt: Example activity"');
 const body=node('clock-body','android.view.View',frame,media+player).replace('clickable="false"','clickable="true"').replace('focusable="false"','focusable="true"');
 const timer=node('clock-timer','android.view.View','[585,1063][648,1111]','','content-desc="Elapsed time: 13 seconds"');
 const overlay=node('clock-overlay','android.view.View',frame);
 const controls=node('clock-controls','android.view.View','[72,1039][648,1112]',timer);
 const card=node('clock-card','android.view.View',frame,body+overlay+controls);
 return node('clock-viewport','android.view.View','[0,351][720,1112]',node('clock-wrapper','android.view.View',frame,card)).replace('scrollable="false"','scrollable="true"');
}
module.exports={clippedVideoClock};
