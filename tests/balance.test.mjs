// Balance prototype 1: 2/3/4-knockout comparison by simulation. Both sides use the game's own AI and engine (tests/sim.mjs).
// This test does NOT judge whether the numbers are "good": it checks that the simulation is sound (every game ends, no exceptions,
// no stalls), that it is reproducible (fixed seeds), and records the measured comparison. The table is printed for the docs.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, openGame } from './helpers.mjs';
import { SIM_SRC, measure, markdownTable } from './sim.mjs';

let browser, page, errors, ctx, M;
before(async () => { browser = await launch(); ({ ctx, page, errors } = await openGame(browser, { seed: 1 })); await page.evaluate(SIM_SRC); M = await measure(page, [2, 3, 4], 1000); });
after(async () => { await browser.close(); });

test('simulation soundness: 3 modes x 1000 fixed-seed games all finish, without exception, stall, or an illegal ending', () => {
  assert.deepEqual(errors, []);
  for (const t of [2, 3, 4]) {
    assert.equal(M[t].bad, 0, `${t}-KO: games that did not finish`); assert.equal(M[t].games, 1000);
    for (const r of M[t].raw) { assert.ok(['ko', 'refill', 'cap'].includes(r.reason), `${t}-KO seed ${r.seed}: ${r.reason}`);
      if (r.reason === 'ko') assert.equal(Math.max(r.koMe, r.koAi), t, `${t}-KO seed ${r.seed}: the winner has exactly the target number of knockouts`); }
  }
});

test('simulation invariants (every turn of 3000 games): each monster is somewhere exactly once (in play/hand/pile + vanished + knocked out = 12), card ids unique, HP within the species maximum, bench never above 2', () => {
  for (const t of [2, 3, 4]) for (const r of M[t].raw) assert.deepEqual(r.bad, [], `${t}-KO seed ${r.seed}`);
  const used = [2, 3, 4].map(t => M[t].swapsPerGame > 0 && M[t].returnsPerGame > 0 && M[t].recoversPerGame > 0 && M[t].boostBPerGame > 0);
  assert.deepEqual(used, [true, true, true], 'the simulation really exercises every new action (swap, return, recover, boost B)');
  console.log('max hand size seen:', Math.max(...[2, 3, 4].flatMap(t => M[t].raw.map(r => r.maxHand))));
});

test('the match gets longer with the knockout target, and the safety net (turn cap) is essentially never needed', () => {
  assert.ok(M[2].meanTurns < M[3].meanTurns && M[3].meanTurns < M[4].meanTurns, [2, 3, 4].map(t => M[t].meanTurns.toFixed(1)).join(' < '));
  for (const t of [2, 3, 4]) assert.ok(M[t].capRate <= 3, `${t}-KO: cap-decided ${M[t].capRate}%`);
});

test('same piles, same AI: the three modes differ only by the required knockouts (same seeds give the same openings)', async () => {
  const open = async t => page.evaluate(t => { const out = []; for (let s = 0; s < 5; s++) { Math.random = (a => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let x = Math.imul(a ^ a >>> 15, 1 | a); x = x + Math.imul(x ^ x >>> 7, 61 | x) ^ x; return ((x ^ x >>> 14) >>> 0) / 4294967296; })(10000 + s); game = null; newGame(); game.targetKos = t; out.push(game.me.hand.map(c => c.kind + (c.color ?? '') + (c.species || '')).join(',') + '|' + game.ai.active.species); } return out; }, t);
  assert.deepEqual(await open(2), await open(3)); assert.deepEqual(await open(3), await open(4));
});

test('reproducible: re-running the same seeds gives identical results', async () => {
  const again = await measure(page, [3], 200);
  assert.deepEqual(again[3].raw, M[3].raw.slice(0, 200));
});

test('measured indicators are within their definitions (sanity, not a quality judgement)', () => {
  for (const t of [2, 3, 4]) { const m = M[t];
    assert.ok(m.meanMaxE >= 1 && m.meanMaxE <= 13, `meanMaxE ${m.meanMaxE}`); assert.ok(m.attachPerMonster > 0 && m.attachPerMonster < 12);
    assert.ok(m.attacksPerKo >= 1, `an attack count per knockout below 1 is impossible (${m.attacksPerKo})`); assert.ok(m.oneShotRate >= 0 && m.oneShotRate <= 100);
    assert.ok(m.firstPlayerWin > 20 && m.firstPlayerWin < 80, `first-player win rate ${m.firstPlayerWin}% (a value this extreme would mean the opening is broken)`); }
});

test('REPORT (printed for docs/TESTING.md): 2/3/4-knockout comparison, 1000 games each, seeds 10000-10999, both sides the same AI', () => {
  const md = markdownTable(M); console.log('\n# BALANCE-TABLE-BEGIN\n' + md + '# BALANCE-TABLE-END');
  assert.ok(md.includes('2体戦') && md.includes('4体戦'));
});
