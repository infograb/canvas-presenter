import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { findBrowserExecutable } from './browser-bin.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const slides = path.join(root, 'assets', 'examples', 'slides');
const browser = await chromium.launch({ headless: true, executablePath: await findBrowserExecutable() });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
const page = await context.newPage();

try {
  const jobs = [
    ['03-media-source.svg', '03-media.png'],
    ['06-interaction.html', '06-interaction-poster.png'],
  ];
  for (const [source, target] of jobs) {
    await page.goto(pathToFileURL(path.join(slides, source)).href);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(slides, target), type: 'png', fullPage: false });
    console.log(`Rendered ${target} from ${source}`);
  }
} finally {
  await browser.close();
}

await fs.writeFile(path.join(slides, '.render-metadata.json'), `${JSON.stringify({ viewport: [1920, 1080], deviceScaleFactor: 1, browser: 'Chromium-based browser selected by BROWSER_BIN or platform lookup' }, null, 2)}\n`);
