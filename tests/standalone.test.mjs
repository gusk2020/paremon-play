// The single-file playtest HTML (game + logo + 35 pictures, no sibling files, no network).
// Motivation: on a Pixel 7a the ZIP version was opened through a content:// URI and every picture was broken, because relative
// <img src> paths cannot be resolved there. This file proves the standalone build needs nothing but itself.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';
import { ROOT, launch, MOBILE, DESKTOP } from './helpers.mjs';
import { build, verify, KEYS, SPECIES } from '../tools/standalone.mjs';

const sha = process.env.PLAYTEST_SHA || (spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout || '').trim() || '0'.repeat(40);
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'paremon-sa-'));
const file = path.join(work, `paremon-playtest-standalone-${sha.slice(0, 7)}.html`);   // the ONLY file in this folder
let html, browser;
before(async () => { html = build(ROOT, sha); fs.writeFileSync(file, html); browser = await launch(); });
after(async () => { await browser.close(); fs.rmSync(work, { recursive: true, force: true }); });

const COLOUR = ['赤', '橙', '黄', '緑', '青', '紫'];

test('standalone: one file, phone-sized, valid JS, the build verifier passes against the repository pictures', () => {
  assert.deepEqual(fs.readdirSync(work), [path.basename(file)]);
  const size = fs.statSync(file).size; assert.ok(size > 5e6 && size < 10e6, `size ${size}`);
  assert.doesNotThrow(() => new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]));
  assert.equal(verify(html, ROOT), true);
  assert.ok(html.includes(`commit ${sha}`), 'commit recorded in the file');
});

