#!/usr/bin/env node
/** Static file server for local development. No dependencies, no config. */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
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
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
  }
}).listen(port, () => console.log(`the-13-0 running at http://localhost:${port}`));
