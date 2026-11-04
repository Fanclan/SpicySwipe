const {test}=require('node:test');const assert=require('node:assert/strict');const {readScreen}=require('../desktop/mobile-screen.cjs');
const node=(attrs='',children='')=>'<node package="com.bumble.app" enabled="true" class="android.view.View" bounds="[21,231][1059,2162]" '+attrs+'>'+children+'</node>';
const card=(name='Sample',order=2)=>node('drawing-order="'+order+'"',node('resource-id="com.bumble.app:id/profile_root_container"',node('resource-id="com.bumble.app:id/encountersGridProfile_list"',node('content-desc="'+name+'’s main photo"')+node('text="'+name+', 28"'))));
const feed=(cards=card())=>'<hierarchy>'+node('resource-id="com.bumble.app:id/mainApp_root"',node('resource-id="com.bumble.app:id/encountersStackContainer"',cards)+node('selected="true"',node('content-desc="People"')))+'</hierarchy>';
const read=(xml,extra={})=>readScreen(xml,{platform:'bumble',foreground:'com.bumble.app',photoIdentity:'0123456789abcdef',...extra});
test('Bumble selects front card by drawing order, not hidden next profile',()=>{for(const cards of [card('Sample',2)+card('Next',1),card('Next',1)+card('Sample',2)]){const s=read(feed(cards));assert.equal(s.kind,'profile');assert.equal(s.name,'Sample');assert.ok(s.identity);assert.equal(s.controls.like.direction,'right');assert.equal(s.controls.skip.direction,'left');assert.equal(s.controls.comment,null);assert.equal(s.photos.length,1);}});
test('Bumble requires photo evidence and unique front card before authorizing swipes',()=>{assert.equal(read(feed(),{photoIdentity:undefined}).controls.like,null);assert.equal(read(feed(card('Sample',2)+card('Other',2))).kind,'blocked');assert.equal(read(feed(),{foreground:'co.hinge.app'}).kind,'blocked');assert.equal(read(feed().replace('People','Liked You')).kind,'blocked');});
test('Bumble blocks system overlays, dialogs and unfamiliar outside controls',()=>{for(const n of ['<node package="android"/>',node('resource-id="com.bumble.app:id/alertTitle" text="Buy now"'),node('clickable="true" text="Subscribe"')])assert.equal(read(feed().replace('</hierarchy>',n+'</hierarchy>')).kind,'blocked');});
test('Bumble profile identity distinguishes same names through main photo evidence',()=>{assert.notEqual(read(feed()).identity,read(feed(),{photoIdentity:'fedcba9876543210'}).identity);});
test('Bumble first Like confirmation is exact and does not authorize other offers',()=>{const confirm='<hierarchy>'+node('resource-id="com.bumble.app:id/alertTitle" text="Interested?"')+node('resource-id="android:id/message" text="Swiping a profile to the right means that you want to connect!"')+node('resource-id="android:id/button1" text="YES" clickable="true"')+node('resource-id="android:id/button2" text="CANCEL" clickable="true"')+'</hierarchy>';const s=read(confirm);assert.equal(s.kind,'swipeConfirm');assert.ok(s.controls.confirm);assert.equal(read(confirm.replace('Interested?','Upgrade?')).kind,'blocked');});

test('Bumble first pass confirmation is bound to a left swipe',()=>{const confirm='<hierarchy>'+node('resource-id="com.bumble.app:id/alertTitle" text="Not interested?"')+node('resource-id="android:id/message" text="Swiping a profile to the left means that you aren&apos;t interested."')+node('resource-id="android:id/button1" text="NOT INTERESTED" clickable="true"')+node('resource-id="android:id/button2" text="CANCEL" clickable="true"')+'</hierarchy>';const s=read(confirm);assert.equal(s.kind,'swipeConfirm');assert.equal(s.swipeDirection,'left');assert.equal(read(confirm.replace('NOT INTERESTED','YES')).kind,'blocked');});

test('Bumble exact empty People queue has no action controls',()=>{const xml=feed(node('text="Why not adjust those filters?"')+node('text="You’ve seen everyone nearby. But, never fear, someone great could be just outside your filters."')+node('text="Adjust your filters"'));const s=read(xml);assert.equal(s.kind,'empty');assert.equal(s.controls.like,null);assert.equal(s.controls.skip,null);assert.equal(read(xml.replace('Why not adjust those filters?','Try Premium')).kind,'blocked');});

