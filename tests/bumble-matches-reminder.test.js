'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {readScreen}=require('../desktop/mobile-screen.cjs');
const Controller=require('../desktop/mobile-controller.cjs');
// Native shape with public reminder copy only. The two thumbnail nodes carry no photo or identity data.
const reminder=readFileSync(join(__dirname,'fixtures/mobile/bumble-matches-pair.xml'),'utf8');
const premiumReminder=readFileSync(join(__dirname,'fixtures/mobile/bumble-premium-chat-reminder.xml'),'utf8');
const read=xml=>readScreen(xml,{platform:'bumble',foreground:'com.bumble.app',photoIdentity:'0123456789abcdef'});
const scale=xml=>xml.replace(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/g,(_,a,b,c,d)=>`[${Math.round(a*1.5)},${Math.round(b*1.5)}][${Math.round(c*1.5)},${Math.round(d*1.5)}]`);

test('Bumble two-thumbnail native matches reminder exposes only its isolated Close',()=>{
 for(const xml of [reminder,scale(reminder)]){
  const screen=read(xml);
  assert.equal(screen.kind,'chatReminder');
  assert.deepEqual(Object.keys(screen.controls).filter(key=>screen.controls[key]),['dismiss']);
  assert.equal(screen.controls.dismiss.label,'Close');
  assert.deepEqual(screen.controls.dismiss.bounds,xml===reminder?{x:608,y:422,width:96,height:96}:{x:912,y:633,width:144,height:144});
  assert.equal(screen.identity,null);assert.equal(screen.context.name,'');
  assert.deepEqual(screen.photos,[]);assert.deepEqual(screen.prompts,[]);
 }
});

test('Bumble Premium+ expiring-chat reminder exposes only Close and no account content',()=>{
 for(const xml of [premiumReminder,scale(premiumReminder)]){
  const screen=read(xml);
  assert.equal(screen.kind,'promoOffer');
  assert.deepEqual(Object.keys(screen.controls).filter(key=>screen.controls[key]),['dismiss']);
  assert.equal(screen.controls.dismiss.label,'Close');
  assert.deepEqual(screen.controls.dismiss.bounds,xml===premiumReminder?{x:608,y:182,width:96,height:96}:{x:912,y:273,width:144,height:144});
  assert.equal(screen.identity,null);assert.equal(screen.context.name,'');
  assert.deepEqual(screen.photos,[]);assert.deepEqual(screen.prompts,[]);
 }
});

test('Bumble expiring-chat reminder cannot authorize messages, changed offers or interactive benefit rows',()=>{
 const chat='You have 1 chat expiring soon. Go take a look!',spotlights='Don’t forget to use your 2 Spotlights';
 const row=premiumReminder.match(/<node[^>]*text="You have 1 chat expiring soon\. Go take a look!"[^>]*\/>/)[0];
 for(const [index,xml] of [
  premiumReminder.replace(chat,'Send a message to keep your chat'),
  premiumReminder.replace(chat,spotlights),premiumReminder.replace(spotlights,chat),
  premiumReminder.replace(chat,'__swap__').replace(spotlights,chat).replace('__swap__',spotlights),
  premiumReminder.replace('2 Spotlights','3 Spotlights'),
  premiumReminder.replace('Get connecting','Send message'),premiumReminder.replace('Get connecting','Buy now'),
  premiumReminder.replace('content-desc="Close"','content-desc="Confirm"'),
  premiumReminder.replace('[608,182][704,278]','[608,1088][704,1184]'),
  premiumReminder.replace(row,row.replace('clickable="false"','clickable="true"')),
  premiumReminder.replace(row,row.replace('focusable="false"','focusable="true"')),
  premiumReminder.replace(row,row.replace('class="android.widget.TextView"','class="android.widget.EditText"')),
  premiumReminder.replace(row,row.replace('hint=""','hint="Message"')),
  premiumReminder.replace(row,row+row),premiumReminder.replace(row,''),
 ].entries()){
  const screen=read(xml);assert.equal(screen.kind,'blocked','variant '+index);
  assert.ok(Object.values(screen.controls).every(value=>!value));
 }
});

