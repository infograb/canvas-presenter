import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
let out = path.join(root, 'dist', 'release');
let ref = 'HEAD';
for (let index = 0; index < args.length; index += 2) {
  const name = args[index];
  const value = args[index + 1];
  if (!value || !['--out', '--ref'].includes(name)) throw new Error('Usage: node scripts/package-release.mjs [--out DIRECTORY] [--ref GIT_REF]');
  if (name === '--out') out = path.resolve(value);
  if (name === '--ref') ref = value;
}
const relative = path.relative(root, out);
if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Release output must be inside the repository');

const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
if (ref.startsWith('v')) {
  await run(process.execPath, [path.join(root, 'scripts', 'version.mjs'), 'check', '--tag', ref], { cwd: root });
} else {
  await run(process.execPath, [path.join(root, 'scripts', 'version.mjs'), 'check'], { cwd: root });
}
const { stdout: gitRootOutput } = await run('git', ['rev-parse', '--show-toplevel'], { cwd: root });
const gitRoot = gitRootOutput.trim();
const repositoryPath = path.relative(gitRoot, root).split(path.sep).join('/');
if (repositoryPath.startsWith('../') || path.isAbsolute(repositoryPath)) throw new Error('Skill root must be inside the Git worktree');
if (ref === 'HEAD') {
  const statusArgs = ['status', '--porcelain', '--untracked-files=all'];
  if (repositoryPath) statusArgs.push('--', repositoryPath);
  const { stdout } = await run('git', statusArgs, { cwd: gitRoot });
  if (stdout.trim()) throw new Error('Refusing to package a dirty Canvas Presenter worktree');
}
const { stdout: commitOutput } = await run('git', ['rev-parse', `${ref}^{commit}`], { cwd: gitRoot });
const commit = commitOutput.trim();
const treeish = repositoryPath ? `${ref}:${repositoryPath}` : ref;
const prefix = `canvas-presenter-v${pkg.version}/`;
await fs.rm(out, { recursive: true, force: true });
await fs.mkdir(out, { recursive: true });
const archives = [
  { format: 'tar.gz', name: `canvas-presenter-v${pkg.version}.tar.gz` },
  { format: 'zip', name: `canvas-presenter-v${pkg.version}.zip` },
];
for (const archive of archives) {
  await run('git', ['archive', `--format=${archive.format}`, `--prefix=${prefix}`, '-o', path.join(out, archive.name), treeish], { cwd: gitRoot });
}
async function digest(file) {
  const bytes = await fs.readFile(file);
  return { sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length };
}
const files = [];
for (const archive of archives) files.push({ name: archive.name, ...await digest(path.join(out, archive.name)) });
const manifest = {
  project: 'canvas-presenter',
  version: pkg.version,
  repository: 'https://github.com/infograb/canvas-presenter',
  ref,
  commit,
  files,
};
const manifestFile = path.join(out, 'release-manifest.json');
await fs.writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
const checksumFiles = [...files, { name: 'release-manifest.json', ...await digest(manifestFile) }];
await fs.writeFile(path.join(out, 'SHA256SUMS'), `${checksumFiles.map(file => `${file.sha256}  ${file.name}`).join('\n')}\n`);
console.log(JSON.stringify({ output: out, version: pkg.version, commit, files: checksumFiles }, null, 2));
