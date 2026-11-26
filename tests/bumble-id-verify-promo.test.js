'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readScreen}=require('../desktop/mobile-screen.cjs');
const read=(xml,extra={})=>readScreen(xml,{platform:'bumble',foreground:'com.bumble.app',...extra});
// Synthetic nodes and public promotion copy only; no profile or account data.
function idVerifyPromo(){
 const node=(type,box,attrs={},children='')=>{
  const a={package:'com.bumble.app',enabled:'true',class:type,bounds:box,clickable:'false',focusable:'false',scrollable:'false',...attrs};
  return '<node '+Object.entries(a).map(([key,value])=>`${key}="${value}"`).join(' ')+'>'+children+'</node>';
 };
 const view=(box,children='',a={})=>node('android.view.View',box,a,children);
 const text=(box,value)=>node('android.widget.TextView',box,{text:value});
 const full='[0,0][720,1280]',sheet='[0,170][720,1280]',nav='[28,194][692,306]',close='[596,202][692,298]',icon='[608,214][680,286]';
 const navBar=view(nav,view(nav,'',{'content-desc':'Navigation Bar'})+view(close,
  view(icon,'',{'content-desc':'Close'})+view(close,view('[624,230][664,270]'))+node('android.widget.Button',icon),{clickable:'true',focusable:'true'}));
 const scroll=node('android.widget.ScrollView','[0,314][720,936]',{},
  view('[40,314][200,474]')+text('[40,506][680,645]','Want more matches and more eyes on you?')+
  text('[40,661][324,704]','It’s time to ID Verify!')+
  view('[64,760][96,792]')+text('[144,737][680,816]','ID Verified members get up to 30% more matches and are seen by more people')+
  view('[64,840][96,872]')+text('[144,817][680,896]','It helps to show you’re real and build trust before the conversation even starts'));
 const choice=(box,caption,label)=>view(box,view(box,'',{'content-desc':label})+view(box)+view(caption)+node('android.widget.Button',box),{clickable:'true',focusable:'true'});
 const actions=view('[40,976][680,1192]',choice('[40,976][680,1072]','[282,976][439,1072]','Verify now')+
  choice('[40,1096][680,1192]','[303,1096][417,1192]','Dismiss'));
 let tree=view(full,view('[0,0][720,170]','',{'content-desc':'Close sheet',clickable:'true'})+view(sheet,view(sheet,navBar+scroll+actions)));
 for(const type of ['android.view.View','android.view.View','android.view.ViewGroup','android.widget.FrameLayout','android.widget.FrameLayout','android.widget.FrameLayout'])
  tree=node(type,full,type==='android.widget.FrameLayout'&&!tree.includes('android:id/content')?{'resource-id':'android:id/content'}:{},tree);
 return '<hierarchy>'+tree+'</hierarchy>';
}
const scaled=xml=>xml.replace(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/g,(_,a,b,c,d)=>`[${a*2},${b*2}][${c*2},${d*2}]`);

test('optional Bumble ID Verify promotion exposes only the explicit lower Dismiss button',()=>{
 for(const xml of [idVerifyPromo(),scaled(idVerifyPromo())]){
  const screen=read(xml),scale=xml===idVerifyPromo()?1:2;
  assert.equal(screen.kind,'promoOffer');
  assert.deepEqual(Object.keys(screen.controls).filter(key=>screen.controls[key]),['dismiss']);
  assert.equal(screen.controls.dismiss.label,'Dismiss');
  assert.deepEqual(screen.controls.dismiss.bounds,{x:40*scale,y:1096*scale,width:640*scale,height:96*scale});
  assert.equal(screen.identity,null);assert.equal(screen.context.name,'');
  assert.deepEqual(screen.photos,[]);assert.deepEqual(screen.prompts,[]);
 }
});

