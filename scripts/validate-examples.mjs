import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileManifest } from './core.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const examples = ['grouped', 'tree', 'sequence'];
const results = [];

for (const name of examples) {
  const file = path.join(root, 'assets', 'examples', `${name}.json`);
  const manifest = JSON.parse(await fs.readFile(file, 'utf8'));
  const payload = await compileManifest(manifest, path.dirname(file));
  if (payload.warnings.length) {
    throw new Error(`${name}.json has warnings:\n${payload.warnings.map(warning => `- ${warning}`).join('\n')}`);
  }
  results.push({ name, counts: payload.counts, paths: payload.paths.length });
}

console.log(JSON.stringify({ valid: true, examples: results }, null, 2));
