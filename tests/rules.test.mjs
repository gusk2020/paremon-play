// Rule regression tests against the shipped v0.17 logic (run in the page, real functions, no mocks).
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, openGame, setup, attack } from './helpers.mjs';

let browser, ctx, page, errors;
before(async () => {
  browser = await launch(); ({ ctx, page, errors } = await openGame(browser, { seed: 7 }));
  // colour indices usable inside page.evaluate callbacks (赤0 橙1 黄2 緑3 青4 紫5)
  await page.evaluate(() => Object.assign(window, { R: 0, O: 1, Y: 2, G: 3, B: 4, P: 5 }));
});
after(async () => { assert.deepEqual(errors, [], 'no page errors during rule tests'); await browser.close(); });

const R = 0, O = 1, Y = 2, G = 3, B = 4, P = 5; // 赤 橙 黄 緑 青 紫
const ev = (fn, arg) => page.evaluate(fn, arg);

test('deck: 30 cards = monster 12 / energy 12 (2 per colour) / tune 3 / boost 3', async () => {
  const d = await ev(() => { const c = makeDeck(); const n = {}; c.forEach(x => n[x.kind] = (n[x.kind] || 0) + 1);
    const en = [0,0,0,0,0,0]; c.filter(x => x.kind === 'en').forEach(x => en[x.color]++);
    return { total: c.length, n, en, species: [...new Set(c.filter(x => x.kind === 'mon').map(x => x.species))].sort() }; });
  assert.equal(d.total, 30);
  assert.deepEqual(d.n, { mon: 12, en: 12, tune: 3, boost: 3 });
  assert.deepEqual(d.en, [2, 2, 2, 2, 2, 2]);
  assert.deepEqual(d.species, ['centipede', 'dragon', 'golem', 'knight', 'skeleton']);
});

test('initial deal: 5-card hands, front 1 + bench 2 for the AI, decks reduced accordingly', async () => {
  const s = await ev(() => ({ me: game.me.hand.length, meDeck: game.me.deck.length, ai: game.ai.hand.length, aiDeck: game.ai.deck.length,
    aiActive: !!game.ai.active, aiBench: game.ai.bench.length, meActive: game.me.active, turn: game.turn, step: game.step,
    meHasMon: game.me.hand.some(c => c.kind === 'mon') }));
  assert.equal(s.me, 5); assert.equal(s.meDeck, 25);
  assert.equal(s.ai + s.aiBench + 1, 5); assert.equal(s.aiDeck, 25);
  assert.equal(s.aiActive, true); assert.equal(s.aiBench, 2);
  assert.equal(s.meActive, null); assert.equal(s.turn, 'setup'); assert.equal(s.meHasMon, true);
});

test('complementary colours are exactly 赤緑 / 橙青 / 黄紫 (both directions)', async () => {
  const m = await ev(() => { const o = []; for (let a = 0; a < 6; a++) for (let b = 0; b < 6; b++) if (complementary(a, b)) o.push([a, b]);
    return { pairs: o, nullCase: [complementary(null, 0), complementary(0, null)] }; });
  assert.deepEqual(m.pairs.sort(), [[0,3],[1,4],[2,5],[3,0],[4,1],[5,2]].sort());
  assert.deepEqual(m.nullCase, [false, false]);
});

test('type chart: 紫→青→緑→黄→橙→赤→紫 (attacker beats defender exactly when attacker = defender+1), ×2 only', async () => {
  const chain = [[P, B], [B, G], [G, Y], [Y, O], [O, R], [R, P]]; // [attacker, defender]
  for (const [att, def] of chain) {
    await setup(page, { me: { active: { e: [att] }, bench: [] }, ai: { active: { e: [def] }, bench: [] }, targetKos: 4 });
    const r = await attack(page, 'me', false);
    assert.equal(r.after - r.before, 4, `${att} should be strong against ${def}`);
  }
  // reverse direction and every other pairing: plain damage 2, never below (no resistance)
  for (let a = 0; a < 6; a++) for (let d = 0; d < 6; d++) {
    if (chain.some(([x, y]) => x === a && y === d)) continue;
    await setup(page, { me: { active: { e: [a] }, bench: [] }, ai: { active: { e: [d] }, bench: [] }, targetKos: 4 });
    const r = await attack(page, 'me', false);
    assert.equal(r.after - r.before, 2, `${a} vs ${d} should be neutral`);
  }
});

test('colourless monster (0 energy) is never weak and has no colour', async () => {
  await setup(page, { me: { active: { e: [O] }, bench: [] }, ai: { active: { e: [] }, bench: [] }, targetKos: 4 });
  const r = await attack(page, 'me', false);
  assert.equal(r.after - r.before, 2);
  assert.deepEqual(await ev(() => [base(game.ai.active), eff(game.ai), colorName(base(game.ai.active))]), [null, null, '無色']);
});

