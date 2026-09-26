import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
await build({entryPoints:[root+'/server/main.mjs'],bundle:true,platform:'node',format:'esm',target:'node20',outfile:root+'/server/cache.bundle.mjs',define:{__RELEASE__:JSON.stringify('server-cache-v2')}});
console.log('Built self-contained TapeSign cache for Node 20');
