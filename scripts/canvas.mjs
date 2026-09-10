#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { compileManifest, inferPngDimensions, inferSvgDimensions, inlineSvgReferences, svgExternalReferences } from './core.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.dirname(SCRIPT_DIR);
const RUNTIME_DIR = path.join(SKILL_ROOT, 'assets', 'runtime');
const MARKER = '.canvas-presenter-inline.json';
const INLINE_MARKER_VERSION = 2;
const MIME = new Map([
  ['.html', 'text/html; charset=utf-8'], ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'], ['.svg', 'image/svg+xml; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'], ['.css', 'text/css; charset=utf-8'],
  ['.txt', 'text/plain; charset=utf-8'],
]);

function usage() {
  return `Usage:
  node scripts/canvas.mjs inventory INPUT_DIR
  node scripts/canvas.mjs inline INPUT_DIR --out DIRECTORY [--force]
  node scripts/canvas.mjs validate MANIFEST
  node scripts/canvas.mjs build MANIFEST --out DIRECTORY [--force]
  node scripts/canvas.mjs serve DIRECTORY [--port 4500|auto]`;
}

function fail(message) {
  throw new Error(message);
}

async function readManifest(file) {
  let text;
  try { text = await fs.readFile(file, 'utf8'); }
  catch (error) { fail(`cannot read manifest "${file}": ${error.code || error.message}`); }
  try { return JSON.parse(text); }
  catch (error) { fail(`invalid JSON in manifest "${file}": ${error.message}`); }
}

async function compileFile(file) {
  const absolute = path.resolve(file);
  const stat = await fs.stat(absolute).catch((error) => fail(`manifest does not exist: "${file}" (${error.code || error.message})`));
  if (!stat.isFile()) fail(`manifest is not a file: "${file}"`);
  const manifest = await readManifest(absolute);
  return { absolute, manifest, payload: await compileManifest(manifest, path.dirname(absolute)) };
}

async function collectMedia(root) {
  const found = [];
  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const absolute = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase().slice(1);
        if (['svg', 'png', 'html', 'htm'].includes(ext)) {
          found.push({ absolute, path: path.relative(root, absolute).split(path.sep).join('/'), format: ext === 'htm' ? 'html' : ext });
        }
      }
    }
  }
  await walk(root);
  found.sort((a, b) => a.path.localeCompare(b.path));
  return found;
}

async function inventory(input) {
  const root = await fs.realpath(path.resolve(input)).catch((error) => fail(`input directory does not exist: "${input}" (${error.code || error.message})`));
  if (!(await fs.stat(root)).isDirectory()) fail(`inventory input is not a directory: "${input}"`);
  const media = await collectMedia(root);
  const referencedBy = new Map();
  const report = [];
  for (const item of media) {
    const entry = { path: item.path, format: item.format };
    try {
      if (item.format === 'svg') {
        const svg = await fs.readFile(item.absolute, 'utf8');
        Object.assign(entry, mediaDimensions(svg, item));
        const refs = svgExternalReferences(svg);
        if (refs.length > 0) {
          entry.externalReferences = refs;
          entry.blocked = 'external references must be inlined; run "canvas.mjs inline" first';
          for (const ref of refs) {
            const target = path.relative(root, path.resolve(path.dirname(item.absolute), ref)).split(path.sep).join('/');
            if (!referencedBy.has(target)) referencedBy.set(target, []);
            referencedBy.get(target).push(item.path);
          }
        }
      } else if (item.format === 'png') {
        Object.assign(entry, mediaDimensions(await fs.readFile(item.absolute), item));
      } else {
        entry.note = 'html slides need explicit width and height plus a rendered poster';
      }
    } catch (error) {
      entry.error = error.message;
    }
    report.push(entry);
  }
  const known = new Set(report.map((entry) => entry.path));
  for (const entry of report) {
    const sources = referencedBy.get(entry.path);
    if (sources) entry.referencedBy = sources;
  }
  const missing = [...referencedBy.keys()].filter((target) => !known.has(target)).sort();
  const counts = {
    media: report.length,
    referenced: report.filter((entry) => entry.referencedBy).length,
    blocked: report.filter((entry) => entry.blocked).length,
    unreadable: report.filter((entry) => entry.error || entry.dimensionError).length,
  };
  process.stdout.write(`${JSON.stringify({ root, counts, files: report, ...(missing.length > 0 ? { unlistedReferences: missing } : {}) }, null, 2)}\n`);
}

