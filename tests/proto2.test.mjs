// Balance prototype 2 (provisional): monster table, forward/back moves, bench actions with a shared once-per-turn slot,
// boost A/B, colour adjustment coexistence, AI use, and invariants. Real engine functions run in the page; no mocks.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, openGame, setup, attack } from './helpers.mjs';

let browser, ctx, page, errors;
before(async () => { browser = await launch(); ({ ctx, page, errors } = await openGame(browser, { seed: 17 })); });
after(async () => { assert.deepEqual(errors, [], 'no page errors'); await browser.close(); });
const R = 0, O = 1, Y = 2, G = 3, B = 4, P = 5;
const ev = (fn, arg) => page.evaluate(fn, arg);
const USED = '今ターンの控え行動（交代・手札へ戻す・エネルギー全回収は合計1回）は使用済みです';

test('monster table: 5 species with different HP / attack offsets / needed energy / copies; 12 monster cards; stronger = more energy and fewer copies', async () => {
  const d = await ev(() => { const p = player(), comp = {}; p.deckM.forEach(c => comp[c.species] = (comp[c.species] || 0) + 1); return { MON: JSON.parse(JSON.stringify(MON)), comp, total: p.deckM.length, g: p.deckG.length }; });
  assert.deepEqual(Object.keys(d.MON).sort(), ['centipede', 'dragon', 'golem', 'knight', 'skeleton']);
  assert.deepEqual(d.comp, { centipede: 4, skeleton: 3, golem: 2, knight: 2, dragon: 1 }); assert.equal(d.total, 12); assert.equal(d.g, 18);
  for (const m of Object.values(d.MON)) assert.ok(m.hp >= 8 && m.hp <= 14, 'HP inside the 8-14 range');
  assert.equal(new Set(Object.values(d.MON).map(m => m.role)).size, 5, 'five different roles');
  assert.equal(new Set(Object.values(d.MON).map(m => `${m.hp}/${m.bOff}/${m.sOff}/${m.needB}/${m.needS}`)).size, 5, 'five different stat lines');
  const byCount = Object.values(d.MON).sort((a, b) => a.count - b.count);
  for (let i = 1; i < byCount.length; i++) assert.ok(byCount[i].needS <= byCount[i - 1].needS, 'more copies never needs more energy than a rarer one');
  assert.ok(d.MON.dragon.count === 1 && d.MON.dragon.needS === Math.max(...Object.values(d.MON).map(m => m.needS)), 'the rarest is the one with the highest requirement');
});

test('monster table: HP, required energy and damage offset really drive the game (each species)', async () => {
  for (const sp of ['centipede', 'skeleton', 'golem', 'knight', 'dragon']) {
    const r = await ev(sp => { const m = MON[sp]; const p = game.me; p.active = Object.assign(mon({ id: 800, species: sp }), { energy: [] });
      const out = { hp: maxHp(p.active), canBasicEmpty: cost(p, false) };
      for (let n = 1; n <= 8; n++) { p.active.energy = Array(n).fill(0); out['b' + n] = cost(p, false); out['s' + n] = cost(p, true); }
      p.active.energy = [0, 1]; out.off = [attackPower(p, false).off, attackPower(p, true).off]; out.m = m; return out; }, sp);
    assert.equal(r.canBasicEmpty, false);
    for (let n = 1; n <= 8; n++) { const total = n === 1 ? 1 : 1 + (n - 1) * 2; // same colour: 1 then 2 each
      assert.equal(r['b' + n], total >= r.m.needB, `${sp} basic with ${n} cards`); assert.equal(r['s' + n], total >= Math.max(2, r.m.needS), `${sp} strong with ${n} cards`); }
    assert.deepEqual(r.off, [r.m.bOff, r.m.sOff]);
  }
});