test('energy counting: first card 1, extra same colour 2 each, other non-complementary 1 each', async () => {
  const c = await ev(() => { const p = game.me; const m = mon({ id: 1 }); m.energy = [R, R, O, R, P];
    p.active = m; p.tuneColor = null; return { counts: energyCounts(m, p), total: energyTotal(m, p) }; });
  assert.deepEqual(c.counts, [1 + 2 + 2, 1, 0, 0, 0, 1]);
  assert.equal(c.total, 7);
});

test('attaching a complementary colour to the base colour is refused; other colours are allowed', async () => {
  const r = await ev(() => { const m = mon({ id: 2 }); m.energy = [R]; game.me.active = m; game.me.tuneColor = null;
    return [0,1,2,3,4,5].map(c => canAttach(m, c, game.me)); });
  assert.deepEqual(r, [true, true, true, false, true, true]); // 緑 is the complement of 赤
  const none = await ev(() => canAttach(mon({ id: 3 }), 3, game.me));
  assert.equal(none, true, 'colourless accepts any first colour');
});

test('attack costs: basic = any 1 effective energy; strong = base colour 1 + any 1 (total >= 2); colourless cannot attack', async () => {
  const k = async (e, tune = null) => ev(([e, tune]) => { const m = mon({ id: 9 }); m.energy = e; game.me.active = m; game.me.tuneColor = tune;
    return [cost(game.me, false), cost(game.me, true)]; }, [e, tune]);
  assert.deepEqual(await k([]), [false, false]);
  assert.deepEqual(await k([R]), [true, false]);
  assert.deepEqual(await k([R, O]), [true, true]);
  assert.deepEqual(await k([R, R]), [true, true]); // second same-colour card counts as 2
});

test('strong attack needs a card of the CURRENT colour (tune): [赤,赤] tuned to 橙 cannot use the strong move', async () => {
  const r = await ev(() => { const m = mon({ id: 9 }); m.energy = [R, R]; game.me.active = m; game.me.tuneColor = O; return [cost(game.me, false), cost(game.me, true)]; });
  assert.deepEqual(r, [true, false]);
});

test('colour adjustment: all cards of the new colour count 2, complements count 0 (not discarded), others 1; cards untouched', async () => {
  const r = await ev(() => { const m = mon({ id: 5 }); m.energy = [R, G, O, O]; game.me.active = m;
    const before = [...m.energy]; game.me.tuneColor = O; const tuned = energyCounts(m, game.me);
    game.me.tuneColor = G; const toG = energyCounts(m, game.me); // complement of 赤 is 緑 ; of 緑 is 赤
    game.me.tuneColor = null; const plain = energyCounts(m, game.me);
    return { tuned, toG, plain, same: JSON.stringify(before) === JSON.stringify(m.energy), base: base(m) }; });
  assert.deepEqual(r.tuned, [1, 4, 0, 1, 0, 0]); // 橙 ×2 ×2; 赤 1; 緑 1
  assert.deepEqual(r.toG, [0, 2, 0, 2, 0, 0]); // tuned to 緑: 赤 (its complement) 0; 橙 1 each = 2; 緑 counts 2
  assert.deepEqual(r.plain, [1, 2, 0, 0, 0, 0]); // base 赤: 赤 1; 橙 1+1; 緑 is the complement of 赤 -> 0 (kept, not discarded)
  assert.equal(r.same, true); assert.equal(r.base, R);
});

test('damage: basic 2 / strong 3, boost +1 is added BEFORE the weakness doubling and then consumed', async () => {
  await setup(page, { me: { active: { e: [O, G] }, bench: [], bonus: 0 }, ai: { active: { e: [R] }, bench: [] }, targetKos: 4 });
  let r = await attack(page, 'me', true); assert.equal(r.after - r.before, 6); // 3 × 2
  await setup(page, { me: { active: { e: [O, G] }, bench: [], bonus: 1 }, ai: { active: { e: [R] }, bench: [] }, targetKos: 4 });
  r = await attack(page, 'me', true); assert.equal(r.after - r.before, 8); assert.equal(r.bonus, 0); // (3+1) × 2
  await setup(page, { me: { active: { e: [R] }, bench: [], bonus: 1 }, ai: { active: { e: [R] }, bench: [] }, targetKos: 4 });
  r = await attack(page, 'me', false); assert.equal(r.after - r.before, 3); // (2+1), neutral
});

test('attacking does not consume energy', async () => {
  await setup(page, { me: { active: { e: [R, O] }, bench: [] }, ai: { active: { e: [P] }, bench: [] }, targetKos: 4 });
  await attack(page, 'me', true);
  assert.deepEqual(await ev(() => game.me.active.energy), [R, O]);
});