const videoCard=(name='Video Sample',order=2,detail='Designer')=>node('drawing-order="'+order+'"',node('resource-id="com.bumble.app:id/profile_root_container"',node('resource-id="com.bumble.app:id/encountersGridProfile_list"',node('',node('content-desc="'+name+'’s main video"')+'<node package="com.bumble.app" enabled="true" class="android.widget.FrameLayout" bounds="[21,231][1059,2162]" resource-id="com.bumble.app:id/videoView_videoContainer" />'+node('text="'+name+', 28"').replace('class="android.view.View"','class="android.widget.TextView"')+(detail?node('text="'+detail+'"').replace('class="android.view.View"','class="android.widget.TextView"'):'')))));
test('Bumble main video uses stable card text, never changing frame fingerprints',()=>{const xml=feed(videoCard()),s=read(xml);assert.equal(s.name,'Video Sample');assert.ok(s.identity);assert.equal(s.controls.like.direction,'right');assert.equal(s.controls.skip.direction,'left');assert.deepEqual(s.photos,[]);assert.equal(read(xml,{photoIdentity:'fedcba9876543210'}).identity,s.identity);assert.notEqual(read(feed(videoCard('Video Sample',2,'Teacher'))).identity,s.identity);});
test('Bumble video evidence is scoped to the unique visible front media card',()=>{for(const cards of [card('Queued',1)+videoCard(),videoCard()+card('Queued',1)])assert.equal(read(feed(cards)).name,'Video Sample');assert.equal(read(feed(videoCard('Queued',1)+card('Photo',2))).name,'Photo');for(const xml of [feed(videoCard('Video Sample',2,'')),feed(videoCard()).replace('text="Video Sample, 28"','text="Another, 28"'),feed(videoCard()).replace('resource-id="com.bumble.app:id/videoView_videoContainer"','resource-id="other"'),feed(videoCard()).replace('content-desc="Video Sample’s main video"','content-desc="Video Sample’s main video" visible-to-user="false"')])assert.equal(read(xml).controls.like,null);});
test('Bumble rejects conflicting media and requires the complete main video to be visible',()=>{const mixed=feed(videoCard()).replace('content-desc="Video Sample’s main video"','content-desc="Video Sample’s main video"').replace('<node package="com.bumble.app" enabled="true" class="android.widget.FrameLayout"',node('content-desc="Video Sample’s main photo"')+'<node package="com.bumble.app" enabled="true" class="android.widget.FrameLayout"');assert.equal(read(mixed).kind,'blocked');const clipped=feed(videoCard()).replace('content-desc="Video Sample’s main video"','content-desc="Video Sample’s main video"').replace('bounds="[21,231][1059,2162]" content-desc="Video Sample’s main video"','bounds="[21,200][1059,2162]" content-desc="Video Sample’s main video"');assert.equal(read(clipped).controls.like,null);});
function videoController(initial){let current=initial,swipes=0;const Controller=require('../desktop/mobile-controller.cjs');const c=new Controller({platform:'bumble',android:{serial:'fixture',inputEpoch:0,hierarchy:async()=>({xml:current,foreground:'com.bumble.app'}),swipeProfile:async(d,b,valid,issued)=>{assert.ok(valid());assert.equal(d,'right');swipes++;issued();current=swipes===1?feed(videoCard()):feed(card('Following'));}},service:{request:async()=>({sidebarConsentGiven:true})},readScreen,readEvidence:async s=>({hashes:s.photos.map(()=>'0123456789abcdef')}),random:()=>0,wait:async()=>{}});return {c,set:s=>current=s,swipes:()=>swipes};}
test('Bumble verifies photo-to-video and video-to-photo transitions without duplicate swipes',async()=>{const x=videoController(feed(card('Previous')));let commits=0;await x.c.act('like',x.c.token(),()=>true,()=>commits++);assert.equal(x.c.screen.name,'Video Sample');assert.equal(x.c.lastAction,null);await x.c.act('like',x.c.token(),()=>true,()=>commits++);assert.equal(x.c.screen.name,'Following');assert.equal(x.swipes(),2);assert.equal(commits,2);});
test('Bumble video profile survives scroll review and verifies identity again at the top',async()=>{const x=videoController(feed(videoCard()));let moves=0;x.c.config.scrollMin=1;x.c.config.scrollMax=1;x.c.android.scrollProfile=async({direction},valid)=>{assert.ok(valid());moves++;assert.equal(direction,moves===1?'up':'down');x.set(moves===1?feed(node('drawing-order="2"',node('resource-id="com.bumble.app:id/profile_root_container"',node('resource-id="com.bumble.app:id/encountersGridProfile_list"',node('text="Profile details"'))))):feed(videoCard()));};const s=await x.c.reviewBumble(x.c.token());assert.equal(s.name,'Video Sample');assert.equal(moves,2);assert.equal(x.swipes(),0);});

test('Bumble video identity ignores playback text inside the native player',()=>{const base=feed(videoCard());const xml=base.replace('resource-id="com.bumble.app:id/videoView_videoContainer" />','resource-id="com.bumble.app:id/videoView_videoContainer">'+node('text="Changing subtitle"').replace('class="android.view.View"','class="android.widget.TextView"')+'</node>');assert.equal(read(xml).identity,read(base).identity);assert.equal(read(xml.replace('Changing subtitle','Different subtitle')).identity,read(base).identity);});

