import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { promisify } from 'node:util';
import { compileManifest, constants, inlineSvgReferences } from '../core.mjs';
import { safeJson } from '../canvas.mjs';

const execFileAsync = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEMP_ROOT = path.join(HERE, '.tmp');
const CLI = path.join(HERE, '..', 'canvas.mjs');
let serial = 0;

async function fixture() {
  await fs.mkdir(TEMP_ROOT, { recursive: true });
  const dir = path.join(TEMP_ROOT, `case-${process.pid}-${serial++}`);
  await fs.mkdir(path.join(dir, 'slides'), { recursive: true });
  await fs.writeFile(path.join(dir, 'slides', 'a.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"><rect width="1920" height="1080" fill="#fff"/></svg>');
  await fs.writeFile(path.join(dir, 'slides', 'b.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600"><text x="10" y="20">B</text></svg>');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  await fs.writeFile(path.join(dir, 'slides', 'c.png'), png);
  return dir;
}

function slide(id, src = 'slides/a.svg', format = 'svg', extra = {}) {
  return { id, kind: 'slide', title: id, src, format, alt: `${id} alt`, notes: `${id} notes`, ...extra };
}

function manifest(canvas, targets, extra = {}) {
  return {
    version: 1,
    title: '테스트',
    description: 'compiler test',
    canvas,
    paths: [{ id: 'main', title: 'Main', steps: targets.map((target) => ({ target })) }],
    ...extra,
  };
}

function inside(inner, outer) {
  return inner.x >= outer.x && inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width + 1e-9 &&
    inner.y + inner.height <= outer.y + outer.height + 1e-9;
}

test('grid and nested row compile parent-first with absolute bounds and preserved dimensions', async (t) => {
  const dir = await fixture();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const source = manifest({
    id: 'board', kind: 'group', title: 'Root', layout: 'grid', columns: 2, children: [
      { id: 'section', kind: 'group', title: 'Section', layout: 'row', children: [slide('wide'), slide('fourthree', 'slides/b.svg')] },
      slide('pngone', 'slides/c.png', 'png'),
    ],
  }, ['wide', 'fourthree', 'pngone']);
  const before = JSON.stringify(source);
  const result = await compileManifest(source, dir);
  assert.equal(JSON.stringify(source), before, 'source manifest must not be mutated');
  assert.deepEqual(result.counts, { slides: 3, groups: 1, html: 0, svg: 2, png: 1 });
  assert.equal(result.nodes[0].id, 'section');
  assert.ok(result.nodes.findIndex((n) => n.id === 'section') < result.nodes.findIndex((n) => n.id === 'wide'));
  assert.equal(result.nodes.find((n) => n.id === 'wide').data.nativeWidth, 1920);
  assert.equal(result.nodes.find((n) => n.id === 'fourthree').data.nativeHeight, 600);
  assert.equal(result.nodes.find((n) => n.id === 'wide').height, 270);
  assert.equal(result.nodes.find((n) => n.id === 'wide').width, constants.DISPLAY_WIDTH);
  assert.ok(inside(result.boundsById.wide, result.boundsById.section));
  assert.ok(inside(result.boundsById.fourthree, result.boundsById.section));
  assert.deepEqual(result.boundsById.overview, result.boundsById.board);
  assert.equal(result.nodes.find((n) => n.id === 'wide').parentId, 'section');
  assert.equal(result.nodes.find((n) => n.id === 'section').parentId, undefined);
});

test('tree layout creates actual upper-root geometry and recursive structural edges', async (t) => {
  const dir = await fixture();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const source = manifest({
    id: 'board', kind: 'group', title: 'Tree', layout: 'tree', children: [
      slide('rootSlide'),
      { id: 'branch', kind: 'group', title: 'Branch', layout: 'tree', children: [slide('branchRoot'), slide('leafA'), slide('leafB')] },
      slide('side'),
    ],
  }, ['rootSlide', 'branchRoot', 'leafA', 'leafB', 'side']);
  const result = await compileManifest(source, dir);
  assert.equal(result.edges.length, 4);
  assert.ok(result.boundsById.rootSlide.y < result.boundsById.branch.y);
  assert.ok(result.boundsById.branchRoot.y < result.boundsById.leafA.y);
  assert.deepEqual(new Set(result.edges.map((e) => `${e.source}->${e.target}`)), new Set([
    'rootSlide->branch', 'rootSlide->side', 'branchRoot->leafA', 'branchRoot->leafB',
  ]));
  assert.ok(inside(result.boundsById.leafA, result.boundsById.branch));
});

test('free and column layouts honor coordinates, zero gap, and sequence ordering', async (t) => {
  const dir = await fixture();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const freeResult = await compileManifest(manifest({
    id: 'board', kind: 'group', title: 'Free', layout: 'free', children: [
      slide('a', 'slides/a.svg', 'svg', { position: { x: 40, y: 80 } }),
      { id: 'nested', kind: 'group', title: 'Nested', layout: 'column', gap: 0, position: { x: 600, y: 20 }, children: [slide('b'), slide('c')] },
    ],
  }, ['a', 'b', 'c']), dir);
  assert.deepEqual(freeResult.nodes.find((n) => n.id === 'a').position, { x: 40, y: 80 });
  assert.deepEqual(freeResult.nodes.find((n) => n.id === 'nested').position, { x: 600, y: 20 });
  const b = freeResult.nodes.find((n) => n.id === 'b');
  const c = freeResult.nodes.find((n) => n.id === 'c');
  assert.equal(c.position.y, b.position.y + b.height);
  assert.deepEqual(freeResult.paths[0].steps.map((s) => s.target), ['a', 'b', 'c']);
});

test('HTML importer embeds local stylesheet images fonts and classic scripts under CSP', async (t) => {
  const dir = await fixture();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.mkdir(path.join(dir, 'web', 'nested'), { recursive: true });
  await fs.writeFile(path.join(dir, 'web', 'pixel.png'), await fs.readFile(path.join(dir, 'slides', 'c.png')));
  await fs.writeFile(path.join(dir, 'web', 'font.woff2'), Buffer.from('font bytes'));
  await fs.writeFile(path.join(dir, 'web', 'nested', 'more.css'), '.hero{background-image:url("../pixel.png")}');
  await fs.writeFile(path.join(dir, 'web', 'main.css'), '@import "nested/more.css"; @font-face{font-family:x;src:url("font.woff2")}');
  await fs.writeFile(path.join(dir, 'web', 'app.js'), 'document.body.dataset.ready="yes";');
  await fs.writeFile(path.join(dir, 'web', 'slide.html'), '<!doctype html><html><head><link rel="stylesheet" href="main.css"></head><body><img src="pixel.png"><script src="app.js"></script></body></html>');
  const source = manifest({ id: 'board', kind: 'group', title: 'HTML', layout: 'column', children: [
    slide('interactive', 'web/slide.html', 'html', { width: 1920, height: 1080, allowScripts: true, poster: 'slides/a.svg' }),
  ] }, ['interactive']);
  const result = await compileManifest(source, dir);
  const asset = result.nodes[0].data.asset;
  assert.match(asset, /Content-Security-Policy/);
  assert.match(asset, /default-src 'none'/);
  assert.match(asset, /script-src 'unsafe-inline'/);
  assert.match(asset, /data:image\/png;base64/);
  assert.match(asset, /data:font\/woff2;base64/);
  assert.match(asset, /document\.body\.dataset\.ready/);
  assert.doesNotMatch(asset, /(?:href|src)="(?:main\.css|pixel\.png|app\.js)"/);
  assert.match(result.nodes[0].data.poster, /^data:image\/svg\+xml;base64,/);
  assert.equal(result.warnings.length, 0);
});

test('HTML warnings and adverse active/dependency cases are explicit', async (t) => {
  const dir = await fixture();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.writeFile(path.join(dir, 'plain.html'), '<h1>Plain</h1>');
  const plain = manifest({ id: 'board', kind: 'group', title: 'Plain', layout: 'column', children: [
    slide('plain', 'plain.html', 'html', { width: 800, height: 600, alt: '', notes: '' }),
    slide('anchor'),
  ] }, ['anchor']);
  const result = await compileManifest(plain, dir);
  assert.ok(result.warnings.some((w) => w.includes('not referenced')));
  assert.ok(result.warnings.some((w) => w.includes('no poster')));
  assert.ok(result.warnings.some((w) => w.includes('no alt')));
  assert.ok(result.warnings.some((w) => w.includes('no presenter notes')));
  assert.match(result.nodes[0].data.asset, /script-src 'none'/);

  await fs.writeFile(path.join(dir, 'bad-script.html'), '<script>alert(1)</script>');
  const badScript = manifest({ id: 'board', kind: 'group', layout: 'column', children: [slide('bad', 'bad-script.html', 'html', { width: 1, height: 1 })] }, ['bad']);
  await assert.rejects(() => compileManifest(badScript, dir), /allowScripts is false/);
  await fs.writeFile(path.join(dir, 'remote.html'), '<img src="https://example.com/x.png">');
  const remote = manifest({ id: 'board', kind: 'group', layout: 'column', children: [slide('bad', 'remote.html', 'html', { width: 1, height: 1 })] }, ['bad']);
  await assert.rejects(() => compileManifest(remote, dir), /unsupported image source/);
  await fs.writeFile(path.join(dir, 'module.html'), '<script type="module">import x from "./x.js"</script>');
  const moduleManifest = manifest({ id: 'board', kind: 'group', layout: 'column', children: [slide('bad', 'module.html', 'html', { width: 1, height: 1, allowScripts: true })] }, ['bad']);
  await assert.rejects(() => compileManifest(moduleManifest, dir), /unsupported JavaScript modules/);
});

test('manifest and asset validation rejects traversal, symlink escape, external SVG, bad refs and dimensions', async (t) => {
  const dir = await fixture();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const outside = path.join(TEMP_ROOT, `outside-${process.pid}-${serial++}.svg`);
  await fs.writeFile(outside, '<svg width="1" height="1"></svg>');
  t.after(() => fs.rm(outside, { force: true }));
  await fs.symlink(outside, path.join(dir, 'slides', 'escape.svg'));
  await fs.writeFile(path.join(dir, 'slides', 'external.svg'), '<svg width="10" height="10"><image href="https://example.com/x.png"/></svg>');

  const one = (node, targets = [node.id]) => manifest({ id: 'board', kind: 'group', layout: 'column', children: [node] }, targets);
  await assert.rejects(() => compileManifest(one(slide('bad', '../outside.svg')), dir), /traversal/);
  await assert.rejects(() => compileManifest(one(slide('bad', 'slides/escape.svg')), dir), /outside the manifest directory/);
  await assert.rejects(() => compileManifest(one(slide('bad', 'slides/external.svg')), dir), /external SVG reference/);
  await assert.rejects(() => compileManifest(one(slide('bad', 'slides/missing.svg')), dir), /does not exist/);
  await assert.rejects(() => compileManifest(one({ ...slide('bad'), format: 'pdf' }), dir), /format must be one of/);
  await assert.rejects(() => compileManifest(one({ ...slide('bad'), width: 100, height: 100 }), dir), /do not match asset dimensions/);
  await assert.rejects(() => compileManifest(one(slide('bad'), ['unknown']), dir), /unknown id/);
});

test('structural validation rejects duplicate/reserved IDs, empty/free errors, cycles, depth, and nonfinite data', async (t) => {
  const dir = await fixture();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const duplicate = manifest({ id: 'board', kind: 'group', layout: 'row', children: [slide('same'), slide('same')] }, ['same']);
  await assert.rejects(() => compileManifest(duplicate, dir), /duplicate id/);
  await assert.rejects(() => compileManifest(manifest({ id: 'board', kind: 'group', layout: 'row', children: [slide('overview')] }, ['overview']), dir), /reserved/);
  await assert.rejects(() => compileManifest(manifest({ id: 'board', kind: 'group', layout: 'row', children: [] }, ['overview']), dir), /empty group/);
  await assert.rejects(() => compileManifest(manifest({ id: 'board', kind: 'group', layout: 'free', children: [slide('a')] }, ['a']), dir), /requires position/);
  const misplaced = manifest({ id: 'board', kind: 'group', layout: 'row', children: [slide('a', 'slides/a.svg', 'svg', { position: { x: 1, y: 2 } })] }, ['a']);
  await assert.rejects(() => compileManifest(misplaced, dir), /parent layout is "row"/);
  const groupTarget = manifest({ id: 'board', kind: 'group', layout: 'row', children: [
    { id: 'section', kind: 'group', layout: 'row', children: [slide('a')] },
  ] }, ['section']);
  await assert.rejects(() => compileManifest(groupTarget, dir), /must reference a slide id, not group/);
  const overviewTarget = manifest({ id: 'board', kind: 'group', layout: 'row', children: [slide('a')] }, ['overview']);
  await assert.rejects(() => compileManifest(overviewTarget, dir), /overview is a separate canvas view/);
  const cyclic = { version: 1, title: '', description: '', paths: [{ id: 'p', steps: [{ target: 'overview' }] }] };
  cyclic.canvas = { id: 'board', kind: 'group', layout: 'column', children: [] };
  cyclic.canvas.children.push(cyclic.canvas);
  await assert.rejects(() => compileManifest(cyclic, dir), /contains a cycle/);
  let deep = slide('bottom');
  for (let i = 12; i >= 0; i--) deep = { id: `g${i}`, kind: 'group', layout: 'column', children: [deep] };
  deep.id = 'board';
  await assert.rejects(() => compileManifest(manifest(deep, ['bottom']), dir), /exceeds maximum canvas depth/);
  const nonfinite = manifest({ id: 'board', kind: 'group', layout: 'row', children: [slide('a')] }, ['a']);
  nonfinite.extra = Infinity;
  await assert.rejects(() => compileManifest(nonfinite, dir), /nonfinite/);
});

test('safe JSON prevents closing-script breakout and preserves decoded text', () => {
  const value = { title: '</script><script>alert(1)</script>', amp: '&', separators: '\u2028\u2029' };
  const encoded = safeJson(value);
  assert.doesNotMatch(encoded, /<\/script/i);
  assert.doesNotMatch(encoded, /[<&>]/);
  assert.deepEqual(JSON.parse(encoded), value);
});

test('CLI inventory is sorted and validate reports useful JSON; failures are nonzero', async (t) => {
  const dir = await fixture();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.mkdir(path.join(dir, 'z'), { recursive: true });
  await fs.writeFile(path.join(dir, 'z', 'last.html'), '<h1>x</h1>');
  const inventoryRun = await execFileAsync(process.execPath, [CLI, 'inventory', dir]);
  const inventory = JSON.parse(inventoryRun.stdout);
  assert.deepEqual(inventory.files.map((x) => x.path), ['slides/a.svg', 'slides/b.svg', 'slides/c.png', 'z/last.html']);
  assert.equal(inventory.files.find((x) => x.path === 'slides/a.svg').width, 1920);
  assert.equal(inventory.files.find((x) => x.path === 'slides/c.png').width, 1);
  assert.equal(inventory.files.find((x) => x.path === 'slides/c.png').height, 1);
  assert.deepEqual(inventory.counts, { media: 4, referenced: 0, blocked: 0, unreadable: 0 });
  assert.ok(inventory.files.every((entry) => !('role' in entry)));

  const source = manifest({ id: 'board', kind: 'group', layout: 'column', children: [slide('a')] }, ['a']);
  const manifestFile = path.join(dir, 'manifest.json');
  await fs.writeFile(manifestFile, JSON.stringify(source));
  const validateRun = await execFileAsync(process.execPath, [CLI, 'validate', manifestFile]);
  assert.equal(JSON.parse(validateRun.stdout).counts.slides, 1);
  await assert.rejects(() => execFileAsync(process.execPath, [CLI, 'validate', path.join(dir, 'missing.json')]), (error) => {
    assert.notEqual(error.code, 0);
    assert.match(error.stderr, /manifest does not exist/);
    return true;
  });
});

test('inline embeds external SVG references and inventory flags them beforehand', async (t) => {
  const dir = await fixture();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const logo = path.join(dir, 'slides', 'logo.png');
  await fs.copyFile(path.join(dir, 'slides', 'c.png'), logo);
  const withRef = '<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080"><image href="logo.png" x="0" y="0" width="120" height="60"/></svg>';
  await fs.writeFile(path.join(dir, 'slides', 'branded.svg'), withRef);

  const before = JSON.parse((await execFileAsync(process.execPath, [CLI, 'inventory', dir])).stdout);
  const branded = before.files.find((x) => x.path === 'slides/branded.svg');
  assert.deepEqual(branded.externalReferences, ['logo.png']);
  assert.match(branded.blocked, /inline/);
  const logoEntry = before.files.find((x) => x.path === 'slides/logo.png');
  assert.deepEqual(logoEntry.referencedBy, ['slides/branded.svg'], 'a referenced file stays listed as usable media');
  assert.equal(logoEntry.width, 1, 'dimensions are still reported for referenced media');
  assert.equal(before.counts.referenced, 1);
  assert.equal(before.counts.blocked, 1);

  const source = manifest({ id: 'board', kind: 'group', layout: 'column', children: [{ id: 'br', kind: 'slide', title: 'Branded', src: 'slides/branded.svg', format: 'svg', width: 1920, height: 1080, alt: 'a' }] }, ['br']);
  await fs.writeFile(path.join(dir, 'manifest.json'), JSON.stringify(source));
  await assert.rejects(execFileAsync(process.execPath, [CLI, 'validate', path.join(dir, 'manifest.json')]), /external SVG reference/);

  const out = path.join(dir, 'inlined');
  const report = JSON.parse((await execFileAsync(process.execPath, [CLI, 'inline', path.join(dir, 'slides'), '--out', out])).stdout);
  assert.deepEqual(report.rewritten, [{ path: 'branded.svg', inlined: ['logo.png'] }]);
  const rewritten = await fs.readFile(path.join(out, 'branded.svg'), 'utf8');
  assert.match(rewritten, /href="data:image\/png;base64,/);
  assert.doesNotMatch(rewritten, /href="logo\.png"/);
  await assert.rejects(execFileAsync(process.execPath, [CLI, 'inline', path.join(dir, 'slides'), '--out', out]), /already exists/);
  const forced = JSON.parse((await execFileAsync(process.execPath, [CLI, 'inline', path.join(dir, 'slides'), '--out', out, '--force'])).stdout);
  assert.deepEqual(forced.rewritten, [{ path: 'branded.svg', inlined: ['logo.png'] }], '--force reproduces the inlined copy');
  assert.match(await fs.readFile(path.join(out, 'branded.svg'), 'utf8'), /href="data:image\/png;base64,/);
});

test('inline --force refuses to delete files it did not create', async (t) => {
  const dir = await fixture();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const out = path.join(dir, 'work');
  await execFileAsync(process.execPath, [CLI, 'inline', path.join(dir, 'slides'), '--out', out]);
  const keep = path.join(out, 'notes.txt');
  await fs.writeFile(keep, 'user data');
  await assert.rejects(
    execFileAsync(process.execPath, [CLI, 'inline', path.join(dir, 'slides'), '--out', out, '--force']),
    /files this command did not create/,
  );
  assert.equal(await fs.readFile(keep, 'utf8'), 'user data');
  await fs.rm(keep);
  await execFileAsync(process.execPath, [CLI, 'inline', path.join(dir, 'slides'), '--out', out, '--force']);
});

test('inline refuses an output directory that contains its own input', async (t) => {
  const dir = await fixture();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await assert.rejects(
    execFileAsync(process.execPath, [CLI, 'inline', path.join(dir, 'slides'), '--out', dir]),
    /must not contain the input directory/,
  );
  await assert.rejects(
    execFileAsync(process.execPath, [CLI, 'inline', path.join(dir, 'slides'), '--out', path.join(dir, 'slides', 'out')]),
    /must be outside the input directory/,
  );
});

function servePort(t, dir, port) {
  const child = spawn(process.execPath, [CLI, 'serve', dir, '--port', port], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => child.kill('SIGTERM'));
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => reject(new Error(`serve did not report a port; stdout=${buffer}`)), 8000);
    child.stderr.on('data', (chunk) => { buffer += chunk; });
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      const match = buffer.match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (match) { clearTimeout(timer); resolve(Number(match[1])); }
    });
    child.once('exit', () => { clearTimeout(timer); reject(new Error(`serve exited; output=${buffer}`)); });
  });
}

