'use strict';
// Only the ordinary People card stack is eligible for a swipe. Native IDs and
// drawing order distinguish the foreground card from the preloaded next card.
module.exports=function readBumble(xml,options,h){
 const {parse,bounds,fullyVisible,label,control,hash,result,block}=h;
 result.profileDiscriminator=null;
 if(options.foreground!=='com.bumble.app')return block('Bumble must be the selected device foreground app.');
 let nodes;try{nodes=parse(xml)}catch(error){return block(error.message)}
 result.screenKey=hash(nodes.map(n=>n.a));
 if(!nodes.length||nodes.some(n=>n.a.package&&n.a.package!=='com.bumble.app'))return block('Another app or system overlay is visible. Return to Bumble.');
 const visible=nodes.filter(n=>n.visible),id=name=>visible.filter(n=>n.a['resource-id']==='com.bumble.app:id/'+name),find=text=>visible.filter(n=>label(n)===text);
 const title=id('alertTitle');
 if(title.length){
  const pass=title.length===1&&label(title[0])==='Not interested?';
  const heading=pass?'Not interested?':'Interested?',body=pass?"Swiping a profile to the left means that you aren't interested.":'Swiping a profile to the right means that you want to connect!',button=pass?'NOT INTERESTED':'YES';
  const yes=visible.filter(n=>n.a['resource-id']==='android:id/button1'&&label(n)===button),cancel=visible.filter(n=>n.a['resource-id']==='android:id/button2'&&label(n)==='CANCEL');
  const expected=new Set([heading,body,button,'CANCEL']);
  if(title.length===1&&label(title[0])===heading&&find(body).length===1&&yes.length===1&&cancel.length===1&&!visible.some(n=>label(n)&&!expected.has(label(n)))&&!visible.some(n=>n.a.clickable==='true'&&!yes.includes(n)&&!cancel.includes(n))&&control(yes[0],true)&&control(cancel[0],true)){
   result.kind='swipeConfirm';result.swipeDirection=pass?'left':'right';result.identity=hash(['bumble-first-like',result.screenKey]);result.controls.confirm=control(yes[0],true);return result;
  }
  return block('A Bumble dialog requires attention.');
 }
 if(visible.some(n=>/(?:Dialog|AlertDialog|PopupWindow)$/.test(n.a.class||'')||/:id\/(?:button1|permission_allow_button)$/.test(n.a['resource-id']||'')))return block('A dialog requires attention.');
 const within=(n,parent)=>{for(let p=n;p;p=p.parent)if(p===parent)return true;return false};
 const main=id('mainApp_root'),stack=id('encountersStackContainer'),people=visible.filter(n=>n.a['content-desc']==='People');
 if(main.length!==1||stack.length!==1||people.length!==1||![people[0],people[0].parent].some(n=>n?.a.selected==='true')||!within(stack[0],main[0]))return block('Open Bumble’s ordinary People feed.');
 if(visible.some(n=>!within(n,main[0])&&(label(n)||n.a.clickable==='true')))return block('An unfamiliar Bumble overlay requires attention.');
 // Known first-use animation gives the same ordinary swipe, followed by exact confirmation.
 const roots=id('profile_root_container').filter(n=>within(n,stack[0]));
 if(!roots.length&&['Why not adjust those filters?','You’ve seen everyone nearby. But, never fear, someone great could be just outside your filters.','Adjust your filters'].every(text=>find(text).length===1&&within(find(text)[0],stack[0]))){result.kind='empty';result.reason='No more profiles within your Bumble filters.';return result;}
 const entries=roots.map(root=>{let layer=root;while(layer.parent&&layer.parent!==stack[0])layer=layer.parent;return {root,layer,order:Number(layer.a['drawing-order'])}});
 if(!entries.length||entries.some(e=>!Number.isInteger(e.order)||e.order<1)||new Set(entries.map(e=>e.layer)).size!==entries.length)return block('The visible Bumble card is ambiguous.');
 const top=entries.filter(e=>e.order===Math.max(...entries.map(e=>e.order)));
 if(top.length!==1)return block('The visible Bumble card is ambiguous.');
 const root=top[0].root,lists=id('encountersGridProfile_list').filter(n=>within(n,root));
 if(lists.length!==1||!fullyVisible(lists[0])||!lists[0].enabled)return block('The Bumble profile card is unavailable.');
 const cardNodes=visible.filter(n=>within(n,root));
 const media=cardNodes.filter(n=>/.[’']s main (?:photo|video)$/.test(label(n))&&bounds(n));
 if(media.length>1)return block('The main profile media is ambiguous.');
 const mainMedia=media[0],isVideo=mainMedia&&/[’']s main video$/.test(label(mainMedia));
 result.kind='profile';result.name=mainMedia?label(mainMedia).replace(/[’']s main (?:photo|video)$/,''):'';result.context.name=result.name;
 result.context.bio=cardNodes.filter(n=>fullyVisible(n)&&n.a.text).map(n=>n.a.text).join('\n').slice(0,12000);
 // Static evidence is separate from photo fingerprints: pixels may change on
 // the same person. Only the complete main-media card's unique name/age header
 // can distinguish same-name profiles; missing/unsupported layouts stay null.
 if(mainMedia&&mainMedia.enabled&&fullyVisible(mainMedia)){
  const parent=mainMedia.parent,b=bounds(mainMedia),p=parent&&bounds(parent);
  const players=cardNodes.filter(n=>n.a['resource-id']==='com.bumble.app:id/videoView_videoContainer'&&within(n,parent));
  if(parent?.a.class==='android.view.View'&&p&&p.x===b.x&&p.y===b.y&&p.width===b.width&&p.height===b.height&&fullyVisible(parent)&&(!isVideo||(players.length===1&&players[0].a.class==='android.widget.FrameLayout'))){
   const headers=cardNodes.filter(n=>within(n,parent)&&!within(n,mainMedia)&&!players.some(player=>within(n,player))&&n.a.class==='android.widget.TextView'&&/^.+, \d+$/.test(n.a.text||''));
   const header=headers[0],match=header&&/^(.+), ([1-9]\d{1,2})$/.exec(header.a.text);
   if(headers.length===1&&header.enabled&&fullyVisible(header)&&(!header.a['content-desc']||header.a['content-desc']===header.a.text)&&match&&match[1]===result.name&&Number(match[2])>=18&&Number(match[2])<=120)result.profileDiscriminator=hash(['bumble-static-profile',match[1],Number(match[2])]);
  }
 }
 if(isVideo){
  // Video pixels change during playback. Bind to the fully visible native video
  // card's name/age and additional static text, never to a sampled video frame.
  const parent=mainMedia.parent,b=bounds(mainMedia),p=parent&&bounds(parent);
  const players=cardNodes.filter(n=>n.a['resource-id']==='com.bumble.app:id/videoView_videoContainer'&&within(n,parent));
  if(p&&p.x===b.x&&p.y===b.y&&p.width===b.width&&p.height===b.height&&fullyVisible(mainMedia)&&fullyVisible(parent)&&players.length===1&&players[0].a.class==='android.widget.FrameLayout'){
   const texts=cardNodes.filter(n=>within(n,parent)&&!players.some(player=>within(n,player))&&fullyVisible(n)&&n.a.class==='android.widget.TextView'&&n.a.text).map(n=>label(n));
   const headers=texts.filter(text=>{const m=/^(.+), (\d{2,3})$/.exec(text);return m&&m[1]===result.name&&Number(m[2])>=18&&Number(m[2])<=120});
   const details=[...new Set(texts.filter(text=>text!==headers[0]&&text.length>=3))].sort();
   if(headers.length===1&&details.length)result.identity=hash(['bumble-main-video',result.name,headers[0],details]);
  }
  if(!result.identity)result.reason='Bumble’s main video needs fully visible name, age and profile details before swiping.';
 }else{
  result.photos=media.filter(fullyVisible).map(n=>({key:hash(['bumble-main-photo',label(n)]),bounds:bounds(n),like:null}));
  result.identity=result.name&&result.photos.length&&/^[a-f0-9]{16}$/.test(options.photoIdentity||'')?hash(['bumble-profile',result.name,options.photoIdentity]):null;
  if(!result.identity)result.reason='Return to the top of the profile to verify its main photo before swiping.';
 }
 if(result.identity){const b=bounds(lists[0]);result.controls.like={key:hash(['bumble-right',b]),bounds:b,direction:'right',label:'Swipe right to Like'};result.controls.skip={key:hash(['bumble-left',b]),bounds:b,direction:'left',label:'Swipe left to pass'};}
 return result;
};