const staticHeader=(text,attrs='')=>node('text="'+text+'" '+attrs).replace('class="android.view.View"','class="android.widget.TextView"');
const evidenceCard=(name='Sample',age=28,order=2,header=staticHeader(name+', '+age),outside='')=>node('drawing-order="'+order+'"',node('resource-id="com.bumble.app:id/profile_root_container"',node('resource-id="com.bumble.app:id/encountersGridProfile_list"',node('',node('content-desc="'+name+'’s main photo"')+header)+outside)));
test('Bumble exposes independent static name and age evidence for photos and videos',()=>{
 const photo=read(feed(evidenceCard())),video=read(feed(videoCard('Sample')));
 assert.match(photo.profileDiscriminator,/^[a-f0-9]{64}$/);
 assert.equal(video.profileDiscriminator,photo.profileDiscriminator);
 assert.equal(read(feed(evidenceCard()),{photoIdentity:'fedcba9876543210'}).profileDiscriminator,photo.profileDiscriminator);
 assert.equal(read(feed(videoCard('Sample',2,'Different detail'))).profileDiscriminator,photo.profileDiscriminator);
 assert.notEqual(read(feed(evidenceCard('Sample',29))).profileDiscriminator,photo.profileDiscriminator);
 assert.notEqual(read(feed(evidenceCard('Other',28))).profileDiscriminator,photo.profileDiscriminator);
 assert.equal(read(feed(evidenceCard()),{photoIdentity:undefined}).controls.like,null);
});
test('Bumble static evidence validates the full header name and adult age',()=>{
 for(const text of ['Other, 28','Sample, 17','Sample, 121','Sample, 028','Sample, 2','Sample, twenty eight','Sample, 28 extra','Sample, 28, 29','Sample,28','Sample, 28\nExtra'])assert.equal(read(feed(evidenceCard('Sample',28,2,staticHeader(text)))).profileDiscriminator,null,text);
 for(const age of [18,99,120])assert.ok(read(feed(evidenceCard('Sample',age))).profileDiscriminator);
});
test('Bumble static evidence ignores preloaded and hidden headers',()=>{
 const expected=read(feed(evidenceCard())).profileDiscriminator;assert.ok(expected);
 for(const cards of [evidenceCard('Queued',40,1)+evidenceCard(),evidenceCard()+evidenceCard('Queued',40,1)])assert.equal(read(feed(cards)).profileDiscriminator,expected);
 assert.equal(read(feed(evidenceCard('Sample',28,2,staticHeader('Sample, 28')+staticHeader('Sample, 29','visible-to-user="false"')))).profileDiscriminator,expected);
 assert.equal(read(feed(evidenceCard('Sample',28,2,staticHeader('Sample, 28','visible-to-user="false"')))).profileDiscriminator,null);
});
test('Bumble static evidence rejects duplicate or conflicting native headers',()=>{
 for(const extra of ['Sample, 28','Sample, 29','Other, 28'])assert.equal(read(feed(evidenceCard('Sample',28,2,staticHeader('Sample, 28')+staticHeader(extra)))).profileDiscriminator,null);
});
test('Bumble static evidence rejects fake headers and headers outside main media',()=>{
 for(const xml of [feed(card()),feed(evidenceCard('Sample',28,2,node('text="Sample, 28"'))),feed(evidenceCard('Sample',28,2,'',staticHeader('Sample, 28'))),feed(evidenceCard('Sample',28,2,staticHeader('Sample, 28').replace('text="Sample, 28"','content-desc="Sample, 28"'))),feed(evidenceCard('Sample',28,2,staticHeader('Sample, 28').replace('text="Sample, 28"','text="Sample, 28" content-desc="Other, 28"')))])assert.equal(read(xml).profileDiscriminator,null);
});
test('Bumble static evidence requires fully visible enabled headers and main media',()=>{
 const header=staticHeader('Sample, 28');
 for(const replacement of [header.replace('[21,231][1059,2162]','[21,200][1059,2162]'),header.replace('enabled="true"','enabled="false"'),node('visible-to-user="false"',header)])assert.equal(read(feed(evidenceCard('Sample',28,2,replacement))).profileDiscriminator,null);
 const xml=feed(evidenceCard());
 assert.equal(read(xml.replace('bounds="[21,231][1059,2162]" content-desc="Sample’s main photo"','bounds="[21,231][1059,2000]" content-desc="Sample’s main photo"')).profileDiscriminator,null);
 assert.equal(read(xml.replace('content-desc="Sample’s main photo"','content-desc="Sample’s main photo" visible-to-user="false"')).profileDiscriminator,null);
});
test('Bumble static video evidence excludes native player text and needs supported player layout',()=>{
 const base=feed(videoCard('Sample')),expected=read(base).profileDiscriminator;assert.ok(expected);
 const withPlayer=base.replace('resource-id="com.bumble.app:id/videoView_videoContainer" />','resource-id="com.bumble.app:id/videoView_videoContainer">'+staticHeader('Sample, 29')+'</node>');
 assert.equal(read(withPlayer).profileDiscriminator,expected);
 assert.equal(read(withPlayer.replace('text="Sample, 28"','text="Details only"')).profileDiscriminator,null);
 assert.equal(read(base.replace('resource-id="com.bumble.app:id/videoView_videoContainer"','resource-id="unsupported"')).profileDiscriminator,null);
 assert.equal(read(feed()).profileDiscriminator,null);
 assert.equal(read('<hierarchy/>').profileDiscriminator,null);
});


