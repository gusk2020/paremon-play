// New card illustrations: energy (6 colours), colour adjust (2 variants), boost. Rules unchanged; names / geometry kept.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, launch, openGame, setup, MOBILE, DESKTOP } from './helpers.mjs';
import { CARD_KEYS } from '../tools/standalone.mjs';

const browser = await launch();
after(async () => { await browser.close(); });

test('card illustrations: 9 files exist as real RGBA PNGs with transparency, small enough for a phone, nothing else in paremon_cards', () => {
  assert.deepEqual(fs.readdirSync(path.join(ROOT, 'paremon_cards')).sort(), CARD_KEYS.map(k => path.basename(k)).sort());
  for (const k of CARD_KEYS) {
    const b = fs.readFileSync(path.join(ROOT, k));
    assert.equal(b.subarray(1, 4).toString(), 'PNG'); assert.equal(b[25], 6, `${k} is RGBA`);
    assert.ok(b.length < 150_000, `${k} ${b.length} bytes`);
  }
  for (const f of ['energy_sheet', 'tune_sheet', 'boost_sheet']) assert.ok(fs.existsSync(path.join(ROOT, 'assets/sources/card_sheets', f + '.png')), 'source sheet kept: ' + f);
});

for (const [name, viewport] of [['412x892', MOBILE], ['360x740', { width: 360, height: 740 }], ['desktop', DESKTOP]]) {
  test(`each card kind shows its own illustration, decoded, inside the card, names/labels kept (${name})`, async () => {
    const { ctx, page, errors } = await openGame(browser, { seed: 94, viewport });
    const seen = new Set();
    for (const cfg of [[0, 1, 2], [3, 4, 5]]) {
      const hand = [...cfg.map(color => ({ kind: 'en', color })), { kind: 'tune', color: 0 }, { kind: 'tune', color: 2 }, { kind: 'boost', color: 0 }];
      await setup(page, { me: { active: { e: [0] }, bench: [], hand }, turn: 'player', step: 1 });
      await page.waitForFunction(() => [...document.querySelectorAll('#hand img.card-art')].every(i => i.complete));
      const cards = await page.$$eval('#hand .hand-card', els => els.map(e => { const i = e.querySelector('img.card-art'), sw = e.querySelector('.swatch'), r = e.getBoundingClientRect(), ir = i && i.getBoundingClientRect(), sr = sw.getBoundingClientRect();
        return { src: i && decodeURIComponent(i.getAttribute('src')), ok: !!i && i.naturalWidth > 0, text: e.textContent, ih: ir && ir.height, sh: sr.height, inside: ir && ir.left >= r.left - 1 && ir.right <= r.right + 1 && ir.top >= r.top - 1 && ir.bottom <= r.bottom + 1 }; }));
      for (const c of cards) { assert.ok(c.ok, 'decoded ' + c.src); assert.ok(c.inside, 'inside card ' + c.src); assert.ok(c.sh >= 28, `art area ${c.sh}px ${c.src}`); seen.add(c.src); }
      const names = ['赤', '橙', '黄', '緑', '青', '紫'];
      cfg.forEach((color, i) => assert.ok(cards[i].text.includes(names[color]), 'energy keeps its colour name'));
      for (const k of cards.slice(3)) assert.ok(!/[赤橙黄緑青紫]/.test(k.text), 'no colour name on aux cards: ' + k.text);
    }
    assert.deepEqual([...seen].sort(), CARD_KEYS.slice().sort());
    assert.deepEqual(errors, []); await ctx.close();
  });
}

test('card detail shows a large illustration for energy / colour adjust / boost', async () => {
  const { ctx, page, errors } = await openGame(browser, { seed: 95, viewport: MOBILE });
  await setup(page, { me: { active: { e: [0] }, bench: [], hand: [{ kind: 'en', color: 4 }, { kind: 'tune', color: 2 }, { kind: 'boost', color: 0 }] }, turn: 'player', step: 1 });
  for (const [i, want] of [[0, 'energy_blue'], [1, 'tune_b'], [2, 'boost']]) {
    await page.evaluate(i => showDetails(game.me.hand[i]), i);
    const d = await page.$eval('#detailContent', e => { const im = e.querySelector('img.card-art'); return { src: im && decodeURIComponent(im.getAttribute('src')), ok: im && im.complete && im.naturalWidth > 0, h: im && im.getBoundingClientRect().height }; });
    assert.ok(d.src.includes(want) && d.ok && d.h > 60, JSON.stringify(d));
    await page.evaluate(() => closeModal && closeModal());
  }
  assert.deepEqual(errors, []); await ctx.close();
});
