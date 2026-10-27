'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const Controller=require('../desktop/mobile-controller.cjs');
const profile=()=>({kind:'profile',name:'Fixture',identity:'fixture-card',screenKey:'fixture-screen',controls:{like:{direction:'right',bounds:{x:1,y:1,width:100,height:100}}}});
function setup({limit=10,next,fail,interrupt,initial=profile()}={}){
 let current=initial,swipes=0,records=0,committed=0,reads=0,active=true;
 const c=new Controller({platform:'bumble',android:{serial:'fixture',inputEpoch:0},service:{},wait:async()=>{if(interrupt)active=false}});
 c.session.status='running';c.session.config.maxSwipes=limit;c.session.endsAt=Date.now()+60000;
 c.read=async()=>{reads++;return current};c.record=async()=>{records++};
 c.android.swipeProfile=async(d,b,valid,issued)=>{assert.ok(valid());swipes++;issued();if(fail)throw Error('Native failed');if(next)current=next(swipes)};
 return {c,run:()=>c.swipeBumble('like',initial,c.token(),()=>active,n=>{committed+=n||1}),stats:()=>({swipes,records,committed,reads})};
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

test('Bumble confirms a same-name different-age card only after two stable reads',async()=>{
 const initial={...profile(),profileDiscriminator:'age-29'};
 const next={...profile(),identity:'new-photo',screenKey:'next',profileDiscriminator:'age-31'};
 const x=setup({initial,next:()=>next});await x.run();
 assert.equal(x.stats().swipes,1);assert.equal(x.stats().reads,3);assert.equal(x.stats().committed,1);assert.equal(x.c.lastAction,null);
});
for(const next of [
 {...profile(),identity:'new-photo',screenKey:'next',profileDiscriminator:'age-29'},
 {...profile(),identity:'fixture-card',screenKey:'next',profileDiscriminator:'age-31'},
 {...profile(),identity:'new-photo',screenKey:'next',profileDiscriminator:null}
])test('Bumble same-name transition requires both independent evidence changes '+next.identity+next.profileDiscriminator,async()=>{
 const x=setup({initial:{...profile(),profileDiscriminator:'age-29'},next:()=>next});
 await assert.rejects(x.run(),/transition/);assert.equal(x.stats().swipes,1);
 assert.equal(x.c.lastAction.profileDiscriminator,'age-29');
});
test('Bumble a transient same-name static change cannot authorize a retry or confirm success',async()=>{
 const initial={...profile(),profileDiscriminator:'age-29'};
 const x=setup({initial});let reads=0;
 x.c.read=async()=>++reads===2?{...profile(),identity:'new-photo',screenKey:'next',profileDiscriminator:'age-31'}:initial;
 await assert.rejects(x.run(),/transition/);assert.equal(x.stats().swipes,1);assert.ok(x.c.lastAction);
});
test('Bumble alternating same-name candidates never count as stable transition evidence',async()=>{
 const initial={...profile(),profileDiscriminator:'age-29'};
 const x=setup({initial});let reads=0;
 x.c.read=async()=>++reads===1?initial:{...profile(),identity:'new-photo-'+reads%2,screenKey:'next',profileDiscriminator:'age-31'};
 await assert.rejects(x.run(),/transition/);assert.equal(x.stats().swipes,1);
});