function chatReminder(){const n=(klass,attrs='',children='')=>'<node package="com.bumble.app" enabled="true" class="'+klass+'" bounds="[0,100][1080,2300]" '+attrs+'>'+children+'</node>';return '<hierarchy>'+n('android.view.View','',n('android.widget.ImageView','content-desc="Close" clickable="true"')+n('android.widget.TextView','text="Why not message Example?"')+n('android.widget.TextView','text="You’ve already matched with them, and you two could be cute together."')+n('android.view.View','clickable="true"',n('android.widget.TextView','text="Start chat"')+n('android.widget.Button','')) )+'</hierarchy>'}
test('Bumble recognizes only the exact chat reminder and exposes only Close',()=>{
 const s=read(chatReminder());assert.equal(s.kind,'chatReminder');assert.ok(s.controls.dismiss);assert.equal(s.controls.like,null);assert.equal(s.controls.sendMessage,null);assert.equal(s.identity,null);
});
test('Bumble chat reminder rejects changed wording, disabled Close, extra controls and editors',()=>{
 const xml=chatReminder();for(const bad of [xml.replace('Why not message Example?','Buy Spotlight?'),xml.replace('Start chat','Buy now'),xml.replace('content-desc="Close" clickable="true"','content-desc="Close" clickable="false"'),xml.replace('class="android.widget.ImageView"','class="android.widget.EditText"'),xml.replace('</hierarchy>',node('clickable="true" text="Upgrade"')+'</hierarchy>')])assert.equal(read(bad).kind,'blocked');
});

function promoOffer(){const n=(klass,attrs='',children='')=>'<node package="com.bumble.app" enabled="true" class="'+klass+'" bounds="[0,100][1080,2300]" '+attrs+'>'+children+'</node>';return '<hierarchy>'+n('android.view.View','',n('android.widget.ImageView','content-desc="Close" clickable="true"')+n('android.widget.ScrollView','',n('android.widget.TextView','text="50% off 15 SuperSwipes"')+n('android.widget.TextView','text="Really like someone? Send a SuperSwipe and you’re sure to be seen"'))+n('android.widget.TextView','text="Normal price $34.99"')+n('android.view.View','clickable="true"',n('android.widget.TextView','text="Only $17.49"'))+n('android.widget.TextView','text="Offer ends in 58:32"')+n('android.widget.Button','text="Terms and Conditions" clickable="true"'))+'</hierarchy>'}
test('Bumble verified SuperSwipe offer exposes only Close and ignores its countdown',()=>{const xml=promoOffer(),s=read(xml);assert.equal(s.kind,'promoOffer');assert.ok(s.controls.dismiss);assert.equal(s.controls.like,null);assert.equal(s.identity,null);assert.equal(read(xml.replace('58:32','58:31')).screenKey,s.screenKey);assert.notEqual(read(xml.replace('[0,100][1080,2300]','[0,101][1080,2300]')).screenKey,s.screenKey);});
test('Bumble offer countdown width may change but actionable geometry stays bound',()=>{const a=promoOffer().replace('bounds="[0,100][1080,2300]" text="Offer ends in','bounds="[357,2171][723,2230]" text="Offer ends in');const b=a.replace('[357,2171][723,2230]','[356,2171][724,2230]');assert.equal(read(a).screenKey,read(b).screenKey);assert.equal(read(a).screenKey,read(a.replace('[357,2171][723,2230]','[357,2171][724,2230]')).screenKey);assert.equal(read(a.replace('[357,2171][723,2230]','[360,2171][730,2230]')).kind,'blocked');assert.notEqual(read(a).screenKey,read(a.replace('[357,2171][723,2230]','[357,2172][723,2231]')).screenKey);});
test('Bumble offer fails closed for changed offers, controls, hierarchy and timers',()=>{const xml=promoOffer();for(const bad of [xml.replace('SuperSwipes','Boosts'),xml.replace('Only $17.49','Subscribe'),xml.replace('clickable="true"','clickable="false"'),xml.replace('58:32','Buy now'),xml.replace('android.widget.ScrollView','android.widget.EditText'),xml.replace('</hierarchy>',node('clickable="true" text="Buy"')+'</hierarchy>')])assert.equal(read(bad).kind,'blocked');});

