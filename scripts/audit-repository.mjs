import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const required = [
  'README.md', 'LICENSE', 'NOTICE.md', 'CHANGELOG.md', 'CONTRIBUTING.md',
  'SECURITY.md', 'SUPPORT.md', 'CODE_OF_CONDUCT.md', 'RELEASING.md',
  'SKILL.md', 'package.json', 'package-lock.json', '.gitignore', '.gitattributes',
  '.editorconfig', '.github/workflows/ci.yml', '.github/workflows/pages.yml',
  '.github/workflows/release.yml', '.github/ISSUE_TEMPLATE/bug_report.yml',
  '.github/ISSUE_TEMPLATE/feature_request.yml', '.github/PULL_REQUEST_TEMPLATE.md',
  'assets/runtime/player.jsx', 'assets/runtime/player.js', 'assets/runtime/player.css',
  'assets/runtime/THIRD-PARTY-NOTICES.txt', 'assets/examples/ASSET-PROVENANCE.md',
  'docs/images/overview.png',
  'scripts/core.mjs', 'scripts/canvas.mjs', 'assets/runtime/theme.css', 'assets/runtime/build.mjs',
  'references/schema.md', 'references/qa.md', 'references/research.md',
];
const errors = [];
for (const relative of required) {
  try { await fs.access(path.join(root, relative)); }
  catch { errors.push(`missing required file: ${relative}`); }
}

const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
if (pkg.name !== '@infograb/canvas-presenter') errors.push(`unexpected package name: ${pkg.name}`);
if (pkg.license !== 'MIT') errors.push(`package license must be MIT, got ${pkg.license}`);
if (pkg.private !== true) errors.push('package.json must keep private: true until npm publishing is designed explicitly');
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(pkg.version)) errors.push(`invalid SemVer: ${pkg.version}`);
if (pkg.repository?.url !== 'git+https://github.com/infograb/canvas-presenter.git') errors.push('repository URL does not match infograb/canvas-presenter');
if (pkg.bin?.['canvas-presenter'] !== 'scripts/canvas.mjs') errors.push('CLI bin mapping is missing');

const cliMode = (await fs.stat(path.join(root, 'scripts', 'canvas.mjs'))).mode;
if ((cliMode & 0o111) === 0) errors.push('scripts/canvas.mjs is not executable');

const notices = await fs.readFile(path.join(root, 'assets/runtime/THIRD-PARTY-NOTICES.txt'), 'utf8');
for (const dependency of Object.keys(pkg.dependencies || {})) {
  if (!notices.includes(`===== ${dependency} `)) errors.push(`runtime notice missing direct dependency: ${dependency}`);
}

const skipDirectories = new Set(['.git', 'node_modules', 'dist', '.audit', 'browser-qa-output']);
const textExtensions = new Set(['.md', '.mjs', '.jsx', '.css', '.json', '.yml', '.yaml', '.txt']);
const skipFiles = new Set(['assets/runtime/player.js', 'assets/runtime/player.css', 'assets/runtime/THIRD-PARTY-NOTICES.txt', 'package-lock.json']);
const textFiles = [];
async function collect(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && skipDirectories.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    const relative = path.relative(root, absolute).split(path.sep).join('/');
    if (entry.isDirectory()) await collect(absolute);
    else if (entry.isFile() && textExtensions.has(path.extname(entry.name)) && !skipFiles.has(relative)) textFiles.push(relative);
  }
}
await collect(root);

const privatePatterns = [
  [/\/Users\/[^/\s]+\//, 'personal macOS absolute path'],
  [/(?:^|[\/])\.vault(?:[\/]|$)/m, 'private vault path'],
  [/orca\/workspaces/i, 'internal workspace path'],
  [/workspace\.ops\./i, 'internal workspace domain'],
  [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, 'private key'],
  [/gh[pousr]_[A-Za-z0-9_]{20,}/, 'GitHub token'],
  [/AKIA[0-9A-Z]{16}/, 'AWS access key'],
  [/AIza[0-9A-Za-z_-]{30,}/, 'Google API key'],
];
const markdownLink = /!?\[[^\]]*\]\(([^)]+)\)/g;
for (const relative of textFiles) {
  const absolute = path.join(root, relative);
  const source = await fs.readFile(absolute, 'utf8');
  for (const [pattern, label] of privatePatterns) {
    if (pattern.test(source)) errors.push(`${relative}: ${label}`);
  }
  if (path.extname(relative) !== '.md') continue;
  for (const match of source.matchAll(markdownLink)) {
    let target = match[1].trim();
    if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1);
    target = target.split(/\s+["']/)[0];
    if (!target || target.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
    const pathname = decodeURIComponent(target.split('#')[0].split('?')[0]);
    if (!pathname) continue;
    try { await fs.access(path.resolve(path.dirname(absolute), pathname)); }
    catch { errors.push(`${relative}: broken relative link ${target}`); }
  }
}

if (errors.length) {
  console.error(JSON.stringify({ valid: false, errors }, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ valid: true, version: pkg.version, requiredFiles: required.length, scannedTextFiles: textFiles.length, runtimeDependencies: Object.keys(pkg.dependencies || {}).length }, null, 2));
}
