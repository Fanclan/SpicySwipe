'use strict';
const {nativePhotoForm}=require('./hinge-native-photo-form.cjs');

// Anonymous native layout: a lower video keeps its clock while the photo form is open.
const node=(id,kind,box,children='',attrs='')=>`<node resource-id="${id}" package="co.hinge.app" class="${kind}" text="" enabled="true" clickable="false" scrollable="false" focusable="false" bounds="${box}" ${attrs}>${children}</node>`;
function photoFormVideoClock(){
 const box='[40,738][680,1112]',paint='[40,650][680,1280]';
 const texture=node('form-clock-texture','android.view.TextureView',paint);
 const player=node('form-clock-player','ycl',paint,node('form-clock-frame','android.widget.FrameLayout',paint,texture));
 const media=node('form-clock-media','android.view.View',box,'','content-desc="Video prompt: Example activity"');
 const body=node('form-clock-body','android.view.View',box,media+player).replace('clickable="false"','clickable="true"').replace('focusable="false"','focusable="true"');
 const timer=node('form-clock-timer','android.view.View','[585,770][648,818]','','content-desc="Elapsed time: 9 seconds"');
 const overlay=node('form-clock-overlay','android.view.View','[40,738][680,978]');
 const controls=node('form-clock-controls','android.view.View','[72,746][648,842]',timer);
 const card=node('form-clock-card','android.view.View',box,body+overlay+controls);
 const video=node('form-clock-wrapper','android.view.View',box,card);
 const boundary='</node><node class="android.widget.Button" content-desc="Skip Sample"';
 return nativePhotoForm({height:271}).replace(boundary,video+boundary);
}
module.exports={photoFormVideoClock};