test('standalone: 36 pictures embedded (35 monsters + logo), byte-identical to the repository files; no external reference of any kind', () => {
  const table = JSON.parse(html.match(/const EMBED_B64=(\{.*?\});\n/s)[1]);
  assert.equal(Object.keys(table).length, 35); assert.deepEqual(Object.keys(table).sort(), [...KEYS].sort());
  for (const k of KEYS) assert.ok(Buffer.from(table[k], 'base64').equals(fs.readFileSync(path.join(ROOT, k))), k);
  assert.ok(html.includes('data-art="paremon_logo_center_crop2.png" src="data:image/png;base64,'));
  const rest = html.replace(/const EMBED_B64=\{.*?\};\n/s, '').replace(/data:image\/png;base64,[A-Za-z0-9+/=]+/g, 'DATA');
  assert.ok(!/https?:\/\//i.test(rest)); assert.ok(!/<script[^>]+src=|<link[^>]+href=/i.test(rest)); assert.ok(!/\bsrc="paremon/.test(rest));
});

test('standalone: the verifier DETECTS broken builds (missing picture, corrupt picture, picture of the wrong file, path-based <img>, external script, missing logo)', () => {
  const table = html.match(/const EMBED_B64=(\{.*?\});\n/s)[1];
  const mutate = (fn) => fn(html);
  const key = KEYS[3], b64 = JSON.parse(table)[key];
  const cases = {
    'missing picture': h => h.replace(`"${key}":"${b64}",`, ''),
    'corrupt picture': h => h.replace(`"${key}":"${b64}"`, `"${key}":"${Buffer.from('not a png at all').toString('base64')}"`),
    'wrong picture': h => h.replace(`"${key}":"${b64}"`, `"${key}":"${JSON.parse(table)[KEYS[4]]}"`),
    'relative <img src>': h => h.replace('<header id="topbar">', '<header id="topbar"><img src="paremon_logo_center_crop2.png">'),
    'external script': h => h.replace('</head>', '<script src="https://cdn.example/x.js"></script></head>'),
    'no logo': h => h.replace(/data-art="paremon_logo_center_crop2\.png" src="data:image\/png;base64,[A-Za-z0-9+/=]+"/, 'src="x"'),
    'artSrc still path-based': h => h.replace('const artSrc=(m,c)=>EMBED[artKey(m,c)]', 'const artSrc=(m,c)=>artKey(m,c)'),
  };
  for (const [name, fn] of Object.entries(cases)) { const broken = mutate(fn); assert.notEqual(broken, html, `${name}: mutation did not change the file`); assert.throws(() => verify(broken, ROOT), /verify:/, name); }
});

for (const [name, viewport] of [['phone 393x851 (Pixel 7a-like)', { width: 393, height: 851 }], ['phone 412x892', MOBILE], ['desktop', DESKTOP]]) {
  test(`standalone opened over file:// from a folder that contains nothing else (${name}): starts, logo + monster pictures decode, no error, no network, no overflow`, async () => {
    const ctx = await browser.newContext({ viewport }); const page = await ctx.newPage(); const errors = [], urls = [];
    page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('request', r => urls.push(r.url())); page.on('requestfailed', r => errors.push('failed: ' + r.url().slice(0, 60)));
    await page.goto(pathToFileURL(file).href);
    await page.waitForFunction(() => document.querySelectorAll('#hand button').length === 5 && [...document.images].every(i => i.complete));
    const g = await page.evaluate(() => ({ imgs: [...document.images].map(i => ({ ok: i.naturalWidth > 0, art: i.dataset.art, scheme: i.src.split(':')[0] })), overflow: document.documentElement.scrollWidth - innerWidth, turn: game.turn }));
    assert.deepEqual(errors, []); assert.ok(g.imgs.length >= 3 && g.imgs.every(i => i.ok), 'all pictures decoded'); assert.ok(g.imgs.every(i => ['blob', 'data'].includes(i.scheme)), 'embedded pictures only');
    assert.ok(g.imgs.every(i => /^paremon_(logo_center_crop2|monsters2\/[a-z]+_[0-6])\.png$/.test(i.art)), 'every image knows its repository path'); assert.ok(g.overflow <= 0); assert.equal(g.turn, 'setup');
    assert.ok(urls.every(u => /^(file:|blob:|data:)/.test(u)) && urls.filter(u => u.startsWith('file:')).length === 1, 'the HTML itself is the only file requested: ' + urls.filter(u => !/^(blob:|data:)/.test(u)).join(' '));
    await ctx.close();
  });
}

test('standalone loaded with NO URL and NO sibling files (page.setContent = about:blank origin, the closest simulation of a content:// page)', async () => {
  const page = await (await browser.newContext({ viewport: MOBILE })).newPage(); const errors = [];
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.setContent(html, { waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelectorAll('#hand button').length === 5 && [...document.images].every(i => i.complete && i.naturalWidth > 0));
  assert.equal(page.url(), 'about:blank'); assert.deepEqual(errors, []);
  // and the ZIP-style failure is real: the repository HTML in the same situation has broken pictures (this is what the phone showed)
  const page2 = await (await browser.newContext({ viewport: MOBILE })).newPage();
  await page2.setContent(fs.readFileSync(path.join(ROOT, 'paremon_crossplatform_v17.html'), 'utf8'), { waitUntil: 'load' });
  await page2.waitForFunction(() => document.querySelectorAll('#hand button').length === 5 && [...document.images].every(i => i.complete));
  assert.ok(await page2.evaluate(() => [...document.images].every(i => i.naturalWidth === 0)), 'relative-path version cannot load pictures without a base URL (reproduces the Pixel 7a report)');
});

test('standalone: all 35 species x state pictures + logo are shown from the embedded table (dynamic references), at the right pixel size, incl. temporary colour adjustment', async () => {
  const ctx = await browser.newContext({ viewport: MOBILE }); const page = await ctx.newPage(); const errors = [], urls = [];
  page.on('pageerror', e => errors.push(e.message)); page.on('request', r => urls.push(r.url()));
  await page.goto(pathToFileURL(file).href); await page.waitForFunction(() => typeof game !== 'undefined' && document.querySelectorAll('#hand button').length > 0);
  const seen = new Set();
  const settle = () => page.waitForFunction(() => [...document.images].every(i => i.complete));
  const set = async (sp, e, tune = null) => { await page.evaluate(([sp, e, tune]) => { const mk = (en, species) => Object.assign(mon({ id: ++uid, species }), { energy: en }); game.me.active = mk(e, sp); game.me.bench = [mk([], sp)]; game.me.tuneColor = tune; game.me.hand = [fresh('mon', 0)]; game.me.hand[0].species = sp; game.turn = 'player'; game.step = 1; notice = null; queue = []; render(); }, [sp, e, tune]); await settle(); };
  for (const sp of SPECIES) {
    for (let c = -1; c < 6; c++) {
      await set(sp, c < 0 ? [] : [c]);
      const r = await page.$eval('#playerSlots [data-slot="player:1"] img', i => ({ art: i.dataset.art, ok: i.naturalWidth > 0, w: i.naturalWidth, h: i.naturalHeight, scheme: i.src.split(':')[0] }));
      assert.equal(r.art, `paremon_monsters2/${sp}_${c + 1}.png`); assert.ok(r.ok && ['blob', 'data'].includes(r.scheme), r.art); seen.add(r.art);
      const png = fs.readFileSync(path.join(ROOT, r.art)); assert.deepEqual([r.w, r.h], [png.readUInt32BE(16), png.readUInt32BE(20)], `${r.art} decoded at its real size`);
    }
    await set(sp, [0], 4);   // base 赤 tuned to 青 -> the blue picture
    assert.equal(await page.$eval('#playerSlots [data-slot="player:1"] img', i => i.dataset.art), `paremon_monsters2/${sp}_5.png`, `${sp}: temporary colour switches the picture`);
    assert.equal(await page.$eval('#playerSlots [data-slot="player:0"] img', i => i.dataset.art), `paremon_monsters2/${sp}_0.png`, 'bench monster without energy is colourless');
    assert.equal(await page.$eval('#hand .hand-card img', i => i.dataset.art), `paremon_monsters2/${sp}_0.png`, 'hand card picture');
    // detail view picture
    await page.evaluate(() => showDetails(game.me.active, 'field', true)); await settle();
    assert.ok(await page.$eval('#detailContent img', i => i.naturalWidth > 0 && i.dataset.art.endsWith('_5.png')), 'detail picture'); await page.evaluate(() => closeModal(false));
  }
  assert.equal(seen.size, 35); assert.deepEqual(errors, []);
  assert.ok(urls.every(u => /^(file:|blob:|data:)/.test(u)), 'no network request'); assert.ok(!urls.some(u => /paremon_monsters2\//.test(u)), 'no picture file was ever requested');
  await ctx.close();
});

test('standalone: rules + UI (mouse, touch, menus, KD-8 text checks, attack, swap, win, restart) + seeded full games pass against the standalone file itself', () => {
  const r = spawnSync('node', ['--test', '--test-timeout=120000', 'tests/rules.test.mjs', 'tests/ui.test.mjs', 'tests/play.test.mjs'], { cwd: ROOT, encoding: 'utf8',
    env: { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('NODE_TEST'))), PAREMON_HTML: file } });
  const m = Object.fromEntries([...r.stdout.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)/gm)].map(x => [x[1], +x[2]]));
  assert.equal(r.status, 0, r.stdout.slice(-3000)); assert.ok(m.tests >= 85, `only ${m.tests} tests ran`);
  assert.equal(m.fail, 0); assert.equal(m.skipped, 0); assert.equal(m.todo, 0); assert.equal(m.pass, m.tests);
  console.log(`# against the standalone HTML: ${m.pass}/${m.tests} passed`);
});

test('standalone: time to a playable screen is short even with the CPU slowed 4x (phone-class)', async () => {
  const ctx = await browser.newContext({ viewport: { width: 393, height: 851 } }); const page = await ctx.newPage(); const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const t0 = Date.now(); await page.goto(pathToFileURL(file).href);
  await page.waitForFunction(() => document.querySelectorAll('#hand button').length === 5 && [...document.images].every(i => i.complete && i.naturalWidth > 0));
  const ms = Date.now() - t0; console.log(`# standalone ready in ${ms} ms with CPU x4 slower`);
  assert.ok(ms < 6000, `took ${ms} ms`);
  await ctx.close();
});