test('type chart: all 36 attacker/defender colour pairs — only the 6 advantage pairs double the damage', async () => {
  let doubled = 0, plain = 0;
  for (let a = 0; a < 6; a++) for (let d = 0; d < 6; d++) {
    const r = await ev(([a, d]) => { game.me.active = Object.assign(mon({ id: 801, species: 'skeleton' }), { energy: [a] }); game.me.tuneColor = null; game.me.boostA = false; game.ai.active = Object.assign(mon({ id: 802, species: 'golem' }), { energy: [d] }); game.ai.tuneColor = null; const c = computeAttack(game.me, game.ai, false); return [c.weak, c.dmg]; }, [a, d]);
    const adv = a === (d + 1) % 6; assert.deepEqual(r, [adv, adv ? 4 : 2], `attacker ${a} vs defender ${d}`); adv ? doubled++ : plain++;
  }
  assert.deepEqual([doubled, plain], [6, 30]);
  assert.deepEqual(await ev(() => [0, 1, 2, 3, 4, 5].map(c => (c + 3) % 6)), [3, 4, 5, 0, 1, 2], 'complement pairs 赤/緑 橙/青 黄/紫');
});

test('same colour is efficient, mixed colours are flexible: counts 1, +2 per extra same card; a different colour is worth 1 and widens colour adjustment A', async () => {
  const r = await ev(() => { const p = game.me; const t = e => { p.active = Object.assign(mon({ id: 803 }), { energy: e }); p.tuneColor = null; return energyTotal(p.active, p); };
    p.active = Object.assign(mon({ id: 803 }), { energy: [0, 1, 2] }); return { same1: t([0]), same2: t([0, 0]), same3: t([0, 0, 0]), mixed3: t([0, 1, 2]), choicesA: tuneColoursA(p).length }; });
  assert.deepEqual([r.same1, r.same2, r.same3, r.mixed3, r.choicesA], [1, 3, 5, 3, 3]);
});

test('moving forward is free (hand→front, hand→bench, bench→front); moving back costs 1 energy', async () => {
  await setup(page, { me: { active: null, bench: [], hand: [{ kind: 'mon' }, { kind: 'mon' }] }, turn: 'player', step: 1 });
  const free = await ev(() => { const p = game.me, ids = p.hand.map(c => c.id); const a = place(p, ids[0], true), b = place(p, ids[1], false); return [a, b, p.retreated, p.active.energy.length, p.bench[0].energy.length]; });
  assert.deepEqual(free, [true, true, false, 0, 0], 'no energy, no action slot');
  await setup(page, { me: { active: null, bench: [{ e: [] }, { e: [R] }] }, turn: 'player', step: 1 });
  const prom = await ev(() => { const p = game.me; const ok = promoteBench(p, 0); return [ok, !!p.active, p.bench.length, p.retreated, p.active.energy.length]; });
  assert.deepEqual(prom, [true, true, 1, false, 0], 'bench→front when the front is empty is free and uses no action slot');
  await setup(page, { me: { active: { e: [R, O] }, bench: [{ e: [] }] }, turn: 'player', step: 1 });
  const back = await ev(() => { const p = game.me; const before = p.active.energy.length; doSwap(p, 0, 1); return [before, p.bench[0].energy.length, p.discard.length, p.retreated]; });
  assert.deepEqual(back, [2, 1, 1, true], 'the retreating front pays exactly one energy card, which goes to the discard');
});

test('a front monster with 0 energy cannot retreat (and nothing breaks); a bench monster with 0 energy cannot be returned or recovered', async () => {
  await setup(page, { me: { active: { e: [] }, bench: [{ e: [] }] }, turn: 'player', step: 1 });
  const r = await ev(() => { const p = game.me; return [swapBlock(p), returnBlock(p, p.bench[0]), recoverBlock(p, p.bench[0])]; });
  assert.ok(r[0].includes('エネルギー') && r[1].includes('エネルギー') && r[2].includes('エネルギー'), r.join(' / '));
  assert.deepEqual(await ev(() => [game.me.active.energy.length, game.me.bench.length, game.me.retreated]), [0, 1, false], 'blocked checks change nothing');
});

