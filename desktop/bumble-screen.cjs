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
 // Exact native matched-person reminder: Close is the only authorized action.
 const reminderTitle=visible.filter(n=>n.a.class==='android.widget.TextView'&&/^Why not message .+\?$/.test(label(n)));
 const reminderBody=find('You’ve already matched with them, and you two could be cute together.'),chat=find('Start chat'),close=find('Close');
 if(reminderTitle.length===1&&reminderBody.length===1&&chat.length===1&&close.length===1){
  const sheet=close[0].parent,chatButton=chat[0].parent,allowed=new Set([reminderTitle[0],reminderBody[0],chat[0],close[0]]);
  if(sheet?.a.class==='android.view.View'&&reminderTitle[0].parent===sheet&&reminderBody[0].parent===sheet&&chatButton?.parent===sheet&&chatButton.a.class==='android.view.View'&&chatButton.a.clickable==='true'&&close[0].a.class==='android.widget.ImageView'&&close[0].a.clickable==='true'&&close[0].enabled&&[...allowed].every(fullyVisible)&&!visible.some(n=>(label(n)&&!allowed.has(n))||(n.a.clickable==='true'&&n!==close[0]&&n!==chatButton)||/EditText$/.test(n.a.class||''))){
   result.kind='chatReminder';result.controls.dismiss=control(close[0],true);return result;
  }
 }
 const feedbackTitle = find('Enjoying Bumble?');
 const feedbackBody = find('We’d love your feedback.');
 if (feedbackTitle.length || feedbackBody.length) {
  const yes = find('Yes'), no = find('No');
  const invalid = () => block('The Bumble feedback prompt requires attention.');
  if (![feedbackTitle, feedbackBody, yes, no, close].every(matches => matches.length === 1)) return invalid();
  const heading = feedbackTitle[0], body = feedbackBody[0], dismiss = close[0], sheet = dismiss.parent;
  const allowedLabels = new Set([heading, body, yes[0], no[0], dismiss]);
  const choices = [yes[0].parent, no[0].parent];
  const allowedClicks = new Set([dismiss, ...choices]);
  const allowedButtons = new Set();
  if (sheet?.a.class !== 'android.view.View' || !fullyVisible(sheet) || heading.parent !== sheet || body.parent !== sheet) return invalid();
  if (![heading, body, yes[0], no[0]].every(n => n.a.class === 'android.widget.TextView' && n.a.text === label(n) && !n.a['content-desc'] && n.a.clickable === 'false' && n.enabled && fullyVisible(n))) return invalid();
  for (const choice of choices) {
   if (choice?.parent !== sheet || choice.a.class !== 'android.view.View' || choice.a.clickable !== 'true' || !choice.enabled || !fullyVisible(choice)) return invalid();
   const children = visible.filter(n => n.parent === choice);
   const native = children.find(n => n.a.class === 'android.widget.Button');
   if (children.length !== 2 || !native || label(native) || native.a.clickable !== 'false' || !native.enabled || !fullyVisible(native) || native.a.bounds !== choice.a.bounds) return invalid();
   allowedButtons.add(native);
  }
  if (visible.some(n => (label(n) && !allowedLabels.has(n)) || (n.a.clickable === 'true' && !allowedClicks.has(n)) ||
      (n.a.class === 'android.widget.Button' && !allowedButtons.has(n)) || /(?:EditText|Dialog|PopupWindow)$/.test(n.a.class || ''))) return invalid();

  // The hit area straddles the sheet's top-left corner. Only the lower half
  // belongs to the visible sheet and is safe to use as the dismissal target.
  const corner = bounds(dismiss), frame = bounds(sheet);
  if (dismiss.a.class !== 'android.view.View' || dismiss.a['content-desc'] !== 'Close' || dismiss.a.text || dismiss.a.clickable !== 'true' || !dismiss.enabled || !corner ||
      corner.x !== frame.x || corner.height !== 2 * corner.width || corner.y + corner.width !== frame.y || corner.width > frame.width / 8) return invalid();
  const [titleBox, bodyBox, yesBox, noBox] = [heading, body, ...choices].map(bounds);
  if (corner.y + corner.height > titleBox.y || titleBox.y + titleBox.height > bodyBox.y || bodyBox.y + bodyBox.height > yesBox.y ||
      yesBox.y + yesBox.height > noBox.y || yesBox.x !== noBox.x || yesBox.width !== noBox.width || yesBox.height !== noBox.height) return invalid();
  const target = { x: corner.x, y: frame.y, width: corner.width, height: corner.width };
  result.kind = 'feedbackPrompt';
  result.controls.dismiss = { label: 'Close', bounds: target, key: hash(['bumble-feedback-close', target]) };
  return result;
 }
 // Observed native SuperSwipe offer. Only Close is exposed; purchase stays inaccessible.
 const offerTitle=find('50% off 15 SuperSwipes'),offerBody=find('Really like someone? Send a SuperSwipe and you’re sure to be seen'),price=find('Normal price $34.99'),buy=find('Only $17.49'),terms=find('Terms and Conditions'),timer=visible.filter(n=>/^Offer ends in \d{1,2}:[0-5]\d$/.test(label(n)));
 if(close.length===1&&[offerTitle,offerBody,price,buy,terms,timer].every(a=>a.length===1)){
  const sheet=close[0].parent,scroll=offerTitle[0].parent,purchase=buy[0].parent,allowed=new Set([close[0],offerTitle[0],offerBody[0],price[0],buy[0],terms[0],timer[0]]);
  if(sheet?.a.class==='android.view.View'&&scroll?.a.class==='android.widget.ScrollView'&&scroll.parent===sheet&&offerBody[0].parent===scroll&&purchase?.a.class==='android.view.View'&&purchase.parent===sheet&&purchase.a.clickable==='true'&&[price[0],terms[0],timer[0]].every(n=>n.parent===sheet)&&close[0].a.class==='android.widget.ImageView'&&close[0].a.clickable==='true'&&close[0].enabled&&terms[0].a.class==='android.widget.Button'&&terms[0].a.clickable==='true'&&[offerTitle[0],offerBody[0],price[0],buy[0],timer[0]].every(n=>n.a.class==='android.widget.TextView'&&n.a.clickable!=='true')&&[...allowed].every(fullyVisible)&&!visible.some(n=>(label(n)&&!allowed.has(n))||(n.a.clickable==='true'&&![close[0],purchase,terms[0]].includes(n))||/EditText$/.test(n.a.class||''))){
   // The centered countdown changes glyph width; retain its center, row and height.
   const tb=bounds(timer[0]),sb=bounds(sheet),center=sb.x+sb.width/2;if(Math.abs(tb.x+tb.width/2-center)>1)return block('Bumble offer countdown layout requires attention.');
   result.screenKey=hash(nodes.map(n=>n===timer[0]?{...n.a,text:'Offer ends in <countdown>',bounds:JSON.stringify([center,tb.y,tb.height])}:n.a));
   result.kind='promoOffer';result.controls.dismiss=control(close[0],true);return result;
  }
 }
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
 const emptyLabels=['Why not adjust those filters?','You’ve seen everyone nearby. But, never fear, someone great could be just outside your filters.','Adjust your filters'];
 if(!roots.length&&emptyLabels.every(text=>find(text).length===1&&within(find(text)[0],stack[0]))){result.kind='empty';result.reason='No more profiles within your Bumble filters.';return result;}
 const entries=roots.map(root=>{let layer=root;while(layer.parent&&layer.parent!==stack[0])layer=layer.parent;return {root,layer,order:Number(layer.a['drawing-order'])}});
 if(!entries.length||entries.some(e=>!Number.isInteger(e.order)||e.order<1)||new Set(entries.map(e=>e.layer)).size!==entries.length)return block('The visible Bumble card is ambiguous.');
 const top=entries.filter(e=>e.order===Math.max(...entries.map(e=>e.order)));
 if(top.length!==1)return block('The visible Bumble card is ambiguous.');
 const root=top[0].root,lists=id('encountersGridProfile_list').filter(n=>within(n,root));
 if(lists.length!==1||!fullyVisible(lists[0])||!lists[0].enabled)return block('The Bumble profile card is unavailable.');
 const nativeFooterLayout=[main[0],stack[0],root].every(n=>n.a.class==='android.widget.FrameLayout')&&lists[0].a.class==='androidx.recyclerview.widget.RecyclerView';
 if(nativeFooterLayout)result.actionStrategy='footer';
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
 // The native summary video can omit its main-video accessibility label. Its
 // complete player and sibling static facts still identify the foreground card.
 if(!mainMedia&&nativeFooterLayout){
  const summaries=cardNodes.filter(n=>n.a['resource-id']==='com.bumble.app:id/encountersGridItem_summaryContainer');
  const players=cardNodes.filter(n=>n.a['resource-id']==='com.bumble.app:id/videoView_videoContainer');
  if(summaries.length===1&&players.length===1){
   const summary=summaries[0],player=players[0],content=player.parent?.parent?.parent,click=content?.parent,outer=click?.parent,box=bounds(lists[0]);
   const sameBox=n=>{const b=n&&bounds(n);return b&&b.x===box.x&&b.y===box.y&&b.width===box.width&&b.height===box.height&&n.enabled&&fullyVisible(n)};
   if(summary.a.class==='androidx.compose.ui.platform.ComposeView'&&summary.parent===lists[0]&&player.a.class==='android.widget.FrameLayout'&&player.parent?.a.class==='android.view.ViewGroup'&&content?.a.class==='android.view.View'&&click?.a.class==='android.view.View'&&click.a.clickable==='true'&&outer?.a.class==='android.view.View'&&outer.parent===summary&&[summary,outer,click,content,player.parent.parent,player.parent,player].every(sameBox)){
    const texts=cardNodes.filter(n=>within(n,content)&&!within(n,player)&&n.a.class==='android.widget.TextView'&&n.a.text);
    const headers=texts.filter(n=>/^.+, \d+$/.test(n.a.text)),header=headers[0],match=header&&/^(.+), ([1-9]\d{1,2})$/.exec(header.a.text),panel=header?.parent;
    const staticText=n=>n.enabled&&fullyVisible(n)&&n.a.clickable!=='true'&&(!n.a['content-desc']||n.a['content-desc']===n.a.text);
    if(headers.length===1&&match&&Number(match[2])>=18&&Number(match[2])<=120&&panel?.a.class==='android.view.View'&&panel.parent===content&&fullyVisible(panel)&&staticText(header)){
     const details=texts.filter(n=>n!==header&&n.parent===panel&&staticText(n)&&label(n).length>=3&&bounds(n).y>=bounds(header).y+bounds(header).height).map(label);
     if(details.length){
      result.name=match[1];result.context.name=result.name;result.identity=hash(['bumble-main-video',result.name,header.a.text,[...new Set(details)].sort()]);
      result.profileDiscriminator=hash(['bumble-static-profile',result.name,Number(match[2])]);result.reason='';
     }
    }
   }
  }
 }
 if(result.identity){const b=bounds(lists[0]);result.controls.like={key:hash(['bumble-right',b]),bounds:b,direction:'right',label:'Swipe right to Like'};result.controls.skip={key:hash(['bumble-left',b]),bounds:b,direction:'left',label:'Swipe left to pass'};}
 // Native voting controls are separate from main-card gesture evidence. Scrolling
 // removes the main photo, so only the controller's verified review can bind identity.
 const footers=id('encountersGridItem_votingContainer').filter(n=>within(n,root));
 if(footers.length&&nativeFooterLayout){
  if(footers.length!==1)return block('The Bumble voting footer is ambiguous.');
  const footer=footers[0],footerNodes=cardNodes.filter(n=>within(n,footer)),labels=['Not for me','Send SuperSwipe','Like'];
  if(footer.a.class!=='androidx.compose.ui.platform.ComposeView'||footer.parent!==lists[0]||!footer.enabled||footer.a.clickable==='true'||label(footer))return block('The Bumble voting footer is unavailable.');
  const unavailable = () => block('The Bumble footer control bounds are not verified.');
  const children = parent => footerNodes.filter(n => n.parent === parent);
  const wrappers = children(footer), rows = wrappers.length === 1 ? children(wrappers[0]) : [];
  const wrapper = wrappers[0], row = rows[0];
  if (rows.length !== 1 || [wrapper, row].some(n => n.a.class !== 'android.view.View' || n.a.clickable === 'true' || label(n))) return unavailable();

  const host = bounds(footer), outer = bounds(wrapper), inner = bounds(row), viewport = bounds(lists[0]);
  if (!host || !outer || !inner) return unavailable();
  const bottom = box => box.y + box.height;
  const right = box => box.x + box.width;
  const equalBounds = (a,b) => a && b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
  const contains = (a,b) => b.x >= a.x && right(b) <= right(a) && b.y >= a.y && bottom(b) <= bottom(a);
  const overlaps = (a,b) => a && b && a.x < right(b) && right(a) > b.x && a.y < bottom(b) && bottom(a) > b.y;
  const visibleTop = Math.max(outer.y, viewport.y), visibleBottom = Math.min(bottom(outer), bottom(viewport));
  const visibleRow = { x: outer.x, y: visibleTop, width: outer.width, height: visibleBottom - visibleTop };
  // Classify clipping from the native containers alone. Android may truncate
  // a child's bounds a second time at the display edge, or omit it entirely.
  const clipped = visibleRow.height > 0 && visibleRow.height < outer.height && contains(viewport, visibleRow) &&
   (equalBounds(host, outer) || equalBounds(host, visibleRow)) && inner.y === outer.y && inner.height === outer.height && contains(outer, inner);

  const actions = new Map(), reportedBoxes = [];
  for (const button of children(row)) {
   const parts = children(button), box = bounds(button);
   if (button.a.class !== 'android.view.View' || button.a.clickable !== 'true' || label(button) || parts.length > 2) return unavailable();
   const markers = parts.filter(n => n.a.class === 'android.view.View');
   const roles = parts.filter(n => n.a.class === 'android.widget.Button');
   if (markers.length > 1 || roles.length > 1 || parts.length !== markers.length + roles.length ||
       parts.some(n => children(n).length || n.a.clickable !== 'false') || roles.some(label)) return unavailable();
   const marker = markers[0], role = roles[0], text = marker && label(marker);
   if (text && (!labels.includes(text) || actions.has(text))) return block('An unfamiliar Bumble footer control requires attention.');
   if (box && text !== 'Send SuperSwipe') reportedBoxes.push(box);
   if (clipped) {
    // Only an offscreen control may lose its semantic label. A shifted child
    // outside its parent column is inconsistent with vertical clipping.
    if (!text && (!box || overlaps(box, visibleRow))) return unavailable();
    if (box && parts.some(n => { const child = bounds(n); return child && (child.x < box.x || right(child) > right(box)); })) return unavailable();
   } else if (!text || !role || ![button, marker, role].every(n => n.enabled && fullyVisible(n)) ||
              !equalBounds(box, bounds(marker)) || !equalBounds(box, bounds(role))) return unavailable();
   if (text) actions.set(text, { button, box });
  }

  const bars = id('mainApp_navigationTabBar'), bar = bars.length === 1 ? bars[0] : null;
  const verifiedBar = clipped && bar?.a.class === 'android.widget.FrameLayout' && within(bar, main[0]) &&
   !within(bar, stack[0]) && within(people[0], bar) && fullyVisible(bar) && bounds(bar).y >= bottom(viewport);
  const protectedAreas = clipped ? [visibleRow, ...reportedBoxes] : reportedBoxes;
  const extraInput = n => ['long-clickable','context-clickable','scrollable','checkable','editable'].some(key => n.a[key] === 'true');
  const inputRole = n => /(?:Button|EditText|Switch|CheckBox|Spinner|SeekBar|RatingBar|ScrollView|RecyclerView|WebView)$/.test(n.a.class || '');
  const overlays = visible.filter(n => (label(n) || n.a.clickable === 'true' || extraInput(n) || inputRole(n)) &&
   !within(n, footer) && !within(footer, n) && !entries.some(e => e.root !== root && within(n, e.root)) &&
   !(verifiedBar && within(n, bar) && fullyVisible(n)) && protectedAreas.some(area => overlaps(bounds(n), area)));
  if (overlays.length) {
   // Android also exposes the empty-queue layer behind the final People card.
   // Its title and explanation can intersect the voting row in screen coordinates.
   const below = nodes.filter(n => n.parent === stack[0] && n !== top[0].layer);
   const layer = below[0];
   const order = Number(layer?.a['drawing-order']);
   const ordinaryUnderlay = entries.length === 1 && below.length === 1 &&
    top[0].layer.a.class === 'android.widget.FrameLayout' && layer.a.class === 'androidx.compose.ui.platform.ComposeView' &&
    Number.isInteger(order) && order > 0 && order < top[0].order;
   const branch = ordinaryUnderlay ? nodes.filter(n => within(n,layer)) : [];
   const lines = emptyLabels.map(value => branch.find(n => n.a.text === value));
   const [title, explanation, adjust] = lines;
   const button = adjust?.parent;
   const role = branch.find(n => n.a.class === 'android.widget.Button');
   const verified = branch.length === 10 && lines.every(n => n?.a.class === 'android.widget.TextView') &&
    title.parent === explanation.parent && button?.parent === title.parent && role?.parent === button &&
    button.a.class === 'android.view.View' && button.a.clickable === 'true' &&
    branch.every(n => n.enabled && n.visible && !n.a['content-desc'] && !n.a['resource-id'] &&
     !extraInput(n) &&
     (n === button || n.a.clickable === 'false') && (lines.includes(n) || (!label(n) &&
      (n === layer || n === role || n.a.class === 'android.view.View')))) &&
    overlays.every(n => n === title || n === explanation);
   if (!verified) return block('An overlay covers the Bumble voting controls.');
  }
  if (clipped) {
   result.controls.like = null;
   result.controls.skip = null;
   return result;
  }
  if (!fullyVisible(footer) || actions.size !== labels.length) return unavailable();
  const [pass, paid, like] = labels.map(text => actions.get(text));
  const square = action => action.box.width === action.box.height;
  if (![pass, paid, like].every(square) || pass.box.y !== like.box.y || pass.box.width !== like.box.width ||
      right(pass.box) >= paid.box.x || right(paid.box) >= like.box.x || paid.box.y >= pass.box.y) return block('The Bumble footer voting layout is not verified.');
  result.controls.profilePass = { ...control(pass.button, true), label: 'Not for me' };
  result.controls.profileLike = { ...control(like.button, true), label: 'Like' };
 }
 return result;
};
