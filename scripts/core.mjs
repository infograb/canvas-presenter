import fs from 'node:fs/promises';
import path from 'node:path';

const ID_RE = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
const COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const FORMATS = new Set(['svg', 'png', 'html']);
const LAYOUTS = new Set(['row', 'column', 'grid', 'tree', 'free']);
const MAX_DEPTH = 12;
const DISPLAY_WIDTH = 480;
const DUPLICATE_ASSET_WARN_BYTES = 262144;
const GROUP_PADDING = 32;
const GROUP_HEADER = 72;
const DEFAULT_GAP = 40;

function fail(message) {
  throw new Error(message);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function finitePositive(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    fail(`${label} must be a positive finite number`);
  }
  return value;
}

function finiteNonnegative(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    fail(`${label} must be a nonnegative finite number`);
  }
  return value;
}

function normalizePosition(value, label) {
  if (value === undefined) return undefined;
  if (!isObject(value)) fail(`${label} must be an object`);
  return {
    x: finiteNonnegative(value.x, `${label}.x`),
    y: finiteNonnegative(value.y, `${label}.y`),
  };
}

function text(value, label, fallback = '') {
  if (value === undefined) return fallback;
  if (typeof value !== 'string') fail(`${label} must be a string`);
  return value;
}

function assertPlainTree(value, stack = new WeakSet(), seen = new WeakSet(), label = 'manifest') {
  if (typeof value === 'number' && !Number.isFinite(value)) fail(`${label} contains a nonfinite number`);
  if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint' || value === undefined) {
    fail(`${label} contains a non-JSON value`);
  }
  if (value === null || typeof value !== 'object') return;
  if (stack.has(value)) fail(`${label} contains a cycle`);
  if (seen.has(value)) return;
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer || value instanceof Date) {
    fail(`${label} must contain only JSON-compatible values`);
  }
  stack.add(value);
  seen.add(value);
  for (const [key, child] of Object.entries(value)) assertPlainTree(child, stack, seen, `${label}.${key}`);
  stack.delete(value);
}

function jsonClone(value, label = 'manifest') {
  assertPlainTree(value, new WeakSet(), new WeakSet(), label);
  try {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) fail(`${label} is not JSON-compatible`);
    return JSON.parse(encoded);
  } catch (error) {
    fail(`${label} is not JSON-compatible: ${error.message}`);
  }
}

function validateId(id, label, ids) {
  if (typeof id !== 'string' || !ID_RE.test(id)) fail(`${label}.id must match ${ID_RE}`);
  if (id === 'overview') fail(`${label}.id "overview" is reserved`);
  if (ids.has(id)) fail(`duplicate id "${id}" at ${label}`);
  ids.add(id);
}

function normalizeNode(node, semanticDepth, label, ids, records) {
  if (!isObject(node)) fail(`${label} must be an object`);
  if (semanticDepth > MAX_DEPTH) fail(`${label} exceeds maximum canvas depth ${MAX_DEPTH}`);
  validateId(node.id, label, ids);
  const title = text(node.title, `${label}.title`);
  const summary = text(node.summary, `${label}.summary`);
  const color = node.color === undefined ? undefined : text(node.color, `${label}.color`);
  if (color !== undefined && !COLOR_RE.test(color)) fail(`${label}.color must be a CSS #hex color`);

  if (node.kind === 'group') {
    const layout = node.layout === undefined ? 'grid' : node.layout;
    if (!LAYOUTS.has(layout)) fail(`${label}.layout must be one of row, column, grid, tree, free`);
    if (!Array.isArray(node.children) || node.children.length === 0) fail(`${label} is an empty group`);
    let columns;
    if (layout === 'grid') {
      columns = node.columns === undefined ? 2 : node.columns;
      if (!Number.isInteger(columns) || columns < 1) fail(`${label}.columns must be a positive integer`);
    } else if (node.columns !== undefined && (!Number.isInteger(node.columns) || node.columns < 1)) {
      fail(`${label}.columns must be a positive integer when provided`);
    }
    const gap = node.gap === undefined ? DEFAULT_GAP : finiteNonnegative(node.gap, `${label}.gap`);
    const normalized = {
      id: node.id,
      kind: 'group',
      title,
      summary,
      color,
      layout,
      columns,
      gap,
      children: [],
      depth: semanticDepth,
      position: normalizePosition(node.position, `${label}.position`),
    };
    records.push(normalized);
    normalized.children = node.children.map((child, index) =>
      normalizeNode(child, semanticDepth + 1, `${label}.children[${index}]`, ids, records));
    if (layout === 'free') {
      for (const child of normalized.children) {
        if (!child.position) fail(`${label} free layout requires position {x,y} on child "${child.id}"`);
      }
    } else {
      for (const child of normalized.children) {
        if (child.position) fail(`${label} child "${child.id}" has position but parent layout is "${layout}", not "free"`);
      }
    }
    return normalized;
  }

  if (node.kind === 'slide') {
    if (!FORMATS.has(node.format)) fail(`${label}.format must be one of svg, png, html`);
    if (typeof node.src !== 'string' || node.src.trim() === '') fail(`${label}.src must be a non-empty relative path`);
    if (node.width !== undefined) finitePositive(node.width, `${label}.width`);
    if (node.height !== undefined) finitePositive(node.height, `${label}.height`);
    if ((node.width === undefined) !== (node.height === undefined)) {
      fail(`${label}.width and .height must be provided together`);
    }
    if (node.poster !== undefined && node.format !== 'html') fail(`${label}.poster is supported only for html slides`);
    if (node.allowScripts !== undefined && node.format !== 'html') fail(`${label}.allowScripts is supported only for html slides`);
    if (node.allowScripts !== undefined && typeof node.allowScripts !== 'boolean') fail(`${label}.allowScripts must be boolean`);
    const normalized = {
      id: node.id,
      kind: 'slide',
      title,
      summary,
      color,
      format: node.format,
      src: node.src,
      poster: node.poster,
      width: node.width,
      height: node.height,
      allowScripts: node.allowScripts === true,
      alt: text(node.alt, `${label}.alt`),
      notes: text(node.notes, `${label}.notes`),
      depth: semanticDepth,
      position: normalizePosition(node.position, `${label}.position`),
    };
    records.push(normalized);
    return normalized;
  }

  fail(`${label}.kind must be "group" or "slide"`);
}