test('return to hand: costs one attached energy but discards ALL of them; the monster comes back as a fresh full-HP card; bench slot freed; shares the once-per-turn slot', async () => {
  await setup(page, { me: { active: { e: [R] }, bench: [{ e: [R, R, O], d: 5, sp: 'knight' }], hand: [] }, turn: 'player', step: 1 });
  const r = await ev(() => { const p = game.me, id = p.bench[0].id; const before = [swapBlock(p), returnBlock(p, p.bench[0]), recoverBlock(p, p.bench[0])];
    doReturn(p, 0); const c = p.hand[0]; return { before, bench: p.bench.length, hand: p.hand.length, kind: c.kind, sp: c.species, sameId: c.id === id, discard: p.discard.length, flag: p.retreated, after: [swapBlock(p), recoverBlock(p, { energy: [1] })] }; });
  assert.deepEqual(r.before, [null, null, null]);
  assert.deepEqual([r.bench, r.hand, r.kind, r.sp, r.sameId, r.discard, r.flag], [0, 1, 'mon', 'knight', true, 3, true]);
  assert.deepEqual(r.after, [USED, USED], 'swap / recover are blocked for the rest of the turn');
  // re-placing the returned card: full HP, 0 energy, usable at once
  const again = await ev(() => { const p = game.me; const ok = place(p, p.hand[0].id, false); const m = p.bench[0]; return [ok, m.damage, m.energy.length, hpLeft(m), maxHp(m)]; });
  assert.deepEqual(again, [true, 0, 0, 12, 12]);
  await ev(() => turnStart(game.me)); assert.equal(await ev(() => returnBlock(game.me, game.me.bench[0])).then(x => typeof x), 'string', 'a monster with 0 energy still cannot be returned (needs 1)');
});

test('energy recovery: ALL attached energy cards return to the hand (no extra cost), the monster vanishes (not discard, not deck, not the opponent\'s KO count), shared slot', async () => {
  await setup(page, { me: { active: { e: [R] }, bench: [{ e: [R, B, B], sp: 'dragon' }], hand: [{ kind: 'mon' }] }, turn: 'player', step: 1 });
  const r = await ev(() => { const p = game.me, o = game.ai, id = p.bench[0].id, h0 = p.hand.length, k0 = o.kos, left0 = monstersLeft(p); const lost = doRecover(p, 0);
    const en = p.hand.filter(c => c.kind === 'en').map(c => c.color).sort();
    return { lost, bench: p.bench.length, gain: p.hand.length - h0, en, vanished: p.removed.map(x => x.id === id && x.species === 'dragon'), discard: p.discard.length, inHand: p.hand.some(c => c.id === id), inDeck: [...p.deckM, ...p.deckG].some(c => c.id === id), oppKo: o.kos - k0, left: left0 - monstersLeft(p), flag: p.retreated, blocked: [swapBlock(p), returnBlock(p, { energy: [1] })] }; });
  assert.deepEqual([r.lost, r.bench, r.gain, r.en, r.vanished, r.discard, r.inHand, r.inDeck, r.oppKo, r.left, r.flag], [false, 0, 3, [0, 4, 4], [true], 0, false, false, 0, 1, true]);
  assert.deepEqual(r.blocked, [USED, USED]);
});

test('the last monster: vanishing it with no other monster anywhere (field, hand, pile) loses for the acting side; with another monster left it does not', async () => {
  await setup(page, { me: { active: null, bench: [{ e: [R, R] }], hand: [] }, turn: 'player', step: 1 });
  const r = await ev(() => { game.me.deckM = []; const lost = doRecover(game.me, 0); return [lost, game.over, game.winner, game.endReason]; });
  assert.deepEqual(r, [true, true, 'ai', 'refill']);
  await setup(page, { me: { active: { e: [] }, bench: [{ e: [R, R] }], hand: [] }, turn: 'player', step: 1 });
  assert.deepEqual(await ev(() => { const lost = doRecover(game.me, 0); return [lost, game.over]; }), [false, false]);
  await setup(page, { me: { active: null, bench: [{ e: [R, R] }], hand: [{ kind: 'mon' }] }, turn: 'player', step: 1 });
  assert.deepEqual(await ev(() => [doRecover(game.me, 0), game.over]), [false, false], 'a monster in hand counts as another monster');
});

