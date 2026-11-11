import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { HTML, ROOT } from './helpers.mjs';

const html = fs.readFileSync(HTML, 'utf8');
const SPECIES = ['centipede', 'dragon', 'golem', 'knight', 'skeleton'];

test('inline script has valid JavaScript syntax', () => {
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(m, 'one inline <script> expected');
  assert.doesNotThrow(() => new vm.Script(m[1], { filename: 'paremon_crossplatform_v17.html' }));
  assert.equal((html.match(/<script/g) || []).length, 1);
});

test('every static src/href in the HTML points at an existing file', () => {
  const refs = [...html.matchAll(/\b(?:src|href)="([^"#]+)"/g)].map(m => m[1]).filter(r => !/^(https?:|data:)/.test(r) && !/[${}]/.test(r)); // dynamic art paths are covered by the image test below
  assert.ok(refs.length >= 1);
  for (const r of refs) assert.ok(fs.existsSync(path.join(ROOT, r)), `missing: ${r}`);
});

test('35 monster images exist: 5 species x (colourless + 6 colours), each a real RGBA PNG', () => {
  for (const s of SPECIES) for (let i = 0; i <= 6; i++) {
    const f = path.join(ROOT, 'paremon_monsters2', `${s}_${i}.png`);
    assert.ok(fs.existsSync(f), `missing ${s}_${i}.png`);
    const b = fs.readFileSync(f);
    assert.equal(b.subarray(1, 4).toString(), 'PNG', f);
    const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
    // Pictures were cleaned of neighbour fragments (tools/clean_assets.py), so real sizes differ; this only rejects corrupt/tiny files.
    // The real quality checks are in images.test.mjs.
    assert.ok(w >= 120 && h >= 200, `${s}_${i}.png too small: ${w}x${h}`);
    assert.equal(b[25], 6, `${s}_${i}.png should be RGBA (colour type 6)`);
  }
  assert.equal(fs.readdirSync(path.join(ROOT, 'paremon_monsters2')).length, 35);
});

test('no extra or misnamed files in paremon_monsters2', () => {
  const names = new Set(fs.readdirSync(path.join(ROOT, 'paremon_monsters2')));
  for (const s of SPECIES) for (let i = 0; i <= 6; i++) names.delete(`${s}_${i}.png`);
  assert.deepEqual([...names], []);
});

test('logo file exists and is a PNG', () => {
  const b = fs.readFileSync(path.join(ROOT, 'paremon_logo_center_crop2.png'));
  assert.equal(b.subarray(1, 4).toString(), 'PNG');
});

test('no third-party brand wording anywhere in the game page (visible text, alt text, title)', () => {
  for (const word of ['ニンテンドー', '任天堂', 'Nintendo', 'ポケモン', 'Pokemon']) assert.ok(!html.includes(word), `found ${word}`);
});

test('originals of the cleaned assets are kept (35 monster pictures + logo) so before/after can be compared', () => {
  assert.equal(fs.readdirSync(path.join(ROOT, 'assets/originals/paremon_monsters2')).length, 35);
  assert.ok(fs.existsSync(path.join(ROOT, 'assets/originals/paremon_logo_center_crop2.png')));
});