function validatePaths(manifest, ids, slides, warnings) {
  if (!Array.isArray(manifest.paths) || manifest.paths.length === 0) fail('manifest.paths must be a non-empty array');
  const pathIds = new Set();
  const targetedSlides = new Set();
  const paths = manifest.paths.map((entry, index) => {
    const label = `manifest.paths[${index}]`;
    if (!isObject(entry)) fail(`${label} must be an object`);
    if (typeof entry.id !== 'string' || !ID_RE.test(entry.id)) fail(`${label}.id must match ${ID_RE}`);
    if (pathIds.has(entry.id)) fail(`duplicate path id "${entry.id}"`);
    pathIds.add(entry.id);
    text(entry.title, `${label}.title`);
    if (!Array.isArray(entry.steps) || entry.steps.length === 0) fail(`${label}.steps must be a non-empty array`);
    entry.steps.forEach((step, stepIndex) => {
      const stepLabel = `${label}.steps[${stepIndex}]`;
      if (!isObject(step)) fail(`${stepLabel} must be an object`);
      if (typeof step.target !== 'string') {
        fail(`${stepLabel}.target references unknown id "${String(step.target)}"`);
      }
      if (step.target === 'overview') {
        fail(`${stepLabel}.target must reference a slide id; overview is a separate canvas view`);
      }
      if (!ids.has(step.target)) {
        fail(`${stepLabel}.target references unknown id "${step.target}"`);
      }
      if (!slides.has(step.target)) {
        fail(`${stepLabel}.target must reference a slide id, not group "${step.target}"`);
      }
      if (step.label !== undefined) text(step.label, `${stepLabel}.label`);
      if (step.notes !== undefined) text(step.notes, `${stepLabel}.notes`);
      if (step.duration !== undefined) finiteNonnegative(step.duration, `${stepLabel}.duration`);
      targetedSlides.add(step.target);
    });
    return entry;
  });
  const defaultPath = manifest.defaultPath === undefined ? paths[0].id : manifest.defaultPath;
  if (typeof defaultPath !== 'string' || !pathIds.has(defaultPath)) fail(`manifest.defaultPath references unknown path "${String(defaultPath)}"`);
  for (const slideId of slides) {
    if (!targetedSlides.has(slideId)) warnings.push(`slide "${slideId}" is not referenced by any presentation path`);
  }
  return { paths, defaultPath };
}

async function containedFile(baseReal, authoredPath, label) {
  if (typeof authoredPath !== 'string' || authoredPath.trim() === '') fail(`${label} must be a non-empty relative path`);
  if (authoredPath.includes('\0')) fail(`${label} contains a NUL byte`);
  if (path.isAbsolute(authoredPath) || authoredPath.startsWith('\\') || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(authoredPath)) {
    fail(`${label} must be a local relative path, not "${authoredPath}"`);
  }
  const segments = authoredPath.replaceAll('\\', '/').split('/');
  if (segments.includes('..')) fail(`${label} must not contain traversal segments: "${authoredPath}"`);
  if (/[?#]/.test(authoredPath)) fail(`${label} must not contain query or fragment components: "${authoredPath}"`);
  const candidate = path.resolve(baseReal, authoredPath);
  const relLexical = path.relative(baseReal, candidate);
  if (relLexical.startsWith('..') || path.isAbsolute(relLexical)) fail(`${label} escapes the manifest directory`);
  let real;
  try {
    real = await fs.realpath(candidate);
  } catch (error) {
    fail(`${label} does not exist: "${authoredPath}" (${error.code || error.message})`);
  }
  const relReal = path.relative(baseReal, real);
  if (relReal.startsWith('..') || path.isAbsolute(relReal)) fail(`${label} resolves outside the manifest directory: "${authoredPath}"`);
  const stat = await fs.stat(real);
  if (!stat.isFile()) fail(`${label} is not a file: "${authoredPath}"`);
  return real;
}

function mimeFor(file) {
  switch (path.extname(file).toLowerCase()) {
    case '.png': return 'image/png';
    case '.svg': return 'image/svg+xml';
    case '.jpg': case '.jpeg': return 'image/jpeg';
    case '.gif': return 'image/gif';
    case '.webp': return 'image/webp';
    case '.avif': return 'image/avif';
    case '.woff': return 'font/woff';
    case '.woff2': return 'font/woff2';
    case '.ttf': return 'font/ttf';
    case '.otf': return 'font/otf';
    default: fail(`unsupported local asset extension "${path.extname(file) || '(none)'}" for ${file}`);
  }
}

function dataUrl(bytes, mime) {
  return `data:${mime};base64,${bytes.toString('base64')}`;
}

let crcTable;
function crc32(bytes) {
  if (!crcTable) {
    crcTable = Array.from({ length: 256 }, (_, index) => {
      let value = index;
      for (let bit = 0; bit < 8; bit++) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
      return value >>> 0;
    });
  }
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function inferPngDimensions(bytes, label) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (bytes.length < 45 || !bytes.subarray(0, 8).equals(signature)) fail(`${label} is not a valid PNG`);
  let offset = 8;
  let dimensions;
  let sawIdat = false;
  let sawIend = false;
  let chunkIndex = 0;
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) fail(`${label} has a truncated PNG chunk`);
    const length = bytes.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > bytes.length) fail(`${label} has a truncated PNG chunk payload`);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    if (!/^[A-Za-z]{4}$/.test(type)) fail(`${label} has an invalid PNG chunk type`);
    const expectedCrc = bytes.readUInt32BE(offset + 8 + length);
    const actualCrc = crc32(bytes.subarray(offset + 4, offset + 8 + length));
    if (expectedCrc !== actualCrc) fail(`${label} has a corrupt PNG ${type} chunk`);
    if (chunkIndex === 0 && type !== 'IHDR') fail(`${label} PNG must begin with IHDR`);
    if (type === 'IHDR') {
      if (chunkIndex !== 0 || length !== 13) fail(`${label} has an invalid PNG IHDR chunk`);
      const width = bytes.readUInt32BE(offset + 8);
      const height = bytes.readUInt32BE(offset + 12);
      if (!width || !height) fail(`${label} has invalid PNG dimensions`);
      dimensions = { width, height };
      const compression = bytes[offset + 18];
      const filter = bytes[offset + 19];
      const interlace = bytes[offset + 20];
      if (compression !== 0 || filter !== 0 || ![0, 1].includes(interlace)) fail(`${label} has unsupported PNG encoding fields`);
    } else if (type === 'IDAT') {
      sawIdat = true;
    } else if (type === 'IEND') {
      if (length !== 0) fail(`${label} has an invalid PNG IEND chunk`);
      sawIend = true;
      if (end !== bytes.length) fail(`${label} has trailing data after PNG IEND`);
    }
    offset = end;
    chunkIndex++;
    if (sawIend) break;
  }
  if (!dimensions || !sawIdat || !sawIend) fail(`${label} is missing required PNG chunks`);
  return dimensions;
}

// 마크업을 정규식으로 훑으면 속성 안의 주석, 문자열 안의 url(), 네임스페이스 접두사에서 문맥을 잃는다.
// 아래 토크나이저 하나로 SVG와 HTML을 같은 규칙으로 읽고, 다시 쓸 때도 토큰 단위로 바꾼다.
const RAWTEXT_ELEMENTS = new Set(['script', 'style']);
const RESOURCE_ATTRIBUTES = new Set(['href', 'src', 'poster', 'data']);

function localName(name) {
  const colon = name.indexOf(':');
  return colon < 0 ? name : name.slice(colon + 1);
}

function namePrefix(name) {
  const colon = name.indexOf(':');
  return colon < 0 ? '' : name.slice(0, colon);
}

