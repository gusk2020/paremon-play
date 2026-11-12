// Headless balance simulation. It drives BOTH sides with the game's own opponent AI (aiChoose/aiDrawChoice) and the game's own
// engine (attackEvents, refillEvents, startDraws, ...), so the numbers describe exactly the rules that ship. No DOM is touched.
// Policy (stated in docs/TESTING.md): both sides play the same simple AI; "me" moves first and may not attack on its first turn.
export const SIM_SRC = () => {
  const mulberry = a => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  window.__simGame = (target, seed) => {
    Math.random = mulberry(seed);
    game = null; newGame(); game.targetKos = target; game.auto = { me: true, ai: true }; aiOpening(game.me);
    let side = game.me, guard = 0, turns = 0, tuneTurns = 0, oneSidedFirst = null, maxHand = 0; const bad = [];
    // invariants checked after every turn: every monster is somewhere exactly once (12 = still in play/hand/pile + vanished + knocked out),
    // card ids are unique, nothing negative, HP within the species' maximum
    const check = () => { for (const q of [game.me, game.ai]) { const o2 = other(q), mons = [q.active, ...q.bench].filter(Boolean);
      if (monstersLeft(q) + q.removed.length + o2.kos !== 12) bad.push(`monster count ${monstersLeft(q) + q.removed.length + o2.kos} (left ${monstersLeft(q)}, vanished ${q.removed.length}, knocked out ${o2.kos})`);
      const ids = [...q.hand.map(c => c.id), ...q.deckM.map(c => c.id), ...q.deckG.map(c => c.id), ...mons.map(m => m.id)]; if (new Set(ids).size !== ids.length) bad.push('duplicate card id');
      if (q.bench.length > 2) bad.push('bench overflow'); for (const m of mons) { if (m.damage < 0 || m.damage >= maxHp(m)) bad.push('bad HP'); if (m.energy.some(c => c < 0 || c > 5)) bad.push('bad energy'); }
      maxHand = Math.max(maxHand, q.hand.length); } };
    while (!game.over && guard++ < 400) {
      const p = side, o = other(p);
      turnStart(p); turns++;
      startDraws(p, aiDrawChoice(p));
      let n = 0, tuned0 = p.st.tunes;
      for (let a; (a = aiChoose(p, o)) && n < 40; n++) a.apply();
      if (p.st.tunes > tuned0) tuneTurns++;
      aiBattleEvents(p, o).forEach(e => e.fn && e.fn());
      turnEnd(p); check();
      if (game.over) break;
      if (p === game.ai) { game.step++; if (capReached()) { capEvents().forEach(e => e.fn && e.fn()); break; } }
      side = o;
    }
    if (!game.over) return { error: 'did not finish' };
    const m = game.me.st, a = game.ai.st;
    return { target, seed, bad, maxHand, winner: game.winner, reason: game.endReason, turns, ownTurns: game.step + 1, koMe: game.me.kos, koAi: game.ai.kos,
      maxE: Math.max(m.maxE, a.maxE), attached: m.attached + a.attached, placed: m.placed + a.placed, attacks: m.attacks + a.attacks, kos: m.kos + a.kos, oneShots: m.oneShots + a.oneShots,
      tunes: m.tunes + a.tunes, tuneTurns, tuneA: m.tuneA + a.tuneA, tuneB: m.tuneB + a.tuneB, extraAttach: m.extraAttach + a.extraAttach,
      loserKos: Math.min(game.me.kos, game.ai.kos),
      swaps: m.swaps + a.swaps, returns: m.returns + a.returns, recovers: m.recovers + a.recovers, benchAtks: m.benchAtks + a.benchAtks, benchKos: m.benchKos + a.benchKos, boostA: m.boostA + a.boostA, boostB: m.boostB + a.boostB,
      sp: ['spPlaced', 'spAtk', 'spKo', 'spKoed'].reduce((o2, k) => (o2[k] = Object.fromEntries(Object.keys({ ...m[k], ...a[k] }).map(sp => [sp, (m[k][sp] || 0) + (a[k][sp] || 0)])), o2), {}), deckLeft: [game.me.deckM.length, game.me.deckG.length, game.ai.deckM.length, game.ai.deckG.length] };
  };
};
export function summarize(rs) {
  const n = rs.length, sum = k => rs.reduce((s, r) => s + r[k], 0), mean = k => sum(k) / n, pct = f => 100 * rs.filter(f).length / n;
  const sorted = k => rs.map(r => r[k]).sort((a, b) => a - b);
  return { games: n, meanTurns: mean('turns'), medianTurns: sorted('turns')[n >> 1], p90Turns: sorted('turns')[Math.floor(n * 0.9)], meanMaxE: mean('maxE'),
    attachPerMonster: sum('attached') / Math.max(1, sum('placed')), attacksPerKo: sum('attacks') / Math.max(1, sum('kos')), tuneTurnRate: 100 * sum('tuneTurns') / Math.max(1, sum('turns')),
    refillFailRate: pct(r => r.reason === 'refill'), capRate: pct(r => r.reason === 'cap'), oneShotRate: 100 * sum('oneShots') / Math.max(1, sum('attacks')), firstPlayerWin: pct(r => r.winner === 'me'),
    shutoutRate: pct(r => r.loserKos === 0), drawRate: pct(r => r.winner === 'draw'), extraPerGame: mean('extraAttach'),
    swapsPerGame: mean('swaps'), returnsPerGame: mean('returns'), recoversPerGame: mean('recovers'), benchAtksPerGame: mean('benchAtks'), benchKoPerGame: mean('benchKos'),
    benchKoShare: 100 * sum('benchKos') / Math.max(1, sum('kos')), boostAPerGame: mean('boostA'), boostBPerGame: mean('boostB'), benchActGames: pct(r => r.swaps + r.returns + r.recovers > 0),
    species: speciesTable(rs) };
}

