'use strict';

// Anonymous native layout built for ownership tests, with no account content.
function nativePhotoForm({height=181, photoOwner='Sample', detachedPhoto=false, detachedForm=false, detachedSend=false}={}) {
 const bottom=137+height, end=bottom+290;
 const view=(id,box,children)=>`<node resource-id="${id}" class="android.view.View" clickable="false" scrollable="false" bounds="${box}">${children}</node>`;
 const image=`<node class="android.widget.ImageView" content-desc="${photoOwner}&apos;s photo" clickable="false" bounds="[72,137][648,${bottom}]"/>`;
 const photo=view('photo-subtree',`[72,137][648,${bottom}]`,view('photo-full',`[72,89][648,${bottom}]`,view('photo-visible',`[72,137][648,${bottom}]`,image)));
 const comment=`<node class="android.view.View" content-desc="Edit comment" bounds="[72,${bottom+24}][648,${bottom+160}]"/>`;
 const send=`<node class="android.widget.Button" content-desc="Send priority like" enabled="true" bounds="[296,${bottom+184}][648,${bottom+266}]"/>`;
 const form=view('comment-form',`[40,${bottom}][680,${end}]`,comment+(detachedSend?'':send));
 const card=view('selected-card',`[40,89][680,${end}]`,(detachedPhoto?'':photo)+(detachedForm?'':form));
 return `<hierarchy><node package="co.hinge.app" class="android.widget.FrameLayout" bounds="[0,0][720,1280]"><node class="android.view.View" scrollable="true" bounds="[0,137][720,1112]">${card}${detachedPhoto?photo:''}${detachedForm?form:''}${detachedSend?send:''}</node><node class="android.widget.Button" content-desc="Skip Sample" enabled="true" clickable="true" bounds="[40,972][164,1096]"/><node class="android.view.View" content-desc="Discover" selected="true" bounds="[0,1112][144,1228]"/></node></hierarchy>`;
}
module.exports={nativePhotoForm};