test('serve --port auto steps past ports that are already taken', async (t) => {
  const dir = await fixture();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const first = await servePort(t, dir, 'auto');
  const second = await servePort(t, dir, 'auto');
  assert.ok(second > first, `auto must skip the port it already handed out: first=${first} second=${second}`);
});

test('serve names a usable alternative when an explicit port is taken', async (t) => {
  const dir = await fixture();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const taken = await servePort(t, dir, 'auto');
  await assert.rejects(
    execFileAsync(process.execPath, [CLI, 'serve', dir, '--port', String(taken)]),
    (error) => {
      assert.match(error.stderr, new RegExp(`port ${taken} is already in use`));
      assert.match(error.stderr, /--port \d+ or --port auto/);
      return true;
    },
  );
});

test('validate reports every failing slide at once', async (t) => {
  const dir = await fixture();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const broken = '<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080"><image href="missing-logo.png" x="0" y="0" width="10" height="10"/></svg>';
  await fs.writeFile(path.join(dir, 'slides', 'x.svg'), broken);
  await fs.writeFile(path.join(dir, 'slides', 'y.svg'), broken);
  const source = manifest({ id: 'board', kind: 'group', layout: 'row', children: [
    { id: 'sx', kind: 'slide', title: 'X', src: 'slides/x.svg', format: 'svg', width: 1920, height: 1080, alt: 'x' },
    { id: 'sy', kind: 'slide', title: 'Y', src: 'slides/y.svg', format: 'svg', width: 1920, height: 1080, alt: 'y' },
  ] }, ['sx', 'sy']);
  await fs.writeFile(path.join(dir, 'manifest.json'), JSON.stringify(source));
  await assert.rejects(execFileAsync(process.execPath, [CLI, 'validate', path.join(dir, 'manifest.json')]), (error) => {
    assert.match(error.stderr, /2 slides failed to load/);
    assert.match(error.stderr, /slide "sx"/);
    assert.match(error.stderr, /slide "sy"/);
    return true;
  });
});

