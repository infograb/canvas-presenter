import { constants } from 'node:fs';
import fs from 'node:fs/promises';

export async function findBrowserExecutable() {
  const candidates = [
    process.env.BROWSER_BIN,
    process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : null,
    process.platform === 'darwin' ? '/Applications/Chromium.app/Contents/MacOS/Chromium' : null,
    process.platform === 'linux' ? '/usr/bin/google-chrome' : null,
    process.platform === 'linux' ? '/usr/bin/google-chrome-stable' : null,
    process.platform === 'linux' ? '/usr/bin/chromium' : null,
    process.platform === 'linux' ? '/usr/bin/chromium-browser' : null,
    process.platform === 'win32' && process.env.PROGRAMFILES
      ? `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`
      : null,
    process.platform === 'win32' && process.env['PROGRAMFILES(X86)']
      ? `${process.env['PROGRAMFILES(X86)']}\\Google\\Chrome\\Application\\chrome.exe`
      : null,
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      await fs.access(candidate, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
      return candidate;
    } catch {}
  }

  throw new Error(`No Chromium-based browser found. Set BROWSER_BIN to an executable path. Checked: ${candidates.join(', ')}`);
}
