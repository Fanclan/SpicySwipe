'use strict';
const path=require('node:path');
const fs=require('node:fs');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
for(const file of ['desktop/main.cjs','desktop/mobile-controller.cjs','desktop/mobile-config.cjs','desktop/mobile-screen.cjs','desktop/mobile-chat.cjs','desktop/mobile-vision.cjs','desktop/windows-ocr.cjs','desktop/mobile-automation.js','desktop/android-preload.cjs','desktop/android-controls.js','desktop/android-renderer.js','desktop/preload.cjs','desktop/renderer.js','desktop/service.cjs','desktop/android.cjs','desktop/policy.cjs'])execFileSync(process.execPath,['--check',path.join(root,file)]);
require('esbuild').buildSync({entryPoints:[path.join(root,'desktop/tinder-preload-source.cjs')],bundle:true,platform:'node',format:'cjs',external:['electron'],target:'chrome140',outfile:path.join(root,'desktop/generated/tinder-preload.cjs')});
for(const page of ['desktop/index.html','desktop/android.html']){
const html=fs.readFileSync(path.join(root,page),'utf8');
for(const m of html.matchAll(/(?:src|href)="([^"#]+)"/g)){if(!fs.existsSync(path.resolve(root,'desktop',m[1])))throw Error('Missing desktop asset: '+m[1]);}
}
console.log('Desktop sources checked; isolated Tinder preload bundled.');