test('forced promotion after a knockout does not use (or reset) the once-per-turn bench slot', async () => {
  await setup(page, { me: { active: { e: [R], d: 9 }, bench: [{ e: [] }], retreated: true }, ai: { active: { e: [R] }, bench: [] }, turn: 'ai', step: 1, targetKos: 4 });
  const used = await ev(() => { const ev1 = attackEvents(game.ai, false); ev1.forEach(e => e.fn && e.fn()); return [game.promotion, game.me.retreated]; });
  assert.deepEqual(used, ['bench', true], 'a slot that was already used stays used; promotion is a separate, free path');
  await setup(page, { ai: { active: { e: [R], d: 9 }, bench: [{ e: [] }], retreated: false }, me: { active: { e: [R] }, bench: [] }, turn: 'player', step: 1, targetKos: 4 });
  const fresh2 = await ev(() => { attackEvents(game.me, false).forEach(e => e.fn && e.fn()); return [game.ai.active && true, game.ai.bench.length, game.ai.retreated]; });
  assert.deepEqual(fresh2, [true, 0, false], 'the AI promotes from its bench without touching its action slot');
});

test('no natural recovery on the bench: damage stays until the monster is returned to hand', async () => {
  await setup(page, { me: { active: { e: [R] }, bench: [{ e: [R], d: 6 }] }, turn: 'ai', step: 1 });
  await ev(() => { turnEnd(game.me); turnStart(game.me); afterAi(); });
  assert.equal(await ev(() => game.me.bench[0].damage), 6);
});

// ---------------- boost ----------------
test('boost A: basic +2 / strong +1, added BEFORE the weakness doubling; once per turn; reset at turn end', async () => {
  await setup(page, { me: { active: { e: [O, O] }, bench: [], hand: [{ kind: 'boost', color: 0 }, { kind: 'boost', color: 1 }] }, ai: { active: { e: [R], sp: 'golem' }, bench: [] }, turn: 'player', step: 1, targetKos: 4 });
  assert.equal(await ev(() => boostBlock(game.me, 'A')), null);
  await ev(() => doBoostA(game.me, game.me.hand[0]));
  assert.deepEqual(await ev(() => [attackPower(game.me, false).boost, attackPower(game.me, true).boost, boostBlock(game.me, 'A'), boostBlock(game.me, 'B'), game.me.hand.length]), [2, 1, '今ターンは増強済みです', '今ターンは増強済みです', 1], 'a second boost card cannot be used this turn');
  const r = await attack(page, 'me', false); assert.equal(r.after - r.before, (3 + 1 + 2) * 2, 'grown 3 + same 1 + boost 2, then x2'); assert.equal(r.boostA, false);
});

test('boost is not consumed when no attack is possible (first turn, not enough energy, nothing to hit)', async () => {
  const hand = [{ kind: 'boost', color: 0 }];
  await setup(page, { me: { active: { e: [O] }, bench: [], hand }, turn: 'player', step: 0 });
  assert.match(await ev(() => boostBlock(game.me, 'A')), /先攻/); assert.equal(await ev(() => canUseHand(game.me.hand[0])), false);
  await setup(page, { me: { active: { e: [] }, bench: [], hand }, turn: 'player', step: 1 });
  assert.match(await ev(() => boostBlock(game.me, 'B')), /エネルギー/); assert.equal(await ev(() => (useHand(game.me.hand[0]), document.getElementById('overlay').classList.contains('show'))), false);
  assert.equal(await ev(() => game.me.hand.length), 1);
  await setup(page, { me: { active: { e: [O] }, bench: [], hand }, ai: { active: { e: [R] }, bench: [] }, turn: 'player', step: 1 });
  assert.match(await ev(() => boostBlock(game.me, 'B')), /控え/); assert.equal(await ev(() => boostBlock(game.me, 'A')), null);
  await setup(page, { me: { active: { e: [O] }, bench: [], hand }, ai: { active: null, bench: [{ e: [] }] }, turn: 'player', step: 1 });
  assert.match(await ev(() => boostBlock(game.me, 'A')), /前衛/); assert.equal(await ev(() => boostBlock(game.me, 'B')), null);
});

