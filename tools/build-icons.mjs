#!/usr/bin/env node
/**
 * Render the PWA icons from assets/icon-template.html.
 *
 *   node tools/build-icons.mjs
 *
 * Needs Playwright and a running dev server. A one-off asset step; the
 * committed PNGs are what ship.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const base = process.env.OG_BASE ?? 'http://localhost:8080';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('build-icons: needs playwright (npm i -D playwright)');
  process.exit(2);
}

const ICONS = [
  { file: 'icon-192.png', size: 192, maskable: false },
  { file: 'icon-512.png', size: 512, maskable: false },
  { file: 'icon-maskable-512.png', size: 512, maskable: true },
  // iOS ignores the manifest icons and rounds the corners itself.
  { file: 'apple-touch-icon.png', size: 180, maskable: false },
];

const browser = await chromium.launch(
  process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {},
);

for (const { file, size, maskable } of ICONS) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  const url = `${base}/assets/icon-template.html?size=${size}&maskable=${maskable ? 1 : 0}`;
  const res = await page.goto(url, { waitUntil: 'networkidle' });
  if (!res?.ok()) {
    console.error(`build-icons: ${url} returned ${res?.status()} — is the dev server up (npm start)?`);
    await browser.close();
    process.exit(1);
  }
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(root, 'assets', file) });
  await page.close();
  console.log(`  ${file}  ${size}x${size}${maskable ? '  (maskable)' : ''}`);
}

await browser.close();
console.log('build-icons: done');