test('attack without enough energy does nothing', async () => {
  await setup(page, { me: { active: { e: [] }, bench: [] }, ai: { active: { e: [R] }, bench: [] }, targetKos: 4 });
  const r = await attack(page, 'me', false); assert.deepEqual(r.texts, []); assert.equal(r.after, r.before);
});

test('knockout at 10 damage: counts a KO, enemy front removed; AI replaces the front from its bench', async () => {
  await setup(page, { me: { active: { e: [R] }, bench: [], kos: 0 }, ai: { active: { e: [R], d: 8 }, bench: [{ e: [] }, { e: [] }] }, targetKos: 3 });
  const r = await attack(page, 'me', false);
  assert.equal(r.kos, 1); assert.equal(r.over, false);
  assert.equal(await ev(() => [game.ai.bench.length, !!game.ai.active].join()), '1,true');
});

test('9 damage does not knock out (HP 10)', async () => {
  await setup(page, { me: { active: { e: [R] }, bench: [], kos: 0 }, ai: { active: { e: [R], d: 7 }, bench: [{ e: [] }] }, targetKos: 2 });
  const r = await attack(page, 'me', false); assert.equal(r.kos, 0); assert.equal(r.targetActive, true);
});

for (const target of [2, 3, 4]) {
  test(`victory by ${target} knockouts (chosen before the match)`, async () => {
    await setup(page, { me: { active: { e: [R] }, bench: [], kos: target - 1 }, ai: { active: { e: [R], d: 9 }, bench: [{ e: [] }, { e: [] }] }, targetKos: target });
    const r = await attack(page, 'me', false);
    assert.equal(r.over, true); assert.equal(r.kos, target);
    assert.ok(r.texts.some(t => t.includes(`${target}体撃破`) && t.includes('勝利')), r.texts.join(' / '));
  });
  test(`${target}-KO target: one short of the target does not end the match`, async () => {
    await setup(page, { me: { active: { e: [R] }, bench: [], kos: target - 2 }, ai: { active: { e: [R], d: 9 }, bench: [{ e: [] }] }, targetKos: target });
    const r = await attack(page, 'me', false); assert.equal(r.over, false);
  });
}

test('victory when the opponent has no bench left, even below the KO target', async () => {
  await setup(page, { me: { active: { e: [R] }, bench: [], kos: 0 }, ai: { active: { e: [R], d: 9 }, bench: [] }, targetKos: 4 });
  const r = await attack(page, 'me', false);
  assert.equal(r.over, true); assert.ok(r.texts.some(t => t.includes('相手の控えがいない')));
});

test('AI knocking out the player front with bench left opens the promotion step; no bench = AI wins', async () => {
  await setup(page, { me: { active: { e: [R], d: 9 }, bench: [{ e: [] }] }, ai: { active: { e: [R] }, bench: [{ e: [] }], kos: 0 }, targetKos: 4, turn: 'ai' });
  let r = await attack(page, 'ai', false); assert.equal(r.over, false); assert.equal(r.promotion, true);
  await setup(page, { me: { active: { e: [R], d: 9 }, bench: [] }, ai: { active: { e: [R] }, bench: [{ e: [] }], kos: 0 }, targetKos: 4, turn: 'ai' });
  r = await attack(page, 'ai', false); assert.equal(r.over, true);
});

test('first player cannot attack on the first turn (step 0)', async () => {
  await setup(page, { me: { active: { e: [R, O] }, bench: [] }, ai: { active: { e: [P] }, bench: [] }, targetKos: 4, step: 0 });
  const r = await ev(() => { actAttack(false); actAttack(true); return { notice: !!notice, dmg: game.ai.active.damage }; });
  assert.deepEqual(r, { notice: false, dmg: 0 });
});

test('losing: the player cannot draw at turn start -> the opponent wins', async () => {
  await setup(page, { me: { active: { e: [R] }, bench: [] }, ai: { active: { e: [R] }, bench: [] }, turn: 'ai', step: 2 });
  let t = await ev(() => { game.me.deck = []; afterAi(); const out = [notice && notice.text, game.over]; return out; });
  assert.ok(t[0].includes('相手の勝利') && t[0].includes('引けません')); assert.equal(t[1], true);
});