// Synthetic native footer; public control labels and geometry only.
const footerNode=(type,box,attrs='',children='')=>`<node package="com.bumble.app" class="${type}" enabled="true" bounds="${box}" ${attrs}>${children}</node>`;
const footerAction=(text,box)=>footerNode('android.view.View',box,'clickable="true"',footerNode('android.view.View',box,`content-desc="${text}" clickable="false"`)+footerNode('android.widget.Button',box,'clickable="false"'));
const votingFooter=footerNode('androidx.compose.ui.platform.ComposeView','[21,1587][1059,2086]','resource-id="com.bumble.app:id/encountersGridItem_votingContainer"',footerNode('android.view.View','[21,1587][1059,2086]','',footerNode('android.view.View','[53,1587][1027,2086]','',footerAction('Not for me','[95,1876][284,2065]')+footerAction('Send SuperSwipe','[422,1692][658,1928]')+footerAction('Like','[796,1876][985,2065]'))));
const footerCard=(content=votingFooter,order=2)=>footerNode('android.widget.FrameLayout','[21,231][1059,2162]',`drawing-order="${order}"`,footerNode('android.widget.FrameLayout','[21,231][1059,2162]','resource-id="com.bumble.app:id/profile_root_container"',footerNode('androidx.recyclerview.widget.RecyclerView','[21,231][1059,2162]','resource-id="com.bumble.app:id/encountersGridProfile_list"',content)));
const nativeFooterFeed=(cards=footerCard())=>'<hierarchy>'+footerNode('android.widget.FrameLayout','[0,63][1080,2337]','resource-id="com.bumble.app:id/mainApp_root"',footerNode('android.widget.FrameLayout','[0,210][1080,2183]','resource-id="com.bumble.app:id/encountersStackContainer"',cards)+footerNode('android.view.View','[432,2183][648,2337]','selected="true"',footerNode('android.view.View','[432,2183][648,2337]','content-desc="People"')))+'</hierarchy>';

test('native Bumble footer exposes separate ordinary Like and pass targets without inventing identity',()=>{
 const s=read(nativeFooterFeed());assert.equal(s.kind,'profile');assert.equal(s.actionStrategy,'footer');assert.equal(s.identity,null);assert.equal(s.name,'');assert.deepEqual(s.photos,[]);assert.equal(s.controls.like,null);assert.equal(s.controls.skip,null);
 assert.deepEqual(s.controls.profileLike.bounds,{x:796,y:1876,width:189,height:189});assert.equal(s.controls.profileLike.label,'Like');assert.ok(s.controls.profileLike.key);
 assert.deepEqual(s.controls.profilePass.bounds,{x:95,y:1876,width:189,height:189});assert.equal(s.controls.profilePass.label,'Not for me');
 assert.deepEqual(Object.entries(s.controls).filter(([,v])=>v).map(([k])=>k).sort(),['profileLike','profilePass']);
});

test('native Bumble layout selects footer strategy at the top without changing gesture evidence',()=>{
 const content=footerNode('android.view.View','[21,231][1059,2162]','content-desc="Example’s main photo"');
 const s=read(nativeFooterFeed(footerCard(content)));assert.equal(s.actionStrategy,'footer');assert.ok(s.identity);assert.equal(s.controls.like.direction,'right');assert.ok(!s.controls.profileLike);assert.ok(!read(feed()).actionStrategy);
});

test('Bumble footer targets belong only to the unique foreground card',()=>{
 const background=footerCard(votingFooter,1),top=footerCard('',2);
 for(const cards of [background+top,top+background]){const s=read(nativeFooterFeed(cards));assert.ok(!s.controls.profileLike);assert.ok(!s.controls.profilePass);}
 const hidden=nativeFooterFeed().replace('resource-id="com.bumble.app:id/encountersGridItem_votingContainer"','resource-id="com.bumble.app:id/encountersGridItem_votingContainer" visible-to-user="false"');assert.ok(!read(hidden).controls.profileLike);
 assert.equal(read(nativeFooterFeed(footerCard()+footerCard())).kind,'blocked');
});