test('boost B: basic attack on the chosen bench monster, NO weakness, NO boost value, uses the attack; a KO counts for the attacker and leaves the front alone', async () => {
  await setup(page, { me: { active: { e: [O, O] }, bench: [], hand: [{ kind: 'boost', color: 0 }] }, ai: { active: { e: [P], d: 2 }, bench: [{ e: [R], d: 2 }, { e: [Y, Y, Y] }] }, turn: 'player', step: 1, targetKos: 4 });
  const r = await ev(() => { const p = game.me, o = game.ai; doBoostB(p, p.hand[0]); const before = [o.bench[0].damage, o.active.damage];
    const events = benchAttackEvents(p, 0); events.forEach(e => e.fn && e.fn());
    return { dmg: o.bench[0] ? o.bench[0].damage - before[0] : 'gone', front: o.active.damage - before[1], text: events[0].text, boosted: p.boosted, hand: p.hand.length, kos: p.kos, bench: o.bench.length }; });
  assert.deepEqual([r.dmg, r.front, r.boosted, r.hand, r.kos, r.bench], [4, 0, true, 0, 0, 2], 'grown 3 + same 1 = 4 on a red target although 橙 beats 赤 (no x2)');
  assert.match(r.text, /弱点・増強値なし/);
  const ko = await ev(() => { const p = game.me, o = game.ai; o.bench[0].damage = 6; const ev2 = benchAttackEvents(p, 0); ev2.forEach(e => e.fn && e.fn()); return { kos: p.kos, bench: o.bench.length, front: !!o.active, frontDmg: o.active.damage, texts: ev2.map(e => e.text), oneShots: p.st.oneShots }; });
  assert.deepEqual([ko.kos, ko.bench, ko.front, ko.frontDmg], [1, 1, true, 2], 'the damaged bench monster (already trained, damage accumulated) is knocked out and removed; the front is untouched');
  assert.ok(ko.texts.some(t => /控えのモンスターを1体撃破/.test(t)));
});

test('boost B can win the match; and it needs the normal-attack energy condition', async () => {
  await setup(page, { me: { active: { e: [R] }, bench: [], kos: 1, hand: [{ kind: 'boost', color: 0 }] }, ai: { active: { e: [R] }, bench: [{ e: [], d: 9 }] }, turn: 'player', step: 1, targetKos: 2 });
  await ev(() => { const p = game.me; doBoostB(p, p.hand[0]); benchAttackEvents(p, 0).forEach(e => e.fn && e.fn()); });
  assert.deepEqual(await ev(() => [game.over, game.winner, game.endReason]), [true, 'me', 'ko']);
  await setup(page, { me: { active: { e: [R] }, bench: [], hand: [{ kind: 'boost', color: 0 }] }, ai: { active: { e: [R] }, bench: [{ e: [] }] }, turn: 'player', step: 1 });
  assert.equal(await ev(() => (game.me.active.species = 'knight', boostBlock(game.me, 'B'))).then(x => /エネルギー/.test(x)), true, 'a knight needs 2 effective energy even for the basic attack');
});

test('colour adjustment coexists with boost A and species offsets (tuned colour decides the weakness; boost after)', async () => {
  await setup(page, { me: { active: { e: [R, O], sp: 'centipede' }, bench: [], hand: [{ kind: 'tune', color: 0 }, { kind: 'boost', color: 1 }] }, ai: { active: { e: [R], sp: 'golem' }, bench: [] }, turn: 'player', step: 1, targetKos: 4 });
  const r = await ev(() => { const p = game.me; const base = computeAttack(p, game.ai, false); doTune(p, p.hand[0], 'A', 1, null); doBoostA(p, p.hand[0]); const c = computeAttack(p, game.ai, false);
    return { base: [base.weak, base.dmg], tuned: [c.weak, c.pw.grown, c.pw.same, c.pw.boost, c.dmg], hand: p.hand.length }; });
  assert.deepEqual(r.base, [false, 3 + 0 + 0], 'red centipede vs red: not weak; basic 2 + speed offset 1 (total 3 with 2 effective)');
  assert.deepEqual(r.tuned.slice(0, 4), [true, 4, 0, 2], 'tuned to 橙: effective 3 (橙 counts 2 while tuned) -> grown 3 + speed offset 1'); assert.equal(r.tuned[4], (4 + 2) * 2); assert.equal(r.hand, 0);
});

