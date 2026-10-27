'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { readPngText } = require('../desktop/windows-ocr.cjs');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1WQAAAAASUVORK5CYII=', 'base64');
function sandbox(t) {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'spicyswipe-ocr-test-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true})); return root;
}
function fakeExec(handler) { return (file,args,settings,callback)=>{handler({file,args,settings,callback});return {kill(){return true;}};}; }

test('local OCR uses only a static hidden PowerShell script, bounded PNG temp, and cleans up',async t=>{
 const tempRoot=sandbox(t);let fileSeen;
 const text=await readPngText(png,{platform:'win32',tempRoot,execFile:fakeExec(({file,args,settings,callback})=>{
  assert.match(file,/WindowsPowerShell[\\/]v1\.0[\\/]powershell\.exe$/i);assert.equal(settings.windowsHide,true);assert.equal(settings.shell,false);assert.ok(settings.timeout<=15000);assert.ok(settings.maxBuffer<=65536);
  const script=args[args.indexOf('-File')+1];assert.equal(path.basename(script),'windows-ocr.ps1');assert.equal(args.includes('-Command'),false);
  fileSeen=args[args.indexOf('-ImagePath')+1];assert.ok(fileSeen.startsWith(tempRoot));assert.deepEqual(fs.readFileSync(fileSeen),png);
  callback(null,JSON.stringify({ok:true,text:'Add a comment',language:'en-US'}),'');
 })});
 assert.equal(text,'Add a comment');assert.equal(fs.existsSync(fileSeen),false);assert.deepEqual(fs.readdirSync(tempRoot),[]);
});

test('rejects unsupported platforms, malformed and oversized images before starting a process',async()=>{
 let calls=0;const options={platform:'win32',execFile:()=>{calls++;}};
 await assert.rejects(readPngText(png,{...options,platform:'darwin'}),/Windows|unsupported/i);
 for(const invalid of [null,'image',Buffer.from('not PNG'),Buffer.alloc(2*1024*1024+1)])await assert.rejects(readPngText(invalid,options),/PNG|image|size/i);
 const huge=Buffer.from(png);huge.writeUInt32BE(99999,16);await assert.rejects(readPngText(huge,options),/size|dimensions/i);
 assert.equal(calls,0);
});

test('unavailable installed OCR language and malformed output fail closed and remove image',async t=>{
 const tempRoot=sandbox(t);
 for(const output of [JSON.stringify({ok:false,code:'unsupported'}),'not JSON',JSON.stringify({ok:true,text:'x'.repeat(9000)}),JSON.stringify({ok:true,text:'text\u0000'})]){
  await assert.rejects(readPngText(png,{platform:'win32',tempRoot,execFile:fakeExec(({callback})=>callback(null,output,''))}),/OCR|Windows|unsupported/i);
  assert.deepEqual(fs.readdirSync(tempRoot),[]);
 }
});

test('abort and timeout never expose a late OCR result and always remove the cropped image',async t=>{
 const tempRoot=sandbox(t),controller=new AbortController();controller.abort();let called=false;
 await assert.rejects(readPngText(png,{platform:'win32',tempRoot,signal:controller.signal,execFile:()=>{called=true;}}),/cancel|abort/i);assert.equal(called,false);
 const late=new AbortController();let entered;const ready=new Promise(r=>entered=r);let finish;
 const pending=readPngText(png,{platform:'win32',tempRoot,signal:late.signal,execFile:fakeExec(({callback})=>{finish=callback;entered();})});
 await ready;late.abort();finish(null,JSON.stringify({ok:true,text:'late',language:'en-US'}),'');await assert.rejects(pending,/cancel|abort/i);assert.deepEqual(fs.readdirSync(tempRoot),[]);
 await assert.rejects(readPngText(png,{platform:'win32',tempRoot,timeoutMs:1000,execFile:fakeExec(({callback})=>callback(Object.assign(new Error('private text'),{killed:true}),'',''))}),/timed out/i);assert.deepEqual(fs.readdirSync(tempRoot),[]);
});

test('native Windows OCR recognizes synthetic placeholder and nonempty comment text', {skip:process.platform!=='win32'},async t=>{
 const tempRoot=sandbox(t),generator=path.join(tempRoot,'synthetic.ps1');
 fs.writeFileSync(generator,`param([string]$Destination,[string]$Text)\nAdd-Type -AssemblyName System.Drawing\n$bitmap=New-Object System.Drawing.Bitmap 700,130\n$graphics=[Drawing.Graphics]::FromImage($bitmap)\n$graphics.Clear([Drawing.Color]::White)\n$font=New-Object Drawing.Font 'Arial',36\n$graphics.DrawString($Text,$font,[Drawing.Brushes]::Black,20,30)\n$bitmap.Save($Destination,[Drawing.Imaging.ImageFormat]::Png)\n$font.Dispose();$graphics.Dispose();$bitmap.Dispose()\n`);
 const powershell=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
 for(const expected of ['Add a comment','Test']){
  const target=path.join(tempRoot,'synthetic.png');
  await promisify(execFile)(powershell,['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',generator,'-Destination',target,'-Text',expected],{windowsHide:true,timeout:15000});
  assert.equal((await readPngText(fs.readFileSync(target),{tempRoot})).trim(),expected);
 }
});

test('packaged helper resolves its static PowerShell script outside app.asar',async t=>{
 const tempRoot=sandbox(t),packedDir=path.join(tempRoot,'app.asar','desktop');fs.mkdirSync(packedDir,{recursive:true});
 const modulePath=path.join(packedDir,'windows-ocr.cjs');fs.copyFileSync(path.join(__dirname,'../desktop/windows-ocr.cjs'),modulePath);
 const packaged=require(modulePath);
 await packaged.readPngText(png,{platform:'win32',tempRoot,execFile:fakeExec(({args,callback})=>{
  // require() resolves macOS /var aliases to /private/var before setting __dirname.
  assert.equal(args[args.indexOf('-File')+1],path.join(fs.realpathSync(tempRoot),'app.asar.unpacked','desktop','windows-ocr.ps1'));
  callback(null,JSON.stringify({ok:true,text:'Test',language:'en-US'}),'');
 })});
});

test('native child cancellation terminates PowerShell and removes its transient crop', {skip:process.platform!=='win32'},async t=>{
 const tempRoot=sandbox(t),controller=new AbortController();let child,started;
 const ready=new Promise(r=>started=r);
 const pending=readPngText(png,{signal:controller.signal,tempRoot,execFile:(file,args,settings,callback)=>{child=execFile(file,args,settings,callback);started();return child;}});
 await ready;controller.abort();await assert.rejects(pending,/cancel|abort/i);assert.equal(child.killed,true);assert.deepEqual(fs.readdirSync(tempRoot),[]);
});
