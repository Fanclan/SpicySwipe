const {test}=require('node:test');const assert=require('node:assert/strict');
const {isTinderURL,isLoginURL,isTrustedUI,validateBounds,allowedTinderAction}=require('../desktop/policy.cjs');
test('only exact HTTPS Tinder hosts can use the page bridge',()=>{
 for(const url of ['https://tinder.com/app/recs','https://www.tinder.com/app/messages/A'])assert.equal(isTinderURL(url),true);
 for(const url of ['http://tinder.com','https://tinder.com.attacker.test','file:///tinder.com','https://tinder.com@evil.test','garbage'])assert.equal(isTinderURL(url),false);
});
test('only the trusted local document can use desktop IPC',()=>{
 assert.equal(isTrustedUI('file:///app/desktop/index.html#settings','file:///app/desktop/index.html'),true);
 for(const url of ['file:///app/desktop/other.html','https://tinder.com','file:///app/desktop/index.html?x=1'])assert.equal(isTrustedUI(url,'file:///app/desktop/index.html'),false);
});
test('login navigation is scoped and the Tinder bridge cannot edit settings',()=>{
 assert.equal(isLoginURL('https://accounts.google.com/signin'),true);assert.equal(isLoginURL('javascript:alert(1)'),false);assert.equal(isLoginURL('https://evil.test'),false);
 assert.equal(allowedTinderAction('load'),true);assert.equal(allowedTinderAction('generate'),true);assert.equal(allowedTinderAction('save'),false);assert.equal(allowedTinderAction('android:tap'),false);
});
test('native app view bounds cannot escape the window or accept invalid numbers',()=>{
 assert.deepEqual(validateBounds({x:400,y:100,width:800,height:1000},{width:1000,height:700}),{x:400,y:100,width:600,height:600});
 for(const bounds of [{x:NaN,y:0,width:1,height:1},{x:-1,y:0,width:100,height:100}])assert.throws(()=>validateBounds(bounds,{width:1000,height:700}));
});