test('AI: uses boost B only when it can knock out a bench monster without being able to knock out the front; otherwise boost A', async () => {
  await setup(page, { ai: { active: { e: [O, O] }, bench: [], hand: [{ kind: 'boost', color: 0 }] }, me: { active: { e: [P] }, bench: [{ e: [Y, Y], d: 6 }, { e: [], d: 1 }] }, turn: 'ai', step: 1, targetKos: 4 });
  assert.equal(await ev(() => aiBenchStrike(game.ai, game.me)), 0, 'the trained, damaged bench monster is the lethal target');
  const r = await ev(() => { const ev1 = aiBattleEvents(game.ai, game.me); ev1.forEach(e => e.fn && e.fn()); return [game.ai.kos, game.me.bench.length, !!game.me.active, game.ai.hand.length, ev1.length]; });
  assert.deepEqual(r.slice(0, 4), [1, 1, true, 0]);
  await setup(page, { ai: { active: { e: [O, O] }, bench: [], hand: [{ kind: 'boost', color: 0 }] }, me: { active: { e: [P], d: 9 }, bench: [{ e: [], d: 6 }] }, turn: 'ai', step: 1, targetKos: 4 });
  assert.equal(await ev(() => aiBenchStrike(game.ai, game.me)), null, 'the front can be knocked out normally: no bench strike');
  await setup(page, { ai: { active: { e: [O, O] }, bench: [], hand: [{ kind: 'boost', color: 0 }] }, me: { active: { e: [P] }, bench: [{ e: [] }] }, turn: 'ai', step: 1, targetKos: 4 });
  assert.equal(await ev(() => aiBenchStrike(game.ai, game.me)), null, 'nothing on the bench can be knocked out in one hit');
  assert.match(await ev(() => aiChoose(game.ai, game.me).text), /増強A/);
});

test('AI bench actions: recovers a nearly dead, energy-rich bench monster; returns a wounded one; swaps out a nearly dead front; never twice in a turn', async () => {
  await setup(page, { ai: { active: { e: [R] }, bench: [{ e: [R, R, R, R], d: 9 }], hand: [] }, me: { active: { e: [R] }, bench: [] }, turn: 'ai', step: 1 });
  assert.match(await ev(() => aiChoose(game.ai, game.me).text), /回収/);
  await setup(page, { ai: { active: { e: [R] }, bench: [{ e: [R], d: 8 }], hand: [] }, me: { active: { e: [R] }, bench: [] }, turn: 'ai', step: 1 });
  assert.match(await ev(() => aiChoose(game.ai, game.me).text), /手札に戻した/);
  await setup(page, { ai: { active: { e: [R, O], d: 9 }, bench: [{ e: [] }], hand: [] }, me: { active: { e: [R] }, bench: [] }, turn: 'ai', step: 1 });
  const acts = await ev(() => { const out = []; for (let a, i = 0; (a = aiChoose(game.ai, game.me)) && i < 6; i++) { a.apply(); out.push(a.text); } return out; });
  assert.ok(acts.some(t => /交代/.test(t)), acts.join(' / ')); assert.equal(acts.filter(t => /交代|回収|手札に戻した/.test(t)).length, 1, 'one bench action per turn');
});

test('hand size has no cap: returns and recoveries can grow the hand without breaking anything', async () => {
  await setup(page, { me: { active: { e: [] }, bench: [{ e: [R, R, R, R, R, R, R, R] }], hand: Array.from({ length: 14 }, () => ({ kind: 'en', color: 2 })) }, turn: 'player', step: 1 });
  assert.equal(await ev(() => { doRecover(game.me, 0); render(); return game.me.hand.length; }), 22);
  assert.equal(await ev(() => document.querySelectorAll('#hand button').length), 22);
});