function mediaDimensions(source, item) {
  try {
    return item.format === 'svg' ? inferSvgDimensions(source, item.path) : inferPngDimensions(source, item.path);
  } catch (error) {
    return { dimensionError: error.message };
  }
}

function outsideOf(base, candidate) {
  const relative = path.relative(base, candidate);
  return relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
}

async function inlineDirectory(inputArg, outArg, force) {
  const root = await fs.realpath(path.resolve(inputArg)).catch((error) => fail(`input directory does not exist: "${inputArg}" (${error.code || error.message})`));
  if (!(await fs.stat(root)).isDirectory()) fail(`inline input is not a directory: "${inputArg}"`);
  const out = path.resolve(outArg);
  if (!outsideOf(root, out)) fail('output directory must be outside the input directory');
  if (!outsideOf(out, root)) fail('output directory must not contain the input directory');

  let exists = false;
  let outStat;
  try { outStat = await fs.lstat(out); exists = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (exists && !force) fail(`output already exists: "${out}" (use --force to replace it)`);
  if (exists && outStat.isSymbolicLink()) fail(`refusing to replace symlink output: "${out}"`);
  if (exists) {
    if (!outStat.isDirectory()) fail(`output is not a directory: "${out}"`);
    const marker = await fs.readFile(path.join(out, MARKER), 'utf8').then(JSON.parse).catch(() => null);
    if (marker?.generator !== 'canvas-presenter-inline') fail('refusing to replace an unowned directory; choose a new empty destination');
    if (marker.version !== INLINE_MARKER_VERSION || !Array.isArray(marker.files)) {
      fail(`"${out}" was written by an older inline run that did not record its files; delete the directory and run inline again`);
    }
    const owned = new Set([MARKER, ...marker.files]);
    const extra = (await listRelativeFiles(out)).filter((name) => !owned.has(name));
    if (extra.length > 0) fail(`output contains files this command did not create (${extra.slice(0, 3).join(', ')}${extra.length > 3 ? ', …' : ''}); refusing to delete user data`);
  }

  const entries = [];
  async function walk(dir) {
    for (const entry of (await fs.readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile()) entries.push(absolute);
    }
  }
  await walk(root);

  const relatives = entries.map((absolute) => path.relative(root, absolute).split(path.sep).join('/'));
  const temp = `${out}.canvas-presenter-tmp-${process.pid}-${Date.now()}`;
  await fs.rm(temp, { recursive: true, force: true });
  const rewritten = [];
  try {
    await fs.mkdir(temp, { recursive: true });
    for (const [index, absolute] of entries.entries()) {
      const relative = relatives[index];
      const target = path.join(temp, relative);
      await fs.mkdir(path.dirname(target), { recursive: true });
      if (path.extname(absolute).toLowerCase() === '.svg') {
        const source = await fs.readFile(absolute, 'utf8');
        const { svg, references } = await inlineSvgReferences(source, path.dirname(absolute), root, `slide "${relative}"`);
        await fs.writeFile(target, svg, { flag: 'wx' });
        if (references.length > 0) rewritten.push({ path: relative, inlined: references });
      } else {
        await fs.copyFile(absolute, target);
      }
    }
    await fs.writeFile(path.join(temp, MARKER), `${JSON.stringify({ generator: 'canvas-presenter-inline', version: INLINE_MARKER_VERSION, files: relatives })}\n`, { flag: 'wx' });
  } catch (error) {
    await fs.rm(temp, { recursive: true, force: true });
    throw error;
  }
  await swapIntoPlace(temp, out, exists);
  process.stdout.write(`${JSON.stringify({ output: out, files: entries.length, rewritten }, null, 2)}\n`);
}

async function listRelativeFiles(dir) {
  const found = [];
  async function walk(current) {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory() && !entry.isSymbolicLink()) await walk(absolute);
      else found.push(path.relative(dir, absolute).split(path.sep).join('/'));
    }
  }
  await walk(dir);
  return found.sort();
}

