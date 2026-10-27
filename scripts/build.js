const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');process.chdir(root);require('./check');
const out=path.join(root,'dist','spicyswipe');fs.mkdirSync(out,{recursive:true});
// Only the generated output folder is rebuilt; source and settings are never removed.
fs.rmSync(out,{recursive:true,force:true});fs.mkdirSync(out,{recursive:true});
for(const file of require('./files')){const target=path.join(out,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(root,file),target)}
const version=JSON.parse(fs.readFileSync('package.json')).version;const archive=path.join(root,'dist',`spicyswipe-${version}.zip`);fs.rmSync(archive,{force:true});
if(process.platform==='win32'){
  execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',
    '$ErrorActionPreference = "Stop"; Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::CreateFromDirectory($env:SPICYSWIPE_ZIP_SOURCE, $env:SPICYSWIPE_ZIP_TARGET)'],
    {windowsHide:true,env:{...process.env,SPICYSWIPE_ZIP_SOURCE:out,SPICYSWIPE_ZIP_TARGET:archive}});
}else{
  execFileSync('zip',['-q','-r',archive,'.'],{cwd:out});
}console.log(`Built unpacked extension: ${out}\nBuilt archive: ${archive}`);
