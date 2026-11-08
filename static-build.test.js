'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const assert = require('node:assert/strict');

test('static deployment build publishes the playable client at the site root', t => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'iron-veil-static-'));
  t.after(() => fs.rmSync(output, { recursive: true, force: true }));
  const result = spawnSync(process.execPath, [path.join(__dirname, '..', 'prepare-static.js')], {
    encoding: 'utf8',
    env: { ...process.env, IRON_VEIL_STATIC_OUTPUT_DIR: output }
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const source = fs.readFileSync(path.join(__dirname, '..', '게임클라이언트_V2.0.html'));
  assert.deepEqual(fs.readFileSync(path.join(output, 'index.html')), source,
    'the published site root is the current game client');
  assert.deepEqual(fs.readFileSync(path.join(output, '게임클라이언트_V2.0.html')), source,
    'the named client URL remains available for direct access');
});
