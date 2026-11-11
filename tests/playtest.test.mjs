// The private playtest ZIP: build it exactly as CI does, extract it, inspect it, then run the game FROM THE EXTRACTED FILES.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { ROOT, launch, MOBILE, DESKTOP } from './helpers.mjs';

const SPECIES = ['centipede', 'dragon', 'golem', 'knight', 'skeleton'];
const sha = process.env.PLAYTEST_SHA || (spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout || '').trim() || '0'.repeat(40);
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'paremon-zip-'));
const out = path.join(work, 'out'), ex = path.join(work, 'extracted');
let zip, browser;
const sh = (cmd, args, opt = {}) => { const r = spawnSync(cmd, args, { encoding: 'utf8', ...opt }); assert.equal(r.status, 0, `${cmd} ${args.join(' ')}\n${r.stdout}${r.stderr}`); return r.stdout; };
const sha256 = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

before(async () => {
  zip = sh('bash', [path.join(ROOT, 'tools/build_playtest.sh'), sha, out]).trim().split('\n').pop();
  fs.mkdirSync(ex); sh('unzip', ['-q', zip, '-d', ex]);
  browser = await launch();
});
after(async () => { await browser.close(); fs.rmSync(work, { recursive: true, force: true }); });

test('ZIP: named paremon-playtest-<short sha>.zip, passes the integrity test, small enough for a phone', () => {
  assert.equal(path.basename(zip), `paremon-playtest-${sha.slice(0, 7)}.zip`);
  sh('unzip', ['-tq', zip]);
  const size = fs.statSync(zip).size; assert.ok(size > 1e6 && size < 12e6, `size ${size}`);
});

test('ZIP: index.html, logo and paremon_monsters2/ sit at the top level (no parent folder); exactly 38 files', () => {
  const names = sh('unzip', ['-Z1', zip]).trim().split('\n').filter(n => !n.endsWith('/'));
  const want = ['index.html', 'PLAYTEST.txt', 'paremon_logo_center_crop2.png', ...SPECIES.flatMap(s => [0, 1, 2, 3, 4, 5, 6].map(i => `paremon_monsters2/${s}_${i}.png`))].sort();
  assert.deepEqual([...names].sort(), want); assert.equal(names.length, 38);
  assert.equal(sh('unzip', ['-Z1', zip]).split('\n').filter(n => n && !n.endsWith('/') && n.includes('/') && !n.startsWith('paremon_monsters2/')).length, 0);
});

test('ZIP: nothing from development is inside (tests, node_modules, source sheets, docs, git, workflows, skills, package files, secrets)', () => {
  const all = sh('unzip', ['-Z1', zip]).toLowerCase();
  for (const bad of ['node_modules', 'tests/', 'assets/', 'docs/', '.git', '.claude', '.github', 'package', 'tools/', '.env', 'secret', 'token', 'sources', 'originals']) assert.ok(!all.includes(bad), `forbidden entry matching "${bad}"`);
  const txt = fs.readFileSync(path.join(ex, 'PLAYTEST.txt'), 'utf8');
  assert.ok(!/ghp_|github_pat_|BEGIN [A-Z ]*PRIVATE KEY/.test(txt + fs.readFileSync(path.join(ex, 'index.html'), 'utf8')));
});

test('ZIP: contents are byte-identical to the repository files (index.html is a copy of the game; pictures untouched)', () => {
  assert.equal(sha256(path.join(ex, 'index.html')), sha256(path.join(ROOT, 'paremon_crossplatform_v17.html')));
  assert.equal(sha256(path.join(ex, 'paremon_logo_center_crop2.png')), sha256(path.join(ROOT, 'paremon_logo_center_crop2.png')));
  for (const f of fs.readdirSync(path.join(ROOT, 'paremon_monsters2'))) assert.equal(sha256(path.join(ex, 'paremon_monsters2', f)), sha256(path.join(ROOT, 'paremon_monsters2', f)), f);
});

test('ZIP: PLAYTEST.txt records the commit, the PR, how to play, and what is unverified (Pixel 7a)', () => {
  const t = fs.readFileSync(path.join(ex, 'PLAYTEST.txt'), 'utf8');
  for (const must of [sha, 'pull/1', 'index.html', 'Chrome', 'オフライン', '未確認', 'Pixel 7a', '展開']) assert.ok(t.includes(must), `PLAYTEST.txt lacks "${must}"`);
});

test('extracted index.html: valid JS, no network dependency (no http(s) references, no CDN, no external script/style)', () => {
  const html = fs.readFileSync(path.join(ex, 'index.html'), 'utf8');
  assert.doesNotThrow(() => new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]));
  assert.ok(!/https?:\/\//i.test(html), 'no absolute URL in the page');
  assert.ok(!/<script[^>]+src=|<link[^>]+href=/i.test(html));
  for (const m of html.matchAll(/\bsrc="([^"$]+)"/g)) assert.ok(fs.existsSync(path.join(ex, m[1])), m[1]);
});

for (const [name, viewport] of [['phone 393x851 (Pixel 7a-like)', { width: 393, height: 851 }], ['phone 412x892', MOBILE], ['desktop', DESKTOP]]) {
  test(`extracted index.html opened over file:// (${name}): starts, all pictures decode, no exception, no 404/network, no horizontal overflow`, async () => {
    const ctx = await browser.newContext({ viewport }); const page = await ctx.newPage(); const errors = [], urls = [];
    page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('request', r => urls.push(r.url())); page.on('requestfailed', r => errors.push('failed: ' + r.url()));
    await page.goto(pathToFileURL(path.join(ex, 'index.html')).href);
    await page.waitForFunction(() => document.querySelectorAll('#hand button').length === 5 && [...document.images].every(i => i.complete));
    const g = await page.evaluate(() => ({ imgs: [...document.images].map(i => i.naturalWidth > 0), overflow: document.documentElement.scrollWidth - innerWidth, hand: document.querySelectorAll('#hand button').length, turn: game.turn }));
    assert.deepEqual(errors, []); assert.ok(g.imgs.length >= 3 && g.imgs.every(Boolean), 'logo + at least one AI card + one monster in the hand, all decoded'); assert.ok(g.overflow <= 0); assert.equal(g.turn, 'setup');
    assert.ok(urls.every(u => u.startsWith('file://') || u.startsWith('data:')), 'only local files were requested: ' + urls.filter(u => !u.startsWith('file://')).join(' '));
    await ctx.close();
  });
}

test('the whole rules + UI (mouse, touch, menus, attack, swap, win, restart) + seeded full-game suites pass AGAINST THE EXTRACTED FILES', () => {
  const r = spawnSync('node', ['--test', '--test-timeout=120000', 'tests/rules.test.mjs', 'tests/ui.test.mjs', 'tests/play.test.mjs'], { cwd: ROOT, encoding: 'utf8', env: { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('NODE_TEST'))), PAREMON_HTML: path.join(ex, 'index.html') } });   // NODE_TEST_* would make the child report in the parent's binary format
  const m = Object.fromEntries([...r.stdout.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)/gm)].map(x => [x[1], +x[2]]));
  assert.equal(r.status, 0, r.stdout.slice(-3000));
  assert.ok(m.tests >= 80, `only ${m.tests} tests ran`); assert.equal(m.fail, 0); assert.equal(m.skipped, 0); assert.equal(m.todo, 0); assert.equal(m.pass, m.tests);
  console.log(`# against the extracted ZIP: ${m.pass}/${m.tests} passed`);
});