// per species over all games: share of placements, KOs made per attack, how often it was the one knocked out
export function speciesTable(rs) {
  const t = {};
  for (const r of rs) for (const k of ['spPlaced', 'spAtk', 'spKo', 'spKoed']) for (const [sp, v] of Object.entries(r.sp?.[k] || {})) { t[sp] ??= { spPlaced: 0, spAtk: 0, spKo: 0, spKoed: 0 }; t[sp][k] += v; }
  const placed = Object.values(t).reduce((a, x) => a + x.spPlaced, 0) || 1;
  return Object.fromEntries(Object.entries(t).map(([sp, x]) => [sp, { placedShare: +(100 * x.spPlaced / placed).toFixed(1), koPerAttack: +(x.spKo / Math.max(1, x.spAtk)).toFixed(3), koedPerPlaced: +(x.spKoed / Math.max(1, x.spPlaced)).toFixed(3) }]));
}
export const SEED0 = 10000;
// Runs `n` games per knockout target with the SAME seeds (so the three modes start from identical piles) and summarises them.
export async function measure(page, targets = [2, 3, 4], n = 1000) {
  const out = {};
  for (const t of targets) {
    const rs = await page.evaluate(([t, n, s0]) => { const r = []; for (let i = 0; i < n; i++) r.push(window.__simGame(t, s0 + i)); return r; }, [t, n, SEED0]);
    out[t] = { raw: rs, bad: rs.filter(r => r.error).length, ...summarize(rs.filter(r => !r.error)) };
  }
  return out;
}
export function markdownTable(m) {
  const rows = [['対戦時間（両者の手番の合計の平均）', 'meanTurns', 1], ['対戦時間（中央値／90%点）', null], ['育てた有効エネルギー最大値（平均）', 'meanMaxE', 2], ['1体あたり平均付与枚数', 'attachPerMonster', 2],
    ['撃破までの攻撃回数（攻撃数÷撃破数）', 'attacksPerKo', 2], ['色調整を使った手番の割合（%）', 'tuneTurnRate', 1], ['補充不能決着率（%）', 'refillFailRate', 1], ['ターン上限決着率（%）', 'capRate', 1],
    ['一撃撃破の割合（攻撃のうち、満タンHPを1回で倒した%）', 'oneShotRate', 2], ['先攻の勝率（%）', 'firstPlayerWin', 1], ['完封率（負けた側の撃破が0の割合 %）', 'shutoutRate', 1], ['控え追加付与の使用（1試合あたり枚数）', 'extraPerGame', 1],
    ['控え行動：交代（1試合あたり）', 'swapsPerGame', 2], ['控え行動：手札へ戻す（1試合あたり）', 'returnsPerGame', 2], ['控え行動：エネルギー全回収（1試合あたり）', 'recoversPerGame', 2], ['控え行動を1回でも使った試合（%）', 'benchActGames', 1],
    ['増強A（1試合あたり）', 'boostAPerGame', 2], ['増強B＝控え攻撃（1試合あたり）', 'boostBPerGame', 2], ['控え撃破の割合（全撃破のうち %）', 'benchKoShare', 1]];
  const ts = Object.keys(m);
  let md = `| 指標 | ${ts.map(t => t + '体戦').join(' | ')} |\n| --- | ${ts.map(() => '---').join(' | ')} |\n`;
  for (const [label, key, d] of rows) md += `| ${label} | ${ts.map(t => key ? (m[t][key] === undefined ? '—' : (+m[t][key]).toFixed(d)) : `${m[t].medianTurns}／${m[t].p90Turns}`).join(' | ')} |\n`;
  return md;
}
