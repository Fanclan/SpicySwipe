'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const Controller=require('../desktop/mobile-controller.cjs');
const profile=()=>({kind:'profile',name:'Fixture',identity:'fixture-card',screenKey:'fixture-screen',controls:{like:{direction:'right',bounds:{x:1,y:1,width:100,height:100}}}});
function setup({limit=10,next,fail,interrupt}={}){
 let current=profile(),swipes=0,records=0,committed=0,reads=0,active=true;
 const c=new Controller({platform:'bumble',android:{serial:'fixture',inputEpoch:0},service:{},wait:async()=>{if(interrupt)active=false}});
 c.session.status='running';c.session.config.maxSwipes=limit;c.session.endsAt=Date.now()+60000;
 c.read=async()=>{reads++;return current};c.record=async()=>{records++};
 c.android.swipeProfile=async(d,b,valid,issued)=>{assert.ok(valid());swipes++;issued();if(fail)throw Error('Native failed');if(next)current=next(swipes)};
 return {c,run:()=>c.swipeBumble('like',profile(),c.token(),()=>active,n=>{committed+=n||1}),stats:()=>({swipes,records,committed,reads})};
}
test('Bumble retries one independently stable unchanged card and counts both gestures',async()=>{const x=setup({next:n=>n===2?{...profile(),name:'Next fixture',identity:'next-card',screenKey:'next'}:profile()});await x.run();assert.deepEqual({...x.stats(),reads:0},{swipes:2,records:2,committed:2,reads:0});assert.equal(x.c.lastAction,null)});
test('Bumble unchanged twice retains uncertain guard and counts two',async()=>{const x=setup();await assert.rejects(x.run(),/transition/);assert.equal(x.stats().swipes,2);assert.equal(x.stats().committed,2);assert.equal(x.stats().records,2);assert.ok(x.c.lastAction)});
test('Bumble one remaining action cannot retry',async()=>{const x=setup({limit:1});await assert.rejects(x.run(),/transition/);assert.equal(x.stats().swipes,1);assert.equal(x.stats().committed,1)});
for(const changed of [{...profile(),identity:'changed-card'},{...profile(),kind:'blocked',reason:'Fixture blocker'},{...profile(),kind:'unknown'}])test('Bumble ambiguous or blocked result cannot retry '+changed.kind+changed.identity,async()=>{const x=setup({next:()=>changed});await assert.rejects(x.run(),/transition/);assert.equal(x.stats().swipes,1)});
test('Bumble canceled polling cannot issue late retry',async()=>{const x=setup({interrupt:true});await assert.rejects(x.run(),/canceled/);assert.equal(x.stats().swipes,1);assert.equal(x.stats().committed,1)});
test('Bumble native error counts its dispatched gesture without retry',async()=>{const x=setup({fail:true});await assert.rejects(x.run(),/Native failed/);assert.equal(x.stats().swipes,1);assert.equal(x.stats().committed,1);assert.equal(x.stats().records,1)});

test('Bumble elapsed deadline cannot issue a retry',async()=>{const x=setup();x.c.session.now=()=>x.stats().reads>=6?x.c.session.endsAt:0;await assert.rejects(x.run(),/transition/);assert.equal(x.stats().swipes,1)});
test('Bumble fresh identity race prevents retry',async()=>{const x=setup();let reads=0;x.c.read=async()=>++reads===7?{...profile(),identity:'raced-card'}:profile();await assert.rejects(x.run(),/changed/);assert.equal(x.stats().swipes,1);assert.equal(x.stats().committed,1)});
test('Bumble intervening unknown screen poisons retry even if original returns',async()=>{const x=setup();let reads=0;x.c.read=async()=>++reads===2?{...profile(),kind:'unknown'}:profile();await assert.rejects(x.run(),/transition/);assert.equal(x.stats().swipes,1)});
test('Bumble confirmation never leads to another swipe',async()=>{const x=setup();let reads=0,taps=0;x.c.read=async()=>++reads===2?{...profile(),kind:'swipeConfirm',swipeDirection:'right',controls:{confirm:{}}}:profile();x.c.tap=async()=>{taps++};await assert.rejects(x.run(),/transition/);assert.equal(x.stats().swipes,1);assert.equal(taps,1)});
