import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const ignored=new Set(['.git','node_modules','dist','release','.local','coverage','playwright-report','test-results']);
let files=[];
try{files=[...new Set(execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}).split('\0').filter(Boolean))];}
catch{function walk(dir=''){for(const e of fs.readdirSync(path.join(root,dir),{withFileTypes:true})){const p=path.posix.join(dir,e.name);if(e.isDirectory()){if(!ignored.has(e.name))walk(p);}else if(p!=='server/cache.bundle.mjs')files.push(p);}}walk();}
const rules=[
 ['private key',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
 ['GitHub token',/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/],
 ['AWS access key',/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
 ['personal RPC endpoint',/https?:\/\/lb\.drpc\.live\/(?:[^\s"'<>]+|\?[^\s"'<>]+)/i],
 ['private home path',/(?:[A-Z]:[\\/]Users[\\/](?!Public[\\/])[^\s"']+|\/(?:home|Users)\/(?!example\b)[^\s"']+)/i],
 ['credential in URL',/https?:\/\/[^\s/@:]+:[^\s/@]+@/i],
 ['secret query',/[?&](?:dkey|api_key|apikey|token|secret|password)=[A-Za-z0-9_%-]{12,}/i],
 ['production credential',/(?:password|passwd|private[_-]?key|api[_-]?key|secret)\s*[:=]\s*["'][A-Za-z0-9_+\/=.-]{16,}["']/i],
];
const failures=[];
for(const f of files){
 if(/(?:^|\/)(?:\.local|node_modules|dist|release|cache-data|data)(?:\/|$)|(?:^|\/)\.env(?:\.|$)|\.(?:pem|key|p12|pfx|zip|tgz|log)$|server\/cache\.bundle\.mjs$/.test(f)&&!f.endsWith('.env.example')){failures.push(f+': excluded artifact');continue;}
 const target=path.join(root,f);if(!fs.existsSync(target))continue;
 const bytes=fs.readFileSync(target);if(bytes.includes(0)){failures.push(f+': unexpected binary');continue;}
 const lines=bytes.toString('utf8').split(/\r?\n/);
 for(let i=0;i<lines.length;i++)for(const [name,pattern]of rules)if(pattern.test(lines[i]))failures.push(f+':'+(i+1)+': '+name);
}
if(failures.length){console.error('Public source check failed (matching values withheld):\n'+failures.join('\n'));process.exitCode=1;}
else console.log('Public source check passed: '+files.length+' source files reviewed. Review staged changes manually as well.');
