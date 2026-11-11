'use strict';
// Anonymous raster fixture. Crops and resizes operate on already-quantized pixels.
function bitmapImage(width,height,bytes){
 const pixels=Buffer.from(bytes);
 if(pixels.length!==width*height*4)throw Error('Invalid bitmap fixture');
 return {
  getSize:()=>({width,height}),toBitmap:()=>Buffer.from(pixels),
  crop(rect){
   const {x,y,width:w,height:h}=rect;
   if(![x,y,w,h].every(Number.isSafeInteger)||x<0||y<0||w<1||h<1||x+w>width||y+h>height)throw Error('Crop outside fixture');
   const out=Buffer.alloc(w*h*4);
   for(let row=0;row<h;row++)pixels.copy(out,row*w*4,((y+row)*width+x)*4,((y+row)*width+x+w)*4);
   return bitmapImage(w,h,out);
  },
  resize({width:w,height:h}){
   const out=Buffer.alloc(w*h*4);
   for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const fx=Math.max(0,Math.min(width-1,(x+.5)*width/w-.5));
    const fy=Math.max(0,Math.min(height-1,(y+.5)*height/h-.5));
    const x0=Math.floor(fx),y0=Math.floor(fy),x1=Math.min(width-1,x0+1),y1=Math.min(height-1,y0+1),dx=fx-x0,dy=fy-y0;
    for(let c=0;c<4;c++)out[(y*w+x)*4+c]=Math.round(
     pixels[(y0*width+x0)*4+c]*(1-dx)*(1-dy)+pixels[(y0*width+x1)*4+c]*dx*(1-dy)+
     pixels[(y1*width+x0)*4+c]*(1-dx)*dy+pixels[(y1*width+x1)*4+c]*dx*dy);
   }
   return bitmapImage(w,h,out);
  }
 };
}
const scene=(u,v)=>[0,1,2].map(k=>Math.max(0,Math.min(255,Math.round(
 116+45*Math.sin(29*u+11*v+k)+38*Math.cos(17*v-13*u+k)+26*Math.cos(51*v+35*u)))));
function photoPicture(box,paint=scene){
 const width=Math.max(720,box.x+box.width),height=Math.max(1280,box.y+box.height),bytes=Buffer.alloc(width*height*4,255);
 const squareTop=box.y+box.height-box.width;
 for(let y=box.y;y<box.y+box.height;y++)for(let x=box.x;x<box.x+box.width;x++){
  const rgb=paint((x-box.x+.5)/box.width,(y-squareTop+.5)/box.width);
  for(let c=0;c<3;c++)bytes[(y*width+x)*4+c]=rgb[c];
 }
 return bitmapImage(width,height,bytes);
}
module.exports={bitmapImage,photoPicture,scene};
