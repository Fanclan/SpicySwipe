'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const {evidence}=require('../desktop/mobile-vision.cjs');
const screen={kind:'like',photos:[],controls:{comment:{bounds:{x:10,y:10,width:200,height:80}}}};
function picture(columns=0){const bytes=Buffer.alloc(200*80*4,255);for(let x=30;x<30+columns;x++)for(let y=20;y<50;y++)for(let c=0;c<3;c++)bytes[(y*200+x)*4+c]=20;const crop={getSize:()=>({width:200,height:80}),toBitmap:()=>bytes,toPNG:()=>Buffer.from('synthetic')};return {getSize:()=>({width:300,height:200}),crop:()=>crop};}
test('placeholder text is empty only when the field has placeholder-colored pixels',async()=>{
 assert.equal((await evidence(picture(),screen,{ocr:async()=> 'Add a comment'})).commentText,'');
 assert.equal((await evidence(picture(3),screen,{ocr:async()=> 'Add a comment'})).commentText,'');
 assert.equal((await evidence(picture(60),screen,{ocr:async()=> 'Add a comment'})).commentText,'Add a comment');
});
test('unreadable visual fields fail closed and typed text is retained',async()=>{
 await assert.rejects(evidence(picture(),screen,{ocr:async()=>''}),/could not be read/i);
 assert.equal((await evidence(picture(40),screen,{ocr:async()=> 'Test'})).commentText,'Test');
});
test('blinking caret OCR artifacts normalize only on grey placeholder pixels',async()=>{
 assert.equal((await evidence(picture(3),screen,{ocr:async()=> 'IA dd a comment'})).commentText,'');
 assert.equal((await evidence(picture(60),screen,{ocr:async()=> 'IA dd a comment'})).commentText,'IA dd a comment');
});

test('local cursor removal erases only a tall thin caret, preserving letter strokes',()=>{
 const {withoutCaret}=require('../desktop/mobile-vision.cjs'),width=200,height=178,bytes=Buffer.alloc(width*height*4,255);
 const paint=(x,y,w,h)=>{for(let a=x;a<x+w;a++)for(let b=y;b<y+h;b++)for(let c=0;c<3;c++)bytes[(b*width+a)*4+c]=10};
 paint(80,30,4,60);paint(140,0,4,53);paint(40,40,4,40);const out=withoutCaret(bytes,{width,height});assert.equal(out[(40*width+80)*4],255);assert.equal(out[(10*width+140)*4],255);assert.equal(out[(40*width+40)*4],10);assert.equal(bytes[(40*width+80)*4],10);
});

function patternedPicture(){const crops=[];return {crops,getSize:()=>({width:1200,height:1400}),crop:b=>{crops.push(b);return {resize:({width,height})=>({toBitmap:()=>{const out=Buffer.alloc(width*height*4,255);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const a=b.x+(x+.5)*b.width/width,c=b.y+(y+.5)*b.height/height,v=Math.round(127+60*Math.sin(a*.021+c*.009)+60*Math.cos(c*.025-a*.017));for(let k=0;k<3;k++)out[(y*width+x)*4+k]=v;}return out;}})}}};}
test('top-clipped Hinge square photo preserves its original hash using only visible pixels',()=>{const {fingerprint,squareFingerprint}=require('../desktop/mobile-vision.cjs');const p=patternedPicture(),full={x:100,y:100,width:800,height:800},clipped={x:100,y:200,width:800,height:700};const expected=fingerprint(p,full);assert.notEqual(fingerprint(p,clipped),expected);p.crops.length=0;assert.equal(squareFingerprint(p,clipped),expected);assert.ok(p.crops.every(b=>b.x>=clipped.x&&b.y>=clipped.y&&b.x+b.width<=clipped.x+clipped.width&&b.y+b.height<=clipped.y+clipped.height));});
test('square comparison refuses insufficient visible content and does not authorize a different image',()=>{const {fingerprint,squareFingerprint}=require('../desktop/mobile-vision.cjs');const p=patternedPicture();assert.equal(squareFingerprint(p,{x:100,y:350,width:800,height:550}),null);assert.notEqual(squareFingerprint(p,{x:180,y:200,width:800,height:700}),fingerprint(p,{x:100,y:100,width:800,height:800}));});
