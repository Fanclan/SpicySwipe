'use strict';
// Anonymous native hierarchy: an inert video body and a separate right-edge Like.
const node=(label,box,children='')=>`<node package="co.hinge.app" class="android.view.View" content-desc="${label}" enabled="true" clickable="false" long-clickable="false" scrollable="false" focusable="false" focused="false" checkable="false" selected="false" password="false" bounds="${box}">${children}</node>`;
function videoDiscover({top=488,extra=''}={}){
 const box=`[40,${top}][680,1112]`;
 const texture=node('','[40,240][680,1280]','').replace('class="android.view.View"','class="android.view.TextureView"');
 const player=node('','[40,240][680,1280]',node('','[40,240][680,1280]',texture).replace('class="android.view.View"','class="android.widget.FrameLayout"')).replace('class="android.view.View"','class="ycl"');
 const body=node("Example&apos;s video",box);
 const like=node('Like video','[564,1012][660,1108]').replace('class="android.view.View"','class="android.widget.Button"').replace('clickable="false"','clickable="true"');
 const card=node('',box,node('',box,body+player)+node('','[544,992][680,1112]',node('','[544,992][680,1112]',like)));
 const owner=node('',`[0,${top}][720,1112]`,node('',box,card)).replace('scrollable="false"','scrollable="true"');
 const discover=node('Discover','[0,1112][144,1228]').replace('selected="false"','selected="true"');
 const skip=node('Skip Example','[40,948][164,1072]').replace('class="android.view.View"','class="android.widget.Button"').replace('clickable="false"','clickable="true"');
 const banner=node('',`[40,240][680,${Math.min(380,top-12)}]`).replace('clickable="false"','clickable="true"');
 return '<hierarchy>'+node('','[0,0][720,1280]',banner+owner+discover+skip+extra).replace('class="android.view.View"','class="android.widget.FrameLayout"')+'</hierarchy>';
}
module.exports={videoDiscover,node};