test('Bumble footer fails closed for altered native controls, geometry and overlays',()=>{
 const xml=nativeFooterFeed(),extra=n=>xml.replace('</hierarchy>',n+'</hierarchy>');
 const samples=[
  xml.replace('Send SuperSwipe','Send Rose'),xml.replace('Not for me','Pass'),xml.replace('content-desc="Like"','content-desc="Like" clickable="true"'),
  xml.replace('bounds="[796,1876][985,2065]" clickable="true"','bounds="[700,1800][889,1989]" clickable="true"'),
  xml.replaceAll('[796,1876][985,2065]','[796,1800][985,1989]'),
  xml.replaceAll('[796,1876][985,2065]','[796,2100][985,2289]'),
  xml.replace('resource-id="com.bumble.app:id/encountersGridItem_votingContainer"','resource-id="com.bumble.app:id/other"'),
  xml.replace('class="androidx.compose.ui.platform.ComposeView"','class="android.view.View"'),
  xml.replace('selected="true"','selected="false"'),
  xml.replace('class="android.widget.Button"','class="android.view.View"'),
  xml.replace('enabled="true" bounds="[796,1876][985,2065]" clickable="true"','enabled="false" bounds="[796,1876][985,2065]" clickable="true"'),
  nativeFooterFeed(footerCard(votingFooter+votingFooter)),
  nativeFooterFeed(footerCard(votingFooter+footerNode('android.view.View','[796,1876][985,2065]','clickable="true" text="Buy"'))),
  extra(footerNode('android.view.View','[796,1876][985,2065]','clickable="true" text="Buy"')),
  extra(footerNode('android.app.Dialog','[796,1876][985,2065]')),
  xml.replace('com.bumble.app','other.app'),
 ];
 for(const [i,sample]of samples.entries()){const s=read(sample);assert.ok(!s.controls.profileLike,'Like sample '+i);assert.ok(!s.controls.profilePass,'pass sample '+i);}
});

test('partially scrolled Bumble footer remains a profile without a tap target',()=>{
 const clipped=votingFooter.replaceAll('[21,1587][1059,2086]','[21,1900][1059,2399]').replaceAll('[53,1587][1027,2086]','[53,1900][1027,2399]').replaceAll('[95,1876][284,2065]','[95,2189][284,2378]').replaceAll('[422,1692][658,1928]','[422,2005][658,2241]').replaceAll('[796,1876][985,2065]','[796,2189][985,2378]');
 const s=read(nativeFooterFeed(footerCard(clipped)));assert.equal(s.kind,'profile');assert.equal(s.actionStrategy,'footer');assert.ok(!s.controls.profileLike);assert.ok(!s.controls.profilePass);
});

function unlabeledVideoSummary({name='Example',age=29,detail='Researcher',playback='00:05'}={}){
 const box='[21,231][1059,2162]';
 const player=footerNode('b.nativeVideo',box,'',footerNode('android.view.ViewGroup',box,'',footerNode('android.widget.FrameLayout',box,'resource-id="com.bumble.app:id/videoView_videoContainer"',footerNode('android.widget.TextView','[100,300][250,350]',`text="${playback}"`))));
 const panel=footerNode('android.view.View','[63,1559][1017,2162]','',footerNode('android.widget.TextView','[74,1903][379,1972]',`text="${name}, ${age}" clickable="false"`)+(detail?footerNode('android.widget.TextView','[127,1994][625,2046]',`text="${detail}" clickable="false"`):''));
 return footerNode('androidx.compose.ui.platform.ComposeView',box,'resource-id="com.bumble.app:id/encountersGridItem_summaryContainer"',footerNode('android.view.View',box,'',footerNode('android.view.View',box,'clickable="true"',footerNode('android.view.View',box,'',player+panel))));
}

test('native unlabeled Bumble main video derives stable identity from its own summary facts',()=>{
 const xml=nativeFooterFeed(footerCard(unlabeledVideoSummary())),s=read(xml);
 assert.equal(s.kind,'profile');assert.equal(s.name,'Example');assert.ok(s.identity);assert.ok(s.profileDiscriminator);assert.equal(s.actionStrategy,'footer');assert.deepEqual(s.photos,[]);assert.equal(s.controls.like.direction,'right');
 assert.equal(read(xml,{photoIdentity:'fedcba9876543210'}).identity,s.identity);
 assert.equal(read(xml.replace('00:05','00:06')).identity,s.identity);
 assert.notEqual(read(xml.replace('Researcher','Designer')).identity,s.identity);
 assert.notEqual(read(xml.replace('Example, 29','Example, 30')).profileDiscriminator,s.profileDiscriminator);
 for(const cards of [footerCard(unlabeledVideoSummary(),2)+card('Queued',1),card('Queued',1)+footerCard(unlabeledVideoSummary(),2)])assert.equal(read(nativeFooterFeed(cards)).identity,s.identity);
});

