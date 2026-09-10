// 커밋된 런타임 번들이 소스와 일치하는지 확인한다. 작업 트리는 바꾸지 않는다.
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = [
  'assets/runtime/player.js',
  'assets/runtime/player.css',
  'assets/runtime/THIRD-PARTY-NOTICES.txt',
];

const committed = new Map(await Promise.all(files.map(async (file) => [file, await fs.readFile(path.join(root, file))])));
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'canvas-presenter-generated-'));
const stale = [];
try {
  await run(process.execPath, [path.join(root, 'assets', 'runtime', 'build.mjs')], { cwd: root });
  for (const file of files) {
    const rebuilt = await fs.readFile(path.join(root, file));
    if (!committed.get(file).equals(rebuilt)) stale.push(file);
  }
} finally {
  // 트리를 검사 이전 상태로 되돌린다. 검사 스크립트가 커밋 대상을 바꾸면 안 된다.
  await Promise.all(files.map((file) => fs.writeFile(path.join(root, file), committed.get(file))));
  await fs.rm(scratch, { recursive: true, force: true });
}

if (stale.length > 0) {
  throw new Error(`Generated runtime is stale. Run "npm run build:runtime" and commit: ${stale.join(', ')}`);
}
console.log('Generated runtime files match their sources.');