test.after(async () => {
  await fs.rm(TEMP_ROOT, { recursive: true, force: true });
});

test('force cannot delete an unowned output or extra user files', async (t) => {
  const dir=await fixture();t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const source=manifest({id:'board',kind:'group',title:'Root',layout:'row',children:[slide('a')]},['a']);
  const manifestFile=path.join(dir,'deck.json');await fs.writeFile(manifestFile,JSON.stringify(source));
  const unowned=path.join(dir,'existing');await fs.mkdir(unowned);await fs.writeFile(path.join(unowned,'keep.txt'),'user data');
  await assert.rejects(execFileAsync(process.execPath,[CLI,'build',manifestFile,'--out',unowned,'--force']),/unowned output/);
  assert.equal(await fs.readFile(path.join(unowned,'keep.txt'),'utf8'),'user data');
  const generated=path.join(dir,'generated');
  await execFileAsync(process.execPath,[CLI,'build',manifestFile,'--out',generated]);
  await execFileAsync(process.execPath,[CLI,'build',manifestFile,'--out',generated,'--force']);
  await fs.writeFile(path.join(generated,'personal-notes.txt'),'keep');
  await assert.rejects(execFileAsync(process.execPath,[CLI,'build',manifestFile,'--out',generated,'--force']),/additional or non-regular files/);
  assert.equal(await fs.readFile(path.join(generated,'personal-notes.txt'),'utf8'),'keep');
  assert.equal(await fs.readFile(manifestFile,'utf8'),JSON.stringify(source));
});


