import {build} from 'esbuild';
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {dirname,join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const here=dirname(fileURLToPath(import.meta.url));
const root=resolve(here,'../..');
const outfile=join(here,'player.js');
const result=await build({
  absWorkingDir:root,
  entryPoints:[join(here,'player.jsx')],
  outfile,
  bundle:true,
  minify:true,
  format:'iife',
  platform:'browser',
  target:['chrome110','safari16'],
  legalComments:'inline',
  define:{'process.env.NODE_ENV':'"production"'},
  metafile:true,
});
function packageFromInput(input){
  const parts=input.split(/[/\\]/);
  const i=parts.lastIndexOf('node_modules');
  if(i<0||i+1>=parts.length)return null;
  const scoped=parts[i+1].startsWith('@');
  if(scoped&&i+2>=parts.length)return null;
  const end=scoped?i+3:i+2;
  return {name:parts.slice(i+1,end).join('/'),dir:parts.slice(0,end).join(sep)};
}
const names=new Map();
for(const output of Object.values(result.metafile.outputs)){
  for(const [input,info] of Object.entries(output.inputs||{})){
    if(!info.bytesInOutput)continue;
    const pkg=packageFromInput(input);
    if(pkg&&!names.has(pkg.name))names.set(pkg.name,pkg.dir);
  }
}
const notices=['Canvas Presenter bundled runtime: third-party license notices.\nRebuild with npm ci && npm run build:runtime.\n'];
for(const [name,dir] of [...names.entries()].sort(([a],[b])=>a.localeCompare(b))){
  const abs=resolve(root,dir);
  const pkg=JSON.parse(await readFile(join(abs,'package.json'),'utf8'));
  const files=(await readdir(abs)).filter(n=>/^(license|licence|copying|copyright)(\.|$)/i.test(n));
  if(!files.length)throw new Error(`Missing license notice for ${name}`);
  notices.push(`\n===== ${pkg.name} ${pkg.version} (${pkg.license||'see license'}) =====\n`);
  for(const file of files)notices.push(await readFile(join(abs,file),'utf8'));
}
await writeFile(join(here,'THIRD-PARTY-NOTICES.txt'),notices.join('\n'));
console.log(`Bundled player.js/player.css. Preserved notices for ${names.size} runtime packages.`);
