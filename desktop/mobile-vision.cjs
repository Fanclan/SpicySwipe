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
function withoutCaret(input,{width,height}){
 const out=Buffer.from(input),seen=new Uint8Array(width*height),dark=i=>input[i*4]<90&&input[i*4+1]<90&&input[i*4+2]<90;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const start=y*width+x;if(seen[start]||!dark(start))continue;
  const queue=[start];seen[start]=1;let left=x,right=x,top=y,bottom=y;
  for(let q=0;q<queue.length;q++){const i=queue[q],a=i%width,b=Math.floor(i/width);left=Math.min(left,a);right=Math.max(right,a);top=Math.min(top,b);bottom=Math.max(bottom,b);
   for(const [nx,ny]of [[a-1,b],[a+1,b],[a,b-1],[a,b+1]]){const j=ny*width+nx;if(nx>=0&&nx<width&&ny>=0&&ny<height&&!seen[j]&&dark(j)){seen[j]=1;queue.push(j)}}
  }
  const w=right-left+1,h=bottom-top+1;
  if(w<=Math.max(3,Math.round(height*.045))&&h>=height*.28&&h<=height*.6&&queue.length/(w*h)>.8){
   for(let b=Math.max(0,top-1);b<=Math.min(height-1,bottom+1);b++)for(let a=Math.max(0,left-1);a<=Math.min(width-1,right+1);a++)for(let c=0;c<3;c++)out[(b*width+a)*4+c]=255;
  }
 }
 return out;
}
async function evidence(picture,screen,{signal,ocr=readPngText,fromBitmap}={}){
 const hashes=(screen.photos||[]).map(p=>fingerprint(picture,p.bounds));
 const result={hashes,squareHashes:screen.kind==='like'?(screen.photos||[]).map(p=>squareFingerprint(picture,p.bounds)):[]};
 if(screen.kind==='like'&&screen.controls.comment){
  const b=screen.controls.comment.bounds,size=picture.getSize();
  if(b.x<0||b.y<0||b.x+b.width>size.width||b.y+b.height>size.height)throw Error('Comment field moved outside the screen.');
  const crop=picture.crop(b),clean=fromBitmap?fromBitmap(withoutCaret(crop.toBitmap(),crop.getSize()),crop.getSize()):crop;
  const text=(await ocr(clean.toPNG(),{signal})).replace(/\s+/g,' ').trim();
  if(!text)throw Error('The comment field could not be read. Nothing was sent.');
  // The placeholder is grey; typed characters are dark. A narrow blinking caret is allowed.
  const bitmap=crop.toBitmap(),dimensions=crop.getSize();let darkColumns=0;
  for(let x=12;x<dimensions.width-12;x++){let dark=0;for(let y=12;y<dimensions.height-12;y++){const i=(y*dimensions.width+x)*4;if(bitmap[i]<90&&bitmap[i+1]<90&&bitmap[i+2]<90)dark++}if(dark>2)darkColumns++;}
  result.commentText=/^[il|]?addacomment$/i.test(text.replace(/\s+/g,''))&&darkColumns<=8?'':text;
  result.commentVisual=crypto.createHash('sha256').update(crop.toPNG()).digest('hex');
 }
 return result;
}
module.exports={fingerprint,squareFingerprint,evidence,withoutCaret};