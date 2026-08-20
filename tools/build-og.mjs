#!/usr/bin/env node
/**
 * Render assets/og-template.html to assets/og-image.png (1200x630).
 *
 *   node tools/build-og.mjs
 *
 * Needs Playwright and a running dev server. This is a one-off asset step, not
 * part of `npm run check` — the committed PNG is what ships.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const base = process.env.OG_BASE ?? 'http://localhost:8080';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('build-og: needs playwright (npm i -D playwright)');
  process.exit(2);
}

const browser = await chromium.launch(
  process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {},
);
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });

const res = await page.goto(`${base}/assets/og-template.html`, { waitUntil: 'networkidle' });
if (!res?.ok()) {
  console.error(`build-og: ${base}/assets/og-template.html returned ${res?.status()} — is the dev server up (npm start)?`);
  await browser.close();
  process.exit(1);
}
await page.evaluate(() => document.fonts.ready);

await page.screenshot({ path: join(root, 'assets/og-image.png') });
await browser.close();
console.log('build-og: wrote assets/og-image.png (1200x630)');
