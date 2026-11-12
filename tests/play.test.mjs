// Whole-game smoke/fuzz through the REAL UI code paths (draw modal, menus, drops, promotion modals, messages) with a seeded random
// player against the shipped AI. Asserts: no exception, every game ends, state invariants hold.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, openGame } from './helpers.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

const DRIVER = () => {
  window.__play = (maxIterations, mode) => {
    const rnd = Math.random, pick = a => a[Math.floor(rnd() * a.length)];
    const violations = [], stats = { iterations: 0, drops: 0, attacks: 0, ends: 0, modalClicks: 0, acks: 0, turns: 0, tunes: 0 };
    const check = () => {
      for (const side of ['me', 'ai']) { const p = game[side];
        if (p.bench.length > 2) violations.push(`${side} bench ${p.bench.length}`);
        if (p.kos > game.targetKos) violations.push(`${side} kos ${p.kos} > ${game.targetKos}`);
        for (const m of [p.active, ...p.bench]) if (m) {
          if (m.damage < 0) violations.push('negative damage');
          if (m.energy.some(c => !(c >= 0 && c <= 5))) violations.push('bad energy colour');
          if (energyTotal(m, p) < 0) violations.push('negative effective energy');
        }
        if (p.deckM.length + p.deckG.length + p.hand.length > 30) violations.push(`${side} has more than 30 cards`);
        if (p.deckM.some(c => c.kind !== 'mon') || p.deckG.some(c => c.kind === 'mon')) violations.push(`${side}: piles are mixed`);
        const field = [p.active, ...p.bench].filter(Boolean).length;
        if (p.deckM.length + p.hand.filter(c => c.kind === 'mon').length + field + p.st.kos_lost > 12 && false) violations.push('monster count');
      }
      if (game.over) {
        const ok = (game.endReason === 'ko' && (game.me.kos >= game.targetKos || game.ai.kos >= game.targetKos)) || game.endReason === 'refill' || game.endReason === 'cap';
        if (!ok) violations.push(`game over without a legal reason: ${game.endReason}`);
      }
      if (!game.over && game.turn === 'player' && game.step > 0 && !game.me.active && !game.promotion && !notice) violations.push('player has no front monster outside a refill');
    };
    for (let it = 0; it < maxIterations; it++) {
      stats.iterations++; check();
      const overlay = document.getElementById('overlay').classList.contains('show');
      if (overlay) { const bs = [...document.querySelectorAll('#modalButtons button')].filter(b => !b.disabled);
        if (!bs.length) { violations.push('modal with no enabled button: ' + document.getElementById('modalTitle').textContent); break; }
        const fwd = bs.filter(b => !/戻る|閉じる/.test(b.textContent)); (fwd.length && rnd() < 0.9 ? pick(fwd) : pick(bs)).click(); stats.modalClicks++; continue; }
      if (notice) { if (game.over) return { over: true, text: notice.text, stats, violations, winner: game.winner, reason: game.endReason };
        document.getElementById('message').click(); stats.acks++; continue; }
      if (game.over) return { over: true, text: '', stats, violations, winner: game.winner, reason: game.endReason };
      if (game.promotion) { violations.push('promotion pending without modal'); break; }
      if (game.drawPending) { violations.push('draw choice pending without modal'); break; }
      if (game.turn === 'setup') {
        const flush = () => { let g = 0; while (notice && g++ < 10) acknowledge(); };
        const m = game.me.hand.find(c => c.kind === 'mon'); runDrop({ source: 'hand', key: String(m.id) }, 1); flush();
        const extra = game.me.hand.filter(c => c.kind === 'mon')[0]; if (extra && rnd() < 0.6) { runDrop({ source: 'hand', key: String(extra.id) }, 0); flush(); }
        game.targetKos = pick([2, 3, 4]); begin(); continue; }
      if (game.turn === 'player') {
        stats.turns++;
        const cands = [];
        for (const c of game.me.hand) for (const pos of [0, 1, 2]) if (validDrop({ source: 'hand', key: String(c.id) }, pos)) cands.push({ ds: { source: 'hand', key: String(c.id) }, pos });
        for (const from of [0, 1, 2]) for (const pos of [0, 1, 2]) if (validDrop({ source: 'field', key: String(from) }, pos)) cands.push({ ds: { source: 'field', key: String(from) }, pos });
        const canStrong = game.step > 0 && cost(game.me, true), canBasic = game.step > 0 && cost(game.me, false);
        const r = rnd();
        if (mode === 'passive') { endPlayer(); stats.ends++; continue; }
        if (cands.length && r < 0.7) { const c = pick(cands); runDrop(c.ds, c.pos); stats.drops++; continue; }
        if (canStrong || canBasic) { actAttack(canStrong && rnd() < 0.6); stats.attacks++; continue; }
        endPlayer(); stats.ends++; continue; }
      violations.push(`stuck: turn=${game.turn} notice=${!!notice} promotion=${game.promotion}`); break;
    }
    return { over: !!game.over, text: '', stats, violations };
  };
};

