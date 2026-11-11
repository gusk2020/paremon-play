// Whole-game smoke/fuzz: the real UI code paths (runDrop, attacks, menus, messages) driven by a seeded
// random player against the shipped AI. Asserts: no exception, every game ends, state invariants hold.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, openGame } from './helpers.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

const DRIVER = () => {
  window.__play = (maxIterations, mode) => {
    const rnd = Math.random, pick = a => a[Math.floor(rnd() * a.length)];
    const violations = [], stats = { iterations: 0, drops: 0, attacks: 0, ends: 0, modalClicks: 0, acks: 0, turns: 0 };
    const check = () => {
      for (const side of ['me', 'ai']) { const p = game[side];
        if (p.bench.length > 2) violations.push(`${side} bench ${p.bench.length}`);
        if (p.kos > game.targetKos) violations.push(`${side} kos ${p.kos} > ${game.targetKos}`);
        for (const m of [p.active, ...p.bench]) if (m) {
          if (m.damage < 0) violations.push('negative damage');
          if (m.energy.some(c => !(c >= 0 && c <= 5))) violations.push('bad energy colour');
          if (energyTotal(m, p) < 0) violations.push('negative effective energy');
        }
        if (p.deck.length + p.hand.length > (window.__maxCards || 30)) violations.push(`${side} has more than ${window.__maxCards || 30} cards`);
      }
      if (game.over) {
        const ok = game.me.kos >= game.targetKos || game.ai.kos >= game.targetKos || (!game.ai.active && !game.ai.bench.length) ||
          (!game.me.active && !game.me.bench.length) || game.me.deck.length === 0 || game.ai.deck.length === 0 || game.deckLoss;
        if (!ok) violations.push('game over without a legal win condition');
      }
    };
    for (let it = 0; it < maxIterations; it++) {
      stats.iterations++; check();
      const overlay = document.getElementById('overlay').classList.contains('show');
      if (overlay) { const bs = [...document.querySelectorAll('#modalButtons button')].filter(b => !b.disabled);
        if (!bs.length) { violations.push('modal with no enabled button'); break; }
        // prefer forward choices so that a flow completes; back/close only sometimes
        const fwd = bs.filter(b => !/戻る|閉じる/.test(b.textContent)); (fwd.length && rnd() < 0.9 ? pick(fwd) : pick(bs)).click(); stats.modalClicks++; continue; }
      if (notice) { if (game.over && /勝利/.test(notice.text)) return { over: true, text: notice.text, stats, violations, winner: /あなたの勝利/.test(notice.text) ? 'me' : 'ai' };
        document.getElementById('message').click(); stats.acks++; continue; }
      if (game.over) return { over: true, text: '', stats, violations };
      if (game.promotion) { violations.push('promotion pending without modal'); break; }
      if (game.turn === 'setup') {
        const flush = () => { let g = 0; while (notice && g++ < 10) acknowledge(); }; // input is locked while a message shows
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

test('seeded random games (30): every game finishes, no page error, invariants hold', async () => {
  const winners = { me: 0, ai: 0 }, kinds = new Set(); let totalAttacks = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const { ctx, page, errors } = await openGame(browser, { seed: 1000 + seed });
    await page.evaluate(DRIVER);
    const r = await page.evaluate(() => window.__play(6000, 'random'));
    assert.deepEqual(errors, [], `seed ${seed}: page errors`);
    assert.deepEqual(r.violations, [], `seed ${seed}: ${r.violations.join('; ')}`);
    assert.equal(r.over, true, `seed ${seed}: game did not finish in ${r.stats.iterations} steps (${JSON.stringify(r.stats)})`);
    winners[r.winner || 'ai']++; kinds.add(r.text.replace(/\d/g, '#')); totalAttacks += r.stats.attacks;
    await ctx.close();
  }
  assert.ok(totalAttacks > 30, 'attacks actually happened across the games');
  assert.equal(winners.me + winners.ai, 30);
  console.log('# winners', JSON.stringify(winners), 'endings', [...kinds].join(' | '));
});

test('deck-out in real play: with no attacks the first player runs out of deck first and loses on turn 26', async () => {
  const { ctx, page, errors } = await openGame(browser, { seed: 77 });
  await page.evaluate(DRIVER);
  // The AI cannot attack without energy: turn its energy cards into boost cards (same deck size), so nobody ever attacks.
  await page.evaluate(() => { for (const c of [...game.ai.deck, ...game.ai.hand]) if (c.kind === 'en') { c.kind = 'boost'; c.color = 1; } });
  const r = await page.evaluate(() => window.__play(20000, 'passive'));
  assert.deepEqual(errors, []); assert.deepEqual(r.violations, []);
  assert.equal(r.over, true); assert.match(r.text, /相手の勝利.*引けません/);
  assert.equal(await page.evaluate(() => [game.me.kos, game.ai.kos, game.me.deck.length, game.ai.deck.length].join()), '0,0,0,0',
    'ended by deck-out, not a fight; the AI drew its own last card one step earlier, so it can never be the one that fails to draw (see KD-1)');
  assert.equal(r.stats.ends, 25, 'the player ends turns 1..25 passively; turn 26 cannot draw');
  await ctx.close();
});

test('AI deck-out in real play: when the AI runs dry first, the player sees "あなたの勝利" at the end of the AI turn', async () => {
  const { ctx, page, errors } = await openGame(browser, { seed: 78 });
  await page.evaluate(DRIVER);
  await page.evaluate(() => {
    for (const c of [...game.ai.deck, ...game.ai.hand]) if (c.kind === 'en') { c.kind = 'boost'; c.color = 1; }   // the AI can never attack
    for (let i = 0; i < 5; i++) game.me.deck.push(fresh('boost', 1));                                           // the player has 5 more cards than the AI
    window.__maxCards = 35;
  });
  const r = await page.evaluate(() => window.__play(20000, 'passive'));
  assert.deepEqual(errors, []); assert.deepEqual(r.violations, []);
  assert.equal(r.over, true); assert.match(r.text, /あなたの勝利.*引けませんでした/); assert.equal(r.winner, 'me');
  assert.equal(await page.evaluate(() => [game.me.kos, game.ai.kos, game.ai.deck.length].join()), '0,0,0');
  await ctx.close();
});