function tokenizeMarkup(source, label) {
  const tokens = [];
  const length = source.length;
  let cursor = 0;
  while (cursor < length) {
    const open = source.indexOf('<', cursor);
    if (open < 0) { tokens.push({ kind: 'text', raw: source.slice(cursor) }); break; }
    if (open > cursor) tokens.push({ kind: 'text', raw: source.slice(cursor, open) });
    if (source.startsWith('<!--', open)) {
      const end = source.indexOf('-->', open + 4);
      if (end < 0) fail(`${label} has an unterminated comment`);
      tokens.push({ kind: 'comment', raw: source.slice(open, end + 3) });
      cursor = end + 3;
      continue;
    }
    if (source.startsWith('<![CDATA[', open)) {
      const end = source.indexOf(']]>', open + 9);
      if (end < 0) fail(`${label} has an unterminated CDATA section`);
      tokens.push({ kind: 'cdata', raw: source.slice(open, end + 3) });
      cursor = end + 3;
      continue;
    }
    if (source.startsWith('<!', open) || source.startsWith('<?', open)) {
      const end = source.indexOf('>', open);
      if (end < 0) fail(`${label} has an unterminated markup declaration`);
      tokens.push({ kind: 'declaration', raw: source.slice(open, end + 1) });
      cursor = end + 1;
      continue;
    }
    const head = /^<(\/?)([A-Za-z_][^\s/>]*)/.exec(source.slice(open));
    if (!head) { tokens.push({ kind: 'text', raw: '<' }); cursor = open + 1; continue; }
    const closing = head[1] === '/';
    const rawName = head[2];
    let at = open + head[0].length;
    const attrs = [];
    let selfClosing = false;
    for (;;) {
      while (at < length && /\s/.test(source[at])) at += 1;
      if (at >= length) fail(`${label} has an unterminated <${rawName}> tag`);
      if (source[at] === '>') { at += 1; break; }
      if (source[at] === '/' && source[at + 1] === '>') { selfClosing = true; at += 2; break; }
      const nameStart = at;
      while (at < length && !/[\s/>=]/.test(source[at])) at += 1;
      if (at === nameStart) fail(`${label} has a malformed attribute in <${rawName}>`);
      const attrRawName = source.slice(nameStart, at);
      let probe = at;
      while (probe < length && /\s/.test(source[probe])) probe += 1;
      const attr = { rawName: attrRawName, name: localName(attrRawName).toLowerCase(), prefix: namePrefix(attrRawName), hasValue: false, value: '', quote: '' };
      if (source[probe] !== '=') { attrs.push(attr); at = probe; continue; }
      probe += 1;
      while (probe < length && /\s/.test(source[probe])) probe += 1;
      const quote = source[probe];
      if (quote === '"' || quote === "'") {
        const end = source.indexOf(quote, probe + 1);
        if (end < 0) fail(`${label} has an unterminated attribute value in <${rawName}>`);
        attr.hasValue = true; attr.value = source.slice(probe + 1, end); attr.quote = quote;
        at = end + 1;
      } else {
        const valueStart = probe;
        while (probe < length && !/[\s>]/.test(source[probe])) probe += 1;
        if (probe === valueStart) fail(`${label} has an empty unquoted attribute value in <${rawName}>`);
        attr.hasValue = true; attr.value = source.slice(valueStart, probe); attr.quote = '';
        at = probe;
      }
      attrs.push(attr);
    }
    const token = { kind: 'tag', closing, selfClosing, rawName, name: localName(rawName).toLowerCase(), prefix: namePrefix(rawName), attrs };
    tokens.push(token);
    cursor = at;
    if (!closing && !selfClosing && RAWTEXT_ELEMENTS.has(token.name)) {
      // 닫는 태그는 쓰인 그대로여야 한다. `<s:script>`는 `</s:script>`로 닫힌다.
      const close = new RegExp(`</${token.rawName.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\s*>`, 'i').exec(source.slice(cursor));
      if (!close) fail(`${label} has an unterminated <${token.name}> element`);
      token.rawtext = source.slice(cursor, cursor + close.index);
      token.rawtextClose = close[0];
      cursor += close.index + close[0].length;
    }
  }
  return tokens;
}

function quoteAttributeValue(value, preferred, label, attrName) {
  const quote = preferred || (value.includes('"') ? "'" : '"');
  if (value.includes(quote)) fail(`${label} attribute ${attrName} cannot be serialized without changing its value`);
  return quote + value + quote;
}

function serializeMarkup(tokens, label) {
  let output = '';
  for (const token of tokens) {
    if (token.kind !== 'tag') { output += token.raw; continue; }
    if (token.closing) { output += `</${token.rawName}>`; continue; }
    output += `<${token.rawName}`;
    for (const attr of token.attrs) {
      output += ` ${attr.rawName}`;
      if (attr.hasValue) output += `=${quoteAttributeValue(attr.value, attr.quote, label, attr.rawName)}`;
    }
    output += token.selfClosing ? '/>' : '>';
    if (token.rawtext !== undefined) output += token.rawtext + (token.rawtextClose ?? `</${token.rawName}>`);
  }
  return output;
}

// CSS도 문맥이 필요하다. 문자열, 주석, url() 인자, at-rule 이름을 구분해 위치로 돌려준다.
function decodeCssIdentifier(value) {
  return value.replace(/\\([0-9a-fA-F]{1,6})[ \t\n]?|\\([\s\S])/g, (_, hex, literal) => (hex ? String.fromCodePoint(Number.parseInt(hex, 16)) : literal));
}