async function swapIntoPlace(temp, out, replacing) {
  const aside = `${out}.canvas-presenter-old-${process.pid}-${Date.now()}`;
  if (replacing) await fs.rename(out, aside);
  try {
    await fs.rename(temp, out);
  } catch (error) {
    if (replacing) await fs.rename(aside, out).catch(() => {});
    await fs.rm(temp, { recursive: true, force: true });
    throw error;
  }
  if (replacing) await fs.rm(aside, { recursive: true, force: true });
}

export function safeJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function safeComment(value) {
  return value.replaceAll('--', '- -').replace(/-$/gm, '- ');
}

async function build(manifestArg, outArg, force) {
  const { absolute: manifestFile, manifest, payload } = await compileFile(manifestArg);
  const out = path.resolve(outArg);
  const manifestReal = await fs.realpath(manifestFile);
  const outRelToManifest = path.relative(out, manifestReal);
  if (outRelToManifest === '' || (!outRelToManifest.startsWith('..') && !path.isAbsolute(outRelToManifest))) {
    fail('output directory must not contain the source manifest');
  }
  const baseReal = await fs.realpath(path.dirname(manifestReal));
  if (out === baseReal) fail('output directory must not be the manifest source directory');

  let exists = false;
  let outStat;
  try { outStat = await fs.lstat(out); exists = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (exists && !force) fail(`output already exists: "${out}" (use --force to replace it)`);
  if (exists && outStat.isSymbolicLink()) fail(`refusing to replace symlink output: "${out}"`);
  if (exists) {
    if (!outStat.isDirectory()) fail(`output is not a directory: "${out}"`);
    const marker = await fs.readFile(path.join(out, '.canvas-presenter-output.json'), 'utf8').then(JSON.parse).catch(() => null);
    if (marker?.generator !== 'canvas-presenter' || marker.version !== 1) fail('refusing to replace an unowned output directory; choose a new empty destination');
    const allowed = new Set(['index.html', 'manifest.json', 'validation.json', 'THIRD-PARTY-NOTICES.txt', '.canvas-presenter-output.json']);
    const entries = await fs.readdir(out, { withFileTypes: true });
    if (entries.some(entry => !allowed.has(entry.name) || !entry.isFile())) fail('output contains additional or non-regular files; refusing to delete user data');
    const outReal = await fs.realpath(out);
    function checkSource(node) {
      for (const source of [node.src, node.poster].filter(Boolean)) {
        const relative = path.relative(outReal, path.resolve(baseReal, source));
        if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) fail('output directory contains an input asset; refusing to replace source data');
      }
      (node.children || []).forEach(checkSource);
    }
    checkSource(manifest.canvas);
  }

  let runtimeJs;
  let runtimeCss;
  try {
    [runtimeJs, runtimeCss] = await Promise.all([
      fs.readFile(path.join(RUNTIME_DIR, 'player.js'), 'utf8'),
      fs.readFile(path.join(RUNTIME_DIR, 'player.css'), 'utf8'),
    ]);
  } catch (error) {
    fail(`runtime assets are unavailable in ${RUNTIME_DIR}: ${error.code || error.message}`);
  }
  let notices = null;
  try { notices = await fs.readFile(path.join(RUNTIME_DIR, 'THIRD-PARTY-NOTICES.txt'), 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }

  const csp = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; frame-src 'self'; object-src 'none'; base-uri 'none'";
  const noticeComment = notices === null ? '' : `<!--\nTHIRD-PARTY NOTICES\n${safeComment(notices)}\n-->\n`;
  const html = `<!doctype html>\n<html lang="ko">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<meta http-equiv="Content-Security-Policy" content="${csp}">\n<title>${payload.title.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')}</title>\n<style>${runtimeCss.replace(/<\/style/gi, '<\\/style')}</style>\n</head>\n<body>\n<div id="root"></div>\n<script id="canvas-data" type="application/json">${safeJson(payload)}</script>\n<script>${runtimeJs.replace(/<\/script/gi, '<\\/script')}</script>\n</body>\n</html>\n${noticeComment}`;

  const temp = `${out}.canvas-presenter-tmp-${process.pid}-${Date.now()}`;
  await fs.rm(temp, { recursive: true, force: true });
  try {
    await fs.mkdir(temp, { recursive: true });
    await Promise.all([
      fs.writeFile(path.join(temp, '.canvas-presenter-output.json'), JSON.stringify({generator:'canvas-presenter',version:1})+'\n', { flag: 'wx' }),
      fs.writeFile(path.join(temp, 'index.html'), html, { flag: 'wx' }),
      fs.writeFile(path.join(temp, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' }),
      fs.writeFile(path.join(temp, 'validation.json'), `${JSON.stringify({ valid: true, counts: payload.counts, warnings: payload.warnings }, null, 2)}\n`, { flag: 'wx' }),
      ...(notices === null ? [] : [fs.writeFile(path.join(temp, 'THIRD-PARTY-NOTICES.txt'), notices, { flag: 'wx' })]),
    ]);
  } catch (error) {
    await fs.rm(temp, { recursive: true, force: true });
    throw error;
  }
  await swapIntoPlace(temp, out, exists);
  process.stdout.write(`${JSON.stringify({ output: out, counts: payload.counts, warnings: payload.warnings }, null, 2)}\n`);
}

function parsePort(raw) {
  if (raw === undefined) return 4500;
  if (raw === 'auto') return 'auto';
  if (!/^\d+$/.test(raw)) fail(`port must be "auto" or an integer from 1 to 65535, got "${raw}"`);
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) fail(`port must be "auto" or an integer from 1 to 65535, got "${raw}"`);
  return port;
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => { server.removeListener('listening', onListening); reject(error); };
    const onListening = () => { server.removeListener('error', onError); resolve(); };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
  });
}