test('Bumble two-thumbnail reminder rejects changed actions, interactive photos and ambiguous framing',()=>{
 const leaf=reminder.match(/<node[^>]*bounds="\[112,542\]\[352,862\]"[^>]*\/>/)[0];
 const mutateLeaf=(from,to)=>reminder.replace(leaf,leaf.replace(from,to));
 const variants=[
  reminder.replace('See matches','Subscribe'),reminder.replace('See matches','Send message'),
  reminder.replace('Someone’s popular! Why not see where your matches lead?','Verify your account'),
  reminder.replace('content-desc="Close"','content-desc="Buy now"'),
  reminder.replace('class="android.widget.ImageView"','class="android.widget.Button"'),
  reminder.replace('[608,422][704,518]','[608,1088][704,1184]'),
  reminder.replace('[112,542][352,862]','[112,500][352,820]'),
  reminder.replace('[112,542][352,862]','[112,622][352,942]'),
  reminder.replace('[368,542][608,862]','[352,542][592,862]'),
  reminder.replace('[368,542][608,862]','[368,542][616,862]'),
  reminder.replace('[368,542][608,862]','[384,542][624,862]'),
  mutateLeaf('clickable="false"','clickable="true"'),
  mutateLeaf('focusable="false"','focusable="true"'),
  mutateLeaf('text=""','text="Send a compliment"'),
  mutateLeaf('content-desc=""','content-desc="Close"'),
  mutateLeaf('class="android.view.View"','class="android.widget.EditText"'),
  mutateLeaf('hint=""','hint="Message"'),
  reminder.replace(leaf,leaf+leaf),reminder.replace(leaf,''),
  reminder.replace(leaf,leaf.replace('/>','>'+leaf+'</node>')),
  reminder.replace('resource-id="android:id/content"','resource-id="com.bumble.app:id/profile_root_container"'),
  reminder.replace('package="com.bumble.app"','package="android"'),
  reminder.replace('</hierarchy>',leaf+'</hierarchy>'),
  reminder.replace(leaf,leaf.replace('/>',' visible-to-user="false"/>')),
 ];
 for(const [index,xml] of variants.entries()){
  const screen=read(xml);assert.equal(screen.kind,'blocked','variant '+index);
  assert.ok(Object.values(screen.controls).every(value=>!value));
 }
});

const node=(attrs='',children='')=>'<node package="com.bumble.app" enabled="true" class="android.view.View" bounds="[21,231][1059,2162]" '+attrs+'>'+children+'</node>';
const profile=name=>'<hierarchy>'+node('resource-id="com.bumble.app:id/mainApp_root"',
 node('resource-id="com.bumble.app:id/encountersStackContainer"',node('drawing-order="2"',
  node('resource-id="com.bumble.app:id/profile_root_container"',node('resource-id="com.bumble.app:id/encountersGridProfile_list"',
   node('content-desc="'+name+'’s main photo"')+node('text="'+name+', 28"')))))+
 node('selected="true"',node('content-desc="People"')))+'</hierarchy>';
function pendingController({after=profile('Previous'),initial=reminder,race}={}){
 let current=initial,reads=0;const taps=[],observed=[];
 const c=new Controller({platform:'bumble',service:{},android:{serial:'fixture',inputEpoch:0,
  hierarchy:async()=>{if(++reads===2&&race)current=race;observed.push(current);return {xml:current,foreground:'com.bumble.app'}},
  tapControl:async(bounds,valid)=>{assert.ok(valid());taps.push(bounds);current=after},
  swipeProfile:async()=>assert.fail('A pending action cannot swipe'),
 },wait:async()=>{},readEvidence:async s=>({hashes:s.photos.map(()=>'0123456789abcdef')})});
 const original=read(profile('Previous'));
 c.session.count=c.reservedCount=86;c.session.config.maxSwipes=1000;
 c.lastAction={kind:'like',name:original.name,identity:original.identity};
 return {c,original,taps,observed,run:()=>c.reconcilePending(original,c.token(),()=>true)};
}

test('Bumble closes either reminder once without clearing an unconfirmed Like or changing its count',async()=>{
 for(const initial of [reminder,premiumReminder]){
  const x=pendingController({initial}),pending=x.c.lastAction;
  assert.equal(await x.run(),false);
  assert.deepEqual(x.taps,[{x:608,y:initial===reminder?422:182,width:96,height:96}]);
  assert.equal(x.c.lastAction,pending);assert.equal(x.c.session.count,86);assert.equal(x.c.reservedCount,86);
 }
});
test('Bumble pending Like resolves only after two matching observations of a new card behind the reminder',async()=>{
 for(const initial of [reminder,premiumReminder]){
  const after=profile('Following'),x=pendingController({after,initial});
  assert.equal(await x.run(),true);assert.equal(x.c.lastAction,null);
  assert.equal(x.taps.length,1);assert.equal(x.observed.filter(xml=>xml===after).length,2);
  assert.equal(x.c.session.count,86);assert.equal(x.c.reservedCount,86);
 }
});
test('Bumble does not repeat Close when the reminder stays open, or tap a changed screen',async()=>{
 for(const initial of [reminder,premiumReminder])for(const options of [{after:initial},{race:profile('Following')}]){
  const x=pendingController({initial,...options}),pending=x.c.lastAction;
  await assert.rejects(x.run(),options.race?/Screen changed/:/popup did not close/);
  assert.equal(x.taps.length,options.race?0:1);assert.equal(x.c.lastAction,pending);
  assert.equal(x.c.session.count,86);
 }
 const x=pendingController({initial:reminder.replace('See matches','Subscribe')}),pending=x.c.lastAction;
 assert.equal(await x.run(),false);assert.equal(x.taps.length,0);assert.equal(x.c.lastAction,pending);
});
