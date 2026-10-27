'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {readChat}=require('../desktop/mobile-chat.cjs');
const {readScreen}=require('../desktop/mobile-screen.cjs');
const empty=fs.readFileSync(path.join(__dirname,'fixtures/mobile/hinge-chat-empty.xml'),'utf8');
const typed=fs.readFileSync(path.join(__dirname,'fixtures/mobile/hinge-chat-typed.xml'),'utf8');
const read=xml=>readScreen(xml,{platform:'hinge',foreground:'co.hinge.app'});

test('no native conversation composer delegates to the profile reader',()=>{
 assert.equal(readChat({nodes:[]}),null);
});

test('observed empty conversation has verified header, stable identity and actual opener evidence',()=>{
 const screen=read(empty);
 assert.equal(screen.kind,'conversation');assert.equal(screen.name,'Sample');assert.ok(screen.identity);
 assert.equal(screen.emptyConversation,true);assert.equal(screen.composerText,'');assert.equal(screen.composerTextVerified,true);
 assert.equal(screen.controls.composer.bounds.x,32);assert.equal(screen.controls.sendMessage,null);
 assert.match(screen.context.history,/Start the chat with Sample/);assert.match(screen.context.history,/Wed, Jan 7 8:15PM/);assert.match(screen.context.history,/You liked Sample's photo\./);
 assert.equal(screen.controls.skip,null);assert.equal(screen.controls.sendLike,null);
});

test('typed conversation preserves identity across keyboard resize and returns only exact Send message',()=>{
 const screen=read(typed);
 assert.equal(screen.kind,'conversation');assert.equal(screen.identity,read(empty).identity);assert.notEqual(screen.screenKey,read(empty).screenKey);
 assert.equal(screen.composerText,'Test');assert.equal(screen.composerTextVerified,true);assert.equal(screen.emptyConversation,true);
 assert.equal(screen.controls.sendMessage.label,'Send message');assert.deepEqual(screen.controls.sendMessage.bounds,{x:922,y:1359,width:126,height:126});
});

test('a real draft equal to the composer hint is preserved when Send message is present',()=>{
 const screen=read(typed.replace('text="Test"','text="Send a message"'));
 assert.equal(screen.kind,'conversation');assert.equal(screen.composerText,'Send a message');assert.ok(screen.controls.sendMessage);
});

test('same-name conversations differ by match timestamp, never screen position alone',()=>{
 const changed=read(empty.replace('Wed, Jan 7 8:15PM','Thu, Jan 8 8:15PM'));
 assert.equal(changed.kind,'conversation');assert.notEqual(changed.identity,read(empty).identity);
 for(const xml of [empty.replace('Wed, Jan 7 8:15PM',''),empty.replace("You liked Sample's photo.",''),empty.replace('Start the chat with Sample','Start the chat with Else')]){
  const screen=read(xml);assert.equal(screen.kind,'blocked');assert.equal(screen.controls.composer,null);
 }
});

test('unknown body messages prevent empty-conversation inference and sending',()=>{
 const additions=['<node text="Hello there" package="co.hinge.app" class="android.widget.TextView" bounds="[200,1000][700,1040]" enabled="true" clickable="false" />','<node content-desc="Incoming photo" package="co.hinge.app" class="android.widget.ImageView" bounds="[200,1000][700,1040]" enabled="true" clickable="false" />'];
 for(const addition of additions){
  // Append into the exact native chat region, immediately before its last visible known text.
  const injection=typed.replace(/(<node[^>]*text="You liked Sample's photo\."[^>]*\/>)/,addition+'$1');
  assert.notEqual(injection,typed);const screen=read(injection);assert.equal(screen.kind,'blocked');assert.equal(screen.emptyConversation,false);assert.equal(screen.controls.sendMessage,null);
 }
});

test('ambiguous header, inactive Chat tab, disabled composer/send and microphone contradictions fail closed',()=>{
 const cases=[
  empty.replace('content-desc="Sample, Verified"','content-desc="Other, Verified"'),
  empty.replace('selected="true" bounds="[0,178][540,300]"','selected="false" bounds="[0,178][540,300]"'),
  empty.replace(/(resource-id="co\.hinge\.app:id\/messageComposition"[^>]*enabled=")true/,'$1false'),
  typed.replace(/(resource-id="co\.hinge\.app:id\/sendMessageButton"[^>]*enabled=")true/,'$1false'),
  typed.replace('co.hinge.app:id/sendMessageButton','co.hinge.app:id/notTheSendButton'),
  empty.replace('content-desc="Record voice note"','content-desc="Send message"'),
  empty.replace('text="Send a message"','text="Unsent draft"')
 ];
 for(const xml of cases){const screen=read(xml);assert.equal(screen.kind,'blocked');assert.equal(screen.controls.sendMessage,null);assert.equal(screen.controls.composer,null);}
});

test('duplicate composer or send controls and missing timestamp sibling relationship block mutations',()=>{
 const extra='<node resource-id="co.hinge.app:id/messageComposition" text="Send a message" hint="Send a message" package="co.hinge.app" class="android.widget.EditText" clickable="true" enabled="true" bounds="[1,1][20,20]" />';
 assert.equal(read(empty.replace('</hierarchy>',extra+'</hierarchy>')).kind,'blocked');
 const sendNode=typed.match(/<node[^>]*resource-id="co.hinge.app:id\/sendMessageButton"[^>]*\/>/)[0];
 assert.equal(read(typed.replace(sendNode,sendNode+sendNode)).kind,'blocked');
 const separator='<node package="co.hinge.app" class="android.view.View" bounds="[308,1914][772,2040]" enabled="true" />';
 const brokenSibling=empty.replace(/(<node[^>]*bounds="\[308,1914\]\[772,2040\]"[^>]*>)/,separator+'$1');
 assert.notEqual(brokenSibling,empty);assert.equal(read(brokenSibling).kind,'blocked');
 const timestampMoved=empty.replace('text="Wed, Jan 7 8:15PM"','text="Unrecognized event"');
 assert.equal(read(timestampMoved).kind,'blocked');
});