function scanCss(css) {
  const urls = [];
  const atRules = [];
  const length = css.length;
  let cursor = 0;
  while (cursor < length) {
    const char = css[cursor];
    if (char === '/' && css[cursor + 1] === '*') {
      const end = css.indexOf('*/', cursor + 2);
      cursor = end < 0 ? length : end + 2;
      continue;
    }
    if (char === '"' || char === "'") {
      cursor = skipCssString(css, cursor);
      continue;
    }
    if (char === '@') {
      const match = /^@((?:\\.|[^\s;{(])+)/.exec(css.slice(cursor));
      if (match) {
        atRules.push({ start: cursor, end: cursor + match[0].length, name: decodeCssIdentifier(match[1]).toLowerCase() });
        cursor += match[0].length;
        continue;
      }
    }
    if ((char === 'u' || char === 'U') && /^url\(/i.test(css.slice(cursor, cursor + 4))) {
      let inner = cursor + 4;
      while (inner < length && /\s/.test(css[inner])) inner += 1;
      if (css[inner] === '"' || css[inner] === "'") {
        const quote = css[inner];
        const stringEnd = skipCssString(css, inner);
        urls.push({ start: inner, end: stringEnd, quote, value: css.slice(inner + 1, stringEnd - 1) });
        cursor = stringEnd;
        continue;
      }
      const valueStart = inner;
      while (inner < length && css[inner] !== ')') inner += 1;
      if (inner >= length) return { urls, atRules, unterminated: true };
      urls.push({ start: valueStart, end: inner, quote: '', value: css.slice(valueStart, inner).trim() });
      cursor = inner;
      continue;
    }
    cursor += 1;
  }
  return { urls, atRules, unterminated: false };
}

function skipCssString(css, start) {
  const quote = css[start];
  let cursor = start + 1;
  while (cursor < css.length) {
    if (css[cursor] === '\\') { cursor += 2; continue; }
    if (css[cursor] === quote) return cursor + 1;
    cursor += 1;
  }
  return css.length;
}

function cssUrlReferences(css) {
  return scanCss(css).urls.map((entry) => entry.value.trim()).filter(Boolean);
}

async function rewriteCssUrls(css, resolve) {
  const { urls } = scanCss(css);
  if (urls.length === 0) return css;
  const replacements = [];
  for (const entry of urls) {
    const next = await resolve(entry.value.trim());
    if (next !== undefined) replacements.push({ entry, next });
  }
  let output = '';
  let cursor = 0;
  for (const { entry, next } of replacements) {
    output += css.slice(cursor, entry.start);
    output += entry.quote ? entry.quote + next + entry.quote : `"${next}"`;
    cursor = entry.end;
  }
  return output + css.slice(cursor);
}

function svgRootElement(tokens, label) {
  const root = tokens.find((token) => token.kind === 'tag' && !token.closing && token.name === 'svg');
  if (!root) fail(`${label} is not an SVG document`);
  return root;
}

function svgAttribute(root, name) {
  const found = root.attrs.filter((attr) => attr.name === name);
  return found.length === 0 ? undefined : found[found.length - 1];
}

export function inferSvgDimensions(svg, label) {
  const root = svgRootElement(tokenizeMarkup(svg, label), label);
  const widthAttr = svgAttribute(root, 'width');
  const heightAttr = svgAttribute(root, 'height');
  if (widthAttr || heightAttr) {
    if (!widthAttr || !heightAttr) fail(`${label} SVG width and height must be provided together`);
    if (!widthAttr.quote || !heightAttr.quote) fail(`${label} SVG width and height attributes must use matching quotes`);
    const dimension = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?(?:px)?$/;
    const rawWidth = widthAttr.value.trim();
    const rawHeight = heightAttr.value.trim();
    if (!dimension.test(rawWidth) || !dimension.test(rawHeight)) {
      fail(`${label} SVG width and height must be unitless numbers or px values`);
    }
    const width = Number(rawWidth.replace(/px$/i, ''));
    const height = Number(rawHeight.replace(/px$/i, ''));
    if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
      fail(`${label} SVG dimensions must be positive finite numbers`);
    }
    return { width, height };
  }
  const viewBox = svgAttribute(root, 'viewbox');
  if (viewBox) {
    const parts = viewBox.value.trim().split(/[\s,]+/);
    const width = Number(parts[2]);
    const height = Number(parts[3]);
    if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) return { width, height };
    fail(`${label} SVG viewBox width and height must be positive finite numbers`);
  }
  fail(`${label} needs positive finite width/height attributes or a valid viewBox`);
}

function isLocalReference(ref) {
  return ref.startsWith('#') || ref.startsWith('data:');
}

// 접두사와 무관하게 로컬 이름으로 거부한다. 네임스페이스 선언을 따라가지 않아도 우회할 수 없다.
function inspectSvgTokens(tokens, label, visit) {
  for (const token of tokens) {
    if (token.kind !== 'tag' || token.closing) continue;
    if (token.name === 'script') fail(`${label} contains unsupported SVG script content`);
    if (token.name === 'foreignobject') fail(`${label} contains unsupported SVG foreignObject content`);
    if (token.rawtext !== undefined) {
      if (/@import/i.test(token.rawtext)) fail(`${label} contains unsupported SVG CSS imports`);
      for (const ref of cssUrlReferences(token.rawtext)) {
        if (!isLocalReference(ref)) fail(`${label} contains external SVG URL "${ref}"`);
      }
    }
    for (const attr of token.attrs) {
      if (/^on[a-z]+$/.test(attr.name)) fail(`${label} contains unsupported SVG event handlers`);
      if (!attr.hasValue) continue;
      if (RESOURCE_ATTRIBUTES.has(attr.name)) {
        if (!attr.quote) fail(`${label} contains malformed or unquoted SVG href; SVG XML attributes must be quoted`);
        const ref = attr.value.trim();
        if (ref && !isLocalReference(ref)) visit({ token, attr, ref, kind: 'attribute' });
      }
      for (const ref of cssUrlReferences(attr.value)) {
        if (!isLocalReference(ref)) visit({ token, attr, ref, kind: 'css' });
      }
    }
  }
}

function validateSvg(svg, label) {
  inspectSvgTokens(tokenizeMarkup(svg, label), label, ({ ref, kind }) => {
    fail(kind === 'css' ? `${label} contains external SVG URL "${ref}"` : `${label} contains external SVG reference "${ref}"`);
  });
}

export function svgExternalReferences(svg) {
  const refs = [];
  try {
    inspectSvgTokens(tokenizeMarkup(svg, 'svg'), 'svg', ({ ref }) => refs.push(ref));
  } catch {
    // 살균 실패는 inventory의 책임이 아니다. 여기서는 읽어낸 참조만 돌려준다.
  }
  return [...new Set(refs)];
}

export async function inlineSvgReferences(svg, svgDir, baseReal, label) {
  const tokens = tokenizeMarkup(svg, label);
  const slots = [];
  inspectSvgTokens(tokens, label, (slot) => slots.push(slot));
  if (slots.length === 0) return { svg, references: [] };
  const cache = new Map();
  const embed = async (ref) => {
    if (!cache.has(ref)) {
      if (isForbiddenUrl(ref)) fail(`${label} references a remote asset "${ref}"; place an approved local copy beside the slide first`);
      const [pathname, fragment] = splitFragment(ref);
      const authored = path.relative(baseReal, path.resolve(svgDir, pathname));
      const file = await containedFile(baseReal, authored, `${label} reference "${ref}"`);
      cache.set(ref, (await embeddedFileData(file, `${label} reference "${ref}"`, 'image-or-font')) + fragment);
    }
    return cache.get(ref);
  };
  for (const slot of slots) {
    if (slot.kind === 'attribute') slot.attr.value = await embed(slot.ref);
  }
  for (const token of tokens) {
    if (token.kind !== 'tag' || token.closing) continue;
    for (const attr of token.attrs) {
      if (!attr.hasValue || RESOURCE_ATTRIBUTES.has(attr.name)) continue;
      attr.value = await rewriteCssUrls(attr.value, async (ref) => (isLocalReference(ref) ? undefined : embed(ref)));
    }
    if (token.rawtext !== undefined) {
      token.rawtext = await rewriteCssUrls(token.rawtext, async (ref) => (isLocalReference(ref) ? undefined : embed(ref)));
    }
  }
  const inlined = serializeMarkup(tokens, label);
  validateSvg(inlined, `${label} after inlining`);
  return { svg: inlined, references: [...cache.keys()] };
}

function splitFragment(ref) {
  const hash = ref.indexOf('#');
  return hash < 0 ? [ref, ''] : [ref.slice(0, hash), ref.slice(hash)];
}

function embeddedAssetSizes(svg) {
  const sizes = new Map();
  for (const match of svg.matchAll(/data:[a-z0-9.+-]+\/[a-z0-9.+-]+;base64,([A-Za-z0-9+/=]{2048,})/gi)) {
    const payload = match[1];
    const key = `${payload.length}:${payload.slice(0, 48)}:${payload.slice(-48)}`;
    const entry = sizes.get(key);
    if (entry) entry.count += 1;
    else sizes.set(key, { bytes: Math.floor((payload.length * 3) / 4), count: 1 });
  }
  return sizes;
}

// 같은 파일이 여러 슬라이드에 쓰이면 realpath, read, 검증, base64를 매번 반복할 이유가 없다.
// 한 번의 컴파일 동안만 사는 캐시이므로 파일이 도중에 바뀌는 경우는 고려하지 않는다.
let embedCache = new Map();

async function embeddedFileData(file, label, allowed) {
  const mime = mimeFor(file);
  const isImage = mime.startsWith('image/');
  const isFont = mime.startsWith('font/');
  if ((allowed === 'image' && !isImage) || (allowed === 'image-or-font' && !isImage && !isFont)) {
    fail(`${label} has unsupported ${allowed === 'image' ? 'image' : 'CSS asset'} type "${path.extname(file) || '(none)'}"`);
  }
  const cached = embedCache.get(file);
  if (cached !== undefined) return cached;
  const bytes = await fs.readFile(file);
  if (mime === 'image/svg+xml') validateSvg(bytes.toString('utf8'), label);
  if (mime === 'image/png') inferPngDimensions(bytes, label);
  const encoded = dataUrl(bytes, mime);
  embedCache.set(file, encoded);
  return encoded;
}

function escapeClosingTag(source, tag) {
  return source.replace(new RegExp(`</${tag}`, 'gi'), `<\\/${tag}`);
}

function isForbiddenUrl(value) {
  return /^(?:https?:|\/\/|file:|ftp:|javascript:)/i.test(value.trim());
}

async function inlineCss(css, cssDir, baseReal, label, importStack = new Set()) {
  if (/expression\s*\(/i.test(css)) fail(`${label} contains unsupported CSS expression()`);
  const scan = scanCss(css);
  if (scan.unterminated) fail(`${label} contains unsupported or malformed CSS url() syntax`);

  // at-rule 이름은 이스케이프를 풀고 본다. `@im\70ort`도 import이다.
  let output = '';
  let cursor = 0;
  for (const rule of scan.atRules) {
    if (rule.name !== 'import') continue;
    const semicolon = css.indexOf(';', rule.end);
    if (semicolon < 0) fail(`${label} contains an unterminated CSS @import`);
    const prelude = css.slice(rule.end, semicolon);
    const preludeScan = scanCss(prelude);
    const target = preludeScan.urls[0] ?? firstCssString(prelude);
    if (!target) fail(`${label} contains unsupported CSS @import syntax`);
    const ref = target.value.trim();
    const trailing = (prelude.slice(0, target.start) + prelude.slice(target.end)).replace(/^\s*url\(\s*/i, '').replace(/^\s*\)\s*/, '').trim();
    if (trailing) fail(`${label} uses unsupported conditional CSS @import for "${ref}"`);
    if (isForbiddenUrl(ref) || ref.startsWith('data:') || ref.startsWith('#')) fail(`${label} has unsupported CSS @import "${ref}"`);
    const absolute = await containedFile(baseReal, path.relative(baseReal, path.resolve(cssDir, ref)), `${label} @import`);
    if (path.extname(absolute).toLowerCase() !== '.css') fail(`${label} @import must reference a .css file`);
    if (importStack.has(absolute)) fail(`${label} contains a cyclic CSS @import involving "${ref}"`);
    importStack.add(absolute);
    output += css.slice(cursor, rule.start);
    output += await inlineCss(await fs.readFile(absolute, 'utf8'), path.dirname(absolute), baseReal, `${label} -> ${ref}`, importStack);
    importStack.delete(absolute);
    cursor = semicolon + 1;
  }
  output += css.slice(cursor);
  if (scanCss(output).atRules.some((rule) => rule.name === 'import')) fail(`${label} contains unsupported CSS @import syntax`);

  return rewriteCssUrls(output, async (ref) => {
    if (ref.startsWith('data:') || ref.startsWith('#')) return undefined;
    if (!ref) fail(`${label} contains unsupported or malformed CSS url() syntax`);
    if (isForbiddenUrl(ref) || ref.startsWith('blob:')) fail(`${label} contains unsupported CSS URL "${ref}"`);
    const [pathname, fragment] = splitFragment(ref);
    const absolute = await containedFile(baseReal, path.relative(baseReal, path.resolve(cssDir, pathname)), `${label} url()`);
    return (await embeddedFileData(absolute, `${label} url()`, 'image-or-font')) + fragment;
  });
}

function firstCssString(source) {
  const match = /["']/.exec(source);
  if (!match) return null;
  const end = skipCssString(source, match.index);
  return { start: match.index, end, quote: source[match.index], value: source.slice(match.index + 1, end - 1) };
}

function cspForHtml(allowScripts) {
  const script = allowScripts ? "script-src 'unsafe-inline'; " : "script-src 'none'; ";
  return `default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; ${script}connect-src 'none'; form-action 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; object-src 'none'; media-src 'none'; base-uri 'none'; manifest-src 'none'`;
}

function requiredAttribute(token, name, label) {
  const found = token.attrs.filter((attr) => attr.name === name);
  if (found.length > 1) fail(`${label} contains duplicate ${name} attributes`);
  return found[0];
}

function quotedValue(attr, name, label) {
  if (!attr.hasValue || !attr.quote) fail(`${label} attribute ${name} must use matching quotes`);
  return attr.value;
}

const ACTIVE_ELEMENTS = new Set(['iframe', 'frame', 'frameset', 'object', 'embed', 'form', 'base']);
const MEDIA_ELEMENTS = new Set(['video', 'audio', 'source', 'track']);

async function processHtml(html, htmlFile, baseReal, allowScripts, label) {
  const htmlDir = path.dirname(htmlFile);
  const tokens = tokenizeMarkup(html, label);

  for (const token of tokens) {
    if (token.kind !== 'tag' || token.closing) continue;
    const name = token.name;
    if (ACTIVE_ELEMENTS.has(name)) fail(`${label} contains unsupported active or navigational HTML element <${name}>`);
    if (MEDIA_ELEMENTS.has(name)) fail(`${label} contains unsupported media element <${name}>`);

    if (name === 'script') {
      if (!allowScripts) fail(`${label} contains scripts but allowScripts is false`);
      const type = requiredAttribute(token, 'type', `${label} script`);
      if (type?.hasValue && type.value.trim().toLowerCase() === 'module') fail(`${label} uses unsupported JavaScript modules`);
      const src = requiredAttribute(token, 'src', `${label} script`);
      let body = token.rawtext ?? '';
      if (src) {
        if (body.trim()) fail(`${label} external script has unsupported inline fallback content`);
        for (const timing of ['defer', 'async']) {
          if (token.attrs.some((attr) => attr.name === timing)) {
            fail(`${label} script uses ${timing}, which stops applying once the file is inlined; remove it or inline the script yourself`);
          }
        }
        const ref = quotedValue(src, 'src', `${label} script`).trim();
        if (isForbiddenUrl(ref) || ref.startsWith('data:') || ref.startsWith('blob:')) fail(`${label} contains unsupported script source "${ref}"`);
        const scriptFile = await containedFile(baseReal, path.relative(baseReal, path.resolve(htmlDir, ref)), `${label} script`);
        if (path.extname(scriptFile).toLowerCase() !== '.js') fail(`${label} script must reference a classic .js file`);
        body = await fs.readFile(scriptFile, 'utf8');
        token.attrs = token.attrs.filter((attr) => attr !== src);
      }
      if (/\b(?:import\s*(?:\(|["'{*])|export\s+(?:default|const|let|var|function|class|\{))/m.test(body)) fail(`${label} contains unsupported imported/module JavaScript`);
      if (/\b(?:fetch\s*\(|XMLHttpRequest\b|WebSocket\b|EventSource\b|navigator\.sendBeacon\b)/.test(body)) fail(`${label} contains unsupported network-dependent JavaScript`);
      token.rawtext = escapeClosingTag(body, 'script');
      continue;
    }

    if (name === 'style') {
      if (requiredAttribute(token, 'src', `${label} style`)) fail(`${label} contains unsupported style src attributes`);
      token.rawtext = escapeClosingTag(await inlineCss(token.rawtext ?? '', htmlDir, baseReal, `${label} inline style`), 'style');
      continue;
    }

    if (name === 'meta') {
      const equiv = requiredAttribute(token, 'http-equiv', `${label} <meta>`);
      if (equiv?.hasValue && equiv.value.trim().toLowerCase() === 'refresh') fail(`${label} contains unsupported meta refresh navigation`);
    }
    if (token.attrs.some((attr) => attr.name === 'srcset')) fail(`${label} uses unsupported srcset; use one local img src instead`);
    if (!allowScripts && token.attrs.some((attr) => /^on[a-z]+$/.test(attr.name))) fail(`${label} contains event handlers but allowScripts is false`);

    const style = requiredAttribute(token, 'style', `${label} <${name}>`);
    if (style?.hasValue) style.value = await inlineCss(style.value, htmlDir, baseReal, `${label} style attribute`);

    if (name === 'link') {
      const rel = requiredAttribute(token, 'rel', `${label} <link>`);
      const href = requiredAttribute(token, 'href', `${label} <link>`);
      if (!rel) fail(`${label} requires a quoted rel attribute`);
      if (!href) fail(`${label} requires a quoted href attribute`);
      const relValues = quotedValue(rel, 'rel', `${label} <link>`).toLowerCase().split(/\s+/).filter(Boolean);
      if (!relValues.includes('stylesheet')) fail(`${label} contains an unsupported <link> dependency`);
      const media = requiredAttribute(token, 'media', `${label} <link>`);
      if (media?.hasValue && media.value.trim()) {
        fail(`${label} stylesheet uses media="${media.value.trim()}", which is lost when the file is inlined; wrap the rules in @media inside the stylesheet instead`);
      }
      const ref = quotedValue(href, 'href', `${label} <link>`).trim();
      if (isForbiddenUrl(ref) || ref.startsWith('data:') || ref.startsWith('blob:')) fail(`${label} contains remote or unsupported stylesheet "${ref}"`);
      const cssFile = await containedFile(baseReal, path.relative(baseReal, path.resolve(htmlDir, ref)), `${label} stylesheet`);
      if (path.extname(cssFile).toLowerCase() !== '.css') fail(`${label} stylesheet must reference a .css file`);
      const css = await inlineCss(await fs.readFile(cssFile, 'utf8'), path.dirname(cssFile), baseReal, `${label} stylesheet ${ref}`);
      token.rawName = 'style';
      token.name = 'style';
      token.attrs = [];
      token.selfClosing = false;
      token.rawtext = escapeClosingTag(css, 'style');
      token.rawtextClose = '</style>';
      continue;
    }

    if (name === 'img') {
      const src = requiredAttribute(token, 'src', `${label} <img>`);
      if (!src) fail(`${label} requires a quoted src attribute`);
      const ref = quotedValue(src, 'src', `${label} <img>`).trim();
      if (!ref.startsWith('data:')) {
        if (isForbiddenUrl(ref) || ref.startsWith('blob:') || ref.startsWith('#')) fail(`${label} contains unsupported image source "${ref}"`);
        const imageFile = await containedFile(baseReal, path.relative(baseReal, path.resolve(htmlDir, ref)), `${label} image`);
        src.value = await embeddedFileData(imageFile, `${label} image`, 'image');
        src.quote = '"';
      }
    }
  }

  // 남은 자원 참조는 전부 거부한다. 인라인되지 않은 것은 실행 시 네트워크를 부른다는 뜻이다.
  for (const token of tokens) {
    if (token.kind !== 'tag' || token.closing) continue;
    for (const attr of token.attrs) {
      if (!RESOURCE_ATTRIBUTES.has(attr.name) || !attr.hasValue) continue;
      if (!attr.quote) fail(`${label} attribute ${attr.name} must use matching quotes`);
      const ref = attr.value.trim();
      if (ref && !ref.startsWith('data:') && !ref.startsWith('#')) fail(`${label} has an unembedded or navigational reference "${ref}"`);
    }
  }

  return withContentSecurityPolicy(tokens, allowScripts, label);
}

// CSP meta는 head 안에 있고 실행 가능한 내용보다 앞에 있어야 효력이 있다.
// 둘 다 만족시킬 수 없는 문서는 통과시키지 않는다. 정책 없이 실행되는 편보다 낫다.
const ACTIVE_BEFORE_POLICY = new Set(['script', 'style', 'img', 'link', 'svg', 'canvas']);

function withContentSecurityPolicy(tokens, allowScripts, label) {
  const meta = { kind: 'text', raw: `<meta http-equiv="Content-Security-Policy" content="${cspForHtml(allowScripts)}">` };
  const isActive = (token) => token.kind === 'tag' && !token.closing
    && (ACTIVE_BEFORE_POLICY.has(token.name) || token.attrs.some((attr) => RESOURCE_ATTRIBUTES.has(attr.name)));
  const activeIndex = tokens.findIndex(isActive);
  const headIndex = tokens.findIndex((token) => token.kind === 'tag' && !token.closing && token.name === 'head');
  const htmlIndex = tokens.findIndex((token) => token.kind === 'tag' && !token.closing && token.name === 'html');
  const anchor = headIndex >= 0 ? headIndex : htmlIndex;
  if (anchor >= 0 && activeIndex >= 0 && activeIndex < anchor) {
    fail(`${label} places <${tokens[activeIndex].name}> before <${headIndex >= 0 ? 'head' : 'html'}>; the security policy cannot be applied to it. Move that content inside the document body.`);
  }
  if (headIndex >= 0) {
    tokens.splice(headIndex + 1, 0, meta);
    return serializeMarkup(tokens, label);
  }
  if (htmlIndex >= 0) {
    tokens.splice(htmlIndex + 1, 0, { kind: 'text', raw: '<head>' }, meta, { kind: 'text', raw: '</head>' });
    return serializeMarkup(tokens, label);
  }
  const doctypeIndex = tokens.findIndex((token) => token.kind === 'declaration' && /^<!doctype/i.test(token.raw));
  const body = serializeMarkup(tokens.slice(doctypeIndex + 1), label);
  const doctype = doctypeIndex >= 0 ? tokens[doctypeIndex].raw : '<!doctype html>';
  return `${doctype}<html><head>${meta.raw}</head><body>${body}</body></html>`;
}

async function loadSlideAsset(slide, baseReal, label) {
  const file = await containedFile(baseReal, slide.src, `${label}.src`);
  const ext = path.extname(file).toLowerCase();
  if (ext !== `.${slide.format}` && !(slide.format === 'html' && ['.htm', '.html'].includes(ext))) {
    fail(`${label}.src extension does not match format "${slide.format}"`);
  }
  let asset;
  let inferred;
  let embedded;
  if (slide.format === 'png') {
    const bytes = await fs.readFile(file);
    inferred = inferPngDimensions(bytes, `${label}.src`);
    asset = dataUrl(bytes, 'image/png');
  } else if (slide.format === 'svg') {
    const svg = await fs.readFile(file, 'utf8');
    validateSvg(svg, `${label}.src`);
    inferred = inferSvgDimensions(svg, `${label}.src`);
    embedded = embeddedAssetSizes(svg);
    asset = dataUrl(Buffer.from(svg), 'image/svg+xml');
  } else {
    const html = await fs.readFile(file, 'utf8');
    asset = await processHtml(html, file, baseReal, slide.allowScripts, `${label}.src`);
  }

  let width = slide.width;
  let height = slide.height;
  if (width === undefined) {
    if (!inferred) fail(`${label} html slides require manifest width and height`);
    ({ width, height } = inferred);
  }
  if (inferred && slide.width !== undefined && (slide.width !== inferred.width || slide.height !== inferred.height)) {
    fail(`${label} manifest dimensions ${slide.width}x${slide.height} do not match asset dimensions ${inferred.width}x${inferred.height}`);
  }

  let poster;
  if (slide.poster !== undefined) {
    const posterFile = await containedFile(baseReal, slide.poster, `${label}.poster`);
    const posterExt = path.extname(posterFile).toLowerCase();
    if (!['.png', '.svg'].includes(posterExt)) fail(`${label}.poster must be a local png or svg`);
    const bytes = await fs.readFile(posterFile);
    if (posterExt === '.png') inferPngDimensions(bytes, `${label}.poster`);
    else validateSvg(bytes.toString('utf8'), `${label}.poster`);
    poster = dataUrl(bytes, posterExt === '.png' ? 'image/png' : 'image/svg+xml');
  }
  return { asset, poster, nativeWidth: width, nativeHeight: height, embedded };
}

function slideSize(slide) {
  if (!Number.isFinite(slide.nativeWidth) || slide.nativeWidth <= 0 || !Number.isFinite(slide.nativeHeight) || slide.nativeHeight <= 0) {
    fail(`slide "${slide.id}" has nonfinite or nonpositive native dimensions`);
  }
  const height = DISPLAY_WIDTH * (slide.nativeHeight / slide.nativeWidth);
  if (!Number.isFinite(height) || height <= 0) fail(`slide "${slide.id}" produces a nonfinite or nonpositive content layout size`);
  return { width: DISPLAY_WIDTH, height };
}

function placeChildren(group, isRoot) {
  const gap = group.gap;
  const leadX = isRoot ? 0 : GROUP_PADDING;
  const leadY = isRoot ? 0 : GROUP_HEADER;
  const tailX = isRoot ? 0 : GROUP_PADDING;
  const tailY = isRoot ? 0 : GROUP_PADDING;
  const children = group.children;
  const placements = [];

  if (group.layout === 'free') {
    for (const child of children) {
      if (!child.position) fail(`free-layout group "${group.id}" requires position {x,y} on child "${child.id}"`);
      placements.push({ child, x: leadX + child.position.x, y: leadY + child.position.y });
    }
  } else if (group.layout === 'row') {
    let x = leadX;
    for (const child of children) {
      placements.push({ child, x, y: leadY });
      x += child.box.width + gap;
    }
  } else if (group.layout === 'column') {
    let y = leadY;
    for (const child of children) {
      placements.push({ child, x: leadX, y });
      y += child.box.height + gap;
    }
  } else if (group.layout === 'grid') {
    const columns = Math.min(group.columns, children.length);
    const colWidths = Array(columns).fill(0);
    const rows = Math.ceil(children.length / columns);
    const rowHeights = Array(rows).fill(0);
    children.forEach((child, index) => {
      colWidths[index % columns] = Math.max(colWidths[index % columns], child.box.width);
      rowHeights[Math.floor(index / columns)] = Math.max(rowHeights[Math.floor(index / columns)], child.box.height);
    });
    const xs = [];
    const ys = [];
    let x = leadX;
    for (const width of colWidths) { xs.push(x); x += width + gap; }
    let y = leadY;
    for (const height of rowHeights) { ys.push(y); y += height + gap; }
    children.forEach((child, index) => placements.push({ child, x: xs[index % columns], y: ys[Math.floor(index / columns)] }));
  } else if (group.layout === 'tree') {
    const root = children[0];
    const branches = children.slice(1);
    if (branches.length === 0) {
      placements.push({ child: root, x: leadX, y: leadY });
    } else {
      const branchesWidth = branches.reduce((sum, child) => sum + child.box.width, 0) + gap * (branches.length - 1);
      const contentWidth = Math.max(branchesWidth, root.box.width);
      const rootX = leadX + (contentWidth - root.box.width) / 2;
      placements.push({ child: root, x: rootX, y: leadY });
      let x = leadX + (contentWidth - branchesWidth) / 2;
      const branchY = leadY + root.box.height + gap;
      for (const child of branches) {
        placements.push({ child, x, y: branchY });
        x += child.box.width + gap;
      }
    }
  }

  for (const placement of placements) {
    const right = placement.x + placement.child.box.width;
    const bottom = placement.y + placement.child.box.height;
    if (![placement.x, placement.y, placement.child.box.width, placement.child.box.height, right, bottom].every(Number.isFinite)) {
      fail(`group "${group.id}" produces nonfinite layout geometry near child "${placement.child.id}"`);
    }
  }
  const maxRight = Math.max(...placements.map((p) => p.x + p.child.box.width));
  const maxBottom = Math.max(...placements.map((p) => p.y + p.child.box.height));
  const width = Math.max(1, maxRight + tailX);
  const height = Math.max(1, maxBottom + tailY);
  if (!Number.isFinite(width) || !Number.isFinite(height)) fail(`group "${group.id}" produces nonfinite layout bounds`);
  group.placements = placements;
  group.box = { width, height };
}

function calculateBoxes(node, isRoot = false) {
  if (node.kind === 'slide') {
    node.box = slideSize(node);
    return node.box;
  }
  for (const child of node.children) calculateBoxes(child, false);
  placeChildren(node, isRoot);
  return node.box;
}

function emitLayout(root) {
  const nodes = [];
  const edges = [];
  const boundsById = Object.create(null);

  function visitGroup(group, absX, absY, renderedParentId, isRoot) {
    boundsById[group.id] = { x: absX, y: absY, width: group.box.width, height: group.box.height };
    if (!isRoot) {
      const position = renderedParentId ? group.relative : { x: absX, y: absY };
      nodes.push({
        id: group.id,
        type: 'frame',
        position,
        ...(renderedParentId ? { parentId: renderedParentId, extent: 'parent' } : {}),
        width: group.box.width,
        height: group.box.height,
        style: { width: group.box.width, height: group.box.height },
        data: {
          kind: 'group', title: group.title, summary: group.summary, parentId: group.semanticParentId,
          depth: group.depth - 1, ...(group.color ? { color: group.color } : {}),
        },
      });
    }
    const rfParent = isRoot ? undefined : group.id;
    for (const placement of group.placements) {
      const child = placement.child;
      child.relative = { x: placement.x, y: placement.y };
      child.semanticParentId = group.id;
      const childAbsX = absX + placement.x;
      const childAbsY = absY + placement.y;
      if (!Number.isFinite(childAbsX) || !Number.isFinite(childAbsY)) {
        fail(`node "${child.id}" produces nonfinite absolute layout coordinates`);
      }
      if (child.kind === 'group') {
        visitGroup(child, childAbsX, childAbsY, rfParent, false);
      } else {
        boundsById[child.id] = { x: childAbsX, y: childAbsY, width: child.box.width, height: child.box.height };
        nodes.push({
          id: child.id,
          type: 'slide',
          position: rfParent ? child.relative : { x: childAbsX, y: childAbsY },
          ...(rfParent ? { parentId: rfParent, extent: 'parent' } : {}),
          width: child.box.width,
          height: child.box.height,
          style: { width: child.box.width, height: child.box.height },
          data: {
            kind: 'slide', title: child.title, summary: child.summary, parentId: group.id,
            depth: child.depth - 1, format: child.format, asset: child.asset,
            ...(child.poster ? { poster: child.poster } : {}),
            nativeWidth: child.nativeWidth, nativeHeight: child.nativeHeight,
            allowScripts: child.allowScripts, alt: child.alt, notes: child.notes,
            ...(child.color ? { color: child.color } : {}),
          },
        });
      }
    }
    if (group.layout === 'tree' && group.children.length > 1) {
      const source = group.children[0].id;
      // 대상 ID는 트리 전체에서 유일하다. 하이픈으로 이어 붙이면 서로 다른 조합이 같은 ID가 될 수 있다.
      for (const child of group.children.slice(1)) edges.push({ id: `tree:${child.id}`, source, target: child.id, type: 'smoothstep' });
    }
  }

  visitGroup(root, 0, 0, undefined, true);
  boundsById.overview = { ...boundsById[root.id] };
  return { nodes, edges, boundsById };
}

function layoutManifest(normalizedRoot) {
  calculateBoxes(normalizedRoot, true);
  return emitLayout(normalizedRoot);
}

export async function compileManifest(manifest, baseDir) {
  if (!isObject(manifest)) fail('manifest must be an object');
  if (manifest.version !== 1) fail('manifest.version must be 1');
  if (typeof baseDir !== 'string' || baseDir === '') fail('baseDir must be a directory path');
  let baseReal;
  try {
    baseReal = await fs.realpath(baseDir);
  } catch (error) {
    fail(`baseDir does not exist: ${baseDir} (${error.code || error.message})`);
  }
  if (!(await fs.stat(baseReal)).isDirectory()) fail(`baseDir is not a directory: ${baseDir}`);
  embedCache = new Map();
  const original = jsonClone(manifest);
  const title = text(manifest.title, 'manifest.title');
  const description = text(manifest.description, 'manifest.description');
  if (!isObject(manifest.canvas)) fail('manifest.canvas must be a group object');
  if (manifest.canvas.kind !== 'group') fail('manifest.canvas root must have kind "group"');

  const ids = new Set();
  const records = [];
  const root = normalizeNode(manifest.canvas, 0, 'manifest.canvas', ids, records);
  const slides = new Set(records.filter((record) => record.kind === 'slide').map((record) => record.id));
  const warnings = [];
  const { paths, defaultPath } = validatePaths(manifest, ids, slides, warnings);

  const slideErrors = [];
  const assetUsage = new Map();
  for (const record of records) {
    if (record.kind !== 'slide') continue;
    const label = `slide "${record.id}"`;
    let loaded;
    try {
      loaded = await loadSlideAsset(record, baseReal, label);
    } catch (error) {
      slideErrors.push(error.message);
      continue;
    }
    Object.assign(record, loaded);
    if (!record.alt) warnings.push(`${label} has no alt text`);
    if (!record.notes) warnings.push(`${label} has no presenter notes`);
    if (record.format === 'html' && !record.poster) warnings.push(`${label} has no poster image`);
    for (const [key, entry] of record.embedded ?? []) {
      const usage = assetUsage.get(key) ?? { bytes: entry.bytes, copies: 0 };
      usage.copies += entry.count;
      assetUsage.set(key, usage);
    }
    delete record.embedded;
  }
  if (slideErrors.length > 0) {
    fail(slideErrors.length === 1 ? slideErrors[0] : `${slideErrors.length} slides failed to load:\n  - ${slideErrors.join('\n  - ')}`);
  }
  for (const usage of assetUsage.values()) {
    const total = usage.bytes * usage.copies;
    if (usage.copies > 1 && total >= DUPLICATE_ASSET_WARN_BYTES) {
      warnings.push(`the same embedded asset is inlined ${usage.copies} times, about ${Math.round(total / 1024)} KB total; shrink the asset or drop it from every slide`);
    }
  }

  const { nodes, edges, boundsById } = layoutManifest(root);
  const counts = {
    slides: records.filter((record) => record.kind === 'slide').length,
    groups: records.filter((record) => record.kind === 'group').length - 1,
    html: records.filter((record) => record.kind === 'slide' && record.format === 'html').length,
    svg: records.filter((record) => record.kind === 'slide' && record.format === 'svg').length,
    png: records.filter((record) => record.kind === 'slide' && record.format === 'png').length,
  };
  return {
    version: 1,
    title,
    description,
    tree: original.canvas,
    paths: jsonClone(paths, 'manifest.paths'),
    defaultPath,
    nodes,
    edges,
    boundsById,
    counts,
    warnings,
    manifest: original,
  };
}

export const constants = Object.freeze({
  MAX_DEPTH, DISPLAY_WIDTH, GROUP_PADDING, GROUP_HEADER, DEFAULT_GAP,
});
