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

test('first player cannot attack on the first turn (step 0)', async () => {
  await setup(page, { me: { active: { e: [R, O] }, bench: [] }, ai: { active: { e: [P] }, bench: [] }, targetKos: 4, step: 0 });
  const r = await ev(() => { actAttack(false); actAttack(true); return { notice: !!notice, dmg: game.ai.active.damage }; });
  assert.deepEqual(r, { notice: false, dmg: 0 });
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

// ---- KD-6 (user-confirmed spec): only the complement of the TEMPORARY base colour is refused while a colour adjustment is active ----
test('KD-6 spec: colourless monsters accept any first energy; normal base refuses only its own complement', async () => {
  const r = await ev(() => { const m = mon({ id: 80 }); game.me.active = m; game.me.tuneColor = null; const none = [0,1,2,3,4,5].map(c => canAttach(m, c, game.me));
    m.energy = [R]; const red = [0,1,2,3,4,5].map(c => canAttach(m, c, game.me)); return { none, red }; });
  assert.deepEqual(r.none, [true, true, true, true, true, true]);
  assert.deepEqual(r.red, [true, true, true, false, true, true]); // 緑 is the complement of 赤
});

test('KD-6 spec: base 赤 tuned to 橙 -> 青 (complement of 橙) refused, 緑 (complement of 赤) allowed', async () => {
  const r = await ev(() => { const m = mon({ id: 81 }); m.energy = [R]; game.me.active = m; game.me.tuneColor = O;
    return [0,1,2,3,4,5].map(c => canAttach(m, c, game.me)); });
  assert.deepEqual(r, [true, true, true, true, false, true]);
});

test('KD-6 spec: the real drop path agrees (drag 緑 allowed, 青 refused while tuned to 橙)', async () => {
  await setup(page, { me: { active: { e: [R] }, bench: [], tuneColor: O, hand: [{ kind: 'en', color: G }, { kind: 'en', color: B }] }, turn: 'player', step: 1 });
  const v = await ev(() => game.me.hand.map(c => validDrop({ source: 'hand', key: String(c.id) }, 1)));
  assert.deepEqual(v, [true, false]);
});

test('KD-6 spec: after the turn the colour returns; the complement card is KEPT but counts 0; counts are recomputed and can re-activate', async () => {
  const r = await ev(() => {
    const m = mon({ id: 82 }); m.energy = [R]; game.me.active = m; game.me.tuneColor = O; game.me.attached = false;
    const card = fresh('en', G); game.me.hand = [card];
    take(game.me, card.id); m.energy.push(card.color);                           // 緑 attached while tuned to 橙
    const tuned = { counts: energyCounts(m, game.me), total: energyTotal(m, game.me) };
    game.me.tuneColor = null;                                                    // turn ends: back to base 赤
    const after = { counts: energyCounts(m, game.me), total: energyTotal(m, game.me), energy: [...m.energy], base: base(m), refusesNow: !canAttach(m, G, game.me) };
    game.me.tuneColor = O; const again = energyCounts(m, game.me); game.me.tuneColor = null;   // a later colour change re-activates it
    const m2 = mon({ id: 83 }); m2.energy = m.energy.slice(1); const rebase = { base: base(m2), counts: energyCounts(m2, game.me) };   // 赤 discarded -> 緑 becomes the base
    return { tuned, after, again, rebase };
  });
  assert.deepEqual(r.tuned.counts, [1, 0, 0, 1, 0, 0]); assert.equal(r.tuned.total, 2);          // tuned to 橙: 赤1 + 緑1 (both "other colour")
  assert.deepEqual(r.after.counts, [1, 0, 0, 0, 0, 0]); assert.equal(r.after.total, 1);          // back at 赤: 緑 is a complement -> 0
  assert.deepEqual(r.after.energy, [R, G], 'the card is not discarded');
  assert.equal(r.after.base, R); assert.equal(r.after.refusesNow, true, 'a new 緑 cannot be attached while the base is 赤');
  assert.deepEqual(r.again, [1, 0, 0, 1, 0, 0]);
  assert.equal(r.rebase.base, G); assert.deepEqual(r.rebase.counts, [0, 0, 0, 1, 0, 0]);
});

test('KD-6 spec: end of the player turn really restores the colour and recalculates (endPlayer)', async () => {
  await setup(page, { me: { active: { e: [R, G] }, bench: [], tuneColor: O, tuned: true }, ai: { active: { e: [P] }, bench: [] }, targetKos: 4 });
  const before = await ev(() => energyTotal(game.me.active, game.me));
  await ev(() => endPlayer());
  const after = await ev(() => [energyTotal(game.me.active, game.me), game.me.active.energy.length, game.me.tuneColor]);
  assert.equal(before, 2); assert.deepEqual(after, [1, 2, null]);
});

// ---- KD-2: the victory reason reads correctly from the player's point of view, for both attackers ----
for (const [who, kos, text] of [
  ['me', 'target', t => `あなたの勝利！ ${t}体撃破`], ['ai', 'target', t => `相手の勝利！ ${t}体撃破`]]) {
  for (const target of [2, 3, 4]) {
    test(`KD-2 wording: ${who === 'me' ? 'player' : 'AI'} wins by ${target} knockouts -> "${text(target)}"`, async () => {
      const A = who === 'me' ? 'me' : 'ai', D = who === 'me' ? 'ai' : 'me';
      await setup(page, { [A]: { active: { e: [R] }, bench: [], kos: target - 1 }, [D]: { active: { e: [R], d: 9 }, bench: [{ e: [] }, { e: [] }] }, targetKos: target, turn: who === 'me' ? 'player' : 'ai' });
      const r = await attack(page, A, false);
      assert.equal(r.over, true); assert.ok(r.texts.includes(text(target)), r.texts.join(' / '));
    });
  }
}
// ---- KD-3: tune/boost carry no colour for any internal .color value ----
test('KD-3: colour adjustment and boost behave identically whatever internal colour field they carry', async () => {
  const out = [];
  for (const kind of ['tune', 'boost']) for (let c = 0; c < 6; c++) {
    await setup(page, { me: { active: { e: [R] }, bench: [], hand: [{ kind, color: c }] }, turn: 'player', step: 1 });
    out.push(await ev(() => { const k = game.me.hand[0]; return [canUseHand(k), (useHand(k), 0)]; }).then(x => x[0]));
  }
  assert.ok(out.every(v => v === true));
  await setup(page, { me: { active: { e: [R] }, bench: [], hand: [{ kind: 'boost', color: 4 }] }, ai: { active: { e: [R] }, bench: [] }, turn: 'player', step: 1 });
  await ev(() => { useHand(game.me.hand[0]); acknowledge(); });
  assert.deepEqual(await ev(() => [game.me.bonus, game.me.boosted, game.me.tuneColor]), [1, true, null]);
});


// =====================================================================================================================
// バランス試作1 (provisional rules). Each test below states the rule it checks. Old v0.17 tests that no longer describe the
// game were REPLACED (not skipped); the differences are listed in docs/SPEC.md "旧仕様との差分".
// =====================================================================================================================
const T = 'target';
const attackOf = (cfg, strong) => ev(([c, strong]) => { const p = game.me; p.active = Object.assign(mon({ id: 900 }), { energy: c.e }); p.tuneColor = c.tune ?? null; p.bonus = c.boost || 0; const w = attackPower(p, strong); return { ...w, cost: cost(p, strong) }; }, [cfg, strong]);

test('NEW decks: two separate piles — monster pile 12 (monsters only) and growth pile 18 (energy 12 = 2 per colour, 色調整 3, 増強 3); never mixed', async () => {
  const d = await ev(() => { const p = player(); const kinds = a => a.reduce((n, c) => (n[c.kind] = (n[c.kind] || 0) + 1, n), {}); const en = [0, 0, 0, 0, 0, 0]; p.deckG.filter(c => c.kind === 'en').forEach(c => en[c.color]++);
    return { m: kinds(p.deckM), g: kinds(p.deckG), en, species: [...new Set(p.deckM.map(c => c.species))].sort(), total: p.deckM.length + p.deckG.length }; });
  assert.deepEqual(d.m, { mon: 12 }); assert.deepEqual(d.g, { en: 12, tune: 3, boost: 3 }); assert.deepEqual(d.en, [2, 2, 2, 2, 2, 2]); assert.equal(d.total, 30);
  assert.deepEqual(d.species, ['centipede', 'dragon', 'golem', 'knight', 'skeleton']);
});

test('NEW opening: hand = 2 from the monster pile + 3 from the growth pile (so a front AND a bench monster are always possible); the opponent opens with front + bench', async () => {
  for (let k = 0; k < 20; k++) {
    const s = await ev(() => { newGame(); const h = game.me.hand; return { mons: h.filter(c => c.kind === 'mon').length, growth: h.filter(c => c.kind !== 'mon').length, dm: game.me.deckM.length, dg: game.me.deckG.length, aiHand: game.ai.hand.length, aiActive: !!game.ai.active, aiBench: game.ai.bench.length, aiDm: game.ai.deckM.length, aiDg: game.ai.deckG.length, turn: game.turn, step: game.step }; });
    assert.deepEqual([s.mons, s.growth, s.dm, s.dg], [2, 3, 10, 15]); assert.deepEqual([s.aiHand, s.aiActive, s.aiBench, s.aiDm, s.aiDg], [3, true, 1, 10, 15]); assert.deepEqual([s.turn, s.step], ['setup', 0]);
  }
});

test('NEW draw: the normal card comes from the pile the player chooses, plus one EXTRA card from the growth pile every turn; an empty pile cannot be chosen', async () => {
  await ev(() => { newGame(); });
  const r = await ev(() => { const m = game.me; const a = drawChoices(m); const o1 = startDraws(m, 'M'); const after1 = [m.deckM.length, m.deckG.length, m.hand.length];
    const o2 = startDraws(m, 'G'); const after2 = [m.deckM.length, m.deckG.length, m.hand.length]; m.deckM = []; const only = drawChoices(m); m.deckG = []; const none = drawChoices(m); const o3 = startDraws(m, null);
    return { a, o1, after1, o2, after2, only, none, o3 }; });
  assert.deepEqual(r.a, ['M', 'G']); assert.deepEqual(r.o1.map(x => x.kind + x.deck), ['normalM', 'extraG']); assert.deepEqual(r.after1, [9, 14, 7]);
  assert.deepEqual(r.o2.map(x => x.kind + x.deck), ['normalG', 'extraG']); assert.deepEqual(r.after2, [9, 12, 9]);
  assert.deepEqual(r.only, ['G']); assert.deepEqual(r.none, []); assert.deepEqual(r.o3, [], 'both piles empty: nothing is drawn, and nothing bad happens');
});

test('NEW empty piles never lose the game: both piles empty at the start of a turn -> a message and the turn goes on', async () => {
  await setup(page, { me: { active: { e: [R] }, bench: [] }, ai: { active: { e: [R] }, bench: [] }, turn: 'ai', step: 2 });
  const t = await ev(() => { game.me.deckM = []; game.me.deckG = []; afterAi(); return { text: notice && notice.text, over: game.over, turn: game.turn, pending: game.drawPending }; });
  assert.match(t.text, /引ける山札がありません/); assert.equal(t.over, false); assert.equal(t.turn, 'player'); assert.equal(t.pending, false);
});

test('NEW attack power: basic 2 (+1 at effective energy 3 and 5, max 4); strong 3 (+1 at 4 and 6, max 5); cost rules unchanged', async () => {
  const BASIC = [[[R], 1, 2], [[R, O], 2, 2], [[R, O, Y], 3, 3], [[R, O, Y, B], 4, 3], [[R, O, Y, B, P], 5, 4], [[R, R, R, R], 7, 4], [[R, R, R, R, R, R, R], 13, 4]];
  for (const [e, total, grown] of BASIC) { const w = await attackOf({ e }, false); assert.equal(w.total, total, JSON.stringify(e)); assert.equal(w.grown, grown, `basic with total ${total}`); }
  const STRONG = [[[R, O], 2, 3], [[R, O, Y], 3, 3], [[R, O, Y, B], 4, 4], [[R, O, Y, B, P], 5, 4], [[R, R, R, R], 7, 5], [[R, O, Y, B, P, O], 6, 5]];
  for (const [e, total, grown] of STRONG) { const w = await attackOf({ e }, true); assert.equal(w.grown, grown, `strong with total ${total}: ${JSON.stringify(e)} got ${w.grown}`); assert.equal(w.cost, true); }
  assert.equal((await attackOf({ e: [R] }, true)).cost, false, 'strong still needs effective energy 2');
  assert.equal((await attackOf({ e: [] }, false)).cost, false, 'colourless cannot attack');
});

test('NEW same-colour bonus: 2+ REAL cards of the current colour add +1 (once); judged again after a colour adjustment; separate from the doubling of effective counts', async () => {
  assert.equal((await attackOf({ e: [R] }, false)).same, 0);
  assert.equal((await attackOf({ e: [R, O] }, false)).same, 0, 'two different colours');
  assert.equal((await attackOf({ e: [R, R] }, false)).same, 1);
  assert.equal((await attackOf({ e: [R, R, R, R, R] }, false)).same, 1, 'only once');
  assert.equal((await attackOf({ e: [R, O, O] }, false)).same, 0, 'base red has one red card');
  assert.equal((await attackOf({ e: [R, O, O], tune: O }, false)).same, 1, 'tuned to orange: two real orange cards');
  assert.equal((await attackOf({ e: [R, R, O], tune: O }, false)).same, 0, 'tuned to orange: one orange card');
  const w = await attackOf({ e: [R, R] }, false); assert.deepEqual([w.total, w.grown, w.same], [3, 3, 1], 'effective 3 (1+2) grows the basic attack AND the real pair adds the bonus');
});

test('NEW damage order: (grown + same-colour + boost) first, THEN weakness x2; the numbers add up; boost is spent', async () => {
  await setup(page, { me: { active: { e: [O, O] }, bench: [], bonus: 1 }, ai: { active: { e: [R] }, bench: [] }, targetKos: 4 });   // 橙 beats 赤
  const r = await attack(page, 'me', false);
  assert.match(r.texts[0], /基本攻撃：3＋同色1＋増強1 ×弱点2 = 10ダメージ/, 'grown 3 + same 1 + boost 1 = 5, doubled = 10'); assert.equal(r.bonus, 0);
  await setup(page, { me: { active: { e: [R, O, Y, B, P] }, bench: [] }, ai: { active: { e: [R] }, bench: [{ e: [] }] }, targetKos: 4 });                  // 赤 vs 赤: no weakness
  const r2 = await attack(page, 'me', true); assert.equal(r2.after - r2.before, 4, 'strong with effective 5: 4, no pair, no boost');
});

test('K: how big can one hit get? the maximum is documented (strong 5 + pair 1 + boost 1 = 7, x2 on weakness = 14 >= HP10); the simulation measures how often it happens', async () => {
  await setup(page, { me: { active: { e: [R, R, R, R] }, bench: [], bonus: 1 }, ai: { active: { e: [P], d: 0 }, bench: [{ e: [] }] }, targetKos: 4 });   // 赤 beats 橙? 赤(0)+... weak when att==def+1 -> def 紫(5)+1=0 => red beats purple
  const a = await ev(() => computeAttack(game.me, game.ai, true));
  assert.deepEqual([a.pw.grown, a.pw.same, a.pw.boost, a.weak, a.dmg], [5, 1, 1, true, 14]);
});

test('NEW attach slots: 1 normal card (front or bench) + 1 EXTRA card that may only go to a bench monster; both use hand energy; no free generation', async () => {
  const state = async (cfg) => { await setup(page, { me: cfg, turn: 'player', step: 1 }); };
  await state({ active: { e: [R] }, bench: [{ e: [] }], hand: [{ kind: 'en', color: R }, { kind: 'en', color: O }, { kind: 'en', color: Y }] });
  const r = await ev(() => { const p = game.me, [a, b, c] = p.hand, out = [];
    out.push(['front ok', attachBlock(p, p.active, a.color), attachSlot(p, p.active)]); out.push(['bench ok', attachBlock(p, p.bench[0], a.color), attachSlot(p, p.bench[0])]);
    doAttach(p, p.active, a); out.push(['front used -> front blocked', attachBlock(p, p.active, b.color), p.attached, p.attachedBench]);
    out.push(['front used -> bench via extra', attachBlock(p, p.bench[0], b.color), attachSlot(p, p.bench[0])]);
    doAttach(p, p.bench[0], b); out.push(['both used -> bench blocked', attachBlock(p, p.bench[0], c.color), p.attached, p.attachedBench]); return out; });
  assert.deepEqual(r[0], ['front ok', null, 'normal']); assert.deepEqual(r[1], ['bench ok', null, 'extra'], 'a bench target uses the EXTRA slot first');
  assert.equal(r[2][1], '今ターンの通常の付与枠は使用済み'); assert.deepEqual([r[2][2], r[2][3]], [true, false]);
  assert.deepEqual(r[3], ['front used -> bench via extra', null, 'extra']); assert.equal(r[4][1], '今ターンの付与枠（通常・控え追加）は使用済み'); assert.deepEqual([r[4][2], r[4][3]], [true, true]);
  // bench-bench: extra then normal
  await state({ active: { e: [R] }, bench: [{ e: [] }, { e: [] }], hand: [{ kind: 'en', color: R }, { kind: 'en', color: O }, { kind: 'en', color: Y }] });
  const r2 = await ev(() => { const p = game.me, [a, b, c] = p.hand; const s1 = doAttach(p, p.bench[0], a), s2 = doAttach(p, p.bench[1], b); return [s1, s2, attachBlock(p, p.bench[0], c.color), attachBlock(p, p.active, c.color)]; });
  assert.deepEqual(r2.slice(0, 2), ['extra', 'normal']); assert.ok(r2[2] && r2[3], 'a third card is refused everywhere');
  // slots reset every turn
  await ev(() => { turnStart(game.me); });
  assert.deepEqual(await ev(() => [game.me.attached, game.me.attachedBench]), [false, false]);
  // complement rule still applies to the extra slot
  await state({ active: { e: [R] }, bench: [{ e: [G] }], hand: [{ kind: 'en', color: B }, { kind: 'en', color: R }] });
  assert.equal(await ev(() => attachBlock(game.me, game.me.bench[0], R)), '補色のため付与できません', 'the bench monster\'s base is 緑, its complement 赤 is refused in the extra slot too');
  assert.equal(await ev(() => attachBlock(game.me, game.me.bench[0], B)), null);
});

test('NEW colour adjustment A: only colours ALREADY attached to the front; costs only the tune card; back at turn end; counts recomputed; once per turn', async () => {
  await setup(page, { me: { active: { e: [R, O, O] }, bench: [], hand: [{ kind: 'tune', color: 0 }, { kind: 'en', color: Y }] }, ai: { active: { e: [R] }, bench: [] }, turn: 'player', step: 1 });
  const r = await ev(() => { const p = game.me, t = p.hand[0], e = p.hand[1]; const cols = tuneColoursA(p); const before = { eff: eff(p), tot: energyTotal(p.active, p), pw: attackPower(p, false).sum };
    doTune(p, t, 'A', O, null); const after = { eff: eff(p), tot: energyTotal(p.active, p), same: attackPower(p, false).same, hand: p.hand.length, energy: [...p.active.energy], block: tuneBlock(p), tuned: p.tuned, tA: p.st.tuneA };
    endPlayerQuiet = null; turnEnd(p); return { cols, before, after, back: eff(p), handHasEnergy: p.hand.includes(e) }; });
  assert.deepEqual(r.cols, [R, O]); assert.deepEqual([r.before.eff, r.before.tot], [R, 1 + 1 + 1]);
  assert.equal(r.after.eff, O); assert.equal(r.after.tot, 1 + 4, 'tuned to 橙: both 橙 cards count 2 each, the 赤 counts 1'); assert.equal(r.after.same, 1, 'two real 橙 cards now');
  assert.equal(r.after.hand, 1, 'only the colour-adjust card was spent'); assert.deepEqual(r.after.energy, [R, O, O]); assert.match(r.after.block, /色調整済み/); assert.equal(r.after.tA, 1); assert.equal(r.back, R, 'back to the base colour at the end of the turn'); assert.equal(r.handHasEnergy, true);
});

test('NEW colour adjustment B: spends the tune card AND one hand energy card (discarded, NOT attached); the colour becomes that energy\'s colour; attach slots untouched', async () => {
  await setup(page, { me: { active: { e: [R] }, bench: [{ e: [] }], hand: [{ kind: 'tune', color: 0 }, { kind: 'en', color: B }, { kind: 'en', color: B }, { kind: 'en', color: P }] }, ai: { active: { e: [R] }, bench: [] }, turn: 'player', step: 1 });
  const r = await ev(() => { const p = game.me, t = p.hand[0], e = tuneColoursB(p); const cols = e.map(c => c.color); doTune(p, t, 'B', B, e[0]);
    return { cols, eff: eff(p), hand: p.hand.map(c => c.kind + (c.color ?? '')), energy: [...p.active.energy], attached: [p.attached, p.attachedBench], bench: [...p.bench[0].energy], tB: p.st.tuneB, tuned: p.tuned }; });
  assert.deepEqual(r.cols, [B, P], 'one choice per colour in hand'); assert.equal(r.eff, B);
  assert.deepEqual(r.hand, ['en4', 'en5'], 'tune card and ONE 青 energy card are gone, the other cards stay'); assert.deepEqual(r.energy, [R], 'the spent energy was not attached'); assert.deepEqual(r.attached, [false, false], 'no attach slot was used'); assert.deepEqual(r.bench, []);
  assert.equal(r.tB, 1); assert.equal(r.tuned, true);
});

test('NEW colour adjustment: not usable on a colourless front or twice a turn; method B needs hand energy, method A needs attached energy; the real UI shows the reason', async () => {
  await setup(page, { me: { active: { e: [] }, bench: [], hand: [{ kind: 'tune', color: 0 }] }, turn: 'player', step: 1 });
  assert.match(await ev(() => tuneBlock(game.me)), /無色には使えません/); assert.equal(await ev(() => canUseHand(game.me.hand[0])), false);
  assert.match(await ev(() => handBlockedReason(game.me.hand[0])), /エネルギーがありません/);
  await setup(page, { me: { active: { e: [R] }, bench: [], hand: [{ kind: 'tune', color: 0 }, { kind: 'tune', color: 2 }] }, turn: 'player', step: 1 });
  assert.deepEqual(await ev(() => [tuneColoursA(game.me), tuneColoursB(game.me).length]), [[R], 0], 'no energy in hand: B has nothing to spend');
  await ev(() => { doTune(game.me, game.me.hand[0], 'A', R, null); });
  assert.equal(await ev(() => canUseHand(game.me.hand[0])), false, 'second adjustment in the same turn');
});

test('KD-6 still holds with the new A/B methods: only the TEMPORARY colour\'s complement is refused; the original colour\'s complement card is kept at 0 effective', async () => {
  await setup(page, { me: { active: { e: [R, O] }, bench: [], hand: [{ kind: 'tune', color: 0 }, { kind: 'en', color: B }, { kind: 'en', color: G }] }, turn: 'player', step: 1 });
  const r = await ev(() => { const p = game.me, [t, b, g] = p.hand; doTune(p, t, 'A', O, null); return { B: attachBlock(p, p.active, B), G: attachBlock(p, p.active, G.color ?? 3) }; });
  assert.equal(r.B, '補色のため付与できません', '青 is the complement of the temporary 橙'); assert.equal(r.G, null, '緑 (complement of the base 赤) may be attached while tuned to 橙');
  const kept = await ev(() => { const p = game.me; doAttach(p, p.active, p.hand.find(c => c.kind === 'en' && c.color === 3)); const during = energyCounts(p.active, p); turnEnd(p); return { during, after: energyCounts(p.active, p), energy: [...p.active.energy] }; });
  assert.deepEqual(kept.energy, [R, O, G], 'the card is kept'); assert.equal(kept.after[G], 0, 'complement of the base: 0 effective'); assert.ok(kept.during[G] >= 1);
});

test('NEW knockout: the monster\'s energy is lost with it (no automatic inheritance); kos count; the front is gone until a refill', async () => {
  await setup(page, { me: { active: { e: [R, R] }, bench: [], kos: 0 }, ai: { active: { e: [O, O, O], d: 8 }, bench: [{ e: [Y, Y] }], hand: [] }, targetKos: 4 });
  const r = await attack(page, 'me', false);
  assert.equal(r.kos, 1); assert.ok(r.texts.some(t => t.includes('エネルギーは失われた')), r.texts.join(' / '));
  const s = await ev(() => ({ active: game.ai.active.energy, bench: game.ai.bench.length })); assert.deepEqual(s.active, [Y, Y], 'the bench monster comes forward with ITS OWN energy only'); assert.equal(s.bench, 0);
});

// ---- refill / early finish removed -------------------------------------------------------------------------------
const refillCase = async (def, who = 'me') => { const A = who, D = who === 'me' ? 'ai' : 'me';
  await setup(page, { [A]: { active: { e: [R] }, bench: [], kos: 0 }, [D]: def, targetKos: 4, turn: who === 'me' ? 'player' : 'ai' });
  return attack(page, A, false); };

test('NEW (replaces "no bench = early win"): the opponent\'s bench running out does NOT end the match; it refills from HAND first', async () => {
  const r = await refillCase({ active: { e: [R], d: 9 }, bench: [], hand: [{ kind: 'mon' }] });
  assert.equal(r.over, false); assert.ok(r.texts.some(t => t.includes('手札のモンスターを前衛に出した')), r.texts.join(' / '));
  assert.deepEqual(await ev(() => [!!game.ai.active, game.ai.hand.length]), [true, 0]);
});
test('NEW refill: no bench, no monster in hand -> the next monster comes from the MONSTER PILE', async () => {
  await ev(() => newGame());
  const before = await ev(() => game.ai.deckM.length);
  const r = await refillCase({ active: { e: [R], d: 9 }, bench: [], hand: [] });
  assert.equal(r.over, false); assert.ok(r.texts.some(t => t.includes('モンスター山札から前衛を補充')), r.texts.join(' / '));
  assert.deepEqual(await ev(() => [!!game.ai.active, game.ai.deckM.length]), [true, before - 1]);
});
test('NEW refill impossible (no bench, no monster in hand, monster pile empty) -> the side that cannot refill LOSES, wording from the player view', async () => {
  await setup(page, { me: { active: { e: [R] }, bench: [], kos: 0 }, ai: { active: { e: [R], d: 9 }, bench: [], hand: [] }, targetKos: 4 }); await ev(() => { game.ai.deckM = []; });
  const r = await attack(page, 'me', false);
  assert.equal(r.over, true); assert.ok(r.texts.includes('相手は場に出せるモンスターがいない（補充不能）。あなたの勝利！'), r.texts.join(' / ')); assert.equal(await ev(() => [game.winner, game.endReason].join()), 'me,refill');
  await setup(page, { me: { active: { e: [R], d: 9 }, bench: [], hand: [] }, ai: { active: { e: [R] }, bench: [], kos: 0 }, targetKos: 4, turn: 'ai' }); await ev(() => { game.me.deckM = []; });
  const r2 = await attack(page, 'ai', false);
  assert.equal(r2.over, true); assert.ok(r2.texts.includes('あなたは場に出せるモンスターがいない（補充不能）。相手の勝利！'), r2.texts.join(' / ')); assert.equal(await ev(() => game.endReason), 'refill');
});
test('NEW refill for the PLAYER: bench -> choose from bench; no bench but monsters in hand -> choose from hand; neither -> automatic from the monster pile', async () => {
  await ev(() => newGame());
  await setup(page, { me: { active: { e: [R], d: 9 }, bench: [{ e: [] }] }, ai: { active: { e: [R] }, bench: [], kos: 0 }, targetKos: 4, turn: 'ai' });
  let r = await attack(page, 'ai', false); assert.equal(r.promotion, 'bench');
  await setup(page, { me: { active: { e: [R], d: 9 }, bench: [], hand: [{ kind: 'mon' }] }, ai: { active: { e: [R] }, bench: [], kos: 0 }, targetKos: 4, turn: 'ai' });
  r = await attack(page, 'ai', false); assert.equal(r.promotion, 'hand');
  await setup(page, { me: { active: { e: [R], d: 9 }, bench: [], hand: [] }, ai: { active: { e: [R] }, bench: [], kos: 0 }, targetKos: 4, turn: 'ai' });
  r = await attack(page, 'ai', false); assert.ok(r.texts.some(t => t.includes('モンスター山札から前衛を補充した')), r.texts.join(' / ')); assert.equal(r.promotion, false); assert.equal(await ev(() => !!game.me.active), true);
});

test('NEW 4-KO match keeps going: with 3 knockouts needed more than the bench, the opponent keeps refilling from hand and pile until the target is reached', async () => {
  await setup(page, { me: { active: { e: [R, R] }, bench: [], kos: 2 }, ai: { active: { e: [R], d: 9 }, bench: [], hand: [{ kind: 'mon' }] }, targetKos: 4 });
  let r = await attack(page, 'me', false); assert.equal(r.over, false); assert.equal(r.kos, 3); assert.equal(await ev(() => !!game.ai.active), true);
  await ev(() => { game.ai.active.damage = 9; }); r = await attack(page, 'me', false);
  assert.equal(r.over, true); assert.ok(r.texts.some(t => t.includes('4体撃破')), r.texts.join(' / ')); assert.equal(await ev(() => game.endReason), 'ko');
});

test('NEW turn cap (safety net): at turn 40 the match is decided on knockouts; equal knockouts = draw', async () => {
  await setup(page, { me: { active: { e: [R] }, bench: [] }, ai: { active: { e: [R] }, bench: [] }, turn: 'ai', step: 39, targetKos: 4 });
  await ev(() => { game.me.kos = 2; game.ai.kos = 1; });
  let t = await ev(() => { afterAi(); const text = notice && notice.text, r = { text, over: game.over, winner: game.winner, reason: game.endReason }; return r; });
  assert.match(t.text, /ターン上限（40ターン）/); assert.equal(t.over, true); assert.deepEqual([t.winner, t.reason], ['me', 'cap']);
  await setup(page, { me: { active: { e: [R] }, bench: [] }, ai: { active: { e: [R] }, bench: [] }, turn: 'ai', step: 39, targetKos: 4 });
  t = await ev(() => { game.me.kos = 1; game.ai.kos = 1; afterAi(); return { text: notice && notice.text, winner: game.winner }; }); assert.match(t.text, /引き分け/); assert.equal(t.winner, 'draw');
});

test('NEW result summary: finishing a game records mode, winner, turns and the main indicators (copyable text)', async () => {
  await setup(page, { me: { active: { e: [R, R] }, bench: [], kos: 1 }, ai: { active: { e: [R], d: 9 }, bench: [{ e: [] }] }, targetKos: 2 });
  await attack(page, 'me', false);
  const t = await ev(() => RESULTS[0]);
  for (const must of ['【2体撃破・バランス試作1】', 'あなたの勝利', '規定数撃破', '最大有効E', '平均付与', '色調整', '一撃撃破', '撃破あたり']) assert.ok(t.includes(must), `result lacks ${must}: ${t}`);
});

test('AI draw policy: needs a monster -> monster pile; otherwise the growth pile; never picks an empty pile', async () => {
  await setup(page, { ai: { active: null, bench: [], hand: [] } });
  assert.equal(await ev(() => aiDrawChoice(game.ai)), 'M', 'no monster anywhere: take one');
  await setup(page, { ai: { active: { e: [] }, bench: [{ e: [] }, { e: [] }], hand: [] } }); assert.equal(await ev(() => aiDrawChoice(game.ai)), 'G', 'field full of monsters: take growth');
  await setup(page, { ai: { active: { e: [] }, bench: [{ e: [] }], hand: [] } }); assert.equal(await ev(() => aiDrawChoice(game.ai)), 'M', 'a free bench slot and no monster in hand: take a monster');
  await setup(page, { ai: { active: { e: [] }, bench: [{ e: [] }, { e: [] }], hand: [] } });
  await ev(() => { game.ai.deckG = []; }); assert.equal(await ev(() => aiDrawChoice(game.ai)), 'M', 'growth pile empty: the only legal choice');
  await ev(() => { game.ai.deckM = []; }); assert.equal(await ev(() => aiDrawChoice(game.ai)), null);
});
test('AI plays the new rules: uses both attach slots (front + bench), colour adjustment A/B when it raises the damage, and never attaches a complement', async () => {
  await setup(page, { ai: { active: { e: [R] }, bench: [{ e: [] }], hand: [{ kind: 'en', color: R }, { kind: 'en', color: O }, { kind: 'en', color: G }] }, me: { active: { e: [O] }, bench: [] }, turn: 'ai', step: 1 });
  const acts = await ev(() => { const p = game.ai, o = game.me, out = []; for (let a, i = 0; (a = aiChoose(p, o)) && i < 10; i++) { a.apply(); out.push(a.text); } return { out, front: [...p.active.energy], bench: [...p.bench[0].energy] }; });
  assert.ok(acts.out.length >= 2, acts.out.join(' / ')); assert.ok(!acts.front.includes(G), '緑 is the complement of the front\'s 赤'); assert.equal(acts.front.length + acts.bench.length, 1 + 2, 'the front started with one card; the AI attached exactly two (normal + extra), not three');
  assert.ok(acts.out.some(t => t.includes('控え追加付与')), acts.out.join(' / '));
  // tune: opposing front is 赤 so 橙 would be strong; AI has 橙 attached
  await setup(page, { ai: { active: { e: [Y, O] }, bench: [], hand: [{ kind: 'tune', color: 0 }] }, me: { active: { e: [R] }, bench: [] }, turn: 'ai', step: 1 });
  const t = await ev(() => { const p = game.ai, o = game.me; const a = aiChoose(p, o); if (a) a.apply(); return { text: a && a.text, color: p.tuneColor, hand: p.hand.length }; });
  assert.match(t.text, /色調整A/); assert.equal(t.color, O); assert.equal(t.hand, 0);
});