test('unlabeled Bumble video requires complete unique native player and static header evidence',()=>{
 const summary=unlabeledVideoSummary(),xml=nativeFooterFeed(footerCard(summary));
 const badSummaries=[
  unlabeledVideoSummary({detail:''}),unlabeledVideoSummary({age:17}),
  summary.replace('encountersGridItem_summaryContainer','encountersGridItem_photoContainer'),
  summary.replace('videoView_videoContainer','unknownPlayer'),
  summary.replace('class="android.widget.FrameLayout"','class="android.view.View"'),
  summary.replace('resource-id="com.bumble.app:id/videoView_videoContainer"','resource-id="com.bumble.app:id/videoView_videoContainer" visible-to-user="false"'),
  summary.replace('bounds="[21,231][1059,2162]" resource-id="com.bumble.app:id/videoView_videoContainer"','bounds="[21,300][1059,2162]" resource-id="com.bumble.app:id/videoView_videoContainer"'),
  summary.replace('text="Example, 29"','text="Example, 29" visible-to-user="false"'),
  summary.replace('text="Example, 29"','text="Example, 29" content-desc="Other, 29"'),
  summary.replace('text="Researcher"','text="Other, 30"'),
  summary.replace('bounds="[74,1903][379,1972]"','bounds="[74,2200][379,2269]"'),
  summary+summary,
 ];
 for(const [i,content]of badSummaries.entries()){const s=read(nativeFooterFeed(footerCard(content)));assert.equal(s.identity,null,'sample '+i);assert.equal(s.controls.like,null,'sample '+i);}
 const background=nativeFooterFeed(footerCard(summary,1)+footerCard('',2));assert.equal(read(background).identity,null);
 assert.equal(read(xml.replace('</hierarchy>','<node package="com.android.systemui"/></hierarchy>')).kind,'blocked');
});

test('Bumble viewport-clipped voting row permits another scroll while its ordinary targets cross the viewport edge',()=>{
 const clipped=votingFooter.replace('[21,1587][1059,2086]','[21,1700][1059,2162]').replace('[21,1587][1059,2086]','[21,1700][1059,2199]').replace('[53,1587][1027,2086]','[53,1700][1027,2199]').replaceAll('[95,1876][284,2065]','[95,1989][284,2178]').replaceAll('[422,1692][658,1928]','[422,1805][658,2041]').replaceAll('[796,1876][985,2065]','[796,1989][985,2178]');
 const readFooter=content=>read(nativeFooterFeed(footerCard(content)));
 const s=readFooter(clipped);
 assert.equal(s.kind,'profile');assert.equal(s.actionStrategy,'footer');assert.ok(Object.values(s.controls).every(v=>!v));
 for(const changed of [
  clipped.replace('Send SuperSwipe','New offer'),
  clipped.replace('[796,1989][985,2178]','[780,1989][969,2178]'),
  clipped.replace('[21,1700][1059,2162]','[21,1700][1059,2140]'),
  clipped+footerNode('android.view.View','[800,2000][950,2150]','clickable="true" text="Buy"'),
 ]) assert.equal(readFooter(changed).kind,'blocked');
});

function feedbackSheet(){
 const text=(value,box)=>footerNode('android.widget.TextView',box,'clickable="false" text="'+value+'"');
 const choice=(value,box,textBox)=>footerNode('android.view.View',box,'clickable="true"',text(value,textBox)+footerNode('android.widget.Button',box,'clickable="false"'));
 const content=footerNode('android.view.View','[0,1454][63,1580]','clickable="true" content-desc="Close"')
  +text('Enjoying Bumble?','[319,1743][761,1819]')+text('We’d love your feedback.','[307,1861][773,1917]')
  +choice('Yes','[42,1980][1038,2106]','[507,2017][574,2070]')+choice('No','[42,2127][1038,2253]','[513,2164][567,2217]');
 return '<hierarchy>'+footerNode('android.view.View','[0,63][1080,2337]','',footerNode('android.view.View','[0,1517][1080,2337]','',content))+'</hierarchy>';
}

test('Bumble feedback prompt exposes only the visible part of the native Close target',()=>{
 const s=read(feedbackSheet());assert.equal(s.kind,'feedbackPrompt');assert.equal(s.identity,null);
 assert.deepEqual(Object.entries(s.controls).filter(([,v])=>v).map(([k])=>k),['dismiss']);
 assert.equal(s.controls.dismiss.label,'Close');assert.deepEqual(s.controls.dismiss.bounds,{x:0,y:1517,width:63,height:63});assert.ok(s.controls.dismiss.key);
});

test('Bumble feedback prompt blocks changed copy, controls, overlapping choices and ambiguous Close bounds',()=>{
 const xml=feedbackSheet(),extra=n=>xml.replace('</hierarchy>',n+'</hierarchy>');
 const cases=[xml.replace('Enjoying Bumble?','Enjoying Premium?'),xml.replace('We’d love your feedback.','Write a review'),xml.replace('text="Yes"','text="Continue"'),
  xml.replace('clickable="true" content-desc="Close"','clickable="false" content-desc="Close"'),
  xml.replace('enabled="true" bounds="[0,1454]','enabled="false" bounds="[0,1454]'),
  xml.replace('[0,1454][63,1580]','[20,1454][83,1580]'),xml.replace('[0,1454][63,1580]','[0,1500][63,1626]'),
  xml.replaceAll('[42,1980][1038,2106]','[0,1517][1080,2253]'),
  xml.replace('class="android.widget.Button"','class="android.view.View"'),xml.replace('com.bumble.app','com.android.systemui'),
  extra(footerNode('android.view.View','[0,1517][63,1580]','content-desc="Close" clickable="true"')),
  extra(footerNode('android.view.View','[0,1517][63,1580]','clickable="true"')),extra(footerNode('android.app.Dialog','[0,1517][63,1580]')),
 ];
 for(const [i,bad]of cases.entries()){const s=read(bad);assert.equal(s.kind,'blocked','case '+i);assert.ok(Object.values(s.controls).every(v=>!v));}
});