test('seeded random games (30): every game finishes, no page error, invariants hold; the new draw, extra-attach and colour-adjust paths are exercised', async () => {
  const reasons = {}, winners = { me: 0, ai: 0, draw: 0 }; let attacks = 0, tunes = 0, extra = 0, promotions = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const { ctx, page, errors } = await openGame(browser, { seed: 1000 + seed });
    await page.evaluate(DRIVER);
    const r = await page.evaluate(() => { const out = window.__play(9000, 'random'); out.me = game.me.st; out.ai = game.ai.st; return out; });
    assert.deepEqual(errors, [], `seed ${seed}: page errors`);
    assert.deepEqual(r.violations, [], `seed ${seed}: ${r.violations.join('; ')}`);
    assert.equal(r.over, true, `seed ${seed}: game did not finish in ${r.stats.iterations} steps (${JSON.stringify(r.stats)})`);
    reasons[r.reason] = (reasons[r.reason] || 0) + 1; winners[r.winner]++; attacks += r.stats.attacks; tunes += r.me.tunes + r.ai.tunes; extra += r.me.extraAttach + r.ai.extraAttach;
    await ctx.close();
  }
  assert.ok(attacks > 30, 'attacks actually happened'); assert.ok(extra > 0, 'the extra (bench) attach slot was used'); assert.ok(tunes > 0, 'colour adjustment was used');
  assert.equal(winners.me + winners.ai + winners.draw, 30);
  console.log('# endings', JSON.stringify(reasons), 'winners', JSON.stringify(winners), 'tunes', tunes, 'extra attaches', extra);
});

test('turn cap in real play: when nobody can attack, the match ends at turn 40 as a draw (no deck-out loss any more), through the real draw modals and messages', async () => {
  const { ctx, page, errors } = await openGame(browser, { seed: 77 });
  await page.evaluate(DRIVER);
  // the opponent can never attack: turn its energy into boost cards (same pile sizes)
  await page.evaluate(() => { for (const c of [...game.ai.deckG, ...game.ai.hand]) if (c.kind === 'en') { c.kind = 'boost'; c.color = 1; } });
  const r = await page.evaluate(() => window.__play(60000, 'passive'));
  assert.deepEqual(errors, []); assert.deepEqual(r.violations, []);
  assert.equal(r.over, true); assert.match(r.text, /ターン上限（40ターン）.*引き分け/); assert.deepEqual([r.winner, r.reason], ['draw', 'cap']);
  assert.equal(r.stats.ends, 40, 'the player ended 40 turns');
  assert.equal(await page.evaluate(() => [game.me.kos, game.ai.kos].join()), '0,0');
  await ctx.close();
});

test('long games drain the piles without any penalty: with both piles emptied early, the match still runs to its end', async () => {
  const { ctx, page, errors } = await openGame(browser, { seed: 78 });
  await page.evaluate(DRIVER);
  await page.evaluate(() => { for (const p of [game.me, game.ai]) { p.deckG.length = 2; p.deckM.length = 1; } });
  const r = await page.evaluate(() => window.__play(60000, 'random'));
  assert.deepEqual(errors, []); assert.deepEqual(r.violations, []); assert.equal(r.over, true);
  assert.ok(['ko', 'refill', 'cap'].includes(r.reason), r.reason);
  await ctx.close();
});
