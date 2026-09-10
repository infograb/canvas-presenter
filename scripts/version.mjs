import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageFile = path.join(root, 'package.json');
const lockFile = path.join(root, 'package-lock.json');
const changelogFile = path.join(root, 'CHANGELOG.md');
const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

function fail(message) {
  throw new Error(message);
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

async function check(tag) {
  const [pkg, lock, changelog] = await Promise.all([
    readJson(packageFile),
    readJson(lockFile),
    fs.readFile(changelogFile, 'utf8'),
  ]);
  if (!semver.test(pkg.version)) fail(`package.json version is not valid SemVer: ${pkg.version}`);
  if (lock.version !== pkg.version) fail(`package-lock.json version ${lock.version} does not match ${pkg.version}`);
  if (lock.packages?.['']?.version !== pkg.version) fail(`package-lock root package version does not match ${pkg.version}`);
  if (lock.name !== pkg.name) fail(`package-lock.json name ${lock.name} does not match ${pkg.name}`);
  if (lock.packages?.['']?.name !== pkg.name) fail(`package-lock root package name does not match ${pkg.name}`);
  const escaped = pkg.version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!new RegExp(`^## \\[${escaped}\\](?: - |$)`, 'm').test(changelog)) {
    fail(`CHANGELOG.md has no release heading for ${pkg.version}`);
  }
  if (tag && tag !== `v${pkg.version}`) fail(`tag ${tag} does not match package version v${pkg.version}`);
  console.log(JSON.stringify({ valid: true, version: pkg.version, tag: tag || null }, null, 2));
}

async function setVersion(next) {
  if (!next || !semver.test(next)) fail(`set requires a valid SemVer value, got ${String(next)}`);
  const [pkgText, lockText] = await Promise.all([
    fs.readFile(packageFile, 'utf8'),
    fs.readFile(lockFile, 'utf8'),
  ]);
  const pkg = JSON.parse(pkgText);
  const lock = JSON.parse(lockText);
  if (!lock.packages?.['']) fail('package-lock.json has no root package entry');
  const writes = [];
  if (pkg.version !== next) {
    pkg.version = next;
    writes.push(fs.writeFile(packageFile, `${JSON.stringify(pkg, null, 2)}\n`));
  }
  if (lock.version !== next || lock.packages[''].version !== next) {
    writes.push(fs.writeFile(lockFile, patchLockfileVersions(lockText, lock.version, lock.packages[''].version, next)));
  }
  await Promise.all(writes);
  console.log(`Set package and lockfile versions to ${next}. Add a matching CHANGELOG.md release heading before committing.`);
}

function replaceLockVersion(text, pattern, current, next, error) {
  const match = text.match(pattern);
  if (!match) fail(error);
  if (match[2] !== current) fail(`${error}: text ${match[2]} does not match parsed ${current}`);
  return text.replace(pattern, `$1${next}$3`);
}

function patchLockfileVersions(text, rootVersion, packageRootVersion, next) {
  let patched = text;
  if (rootVersion !== next) {
    patched = replaceLockVersion(
      patched,
      /^(\{\n  "name": "[^"]+",\n  "version": ")([^"]+)(")/,
      rootVersion,
      next,
      'package-lock.json root version is not in a surgically editable position',
    );
  }
  if (packageRootVersion !== next) {
    patched = replaceLockVersion(
      patched,
      /(\n    "": \{\n(?:      "name": "[^"]+",\n)?      "version": ")([^"]+)(")/,
      packageRootVersion,
      next,
      'package-lock.json has no root package entry in a surgically editable position',
    );
  }
  return patched;
}

const [command = 'check', ...args] = process.argv.slice(2);
try {
  if (command === 'check') {
    let tag = null;
    if (args.length) {
      if (args.length !== 2 || args[0] !== '--tag') fail('Usage: node scripts/version.mjs check [--tag vX.Y.Z]');
      tag = args[1];
    }
    await check(tag);
  } else if (command === 'set') {
    if (args.length !== 1) fail('Usage: node scripts/version.mjs set X.Y.Z');
    await setVersion(args[0]);
  } else {
    fail('Usage: node scripts/version.mjs check [--tag vX.Y.Z] | set X.Y.Z');
  }
} catch (error) {
  process.stderr.write(`version: ${error.message}\n`);
  process.exitCode = 1;
}