test('native navigation below the Bumble viewport permits scrolling the partially visible voting row',()=>{
 const viewportBottom=2162;
 function positionedFooter(top) {
  const bottom=top+499;
  const update=(_match,x1,y1,x2,y2)=>'['+x1+','+(top+Number(y1)-1587)+']['+x2+','+(top+Number(y2)-1587)+']';
  const moved=votingFooter.replace(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/g,update);
  return moved.replace('[21,'+top+'][1059,'+bottom+']','[21,'+Math.max(231,top)+'][1059,'+Math.min(viewportBottom,bottom)+']');
 }
 const underNav=footerNode('android.view.View','[0,2183][216,2337]','clickable="true" content-desc="Profile"');
 const nav=footerNode('android.widget.FrameLayout','[0,2183][1080,2337]','resource-id="com.bumble.app:id/mainApp_navigationTabBar"',underNav+footerNode('android.view.View','[432,2183][648,2337]','selected="true"',footerNode('android.view.View','[432,2183][648,2337]','content-desc="People"')));
 const stockNav=footerNode('android.view.View','[432,2183][648,2337]','selected="true"',footerNode('android.view.View','[432,2183][648,2337]','content-desc="People"'));
 const arranged=(top,bar=nav,overlay='')=>nativeFooterFeed(footerCard(positionedFooter(top)+overlay)).replace(stockNav,bar);
 for(const top of [1836,1950,2075,2140,0,15,100]){
  const s=read(arranged(top));assert.equal(s.kind,'profile','top '+top);assert.ok(!s.controls.profileLike&&!s.controls.profilePass,'top '+top);
 }
 for(const xml of [
  arranged(1836,nav,footerNode('android.view.View','[95,2125][284,2162]','clickable="true" text="Buy"')),
  arranged(1836,nav,footerNode('android.view.View','[95,2185][284,2285]','clickable="true" text="Buy"')),
  arranged(1836,nav.replace('mainApp_navigationTabBar','otherContainer')),
  arranged(1836,nav.replace('[0,2183][1080,2337]','[0,2125][1080,2337]')),
 ]) assert.equal(read(xml).kind,'blocked');
});

test('Bumble permits scrolling when Android crops the native voting controls at the display edge',()=>{
 const host='[21,2061][1059,2162]',outer='[21,2061][1059,2400]',inner='[53,2061][1027,2400]';
 const cropped=votingFooter.replace('[21,1587][1059,2086]',host).replace('[21,1587][1059,2086]',outer).replace('[53,1587][1027,2086]',inner)
  .replaceAll('[95,1876][284,2065]','[95,2350][284,2400]').replaceAll('[422,1692][658,1928]','[422,2166][658,2400]').replaceAll('[796,1876][985,2065]','[796,2350][985,2400]');
 const readFooter=content=>read(nativeFooterFeed(footerCard(content)));
 const likeAction=footerAction('Like','[796,2350][985,2400]');
 const partiallyExported=[
  cropped.replace(likeAction,''),
  cropped.replace(likeAction,likeAction.replace('content-desc="Like"','content-desc=""')),
  cropped.replaceAll('[796,2350][985,2400]','[796,2400][985,2400]'),
  cropped.replace(likeAction,likeAction.replace(footerNode('android.widget.Button','[796,2350][985,2400]','clickable="false"'),'')),
 ];
 for(const clipped of [cropped,...partiallyExported,cropped.replace('bounds="[95,2350][284,2400]" content-desc="Not for me"','bounds="[95,2360][284,2400]" content-desc="Not for me"')]){
  const s=readFooter(clipped);assert.equal(s.kind,'profile');assert.ok(Object.values(s.controls).every(v=>!v));
 }
 const fullBad=votingFooter.replaceAll('[95,1876][284,2065]','[95,1876][284,1926]').replaceAll('[796,1876][985,2065]','[796,1876][985,1926]');
 for(const invalid of [fullBad,cropped.replace('Send SuperSwipe','Subscribe'),cropped.replace('resource-id=', 'clickable="true" resource-id='),cropped+footerNode('android.view.View','[95,2100][284,2162]','clickable="true" text="Buy"')])assert.equal(readFooter(invalid).kind,'blocked');
});
