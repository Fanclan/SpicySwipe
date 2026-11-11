'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const {evidence}=require('../desktop/mobile-vision.cjs');
const previewFixture=require('./fixtures/hinge-preview-image.cjs');
const screen={kind:'like',photos:[],controls:{comment:{bounds:{x:10,y:10,width:200,height:80}}}};
function picture(columns=0){const bytes=Buffer.alloc(200*80*4,255);for(let x=30;x<30+columns;x++)for(let y=20;y<50;y++)for(let c=0;c<3;c++)bytes[(y*200+x)*4+c]=20;const crop={getSize:()=>({width:200,height:80}),toBitmap:()=>bytes,toPNG:()=>Buffer.from('synthetic')};return {getSize:()=>({width:300,height:200}),crop:()=>crop};}

const previewSourceBox={x:40,y:451,width:640,height:640};
const previewFormBox={x:72,y:137,width:576,height:271};
function previewProof(box,kind,paint=previewFixture.scene,overlays=[]){
 return require('../desktop/mobile-vision.cjs').previewPhotoEvidence(previewFixture.photoPicture(box,paint),box,kind,overlays);
}
test('private preview proof normalizes the full source to the fresh deep clip without serializing pixels',()=>{
 const {hasSourcePreviewProof,samePreviewPhoto}=require('../desktop/mobile-vision.cjs');
 const source=previewProof(previewSourceBox,'profile'),form=previewProof(previewFormBox,'like');
 assert.equal(hasSourcePreviewProof(source),true);assert.equal(hasSourcePreviewProof(form),false);
 assert.equal(samePreviewPhoto(source,form),true);
 assert.deepEqual(JSON.parse(JSON.stringify(source)),{version:1,kind:'profile'});
 assert.deepEqual(Object.keys(source),['version','kind']);assert.ok(Object.isFrozen(source));
 assert.equal(samePreviewPhoto(JSON.parse(JSON.stringify(source)),form),false);
 assert.equal(samePreviewPhoto(source,JSON.parse(JSON.stringify(form))),false);
});
test('private preview proof rejects changed content, wrong anchors, mirrors and every changed window',()=>{
 const {samePreviewPhoto}=require('../desktop/mobile-vision.cjs'),scene=previewFixture.scene;
 const source=previewProof(previewSourceBox,'profile');
 for(const paint of [(u,v)=>scene(1-u,v),(u,v)=>scene(u,v-.265),
  (u,v)=>u<.44&&v<.75?scene(1-u,v):scene(u,v),
  (u,v)=>u>.48&&v<.75?scene(1-u,v):scene(u,v),
  (u,v)=>v>.75?scene(1-u,v):scene(u,v)]){
  assert.equal(samePreviewPhoto(source,previewProof(previewFormBox,'like',paint)),false);
 }
 for(const paint of [()=>[80,90,100],(u,v)=>[u,v,v].map(n=>Math.round(60+90*n)),
  (u,v)=>scene(u,((v-.56)% .265+.265)% .265+.56)]){
  assert.equal(samePreviewPhoto(previewProof(previewSourceBox,'profile',paint),previewProof(previewFormBox,'like',paint)),false);
 }
});
test('private preview proof refuses overlays on its fixed windows and anchors but avoids the old Skip window',()=>{
 const {hasSourcePreviewProof}=require('../desktop/mobile-vision.cjs');
 const skip={x:40,y:948,width:124,height:124},like={x:564,y:975,width:96,height:96};
 assert.equal(hasSourcePreviewProof(previewProof(previewSourceBox,'profile',undefined,[skip,like])),true);
 for(const overlay of [{x:91,y:809,width:8,height:8},{x:354,y:809,width:8,height:8},
  {x:232,y:937,width:8,height:8},{x:91,y:470,width:8,height:8}]){
  assert.equal(previewProof(previewSourceBox,'profile',undefined,[overlay]),null);
 }
});
test('private preview source freshness binds exact whole-crop pixels and bounds',()=>{
 const {samePreviewSourceFrame}=require('../desktop/mobile-vision.cjs'),scene=previewFixture.scene;
 const source=previewProof(previewSourceBox,'profile');
 assert.equal(samePreviewSourceFrame(source,previewProof(previewSourceBox,'profile')),true);
 assert.equal(samePreviewSourceFrame(source,previewProof(previewSourceBox,'profile',(u,v)=>scene(u,v).map(n=>Math.min(255,n+1)))),false);
 assert.equal(samePreviewSourceFrame(source,previewProof({...previewSourceBox,x:41},'profile')),false);
 assert.equal(samePreviewSourceFrame(source,previewProof(previewFormBox,'like')),false);
});
test('private preview proof rechecks native Skip and Like overlays after identity reconstruction',()=>{
 const {previewSourceOverlaysClear}=require('../desktop/mobile-vision.cjs');
 const source=previewProof(previewSourceBox,'profile');
 const skip={x:40,y:948,width:124,height:124},like={x:564,y:975,width:96,height:96};
 assert.equal(previewSourceOverlaysClear(source,[skip,like]),true);
 assert.equal(previewSourceOverlaysClear(source,[{x:232,y:937,width:20,height:20},like]),false);
 assert.equal(previewSourceOverlaysClear(source,[skip,{x:354,y:809,width:20,height:20}]),false);
 assert.equal(previewSourceOverlaysClear(source,[null,like]),false);
 assert.equal(previewSourceOverlaysClear(source,[]),false);
 assert.equal(previewSourceOverlaysClear(previewProof(previewFormBox,'like'),[skip,like]),false);
});
test('private preview proof refuses unmeasured geometry and upscaling',()=>{
 const {samePreviewPhoto}=require('../desktop/mobile-vision.cjs');
 for(const box of [{...previewSourceBox,height:639},{...previewSourceBox,x:-1},{...previewSourceBox,width:159,height:159}]){
  const picture=previewFixture.photoPicture(previewSourceBox);
  assert.equal(require('../desktop/mobile-vision.cjs').previewPhotoEvidence(picture,box,'profile'),null);
 }
 for(const height of [250,300,576])assert.equal(previewProof({...previewFormBox,height},'like'),null);
 assert.equal(samePreviewPhoto(previewProof({x:40,y:40,width:320,height:320},'profile'),previewProof(previewFormBox,'like')),false);
});
test('private preview evidence leaves saved legacy revision and scroll evidence unchanged',async()=>{
 const expected=[
  {kind:'profile',hashes:['162ead455a9a96d6'],patchDigests:['8eb5a04193bc957d12034c61e743a3fd5ca515de61e102dc4be1ea680c7dd793'],squareHashes:[null],scrollPhoto:false},
  {kind:'like',hashes:['9a5a96a6a2b5a528'],patchDigests:['9622e4272fb6f6d8e6b07cb7fce2998b8d38a9651f662db755c6e581d65d38de'],squareHashes:[null],scrollPhoto:false}
 ];
 for(const [index,[kind,bounds]]of[['profile',previewSourceBox],['like',previewFormBox]].entries()){
  const screen={platform:'hinge',kind,controls:{skip:kind==='profile'?{bounds:{x:40,y:948,width:124,height:124}}:null},
   photos:[{bounds,like:kind==='profile'?{bounds:{x:564,y:975,width:96,height:96}}:null}]};
  const value=await evidence(previewFixture.photoPicture(bounds),screen);
  assert.ok(value.previewEvidence[0]);
  assert.deepEqual({kind,hashes:value.hashes,patchDigests:value.patchEvidence.map(p=>p?.digest||null),
   squareHashes:value.squareHashes,scrollPhoto:!!value.scrollPhoto},expected[index]);
 }
});
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
test('Discover image continuity uses the existing square sample only for verified top clips',async()=>{
 const picture=patternedPicture(),full={x:40,y:75,width:640,height:640},clipped={x:40,y:137,width:640,height:578};
 const screen={platform:'hinge',kind:'profile',controls:{},photos:[
  {bounds:clipped,revealDirection:'down'},{bounds:clipped,revealDirection:'up'},
  {bounds:clipped,revealDirection:null},{bounds:{...clipped,height:512},revealDirection:'down'}]};
 const expected=require('../desktop/mobile-vision.cjs').fingerprint(picture,full);
 assert.deepEqual((await evidence(picture,screen)).squareHashes,[expected,null,null,null]);
});
test('adjacent Discover crops require distinct textured bottom windows, a verified top clip, and a forward scroll',async()=>{
 const {sameScrollPhoto,sameClippedPhoto}=require('../desktop/mobile-vision.cjs');
 const frame=async(height,paint,opts={})=>{
  const bounds={x:40,y:137,width:640,height,...opts.bounds};const square={...bounds,y:bounds.y+bounds.height-bounds.width,height:bounds.width};
  const snap={platform:'hinge',kind:'profile',controls:{skip:opts.skip},photos:[{bounds,revealDirection:opts.reveal??'down'}]};
  return (await evidence(renderedPhoto(square,paint),snap)).scrollPhoto;
 };
 const larger=await frame(578,scene),smaller=await frame(425,scene);
 assert.equal(sameScrollPhoto(larger,smaller),true);assert.equal(sameClippedPhoto(larger,smaller),false);
 for(const alternate of [await frame(425,(u,v)=>scene(1-u,v)),await frame(425,scene,{reveal:'up'}),await frame(340,scene),
  await frame(425,scene,{bounds:{x:60}}),await frame(425,scene,{skip:{bounds:{x:100,y:300,width:300,height:220}}})]){
  assert.equal(sameScrollPhoto(larger,alternate),false);
 }
 for(const paint of [()=>[120,130,110],(u,v)=>[u,v,u].map(q=>Math.round(30+90*q))]){
  assert.equal(sameScrollPhoto(await frame(578,paint),await frame(425,paint)),false);
 }
 assert.equal(sameScrollPhoto(smaller,larger),false);
});


