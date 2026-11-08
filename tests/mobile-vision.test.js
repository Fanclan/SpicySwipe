'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const {evidence}=require('../desktop/mobile-vision.cjs');
const screen={kind:'like',photos:[],controls:{comment:{bounds:{x:10,y:10,width:200,height:80}}}};
function picture(columns=0){const bytes=Buffer.alloc(200*80*4,255);for(let x=30;x<30+columns;x++)for(let y=20;y<50;y++)for(let c=0;c<3;c++)bytes[(y*200+x)*4+c]=20;const crop={getSize:()=>({width:200,height:80}),toBitmap:()=>bytes,toPNG:()=>Buffer.from('synthetic')};return {getSize:()=>({width:300,height:200}),crop:()=>crop};}
test('capture still runs for photo cards, confirmations, unrecognized screens and other platforms',async()=>{
 const {captureEvidence}=require('../desktop/mobile-vision.cjs');
 const profile={platform:'bumble',kind:'profile',controls:{},photos:[]};
 for(const candidate of [
  {...profile,photos:[{bounds:{x:0,y:0,width:150,height:150}}]}, {...profile,kind:'swipeConfirm'},
  {...profile,kind:'blocked'}, {...profile,kind:'unknown'}, {...profile,kind:'empty'},
  {...profile,platform:'hinge'}, {...profile,photos:undefined}, {...profile,controls:screen.controls},
  {...screen,platform:'hinge'},
 ]){
  let captures=0;
  const image=candidate.kind==='like'?picture():patternedPicture();
  const options={ocr:async()=>'Test'};
  const captured=await captureEvidence(candidate,async()=>{captures++;return image},options);
  assert.equal(captures,1);assert.deepEqual(captured,await evidence(image,candidate,options));
 }
});
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

test('caret removal rounds the minimum height to a pixel and preserves shorter strokes and typed letters', () => {
 const {withoutCaret} = require('../desktop/mobile-vision.cjs');
 const width = 160, height = 136;
 const original = Buffer.alloc(width * height * 4, 255);
 const paint = (bitmap, left, top, w, h, value) => {
  for (let y = top; y < top + h; y++) {
   for (let x = left; x < left + w; x++) {
    const start = (y * width + x) * 4;
    bitmap.fill(value, start, start + 3);
   }
  }
 };
 paint(original, 15, 30, 4, 38, 20);
 paint(original, 35, 30, 4, 37, 20);
 // A typed H remains dark even though both vertical strokes are as tall as the caret.
 paint(original, 65, 30, 4, 38, 20);
 paint(original, 83, 30, 4, 38, 20);
 paint(original, 69, 47, 14, 4, 20);
 const expected = Buffer.from(original);
 paint(expected, 15, 30, 4, 38, 255);
 assert.ok(withoutCaret(original, {width, height}).equals(expected),
  'Only the 38-pixel caret should be cleared');
});

function patternedPicture(){const crops=[];return {crops,getSize:()=>({width:1200,height:1400}),crop:b=>{crops.push(b);return {resize:({width,height})=>({toBitmap:()=>{const out=Buffer.alloc(width*height*4,255);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const a=b.x+(x+.5)*b.width/width,c=b.y+(y+.5)*b.height/height,v=Math.round(127+60*Math.sin(a*.021+c*.009)+60*Math.cos(c*.025-a*.017));for(let k=0;k<3;k++)out[(y*width+x)*4+k]=v;}return out;}})}}};}
test('top-clipped Hinge square photo preserves its original hash using only visible pixels',()=>{const {fingerprint,squareFingerprint}=require('../desktop/mobile-vision.cjs');const p=patternedPicture(),full={x:100,y:100,width:800,height:800},clipped={x:100,y:200,width:800,height:700};const expected=fingerprint(p,full);assert.notEqual(fingerprint(p,clipped),expected);p.crops.length=0;assert.equal(squareFingerprint(p,clipped),expected);assert.ok(p.crops.every(b=>b.x>=clipped.x&&b.y>=clipped.y&&b.x+b.width<=clipped.x+clipped.width&&b.y+b.height<=clipped.y+clipped.height));});
test('square comparison refuses insufficient visible content and does not authorize a different image',()=>{const {fingerprint,squareFingerprint}=require('../desktop/mobile-vision.cjs');const p=patternedPicture();assert.equal(squareFingerprint(p,{x:100,y:350,width:800,height:550}),null);assert.notEqual(squareFingerprint(p,{x:180,y:200,width:800,height:700}),fingerprint(p,{x:100,y:100,width:800,height:800}));});

