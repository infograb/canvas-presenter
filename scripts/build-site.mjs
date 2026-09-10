import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
let out = path.join(root, 'dist', 'site');
if (args.length) {
  if (args.length !== 2 || args[0] !== '--out') throw new Error('Usage: node scripts/build-site.mjs [--out DIRECTORY]');
  out = path.resolve(args[1]);
}
const relative = path.relative(root, out);
if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
  throw new Error('Site output must be a directory inside the repository');
}

await fs.rm(out, { recursive: true, force: true });
await fs.mkdir(out, { recursive: true });
for (const name of ['grouped', 'tree', 'sequence']) {
  await run(process.execPath, [
    path.join(root, 'scripts', 'canvas.mjs'),
    'build',
    path.join(root, 'assets', 'examples', `${name}.json`),
    '--out',
    path.join(out, name),
  ], { cwd: root });
}
const html = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Canvas Presenter examples</title><style>body{font-family:system-ui,sans-serif;max-width:760px;margin:8vh auto;padding:24px;color:#102731;background:#f7faf8}h1{font-size:clamp(32px,7vw,64px)}p{line-height:1.7}nav{display:grid;gap:12px;margin-top:32px}a{padding:18px 20px;border:1px solid #abc4b6;border-radius:10px;background:#fff;color:#116b5e;font-weight:700;text-decoration:none}a:hover{background:#eaf2ee}</style></head>
<body><h1>Canvas Presenter</h1><p>SVG, PNG, HTML 슬라이드를 오프라인 줌 캔버스와 전체 화면 슬라이드 쇼로 묶는 공개 예제입니다.</p><nav><a href="grouped/">Grouped canvas</a><a href="tree/">Tree canvas</a><a href="sequence/">Sequence canvas</a></nav><p><a href="https://github.com/infograb/canvas-presenter">Source on GitHub</a></p></body></html>\n`;
await fs.writeFile(path.join(out, 'index.html'), html);
console.log(`Built GitHub Pages site at ${out}`);
