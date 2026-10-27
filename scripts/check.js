const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
process.chdir(path.resolve(__dirname,'..'));
const files=require('./files');let errors=[];
for(const file of files){if(!fs.existsSync(file)){errors.push('Missing runtime file: '+file);continue}if(file.endsWith('.js'))try{execFileSync(process.execPath,['--check',file],{stdio:'pipe'})}catch(e){errors.push(e.stderr.toString())}}
const manifest=JSON.parse(fs.readFileSync('manifest.json'));const pkg=JSON.parse(fs.readFileSync('package.json'));
if(manifest.version!==pkg.version)errors.push('Package and manifest versions differ.');
if(manifest.manifest_version!==3)errors.push('Manifest V3 is required.');
const declared=[manifest.background.service_worker,manifest.action.default_popup,manifest.options_ui.page,...Object.values(manifest.icons),...manifest.content_scripts.flatMap(s=>[...(s.js||[]),...(s.css||[])]),...manifest.web_accessible_resources.flatMap(s=>s.resources)];
for(const f of declared)if(!files.includes(f))errors.push('Manifest file excluded from build: '+f);
for(const html of files.filter(f=>f.endsWith('.html'))){const source=fs.readFileSync(html,'utf8');for(const match of source.matchAll(/(?:src|href)="([^"#]+)"/g)){if(/^https?:/.test(match[1]))continue;const dep=path.posix.normalize(path.posix.join(path.posix.dirname(html),match[1]));if(!files.includes(dep))errors.push(html+' references unbundled '+dep)}if(/<script\s*>/i.test(source))errors.push('Inline script violates CSP in '+html)}
for(const dir of ['shared','ui','popup','content'])for(const file of files.filter(f=>f.startsWith(dir+'/')&&f.endsWith('.js'))){if(/\beval\s*\(|new Function\(/.test(fs.readFileSync(file,'utf8')))errors.push('Unsafe dynamic code in '+file)}
if(errors.length){console.error(errors.join('\n'));process.exit(1)}console.log(`Checks passed: ${files.length} runtime files, JavaScript syntax, manifest references, HTML assets, version consistency and CSP-compatible scripts.`);