test('full-square forward translation is opt-in and still requires discriminating private pixel windows',async()=>{
 const {sameScrollPhoto,samePhotoFrame}=require('../desktop/mobile-vision.cjs');
 const frame=async(bounds,paint=scene)=>{
  const square={...bounds,y:bounds.y+bounds.height-bounds.width,height:bounds.width};
  return (await evidence(renderedPhoto(square,paint),{platform:'hinge',kind:'profile',controls:{},photos:[{bounds,revealDirection:'down'}]})).scrollPhoto;
 };
 const start={x:40,y:451,width:640,height:640},translated={...start,y:285};
 const first=await frame(start),second=await frame(translated),clipped=await frame({...translated,y:347,height:412});
 assert.equal(sameScrollPhoto(first,second),false);
 assert.equal(sameScrollPhoto(first,second,{allowFullTranslation:true}),true);
 assert.equal(sameScrollPhoto(second,clipped,{allowFullTranslation:true}),true);
 for(const bad of [first,await frame({...start,y:461}),await frame({...translated,x:41}),
  await frame(translated,(u,v)=>scene(1-u,v))])assert.equal(sameScrollPhoto(first,bad,{allowFullTranslation:true}),false);
 assert.equal(sameScrollPhoto(clipped,await frame({...clipped.bounds,y:300}),{allowFullTranslation:true}),false);
 assert.equal(samePhotoFrame(second,await frame(translated)),true);
 assert.equal(samePhotoFrame(second,first),false);
 assert.equal(samePhotoFrame(clipped,await frame(clipped.bounds,(u,v)=>scene(u,v).map(c=>c+20))),false);
 assert.equal(samePhotoFrame(clipped,await frame(clipped.bounds)),true);
});
