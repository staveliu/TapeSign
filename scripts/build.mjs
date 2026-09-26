import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'vite';
import {releaseId,sha256} from './release.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),release=releaseId(root);
await build({configFile:false,root,base:'./',publicDir:false,define:{__RELEASE__:JSON.stringify(release)},build:{outDir:'dist',emptyOutDir:true,rollupOptions:{input:path.join(root,'index.html'),output:{inlineDynamicImports:true}}}});
const dist=path.join(root,'dist'),html=fs.readFileSync(path.join(dist,'index.html'),'utf8');
const versionPath=`client-${release.slice(2)}.html`;
// Identical entry at a content-versioned path; uploaded before the mutable homepage.
fs.writeFileSync(path.join(dist,versionPath),html);
const files=[];
function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const file=path.join(dir,e.name);if(e.isDirectory())walk(file);else {const bytes=fs.readFileSync(file);files.push({path:path.relative(dist,file).split(path.sep).join('/'),size:bytes.length,sha256:sha256(bytes),contentType:({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'})[path.extname(file)]});}}}
walk(dist);
const manifest={protocol:'TAPESIGN-RELEASE-1',site:'4.2.204.tape',release,versionPath,files};
fs.writeFileSync(path.join(dist,'release.json'),JSON.stringify(manifest,null,2)+'\n');
fs.mkdirSync(path.join(root,'.local'),{recursive:true});
let portable=html.replace(/<script type="module"[^>]*src="([^"]+)"[^>]*><\/script>/g,(_,src)=>'<script type="module">'+fs.readFileSync(path.join(dist,src),'utf8').replace(/<\/script/gi,'<\\/script')+'</script>');
portable=portable.replace(/<link rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g,(_,src)=>'<style>'+fs.readFileSync(path.join(dist,src),'utf8')+'</style>');
fs.writeFileSync(path.join(root,'.local',`TapeSign-${release.slice(2,14)}-standalone.html`),portable);
console.log(JSON.stringify({release,files:files.length,bytes:files.reduce((n,f)=>n+f.size,0),versionPath,standalone:`.local/TapeSign-${release.slice(2,14)}-standalone.html`},null,2));