test('Bumble ID Verify promotion rejects changed copy, required verification and missing explicit Dismiss',()=>{
 const xml=idVerifyPromo();
 for(const [index,bad]of [
  xml.replace('Want more matches and more eyes on you?','Verify your identity to continue'),
  xml.replace('It’s time to ID Verify!','Identity verification required'),
  xml.replace('ID Verified members get up to 30% more matches and are seen by more people','You must verify your identity before continuing'),
  xml.replace('It helps to show you’re real and build trust before the conversation even starts','Complete this security check'),
  xml.replace('content-desc="Dismiss"','content-desc="Continue"'),
  xml.replace('content-desc="Dismiss"',''),xml.replace('content-desc="Dismiss"','content-desc="Verify now"'),
  xml.replace('content-desc="Verify now"','content-desc="Upload government ID"'),
  xml.replace('</hierarchy>','<node package="com.bumble.app" class="android.widget.TextView" text="Verification required" bounds="[0,0][720,100]"/></hierarchy>'),
 ].entries()){
  const screen=read(bad);assert.equal(screen.kind,'blocked','variant '+index);
  assert.ok(Object.values(screen.controls).every(value=>!value));
 }
});

test('Bumble ID Verify promotion rejects foreign packages, editors, overlays and untrusted dismissal controls',()=>{
 const xml=idVerifyPromo(),dismiss='[40,1096][680,1192]';
 for(const [index,bad]of [
  xml.replace('package="com.bumble.app"','package="com.other.app"'),
  xml.replace('class="android.view.ViewGroup"','class="android.app.Dialog"'),
  xml.replace('class="android.widget.Button"','class="android.widget.EditText"'),
  xml.replace('class="android.widget.ScrollView"','class="android.webkit.WebView"'),
  xml.replace('content-desc="Dismiss"','content-desc="Dismiss" editable="true"'),
  xml.replace('content-desc="Dismiss"','content-desc="Dismiss" visible-to-user="false"'),
  xml.replace(`bounds="${dismiss}" clickable="true"`,`bounds="${dismiss}" clickable="false"`),
  xml.replace(`bounds="${dismiss}" clickable="true" focusable="true"`,`bounds="${dismiss}" clickable="true" focusable="false"`),
  xml.replace(`enabled="true" class="android.view.View" bounds="${dismiss}"`,`enabled="false" class="android.view.View" bounds="${dismiss}"`),
  xml.replace('text="It’s time to ID Verify!"','text="It’s time to ID Verify!" focused="true"'),
  xml.replace('resource-id="android:id/content"','resource-id="com.bumble.app:id/mainApp_root"'),
  xml.replace('</hierarchy>','<node package="com.bumble.app" class="android.view.View" content-desc="Dismiss" clickable="true" bounds="[0,0][720,100]"/></hierarchy>'),
  xml.replace('</hierarchy>','<node package="com.bumble.app" class="android.view.View" visible-to-user="false" bounds="[0,0][720,100]"/></hierarchy>'),
 ].entries()){
  const screen=read(bad);assert.equal(screen.kind,'blocked','variant '+index);
  assert.ok(Object.values(screen.controls).every(value=>!value));
 }
 assert.equal(read(xml,{foreground:'com.other.app'}).kind,'blocked');
});

test('Bumble ID Verify dismissal cannot overlap verification, backdrop or promotion content',()=>{
 const xml=idVerifyPromo();
 for(const [index,bad]of [
  xml.replaceAll('[40,1096][680,1192]','[40,976][680,1072]'),
  xml.replaceAll('[40,1096][680,1192]','[0,0][720,170]'),
  xml.replaceAll('[40,1096][680,1192]','[40,737][680,833]'),
  xml.replaceAll('[40,1096][680,1192]','[40,1000][680,1192]'),
  xml.replace('[40,1096][680,1192]','[40,1096][681,1192]'),
  xml.replace('[303,1096][417,1192]','[303,976][417,1072]'),
  xml.replaceAll('[40,976][680,1072]','[40,1096][680,1192]'),
  xml.replace('[40,506][680,645]','[40,506][680,1072]'),
 ].entries()){
  const screen=read(bad);assert.equal(screen.kind,'blocked','variant '+index);
  assert.ok(Object.values(screen.controls).every(value=>!value));
 }
 const screen=read(xml),moved=read(xml.replaceAll('[40,1096][680,1192]','[40,1097][680,1193]'));
 assert.notEqual(screen.screenKey,moved.screenKey,'a changed target cannot reuse an earlier screen approval');
});
