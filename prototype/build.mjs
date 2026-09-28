// Samler den klikbare prototype til én fil.
//
//   node prototype/build.mjs
//
// Produktnavnet hentes fra product.config.json og testdata fra Golden Test
// Case (fixtures/golden-test-case), så prototypen aldrig har sit eget
// brand eller sine egne kopier af Sander.
//
// Skriver to filer:
//   prototype/index.html       — til Artifact-udgivelse (uden <html>/<head>)
//   prototype/standalone.html  — kan åbnes direkte i en browser

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const read = (p) => readFileSync(join(here, 'src', p), 'utf8');
const product = JSON.parse(readFileSync(join(root, 'product.config.json'), 'utf8'));
const golden = JSON.parse(readFileSync(join(root, 'fixtures', 'golden-test-case', 'golden-test-case.json'), 'utf8'));

const escHtml = (t) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
// JSON inde i <script>: undgå at "</script>" i data kan lukke tagget.
const js = (v) => JSON.stringify(v).replace(/</g, '\\u003c');

const injected = `\nconst PRODUCT_NAME = ${js(product.name)};\nconst GOLDEN = ${js(golden)};\n`;
const data = read('app-data.html').replace("'use strict';", `'use strict';${injected}`);

const body = [
  read('base.css.html').replace('%PRODUCT_NAME%', escHtml(product.name)),
  read('app.css.html'),
  data,
  `<script>\n'use strict';\n${read('draw.js')}</script>`,
  read('app-ui.html'),
].join('\n');

writeFileSync(join(here, 'index.html'), body);

const [head, rest] = [body.slice(0, body.indexOf('<div id="root"></div>')), body.slice(body.indexOf('<div id="root"></div>'))];
writeFileSync(join(here, 'standalone.html'), `<!doctype html>
<html lang="da">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<style>body{margin:0}[hidden]{display:none!important}</style>
${head}</head>
<body>
${rest}
</body>
</html>
`);
console.log(`Prototype bygget: ${product.name} · Golden Test Case v${golden.version} · ${golden.shots.length} shots`);