test('swap: discards exactly 1 chosen energy, once per turn; base colour follows the oldest remaining card, empty -> colourless', async () => {
  await setup(page, { me: { active: { e: [R, O] }, bench: [{ e: [] }, { e: [] }] }, ai: { active: { e: [P] }, bench: [] }, targetKos: 4, retreated: false });
  await ev(() => retreat(0));
  await page.click('#modalButtons button:nth-child(1)'); // discard the 1st (赤) card
  await page.click('#modalButtons button:has-text("交代を確定")');
  const s = await ev(() => ({ benchEnergy: game.me.bench[0].energy, retreated: game.me.retreated, base: base(game.me.bench[0]), front: game.me.active.energy.length }));
  assert.deepEqual(s.benchEnergy, [O]); assert.equal(s.retreated, true); assert.equal(s.base, O); assert.equal(s.front, 0);
  const blocked = await ev(() => { retreat(0); return document.getElementById('overlay').classList.contains('show'); });
  assert.equal(blocked, false, 'second swap in the same turn is refused');
  await ev(() => { game.me.bench[0].energy = [R]; game.me.bench[0].energy.splice(0, 1); });
  assert.equal(await ev(() => base(game.me.bench[0])), null);
});

test('turn flags: attach / tune / boost / swap each limited to once per turn; reset when the next turn starts', async () => {
  await setup(page, { me: { active: { e: [R] }, bench: [], attached: true, tuned: true, boosted: true, retreated: true, tuneColor: O, bonus: 1 }, ai: { active: { e: [R] }, bench: [] }, turn: 'ai', step: 1 });
  await ev(() => afterAi()); // sequence() shows the draw message but flags reset immediately
  const f = await ev(() => ({ a: game.me.attached, t: game.me.tuned, b: game.me.boosted, r: game.me.retreated, tc: game.me.tuneColor, bo: game.me.bonus }));
  assert.deepEqual(f, { a: false, t: false, b: false, r: false, tc: null, bo: 0 });
});

test('end of the player turn restores the original colour (tune is temporary)', async () => {
  await setup(page, { me: { active: { e: [R] }, bench: [], tuneColor: O }, ai: { active: { e: [P] }, bench: [] }, targetKos: 4 });
  assert.equal(await ev(() => eff(game.me)), O);
  await ev(() => { endPlayer(); });
  assert.equal(await ev(() => [game.me.tuneColor, base(game.me.active)].join()), `,${R}`);
});

test('once-per-turn limits: attach / colour-adjust / boost cannot be used twice; colour-adjust needs energy on the front monster', async () => {
  const can = async (kind, flags, active = { e: [R] }) => {
    await setup(page, { me: { active, bench: [{ e: [] }], hand: [{ kind, color: kind === 'en' ? 1 : 0 }], ...flags }, turn: 'player', step: 1 });
    return ev(() => canUseHand(game.me.hand[0]));
  };
  assert.equal(await can('en', {}), true);          assert.equal(await can('en', { attached: true }), false);
  assert.equal(await can('tune', {}), true);        assert.equal(await can('tune', { tuned: true }), false);
  assert.equal(await can('boost', {}), true);       assert.equal(await can('boost', { boosted: true }), false);
  assert.equal(await can('tune', {}, { e: [] }), false, 'a colourless front monster cannot be colour-adjusted');
  assert.equal(await can('tune', {}, null), false, 'no front monster');
});

test('swap is refused without energy on the front monster or without a bench monster', async () => {
  const can = async (cfg) => { await setup(page, { me: cfg, turn: 'player', step: 1 }); return ev(() => { retreat(0); const shown = document.getElementById('overlay').classList.contains('show'); document.getElementById('overlay').classList.remove('show'); return shown; }); };
  assert.equal(await can({ active: { e: [] }, bench: [{ e: [] }] }), false);
  assert.equal(await can({ active: { e: [R] }, bench: [] }), false);
  assert.equal(await can({ active: { e: [R] }, bench: [{ e: [] }] }), true);
});

test('species are display-only: the same colour/energy gives the same damage for every species', async () => {
  const out = [];
  for (const sp of ['centipede', 'dragon', 'golem', 'knight', 'skeleton']) {
    await setup(page, { me: { active: { e: [O] }, bench: [] }, ai: { active: { e: [R] }, bench: [] }, targetKos: 4 });
    await ev(sp => { game.me.active.species = sp; game.ai.active.species = sp; }, sp);
    const r = await attack(page, 'me', false); out.push(r.after - r.before);
  }
  assert.deepEqual(out, [4, 4, 4, 4, 4]);
});

// CHARACTERIZATION (current behaviour, not a confirmed rule): while a colour adjustment is active, an energy card
// that is complementary to the ORIGINAL base colour can still be attached, because the check uses the temporary colour.
// docs/SPEC.md lists this as an open question for ChatGPT/the user. If the rule is decided, change this test with it.
test('CHARACTERIZATION: attaching the original base colour\'s complement during a colour adjustment is currently allowed', async () => {
  const r = await ev(() => { const m = mon({ id: 77 }); m.energy = [R]; game.me.active = m; game.me.tuneColor = O; return [canAttach(m, G, game.me), canAttach(m, B, game.me)]; });
  assert.deepEqual(r, [true, false]); // 緑 (complement of base 赤) allowed; 青 (complement of the temporary 橙) refused
});
