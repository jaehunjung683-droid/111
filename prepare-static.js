'use strict';

const fs = require('node:fs');
const path = require('node:path');

const source = path.join(__dirname, '게임클라이언트_V2.0.html');
const outputDirectory = path.resolve(
  process.env.IRON_VEIL_STATIC_OUTPUT_DIR || path.join(__dirname, 'public')
);

if (!fs.existsSync(source)) {
  throw new Error(`Game client was not found: ${source}`);
}

fs.mkdirSync(outputDirectory, { recursive: true });
fs.copyFileSync(source, path.join(outputDirectory, 'index.html'));
fs.copyFileSync(source, path.join(outputDirectory, '게임클라이언트_V2.0.html'));
process.stdout.write(`Static game client prepared in ${outputDirectory}\n`);
