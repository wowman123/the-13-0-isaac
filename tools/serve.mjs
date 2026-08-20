#!/usr/bin/env node
/** Static file server for local development. No dependencies, no config. */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT ?? 8080);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  // Chrome refuses a manifest served as octet-stream.
  '.webmanifest': 'application/manifest+json',
};

createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    // normalize() collapses any ../ before it can escape the project root.
    const rel = normalize(path).replace(/^(\.\.[/\\])+/, '').replace(/^\/+/, '');
    let file = join(root, rel || 'index.html');

    if ((await stat(file).catch(() => null))?.isDirectory()) file = join(file, 'index.html');
    if (!file.startsWith(root)) {
      res.writeHead(403).end('forbidden');
      return;
    }

    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(body);
  } catch (err) {
    // Only a genuinely missing file is a 404. Reporting every failure as one
    // makes a permissions or read error look like a routing bug.
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
      return;
    }
    console.error(`serve: ${req.url} failed:`, err.message);
    res.writeHead(500, { 'content-type': 'text/plain' }).end('server error');
  }
}).listen(port, () => {
  console.log(`the-13-0 running at http://localhost:${port}`);

  // Bind is on every interface, so print the LAN address too — that is the one
  // a phone on the same network can actually open.
  const lan = Object.values(networkInterfaces())
    .flat()
    .filter((n) => n && n.family === 'IPv4' && !n.internal)
    .map((n) => n.address);

  for (const address of lan) console.log(`  on your network:  http://${address}:${port}`);
  if (lan.length) {
    console.log('\n  Service workers need a secure context, so over plain http on a LAN');
    console.log('  address the site works but will not install or run offline.');
  }
});
