'use strict';
const {readPngText}=require('./windows-ocr.cjs');
const crypto=require('node:crypto');
function fingerprint(picture,b){
 const size=picture.getSize();if(!b||b.x<0||b.y<0||b.x+b.width>size.width||b.y+b.height>size.height)return null;
 const crop={x:Math.round(b.x+b.width*.15),y:Math.round(b.y+b.height*.15),width:Math.round(b.width*.7),height:Math.round(b.height*.7)};
 const bytes=picture.crop(crop).resize({width:9,height:8,quality:'good'}).toBitmap();let bits='',minimum=255,maximum=0;
 const gray=i=>{const v=Math.round((bytes[i*4]+bytes[i*4+1]+bytes[i*4+2])/3);minimum=Math.min(minimum,v);maximum=Math.max(maximum,v);return v};
 for(let y=0;y<8;y++)for(let x=0;x<8;x++)bits+=gray(y*9+x)>gray(y*9+x+1)?'1':'0';
 return maximum-minimum<20?null:bits.match(/.{4}/g).map(n=>parseInt(n,2).toString(16)).join('');
}
function squareFingerprint(picture,b){
 // Hinge clips the top of its square confirmation photo below the header.
 // Reuse the original square's central region only if every sampled pixel is visible.
 if(!b||b.height>=b.width||b.height<b.width*.85)return null;
 const square={x:b.x,y:b.y+b.height-b.width,width:b.width,height:b.width};
 const crop={x:Math.round(square.x+square.width*.15),y:Math.round(square.y+square.height*.15),width:Math.round(square.width*.7),height:Math.round(square.height*.7)};
 if(crop.x<b.x||crop.y<b.y||crop.x+crop.width>b.x+b.width||crop.y+crop.height>b.y+b.height)return null;
 return fingerprint(picture,square);
}
// The focused Hinge Like form shows the bottom of the same square. Each window is
// fixed in square coordinates; only sample when every pixel is visibly in bounds.
// Keep coarse colour samples private until submission. They never identify a person.
const patchWindows = [[.08,.56,.35,.19],[.49,.56,.35,.19],[.08,.76,.35,.15]];
function patchBounds(visible, left, top, width, height) {
 const side = visible.width;
 return {x:visible.x+Math.round(left*side),y:visible.y+visible.height-side+Math.round(top*side),width:Math.round(width*side),height:Math.round(height*side)};
}
function overlapsPhotoPatch(photo, overlay) {
 if (!photo || !overlay) return false;
 return patchWindows.some(rect=>{
  const p=patchBounds(photo,...rect);
  return p.x<overlay.x+overlay.width && overlay.x<p.x+p.width && p.y<overlay.y+overlay.height && overlay.y<p.y+p.height;
 });
}
function sampleWindow(picture, visible, left, top, width, height) {
 const patch=patchBounds(visible,left,top,width,height);
 const {x,y,width:w,height:h}=patch;
 if (w < 9 || h < 8 || x < visible.x || y < visible.y || x+w > visible.x+visible.width || y+h > visible.y+visible.height) return null;
 return picture.crop(patch).resize({width:9,height:8,quality:'good'}).toBitmap();
}
function matchingWindow(a,b) {
 let error = 0, outliers = 0, rising = 0, falling = 0, reversed = 0;
 let sumA=0, sumB=0, squaredA=0, squaredB=0;
 const luma = (pixels, i) => (pixels[i]+pixels[i+1]+pixels[i+2])/3;
 for (let i = 0; i < a.length; i += 4) {
  const first=luma(a,i), second=luma(b,i);
  sumA+=first;sumB+=second;squaredA+=first*first;squaredB+=second*second;
  const delta = Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2]);
  error += delta;
  if (delta > 60) outliers++;
  for (const step of [4,36]) {
   if ((step === 4 && (i/4)%9 === 8) || i+step >= a.length) continue;
   const before=luma(a,i+step)-first, after=luma(b,i+step)-second;
   if (Math.abs(before)<6 || Math.abs(after)<6) continue;
   if (before*after<0) reversed++;
   else if (before>0) rising++;
   else falling++;
  }
 }
 const varied=squaredA/72-(sumA/72)**2>=144 && squaredB/72-(sumB/72)**2>=144;
 return {close:error<=8*72*3 && outliers<=7 && reversed<=1, textured:varied && rising>=5 && falling>=5 && rising+falling>=18};
}
function photoPatchEvidence(picture, box, kind) {
 if (!box || !['profile','like'].includes(kind) || !['x','y','width','height'].every(k=>Number.isSafeInteger(box[k]))) return null;
 const {width,height}=picture.getSize();
 if (box.x<0 || box.y<0 || box.width<160 || box.height<=0 || box.x+box.width>width || box.y+box.height>height) return null;
 // Only the measured deep clip is supported here. The existing whole-square
 // comparison covers lightly clipped images; other aspect ratios stay unbound.
 if (kind==='profile' ? Math.abs(box.height-box.width)>3 : box.height/box.width<.45 || box.height/box.width>.50) return null;
 const windows=patchWindows.map(rect=>sampleWindow(picture,box,...rect));
 if (windows.some(w=>!w)) return null;
 if (kind==='profile') {
  // Uniform or repeated bands can appear at several heights. Rule out either
  // alternative anchor; only the fixed bottom anchor can authorize a match.
  for (const top of [.03,.295]) {
   const other=sampleWindow(picture,box,.08,top,.35,.19);
   if (!other || matchingWindow(windows[0],other).close) return null;
  }
 }
 const hash=crypto.createHash('sha256');
 for(const window of windows)hash.update(window);
 return {kind,windows,digest:hash.digest('hex')};
}
function sameClippedPhoto(original,confirmation) {
 if (original?.kind!=='profile' || confirmation?.kind!=='like') return false;
 const comparisons=original.windows.map((w,i)=>matchingWindow(w,confirmation.windows[i]));
 if (comparisons.some(c=>!c.close)) return false;
 const textured=original.windows.filter((w,i)=>comparisons[i].textured);
 return textured.some((w,i)=>textured.slice(i+1).some(other=>!matchingWindow(w,other).close));
}
function withoutCaret(input,{width,height}){
 const out=Buffer.from(input),seen=new Uint8Array(width*height),dark=i=>input[i*4]<90&&input[i*4+1]<90&&input[i*4+2]<90;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const start=y*width+x;if(seen[start]||!dark(start))continue;
  const queue=[start];seen[start]=1;let left=x,right=x,top=y,bottom=y;
  for(let q=0;q<queue.length;q++){const i=queue[q],a=i%width,b=Math.floor(i/width);left=Math.min(left,a);right=Math.max(right,a);top=Math.min(top,b);bottom=Math.max(bottom,b);
   for(const [nx,ny]of [[a-1,b],[a+1,b],[a,b-1],[a,b+1]]){const j=ny*width+nx;if(nx>=0&&nx<width&&ny>=0&&ny<height&&!seen[j]&&dark(j)){seen[j]=1;queue.push(j)}}
  }
  const w=right-left+1,h=bottom-top+1;
  if(w<=Math.max(3,Math.round(height*.045))&&h>=Math.round(height*.28)&&h<=height*.6&&queue.length/(w*h)>.8){
   for(let b=Math.max(0,top-1);b<=Math.min(height-1,bottom+1);b++)for(let a=Math.max(0,left-1);a<=Math.min(width-1,right+1);a++)for(let c=0;c<3;c++)out[(b*width+a)*4+c]=255;
  }
 }
 return out;
}
async function captureEvidence(screen,capturePicture,options){
 // Hierarchy-only Bumble profile sections have no photo crop or comment field.
 // Derive their usual evidence so the controller hashes the same screen revision.
 const hierarchyOnly=screen.platform==='bumble'&&screen.kind==='profile'&&Array.isArray(screen.photos)
  &&screen.photos.length===0&&screen.controls&&!screen.controls.comment;
 return evidence(hierarchyOnly?null:await capturePicture(),screen,options);
}
async function evidence(picture,screen,{signal,ocr=readPngText,fromBitmap}={}){
 const hashes=(screen.photos||[]).map(p=>fingerprint(picture,p.bounds));
 const patchEvidence=screen.platform==='hinge' ? (screen.photos||[]).map(p=>photoPatchEvidence(picture,p.bounds,screen.kind)) : [];
 const result={hashes,patchEvidence,squareHashes:screen.kind==='like'?(screen.photos||[]).map(p=>squareFingerprint(picture,p.bounds)):[]};
 if(screen.kind==='like'&&screen.controls.comment){
  const b=screen.controls.comment.bounds,size=picture.getSize();
  if(b.x<0||b.y<0||b.x+b.width>size.width||b.y+b.height>size.height)throw Error('Comment field moved outside the screen.');
  const crop=picture.crop(b),clean=fromBitmap?fromBitmap(withoutCaret(crop.toBitmap(),crop.getSize()),crop.getSize()):crop;
  const text=(await ocr(clean.toPNG(),{signal})).replace(/\s+/g,' ').trim();
  if(!text)throw Object.assign(Error('The comment field could not be read. Nothing was sent.'),{code:'COMMENT_FIELD_UNREADABLE'});
  // The placeholder is grey; typed characters are dark. A narrow blinking caret is allowed.
  const bitmap=crop.toBitmap(),dimensions=crop.getSize();let darkColumns=0;
  for(let x=12;x<dimensions.width-12;x++){let dark=0;for(let y=12;y<dimensions.height-12;y++){const i=(y*dimensions.width+x)*4;if(bitmap[i]<90&&bitmap[i+1]<90&&bitmap[i+2]<90)dark++}if(dark>2)darkColumns++;}
  result.commentText=/^[il|]?addacomment$/i.test(text.replace(/\s+/g,''))&&darkColumns<=8?'':text;
  result.commentVisual=crypto.createHash('sha256').update(crop.toPNG()).digest('hex');
 }
 return result;
}
module.exports={fingerprint,squareFingerprint,photoPatchEvidence,sameClippedPhoto,overlapsPhotoPatch,captureEvidence,evidence,withoutCaret};