// Two independent renders of the same synthetic square photograph. The native Like
// view can expose just the bottom of the square at a different display resolution.
function renderedPhoto(square, paint) {
 const crops=[];
 return {crops,getSize:()=>({width:1000,height:1400}),crop(rect){
  crops.push(rect);
  return {resize:({width,height})=>({toBitmap(){
   const pixels=Buffer.alloc(width*height*4,255);
   for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const u=(rect.x+(x+.5)*rect.width/width-square.x)/square.width;
    const v=(rect.y+(y+.5)*rect.height/height-square.y)/square.width;
    const rgb=paint(u,v);for(let k=0;k<3;k++)pixels[(y*width+x)*4+k]=rgb[k];
   }
   return pixels;
  }})};
 }};
}
const scene=(u,v)=>[0,1,2].map(k=>Math.round(116+45*Math.sin(29*u+11*v+k)+38*Math.cos(17*v-13*u+k)+26*Math.cos(51*v+35*u)));
const fullSquare={x:40,y:120,width:640,height:640},scaledSquare={x:72,y:40,width:576,height:576};
const visibleSlice={x:72,y:345,width:576,height:271};
function proof(box,square,paint,kind){
 const {photoPatchEvidence}=require('../desktop/mobile-vision.cjs');
 const image=renderedPhoto(square,paint),result=photoPatchEvidence(image,box,kind);
 assert.ok(image.crops.every(r=>r.x>=box.x&&r.y>=box.y&&r.x+r.width<=box.x+box.width&&r.y+r.height<=box.y+box.height));
 return result;
}
test('Hinge binds distant parts of a heavily top-clipped photo in the same square coordinates',()=>{
 const {sameClippedPhoto}=require('../desktop/mobile-vision.cjs');
 const source=proof(fullSquare,fullSquare,scene,'profile');
 assert.equal(sameClippedPhoto(source,proof(visibleSlice,scaledSquare,scene,'like')),true);
 assert.equal(sameClippedPhoto(source,proof(visibleSlice,scaledSquare,(u,v)=>scene(u,v-.265),'like')),false);
 assert.equal(sameClippedPhoto(source,proof(visibleSlice,scaledSquare,(u,v)=>scene(1-u,v),'like')),false);
 assert.equal(sameClippedPhoto(source,proof(visibleSlice,scaledSquare,(u,v)=>v>.77?scene(u,v):scene(1-u,v),'like')),false);
 assert.equal(sameClippedPhoto(source,proof({...visibleSlice,y:400,height:216},scaledSquare,scene,'like')),false);
});
test('clipped Hinge photos need discriminating texture in multiple parts of the frame',()=>{
 const {sameClippedPhoto}=require('../desktop/mobile-vision.cjs');
 for(const paint of [()=>[35,48,60],(u,v)=>[u,v,v].map(n=>Math.round(40+90*n)),(u,v)=>v>.8?scene(u,v):[150,150,150]]){
  assert.equal(sameClippedPhoto(proof(fullSquare,fullSquare,paint,'profile'),proof(visibleSlice,scaledSquare,paint,'like')),false);
 }
});
test('a repeated design in the visible regions alone cannot bind a clipped Hinge photo',()=>{
 const {sameClippedPhoto}=require('../desktop/mobile-vision.cjs');
 const original=proof(fullSquare,fullSquare,scene,'profile');
 const repetitive=[original.windows[0],original.windows[0],original.windows[0]];
 assert.equal(sameClippedPhoto({kind:'profile',windows:repetitive},{kind:'like',windows:repetitive}),false);
});