test('SVG inference and layout reject zero, overflow, and nonfinite derived geometry', async (t) => {
  const dir = await fixture();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.writeFile(path.join(dir, 'slides', 'zero.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="0" height="1080"></svg>');
  await fs.writeFile(path.join(dir, 'slides', 'overflow.svg'), `<svg xmlns="http://www.w3.org/2000/svg" width="${'9'.repeat(400)}" height="1"></svg>`);
  await fs.writeFile(path.join(dir, 'slides', 'overflow-viewbox.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1e309 1"></svg>');
  await fs.writeFile(path.join(dir, 'extreme.html'), '<h1>finite inputs, overflowing ratio</h1>');
  const one = (node) => manifest({ id: 'board', kind: 'group', layout: 'column', children: [node] }, [node.id]);
  await assert.rejects(() => compileManifest(one(slide('zero', 'slides/zero.svg')), dir), /positive finite/);
  await assert.rejects(() => compileManifest(one(slide('overflow', 'slides/overflow.svg')), dir), /positive finite/);
  await assert.rejects(() => compileManifest(one(slide('overflowViewbox', 'slides/overflow-viewbox.svg')), dir), /viewBox.*positive finite/);
  await assert.rejects(() => compileManifest(one(slide('extreme', 'extreme.html', 'html', {
    width: Number.MIN_VALUE, height: Number.MAX_VALUE,
  })), dir), /nonfinite.*layout size/);
  await assert.rejects(() => compileManifest(one(slide('underflow', 'extreme.html', 'html', {
    width: Number.MAX_VALUE, height: Number.MIN_VALUE,
  })), dir), /nonpositive content layout size/);
});

test('unquoted HTML URL attributes and unquoted SVG href are rejected explicitly', async (t) => {
  const dir = await fixture();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.writeFile(path.join(dir, 'unquoted.html'), '<a href=https://example.com>remote</a>');
  await fs.writeFile(path.join(dir, 'slides', 'unquoted.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><image href=https://example.com/x.png /></svg>');
  const htmlManifest = manifest({ id: 'board', kind: 'group', layout: 'column', children: [
    slide('unquotedHtml', 'unquoted.html', 'html', { width: 10, height: 10 }),
  ] }, ['unquotedHtml']);
  const svgManifest = manifest({ id: 'board', kind: 'group', layout: 'column', children: [
    slide('unquotedSvg', 'slides/unquoted.svg'),
  ] }, ['unquotedSvg']);
  await assert.rejects(() => compileManifest(htmlManifest, dir), /href must use matching quotes/);
  await assert.rejects(() => compileManifest(svgManifest, dir), /malformed or unquoted SVG href/);
});

test('inline script bodies are isolated from markup and CSS rewrites', async (t) => {
  const dir = await fixture();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.writeFile(path.join(dir, 'pixel.png'), await fs.readFile(path.join(dir, 'slides', 'c.png')));
  const body = `\nconst x = "style='background:url(pixel.png)'";\nconst y = '<img src="pixel.png">';\nconst z = '<a href=https://example.com>remote-looking literal</a>';\nconst commentLiteral = '<!-- href=https://example.com -->';\nwindow.literalPayload = {x, y, z, commentLiteral};\n`;
  const styleLiteral = `.hero{background:url("pixel.png")}.note::after{content:'<img src="pixel.png">'}`;
  await fs.writeFile(path.join(dir, 'literal-script.html'), `<html><head><style>${styleLiteral}</style></head><body><script>${body}</script></body></html>`);
  const source = manifest({ id: 'board', kind: 'group', layout: 'column', children: [
    slide('literalScript', 'literal-script.html', 'html', { width: 1920, height: 1080, allowScripts: true }),
  ] }, ['literalScript']);
  const result = await compileManifest(source, dir);
  const asset = result.nodes[0].data.asset;
  assert.ok(asset.includes(`<script>${body}</script>`), 'inline script body must be byte-preserved');
  assert.equal(asset.match(/data:image\/png;base64/g)?.length, 1, 'only the real CSS resource is embedded');
  assert.ok(asset.includes(`style='background:url(pixel.png)'`));
  assert.ok(asset.includes('href=https://example.com>remote-looking literal'));
  assert.ok(asset.includes(`content:'<img src="pixel.png">'`), 'style text must be isolated from img attribute rewrites');
  assert.ok(asset.includes(`const commentLiteral = '<!-- href=https://example.com -->';`), 'nested opaque content must restore exactly');
});

test('boundsById has no prototype while inherited-name IDs remain explicit own entries', async (t) => {
  const dir = await fixture();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const source = manifest({ id: 'board', kind: 'group', layout: 'column', children: [slide('constructor')] }, ['constructor']);
  const result = await compileManifest(source, dir);
  assert.equal(Object.getPrototypeOf(result.boundsById), null);
  assert.equal(Object.hasOwn(result.boundsById, 'constructor'), true);
  assert.equal(Object.hasOwn(result.boundsById, 'toString'), false);
  assert.equal(result.boundsById.toString, undefined);
  assert.equal(Object.hasOwn(result.boundsById, 'overview'), true);
});

// 정규식 살균기가 문맥을 잃던 입력들. 각 항목은 리뷰에서 나온 재현 입력이다.
test('markup scanning survives inputs that defeat context-free regexes', async (t) => {
  const dir = await fixture();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const compile = (allowScripts = false) => {
    const node = { id: 'h', kind: 'slide', title: 'H', src: 'slides/h.html', format: 'html', width: 800, height: 600, alt: 'h', allowScripts };
    return compileManifest(manifest({ id: 'board', kind: 'group', layout: 'row', children: [node] }, ['h']), dir);
  };
  const writeHtml = (body) => fs.writeFile(path.join(dir, 'slides', 'h.html'), body);
  const asset = (name, body) => fs.writeFile(path.join(dir, 'slides', name), body);

  await writeHtml('<div title="<!--"><a href="https://example.com/">leave</a>--></div>');
  await assert.rejects(compile(), /unembedded or navigational reference "https:\/\/example.com\/"/,
    'a comment opener inside an attribute value must not hide a live link');

  await asset('pixel.png', await fs.readFile(path.join(dir, 'slides', 'c.png')));
  await writeHtml('<style>.x::before{content:\'url(pixel.png)\'}</style><span class="x"></span>');
  const inertString = await compile();
  assert.match(inertString.nodes[0].data.asset, /content:'url\(pixel\.png\)'/,
    'a url() inside a CSS string is content, not a resource reference');

  await writeHtml('<style>@im\\70ort "https://example.com/x.css";</style>');
  await assert.rejects(compile(), /@import/, 'an escaped at-rule name still decodes to import');

  await asset('app.js', 'globalThis.ready = true;');
  await writeHtml('<head><script defer src="app.js"></script></head><body></body>');
  await assert.rejects(compile(true), /defer/, 'inlining a deferred script silently changes when it runs');

  await asset('print.css', '.only-print{color:red}');
  await writeHtml('<link rel="stylesheet" href="print.css" media="print">');
  await assert.rejects(compile(), /media="print"/, 'inlining a media-scoped stylesheet silently widens it');

  await writeHtml('<html><head data-note=">"></head><body><p>ok</p></body></html>');
  const quotedGt = await compile();
  const csp = quotedGt.nodes[0].data.asset;
  assert.ok(csp.indexOf('Content-Security-Policy') < csp.indexOf('<body'), 'the CSP meta must precede the body');
  assert.match(csp, /<head data-note=">"><meta http-equiv="Content-Security-Policy"/,
    'a > inside a quoted attribute must not split the head tag');

  await writeHtml('<script>globalThis.early = 1</script><head></head>');
  await assert.rejects(compile(true), /security policy cannot be applied/,
    'a document whose script precedes head cannot carry an effective policy and must be rejected');
});

test('SVG scanning rejects prefixed active elements and reads the real root', async (t) => {
  const dir = await fixture();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const compileSvg = (name) => compileManifest(
    manifest({ id: 'board', kind: 'group', layout: 'row', children: [slide('s', `slides/${name}`)] }, ['s']),
    dir,
  );

  await fs.writeFile(path.join(dir, 'slides', 'ns.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:s="http://www.w3.org/2000/svg" width="10" height="10"><s:script>alert(1)</s:script></svg>');
  await assert.rejects(compileSvg('ns.svg'), /unsupported SVG script content/,
    'a namespace prefix must not smuggle a script element past the deny list');

  await fs.writeFile(path.join(dir, 'slides', 'commented.svg'),
    '<!-- <svg width="1" height="1"> -->\n<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"></svg>');
  const sized = await compileSvg('commented.svg');
  assert.equal(sized.nodes[0].data.nativeWidth, 1600, 'dimensions come from the root element, not a comment');
  assert.equal(sized.nodes[0].data.nativeHeight, 900);

  await fs.writeFile(path.join(dir, 'slides', 'prose.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><text>url(nope.png)</text><rect fill="url(#g)"/><g data-href="notafile.png"/></svg>');
  const prose = await compileSvg('prose.svg');
  assert.equal(prose.counts.svg, 1, 'url() in text content and data-href are not resource references');
});

test('inlining SVG references rewrites values, not syntax, and revalidates the result', async (t) => {
  const dir = await fixture();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const png = await fs.readFile(path.join(dir, 'slides', 'c.png'));
  await fs.writeFile(path.join(dir, 'slides', 'logo.png'), png);

  const mixed = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><image href="logo.png" aria-label="logo.png"/></svg>';
  const rewritten = await inlineSvgReferences(mixed, path.join(dir, 'slides'), path.join(dir, 'slides'), 'mixed');
  assert.match(rewritten.svg, /<image href="data:image\/png;base64,/, 'the resource attribute is replaced by value');
  assert.match(rewritten.svg, /aria-label="logo\.png"/, 'a non-resource attribute holding the same text is left alone');
  assert.deepEqual(rewritten.references, ['logo.png']);

  const scripted = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><image href="logo.png"/><script>alert(1)</script></svg>';
  await assert.rejects(
    inlineSvgReferences(scripted, path.join(dir, 'slides'), path.join(dir, 'slides'), 'scripted'),
    /unsupported SVG script content/,
    'inlining must not report success on a document the compiler will reject',
  );
});

test('tree edge ids stay unique when node ids contain hyphens', async (t) => {
  const dir = await fixture();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const source = manifest({
    id: 'board', kind: 'group', title: 'Root', layout: 'row', children: [
      { id: 'a-b', kind: 'group', title: 'A', layout: 'tree', children: [slide('c'), slide('d')] },
      { id: 'a', kind: 'group', title: 'B', layout: 'tree', children: [slide('b'), slide('c-d')] },
    ],
  }, ['c', 'd', 'b', 'c-d']);
  const result = await compileManifest(source, dir);
  const ids = result.edges.map((edge) => edge.id);
  assert.equal(new Set(ids).size, ids.length, `edge ids must be unique: ${ids.join(', ')}`);
});
