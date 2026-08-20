import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../../src/js/mapview-iso.js', import.meta.url), 'utf8');

assert.equal(src.includes("#c0392b"), false, 'debug red fillRect must not ship');
assert.equal(/Object\.keys\(ASSET_SRC\)\.forEach/.test(src), false, 'do not preload every house/car skin on boot');
assert.ok(/BOOT_ASSETS/.test(src), 'boot preload must be an explicit short list');

console.log('ok boot-assets');