async function freePort(start) {
  for (let candidate = start; candidate < Math.min(start + 64, 65536); candidate += 1) {
    const probe = http.createServer();
    try {
      await listen(probe, candidate);
      await new Promise((resolve) => probe.close(resolve));
      return candidate;
    } catch (error) {
      await new Promise((resolve) => probe.close(resolve));
      if (error.code !== 'EADDRINUSE') throw error;
    }
  }
  return null;
}

async function serve(directory, port) {
  const root = await fs.realpath(path.resolve(directory)).catch((error) => fail(`serve directory does not exist: "${directory}" (${error.code || error.message})`));
  if (!(await fs.stat(root)).isDirectory()) fail(`serve target is not a directory: "${directory}"`);
  const server = http.createServer(async (request, response) => {
    try {
      if (!['GET', 'HEAD'].includes(request.method)) {
        response.writeHead(405, { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('Method Not Allowed\n');
        return;
      }
      const rawPath = (request.url || '/').split(/[?#]/, 1)[0];
      let decoded;
      try { decoded = decodeURIComponent(rawPath); }
      catch { response.writeHead(400); response.end('Bad Request\n'); return; }
      if (decoded.includes('\\') || decoded.includes('\0') || decoded.split('/').includes('..')) {
        response.writeHead(403); response.end('Forbidden\n'); return;
      }
      const relative = decoded.replace(/^\/+/, '') || 'index.html';
      let candidate = path.resolve(root, relative);
      const lexical = path.relative(root, candidate);
      if (lexical.startsWith('..') || path.isAbsolute(lexical)) { response.writeHead(403); response.end('Forbidden\n'); return; }
      let real;
      try { real = await fs.realpath(candidate); }
      catch { response.writeHead(404); response.end('Not Found\n'); return; }
      const contained = path.relative(root, real);
      if (contained.startsWith('..') || path.isAbsolute(contained)) { response.writeHead(403); response.end('Forbidden\n'); return; }
      let stat = await fs.stat(real);
      if (stat.isDirectory()) {
        real = await fs.realpath(path.join(real, 'index.html')).catch(() => null);
        if (!real) { response.writeHead(404); response.end('Not Found\n'); return; }
        const indexContained = path.relative(root, real);
        if (indexContained.startsWith('..') || path.isAbsolute(indexContained)) { response.writeHead(403); response.end('Forbidden\n'); return; }
        stat = await fs.stat(real);
      }
      if (!stat.isFile()) { response.writeHead(404); response.end('Not Found\n'); return; }
      const type = MIME.get(path.extname(real).toLowerCase());
      if (!type) { response.writeHead(415); response.end('Unsupported Media Type\n'); return; }
      const body = request.method === 'HEAD' ? null : await fs.readFile(real);
      response.writeHead(200, {
        'Content-Type': type,
        'Content-Length': stat.size,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      response.end(body);
    } catch (error) {
      response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end(`Internal Server Error: ${error.message}\n`);
    }
  });
  let bound = null;
  if (port === 'auto') {
    for (let candidate = 4500; candidate < 4564 && bound === null; candidate += 1) {
      try { await listen(server, candidate); bound = candidate; }
      catch (error) { if (error.code !== 'EADDRINUSE') { server.close(); throw error; } }
    }
    if (bound === null) fail('no free port found between 4500 and 4563');
  } else {
    try {
      await listen(server, port);
      bound = port;
    } catch (error) {
      server.close();
      if (error.code !== 'EADDRINUSE') throw error;
      const alternative = await freePort(port + 1);
      fail(alternative === null
        ? `port ${port} is already in use and no free port was found nearby`
        : `port ${port} is already in use; retry with --port ${alternative} or --port auto`);
    }
  }
  process.stdout.write(`Serving ${root} at http://127.0.0.1:${bound}\n`);
  const close = () => server.close(() => process.exit(0));
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
}

function option(args, name, { value = true } = {}) {
  const indices = args.flatMap((arg, index) => arg === name ? [index] : []);
  if (indices.length > 1) fail(`option ${name} may be specified only once`);
  if (indices.length === 0) return undefined;
  const index = indices[0];
  if (!value) { args.splice(index, 1); return true; }
  if (index + 1 >= args.length || args[index + 1].startsWith('--')) fail(`option ${name} requires a value`);
  const result = args[index + 1];
  args.splice(index, 2);
  return result;
}

export async function main(argv = process.argv.slice(2)) {
  const args = [...argv];
  const command = args.shift();
  if (!command || command === '--help' || command === '-h') { process.stdout.write(`${usage()}\n`); return; }
  if (command === 'inventory') {
    if (args.length !== 1) fail(`inventory requires exactly one INPUT_DIR\n${usage()}`);
    await inventory(args[0]);
  } else if (command === 'inline') {
    const out = option(args, '--out');
    const force = option(args, '--force', { value: false }) === true;
    if (!out || args.length !== 1) fail(`inline requires INPUT_DIR and --out DIRECTORY\n${usage()}`);
    await inlineDirectory(args[0], out, force);
  } else if (command === 'validate') {
    if (args.length !== 1) fail(`validate requires exactly one MANIFEST\n${usage()}`);
    const { payload } = await compileFile(args[0]);
    process.stdout.write(`${JSON.stringify({ valid: true, counts: payload.counts, warnings: payload.warnings }, null, 2)}\n`);
  } else if (command === 'build') {
    const out = option(args, '--out');
    const force = option(args, '--force', { value: false }) === true;
    if (!out || args.length !== 1) fail(`build requires MANIFEST and --out DIRECTORY\n${usage()}`);
    await build(args[0], out, force);
  } else if (command === 'serve') {
    const rawPort = option(args, '--port');
    if (args.length !== 1) fail(`serve requires exactly one DIRECTORY\n${usage()}`);
    await serve(args[0], parsePort(rawPort));
  } else {
    fail(`unknown command "${command}"\n${usage()}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`canvas-presenter: ${error.message}\n`);
    process.exitCode = 1;
  });
}
