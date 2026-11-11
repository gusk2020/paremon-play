// UI regression: boot, layouts (phone + desktop), tap menus, mouse/touch drag, victory selector.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, openGame, setup, ack, rect, mouseDrag, touchDrag, handId, clicksAllowed, startMatch, chooseDraw, MOBILE, DESKTOP } from './helpers.mjs';

const browser = await launch();
after(async () => { await browser.close(); });

const overlay = page => page.evaluate(() => document.getElementById('overlay').classList.contains('show'));
const modalButtons = page => page.$$eval('#modalButtons button', bs => bs.map(b => ({ t: b.textContent.trim(), d: b.disabled })));
const dragHand = id => `#hand [data-drag-hand="${id}"]`;

for (const [name, viewport] of [['phone 412x892', MOBILE], ['small phone 360x640', { width: 360, height: 640 }], ['desktop 1280x900', DESKTOP]]) {
  test(`boot (${name}): no errors, board + 5-card hand drawn, every image decoded, no horizontal overflow`, async () => {
    const { ctx, page, errors } = await openGame(browser, { seed: 11, viewport });
    await page.waitForTimeout(300);
    const s = await page.evaluate(() => ({
      enemyCards: document.querySelectorAll('#enemySlots .bcard').length, playerEmpty: document.querySelectorAll('#playerSlots .empty-slot').length,
      hand: document.querySelectorAll('#hand button').length, imgs: [...document.images].map(i => ({ src: (i.dataset.art || i.getAttribute('src')), ok: i.complete && i.naturalWidth > 0 })),
      overflowX: document.documentElement.scrollWidth - window.innerWidth, logo: !!document.querySelector('.logo-banner img'),
      title: document.title, opScore: document.getElementById('opScore').textContent }));
    assert.deepEqual(errors, []);
    const ai = await page.evaluate(() => ({ placed: (game.ai.active ? 1 : 0) + game.ai.bench.length, inHand: game.ai.hand.filter(c => c.kind === 'mon').length, handMons: game.me.hand.filter(c => c.kind === 'mon').length }));
    assert.ok(ai.placed >= 1 && ai.placed <= 3, 'the AI opens with a front monster and up to 2 bench monsters');
    assert.equal(s.enemyCards, ai.placed); assert.equal(s.playerEmpty, 3); assert.equal(s.hand, 5); assert.equal(s.logo, true);
    assert.equal(s.imgs.length, 1 + s.enemyCards + ai.handMons, 'logo + one picture per enemy card + one per monster in the hand');
    for (const i of s.imgs) assert.ok(i.ok, `image failed to load: ${i.src}`);
    assert.ok(s.imgs.some(i => /^paremon_monsters2\/[a-z]+_0\.png$/.test(i.src)), 'colourless line art is used for unplaced monsters');
    assert.ok(s.overflowX <= 0, `horizontal overflow ${s.overflowX}px`);
    assert.match(s.title, /v0\.17/);
    await ctx.close();
  });
}

test('boot: the hand cards stay inside the viewport on a phone and the enemy/player rows do not overlap', async () => {
  const { ctx, page } = await openGame(browser, { seed: 5, viewport: MOBILE });
  const g = await page.evaluate(() => { const r = s => document.querySelector(s).getBoundingClientRect();
    const e = r('#enemySlots'), p = r('#playerSlots'), h = r('#hand'); return { eBottom: e.bottom, pTop: p.top, hLeft: h.left, hRight: h.right, w: innerWidth }; });
  assert.ok(g.eBottom <= g.pTop + 60, 'enemy front card may overlap the centre line but not the player row'); // front cards are offset 46px by design
  assert.ok(g.hLeft >= 0 && g.hRight <= g.w);
  await ctx.close();
});

test('victory-target selector offers exactly 2/3/4 knockouts and updates the score pills', async () => {
  const { ctx, page } = await openGame(browser, { seed: 21 });
  assert.deepEqual(await page.$$eval('#victoryTarget option', o => o.map(x => x.value)), ['2', '3', '4']);
  for (const n of ['3', '4', '2']) {
    await page.selectOption('#victoryTarget', n);
    const t = await page.evaluate(() => [game.targetKos, document.getElementById('opScore').textContent, document.getElementById('myScore').textContent]);
    assert.deepEqual(t, [Number(n), `撃破 0/${n}`, `撃破 0/${n}`]);
  }
  await ctx.close();
});

test('setup rules: the start button stays disabled until a front monster is placed; then a pile is chosen (+1 extra growth card); the first attack is impossible on turn 1', async () => {
  const { ctx, page, errors } = await openGame(browser, { seed: 8, viewport: DESKTOP });
  assert.equal(await page.isDisabled('#startBtn'), true);
  const id = await handId(page, 'mon');
  await mouseDrag(page, dragHand(id), '#playerSlots [data-slot="player:1"]');
  await ack(page);
  assert.equal(await page.evaluate(() => !!game.me.active), true);
  await startMatch(page, 'M');
  assert.equal(await page.evaluate(() => [game.turn, game.step, game.me.hand.length, game.me.deckM.length, game.me.deckG.length].join()), 'player,0,6,9,14', 'hand 5 - 1 placed + normal card (monster pile) + extra card (growth pile)');
  await clicksAllowed(page);
  await page.click('#playerSlots [data-slot="player:1"]');
  const b = await modalButtons(page);
  assert.deepEqual(b.map(x => x.t), ['詳細', 'ワザ①：攻撃2', 'ワザ②：攻撃3', '前衛と控えの交代', '戻る']);
  assert.ok(b.find(x => x.t.startsWith('ワザ①')).d && b.find(x => x.t.startsWith('ワザ②')).d, 'moves disabled on the very first turn');
  assert.match(await page.textContent('#modalText'), /先攻の最初のターンは攻撃できません/, 'the reason is shown');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('tap: hand card opens the centre menu (使う / 詳細 / 戻る); detail shows and closes; back closes', async () => {
  const { ctx, page } = await openGame(browser, { seed: 12 });
  const id = await handId(page, 'mon');
  await page.click(`#hand [data-drag-hand="${id}"]`);
  assert.equal(await overlay(page), true);
  assert.equal(await page.textContent('#modalTitle'), 'モンスター');
  assert.deepEqual((await modalButtons(page)).map(x => x.t), ['使う', '詳細', '戻る']);
  await page.click('#modalButtons button:has-text("詳細")');
  assert.match(await page.textContent('#detailContent'), /ワザ① 基本攻撃：2から成長/);
  assert.equal(await page.isVisible('#detailContent img'), true);
  await page.click('#modalButtons button:has-text("閉じる")');
  assert.equal(await overlay(page), false);
  await page.click(`#hand [data-drag-hand="${id}"]`); await page.click('#modalButtons button:has-text("戻る")');
  assert.equal(await overlay(page), false);
  await ctx.close();
});

test('tap: using a monster from the menu asks for the slot and places it (no double menu after the slot is chosen)', async () => {
  const { ctx, page } = await openGame(browser, { seed: 13 });
  const id = await handId(page, 'mon');
  await page.click(`#hand [data-drag-hand="${id}"]`);
  await page.click('#modalButtons button:has-text("使う")');
  assert.equal(await page.textContent('#modalTitle'), '使用する対象');
  const labels = (await modalButtons(page)).map(x => x.t);
  assert.ok(labels[0].startsWith('前衛') && labels[1].startsWith('控え①') && labels[2].startsWith('控え②'));
  await page.click('#modalButtons button:has-text("前衛")');
  assert.equal(await overlay(page), false, 'no second menu');
  await ack(page);
  assert.equal(await page.evaluate(() => !!game.me.active), true);
  await ctx.close();
});

test('tap: field menu for the front monster / a bench monster / an empty slot / the enemy', async () => {
  const { ctx, page } = await openGame(browser, { seed: 14 });
  await setup(page, { me: { active: { e: [0, 1] }, bench: [{ e: [] }] }, ai: { active: { e: [2] }, bench: [{ e: [] }] }, turn: 'player', step: 1 });
  await page.click('#playerSlots [data-slot="player:1"]');
  assert.equal(await page.textContent('#modalTitle'), '前衛の操作');
  const front = await modalButtons(page);
  assert.deepEqual(front.map(x => x.t), ['詳細', 'ワザ①：攻撃2', 'ワザ②：攻撃3', '前衛と控えの交代', '戻る']);
  assert.ok(front.every(x => !x.d), 'both moves and the swap are usable with 2 energy');
  await page.click('#modalButtons button:has-text("戻る")');
  await page.click('#playerSlots [data-slot="player:0"]');
  assert.equal(await page.textContent('#modalTitle'), '控え①の操作');
  assert.deepEqual((await modalButtons(page)).map(x => x.t), ['詳細', '前衛と交代', '戻る']);
  await page.click('#modalButtons button:has-text("戻る")');
  await page.click('#playerSlots [data-slot="player:2"]');
  assert.equal(await page.textContent('#modalTitle'), '空きスロット');
  await page.click('#modalButtons button'); // 戻る
  await page.click('#enemySlots [data-slot="enemy:1"]');
  assert.match(await page.textContent('#modalTitle'), /詳細/); // tapping an enemy shows detail only
  await ctx.close();
});

test('tap: attack from the menu asks for a final confirmation, then plays the damage and passes the turn', async () => {
  const { ctx, page } = await openGame(browser, { seed: 15 });
  await setup(page, { me: { active: { e: [1, 3] }, bench: [] }, ai: { active: { e: [0] }, bench: [{ e: [] }] }, turn: 'player', step: 1 });
  await page.click('#playerSlots [data-slot="player:1"]');
  await page.click('#modalButtons button:has-text("ワザ②")');
  assert.equal(await page.textContent('#modalTitle'), '攻撃の最終確認');
  await page.click('#modalButtons button:has-text("攻撃する")');
  assert.match(await page.textContent('#messageText'), /強攻撃：3 ×弱点2 = 6ダメージ/);
  assert.equal(await page.evaluate(() => game.ai.active.damage), 6, 'damage is applied as its message appears');
  await page.click('#message'); // acknowledge once: the attack ends the turn and the opponent starts
  assert.equal(await page.evaluate(() => [game.turn, game.me.active.energy.length].join()), 'ai,2', 'the attack ends the turn and keeps the energy');
  await ctx.close();
});

test('mouse drag (desktop): monster -> front, monster -> bench, energy -> monster, boost -> front; illegal drops do nothing', async () => {
  const { ctx, page, errors } = await openGame(browser, { seed: 31, viewport: DESKTOP });
  await setup(page, { me: { active: null, bench: [], hand: [{ kind: 'mon' }, { kind: 'mon' }, { kind: 'en', color: 0 }, { kind: 'en', color: 1 }, { kind: 'boost', color: 1 }] }, turn: 'setup', step: 0 });
  const ids = await page.evaluate(() => game.me.hand.map(c => c.id));
  await mouseDrag(page, dragHand(ids[0]), '#playerSlots [data-slot="player:0"]'); // front must come first? bench with no front is refused
  assert.equal(await page.evaluate(() => game.me.bench.length), 0, 'a bench monster cannot be placed while there is no front monster');
  await mouseDrag(page, dragHand(ids[0]), '#playerSlots [data-slot="player:1"]'); await ack(page);
  assert.equal(await page.evaluate(() => !!game.me.active), true);
  await mouseDrag(page, dragHand(ids[1]), '#playerSlots [data-slot="player:2"]'); // right bench slot refused: left bench must be filled first
  assert.equal(await page.evaluate(() => game.me.bench.length), 0, 'bench slots fill left-to-right');
  await mouseDrag(page, dragHand(ids[1]), '#playerSlots [data-slot="player:0"]'); await ack(page);
  assert.equal(await page.evaluate(() => game.me.bench.length), 1);
  await setup(page, { me: { active: { e: [] }, bench: [{ e: [] }], hand: [{ kind: 'en', color: 0 }, { kind: 'en', color: 1 }, { kind: 'en', color: 2 }, { kind: 'boost', color: 1 }] }, turn: 'player', step: 1 });
  const h = await page.evaluate(() => game.me.hand.map(c => c.id));
  await mouseDrag(page, dragHand(h[0]), '#playerSlots [data-slot="player:0"]'); await ack(page); // energy onto a bench monster = the EXTRA (bench-only) slot
  assert.deepEqual(await page.evaluate(() => [game.me.bench[0].energy, game.me.attached, game.me.attachedBench]), [[0], false, true]);
  await mouseDrag(page, dragHand(h[1]), '#playerSlots [data-slot="player:1"]'); await ack(page); // the NORMAL slot is still free for the front
  assert.deepEqual(await page.evaluate(() => [game.me.active.energy, game.me.attached]), [[1], true]);
  await mouseDrag(page, dragHand(h[2]), '#playerSlots [data-slot="player:1"]');   // both slots used: a third card is refused
  await mouseDrag(page, dragHand(h[2]), '#playerSlots [data-slot="player:0"]');
  assert.deepEqual(await page.evaluate(() => [game.me.active.energy.length, game.me.bench[0].energy.length, game.me.hand.length]), [1, 1, 2]);
  await mouseDrag(page, dragHand(h[3]), '#playerSlots [data-slot="player:1"]'); await ack(page);
  assert.deepEqual(await page.evaluate(() => [game.me.bonus, game.me.boosted]), [1, true]);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('mouse drag: colour-adjust card on the front opens the A/B menu; A lists only the colours already attached (current one marked); the colour applies for the turn only', async () => {
  const { ctx, page } = await openGame(browser, { seed: 32, viewport: DESKTOP });
  await setup(page, { me: { active: { e: [0, 1] }, bench: [], hand: [{ kind: 'tune', color: 2 }] }, turn: 'player', step: 1 });
  const id = await page.evaluate(() => game.me.hand[0].id);
  await mouseDrag(page, dragHand(id), '#playerSlots [data-slot="player:1"]');
  assert.equal(await page.textContent('#modalTitle'), '色調整：方式を選ぶ');
  const m = await modalButtons(page);
  assert.ok(m[0].t.startsWith('A：') && !m[0].d, 'A is available: the front has energy'); assert.ok(m[1].t.startsWith('B：') && m[1].d, 'B is disabled: no energy card in hand');
  assert.match(await page.textContent('#modalText'), /B：手札にエネルギーがありません/);
  await page.click('#modalButtons button:has-text("A：")');
  assert.equal(await page.textContent('#modalTitle'), '色調整A：変更先の色');
  assert.deepEqual((await modalButtons(page)).slice(0, 2).map(b => b.t), ['赤（今の色：変化なし）', '橙'], 'only the colours already attached, the current one marked');
  await page.click('#modalButtons button:has-text("橙")'); await ack(page);
  assert.deepEqual(await page.evaluate(() => [game.me.tuneColor, game.me.tuned, base(game.me.active), game.me.active.energy, game.me.hand.length]), [1, true, 0, [0, 1], 0]);
  await ctx.close();
});
test('colour adjustment B through the real UI: tune card + one hand energy card are spent, the colour becomes that energy\'s colour, nothing is attached', async () => {
  const { ctx, page } = await openGame(browser, { seed: 34, viewport: MOBILE });
  await setup(page, { me: { active: { e: [0] }, bench: [{ e: [] }], hand: [{ kind: 'tune', color: 2 }, { kind: 'en', color: 4 }, { kind: 'en', color: 5 }] }, turn: 'player', step: 1 });
  const id = await page.evaluate(() => game.me.hand[0].id);
  await page.click(dragHand(id)); await page.click('#modalButtons button:has-text("使う")');
  assert.equal(await page.textContent('#modalTitle'), '色調整：方式を選ぶ'); await page.click('#modalButtons button:has-text("B：")');
  assert.equal(await page.textContent('#modalTitle'), '色調整B：使うエネルギー'); assert.match(await page.textContent('#modalText'), /付与されず捨て札/);
  assert.deepEqual((await modalButtons(page)).slice(0, 2).map(b => b.t), ['青エネルギー', '紫エネルギー']);
  await page.click('#modalButtons button:has-text("青エネルギー")'); await ack(page);
  assert.deepEqual(await page.evaluate(() => [game.me.tuneColor, game.me.active.energy, game.me.hand.length, game.me.attached, game.me.attachedBench, game.me.tuned]), [4, [0], 1, false, false, true]);
  await ctx.close();
});
test('hand menu and attach menu show WHY an action is unavailable and which slot a card would use', async () => {
  const { ctx, page } = await openGame(browser, { seed: 35, viewport: MOBILE });
  await setup(page, { me: { active: { e: [0] }, bench: [{ e: [] }], hand: [{ kind: 'en', color: 3 }, { kind: 'en', color: 1 }, { kind: 'tune', color: 0 }] }, turn: 'player', step: 1 });
  const [g, o, t] = await page.evaluate(() => game.me.hand.map(c => c.id));
  await page.click(dragHand(g)); await page.click('#modalButtons button:has-text("使う")');
  const labels = (await modalButtons(page)).map(b => ({ t: b.t, d: b.d }));
  assert.match(labels[0].t, /前衛・赤（補色のため付与できません）/); assert.equal(labels[0].d, true);
  assert.match(labels[1].t, /控え①・無色（控え追加枠）/); assert.equal(labels[1].d, false);
  assert.match(labels[2].t, /控え②（付与するモンスターがいません）/);
  await page.click('#modalButtons button:has-text("戻る")');
  await page.evaluate(() => { game.me.attached = true; game.me.attachedBench = true; render(); });
  await page.click(dragHand(o));
  assert.equal((await modalButtons(page))[0].d, true); assert.match(await page.textContent('#modalText'), /付与枠（通常・控え追加）は使用済み/);
  await ctx.close();
});

test('mouse drag: swap front <-> bench by dragging (still asks which energy to discard, then confirms)', async () => {
  const { ctx, page } = await openGame(browser, { seed: 33, viewport: DESKTOP });
  await setup(page, { me: { active: { e: [0, 1] }, bench: [{ e: [2] }] }, turn: 'player', step: 1 });
  await mouseDrag(page, '#playerSlots [data-slot="player:0"]', '#playerSlots [data-slot="player:1"]');
  assert.equal(await page.textContent('#modalTitle'), '捨てるエネルギー');
  await page.click('#modalButtons button:nth-child(2)');
  assert.equal(await page.textContent('#modalTitle'), '交代の最終確認');
  await page.click('#modalButtons button:has-text("交代を確定")'); await ack(page);
  assert.deepEqual(await page.evaluate(() => [game.me.active.energy, game.me.bench[0].energy, game.me.retreated]), [[2], [0], true]);
  await ctx.close();
});

test('touch drag (phone emulation, real touch events via CDP): hand monster onto the front slot', async () => {
  const { ctx, page, errors } = await openGame(browser, { seed: 41, viewport: MOBILE, touch: true });
  const id = await handId(page, 'mon');
  await touchDrag(page, ctx, dragHand(id), '#playerSlots [data-slot="player:1"]');
  await page.waitForFunction(() => !!game.me.active, null, { timeout: 5000 });
  await ack(page);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('touch tap (phone emulation): tapping a hand card opens the menu and a short drag below the threshold is still a tap', async () => {
  const { ctx, page } = await openGame(browser, { seed: 42, viewport: MOBILE, touch: true });
  const id = await handId(page, 'mon');
  await page.tap(dragHand(id));
  assert.equal(await overlay(page), true);
  await ctx.close();
});

test('input is locked while a message is showing and while the opponent plays', async () => {
  const { ctx, page } = await openGame(browser, { seed: 51, viewport: DESKTOP });
  await setup(page, { me: { active: { e: [0] }, bench: [], hand: [{ kind: 'en', color: 1 }] }, turn: 'player', step: 1 });
  await page.evaluate(() => doMessage('center', 'テスト通知'));
  const id = await page.evaluate(() => game.me.hand[0].id);
  await mouseDrag(page, dragHand(id), '#playerSlots [data-slot="player:1"]');
  assert.equal(await page.evaluate(() => game.me.hand.length), 1, 'drag ignored while a message is shown');
  await ack(page);
  await setup(page, { me: { active: { e: [0] }, bench: [], hand: [{ kind: 'en', color: 1 }] }, turn: 'ai', step: 1 });
  const id2 = await page.evaluate(() => game.me.hand[0].id);
  await page.click(dragHand(id2), { force: true });
  assert.equal(await overlay(page), false, 'no menu on the opponent turn');
  await ctx.close();
});

test('restart button asks for confirmation and then deals a fresh game', async () => {
  const { ctx, page } = await openGame(browser, { seed: 61 });
  await page.evaluate(() => { game.me.kos = 1; });
  await page.click('#restart');
  assert.equal(await page.textContent('#modalTitle'), '最初からやり直しますか？');
  await page.click('#modalButtons button:has-text("やり直す")');
  assert.deepEqual(await page.evaluate(() => [game.me.kos, game.turn, game.me.hand.length]), [0, 'setup', 5]);
  await ctx.close();
});

test('pictures: a monster is drawn with its colour variant (none -> _0, 赤..紫 -> _1.._6) and follows a temporary colour adjustment', async () => {
  const { ctx, page } = await openGame(browser, { seed: 71 });
  const src = () => page.$eval('#playerSlots [data-slot="player:1"] img', i => (i.dataset.art || i.getAttribute('src')));
  const ok = async () => { await page.waitForFunction(() => { const i = document.querySelector('#playerSlots [data-slot="player:1"] img'); return i && i.complete; });   // wait for the load to FINISH (a broken image finishes with width 0 and still fails below)
    return page.$eval('#playerSlots [data-slot="player:1"] img', i => i.naturalWidth > 0); };
  await setup(page, { me: { active: { e: [] }, bench: [] }, turn: 'player', step: 1 });
  assert.equal(await src(), 'paremon_monsters2/knight_0.png');
  for (let c = 0; c < 6; c++) {
    await setup(page, { me: { active: { e: [c] }, bench: [] }, turn: 'player', step: 1 });
    assert.equal(await src(), `paremon_monsters2/knight_${c + 1}.png`); assert.equal(await ok(), true);
  }
  await setup(page, { me: { active: { e: [0] }, bench: [], tuneColor: 4 }, turn: 'player', step: 1 });
  assert.equal(await src(), 'paremon_monsters2/knight_5.png', 'temporary 青 shows the blue picture');
  await ctx.close();
});

// ---------------- KD-1: AI cannot draw -> the player SEES the win and restarts only by an explicit tap ----------------
test('NEW empty piles (replaces the old deck-out loss): both of the AI\'s piles empty at its turn start -> no loss, the match goes on to my next draw choice', async () => {
  const { ctx, page, errors } = await openGame(browser, { seed: 91, viewport: DESKTOP });
  await setup(page, { me: { active: { e: [0] }, bench: [] }, ai: { active: { e: [0] }, bench: [] }, turn: 'player', step: 1 });
  await page.evaluate(() => { game.ai.deckM = []; game.ai.deckG = []; });
  await page.click('#turnControl button'); await page.click('#modalButtons button:has-text("ターン終了")');
  const seen = []; for (let i = 0; i < 20; i++) { const t = await page.evaluate(() => document.getElementById('message').classList.contains('show') ? document.getElementById('messageText').textContent : null); if (t === null) break; seen.push(t); await page.click('#message'); }
  assert.ok(seen.some(t => /相手のターン。引ける山札がない/.test(t)), seen.join(' / '));
  assert.equal(await page.evaluate(() => game.over), false);
  await page.waitForFunction(() => document.getElementById('overlay').classList.contains('show') && /山札を選んで1枚引く/.test(document.getElementById('modalTitle').textContent));
  assert.deepEqual(errors, []); await ctx.close();
});
async function ack1(page, re) { // click one message at a time until the one matching `re` has been acknowledged
  for (let i = 0; i < 12; i++) { const t = await page.evaluate(() => document.getElementById('message').classList.contains('show') ? document.getElementById('messageText').textContent : null);
    if (t === null) return; const hit = re.test(t); await page.click('#message'); if (hit) return; }
}

test('real taps: attack win (target reached), refill-impossible loss for the opponent, and a restart after every finish', async () => {
  const { ctx, page } = await openGame(browser, { seed: 92, viewport: DESKTOP });
  await setup(page, { me: { active: { e: [0] }, bench: [], kos: 1 }, ai: { active: { e: [0], d: 9 }, bench: [{ e: [] }] }, targetKos: 2, turn: 'player', step: 1 });
  await page.click('#playerSlots [data-slot="player:1"]'); await page.click('#modalButtons button:has-text("ワザ①")'); await page.click('#modalButtons button:has-text("攻撃する")');
  assert.match(await page.textContent('#messageText'), /ダメージ/); await page.click('#message');
  assert.match(await page.textContent('#messageText'), /あなたが1体撃破！ 2\/2/); await page.click('#message');
  assert.match(await page.textContent('#messageText'), /あなたの勝利！ 2体撃破/); assert.equal(await page.evaluate(() => game.over), true);
  assert.equal(await page.isVisible('#resultPanel'), true); assert.match(await page.textContent('#resultText'), /【2体撃破・バランス試作1】あなたの勝利（規定数撃破）/);
  await page.click('#message'); assert.equal(await page.evaluate(() => game.turn), 'setup');
  assert.equal(await page.isVisible('#resultPanel'), true, 'the last results stay visible after the restart (for comparing modes)');
  // opponent cannot refill: no bench, no monster in hand, monster pile empty
  await setup(page, { me: { active: { e: [0] }, bench: [], kos: 0 }, ai: { active: { e: [0], d: 9 }, bench: [], hand: [] }, targetKos: 4, turn: 'player', step: 1 }); await page.evaluate(() => { game.ai.deckM = []; });
  await page.click('#playerSlots [data-slot="player:1"]'); await page.click('#modalButtons button:has-text("ワザ①")'); await page.click('#modalButtons button:has-text("攻撃する")');
  await page.click('#message'); await page.click('#message');
  assert.equal(await page.textContent('#messageText'), '相手は場に出せるモンスターがいない（補充不能）。あなたの勝利！'); assert.equal(await page.evaluate(() => game.endReason), 'refill');
  await page.click('#message'); assert.equal(await page.evaluate(() => game.turn), 'setup');
  // I cannot refill after the opponent's knockout
  await setup(page, { me: { active: { e: [0], d: 9 }, bench: [], hand: [] }, ai: { active: { e: [0] }, bench: [{ e: [] }], kos: 0 }, targetKos: 4, turn: 'ai', step: 1 }); await page.evaluate(() => { game.me.deckM = []; sequence(attackEvents(game.ai, false), () => {}); });
  await page.click('#message'); await page.click('#message');
  assert.equal(await page.textContent('#messageText'), 'あなたは場に出せるモンスターがいない（補充不能）。相手の勝利！');
  await page.click('#message'); assert.equal(await page.evaluate(() => game.turn), 'setup');
  await ctx.close();
});
test('refill for me through real taps: bench -> choose from the bench; no bench -> choose from hand; neither -> automatic from the monster pile', async () => {
  const { ctx, page } = await openGame(browser, { seed: 93, viewport: MOBILE });
  const hit = async () => { await page.evaluate(() => { sequence(attackEvents(game.ai, false), () => { if (game.promotion) { game.afterPromotion = () => render(); render(); } }); }); await page.click('#message'); await page.click('#message'); await page.click('#message'); };   // damage, knockout, refill messages
  await setup(page, { me: { active: { e: [0], d: 9 }, bench: [{ e: [] }], hand: [] }, ai: { active: { e: [0] }, bench: [], kos: 0 }, targetKos: 4, turn: 'ai', step: 1 }); await hit();
  assert.equal(await page.textContent('#modalTitle'), '新しい前衛を選ぶ'); await page.click('#modalButtons button'); await ack(page);
  assert.deepEqual(await page.evaluate(() => [!!game.me.active, game.me.bench.length, game.promotion]), [true, 0, false]);
  await setup(page, { me: { active: { e: [0], d: 9 }, bench: [], hand: [{ kind: 'mon' }] }, ai: { active: { e: [0] }, bench: [], kos: 0 }, targetKos: 4, turn: 'ai', step: 1 }); await hit();
  assert.equal(await page.textContent('#modalTitle'), '新しい前衛を選ぶ（手札から）'); await page.click('#modalButtons button'); await ack(page);
  assert.deepEqual(await page.evaluate(() => [!!game.me.active, game.me.hand.length]), [true, 0]);
  await ctx.close();
});

// ---------------- KD-3: auxiliary cards show no colour ----------------
test('KD-3: 色調整 / 増強 cards are neutral auxiliary cards (no colour name, neutral swatch, own label); energy cards keep their colour', async () => {
  const { ctx, page } = await openGame(browser, { seed: 93, viewport: DESKTOP });
  const NEUTRAL = 'rgb(133, 149, 166)', NAMES = /[赤橙黄緑青紫]/;
  for (let c = 0; c < 6; c++) {
    await setup(page, { me: { active: { e: [0] }, bench: [], hand: [{ kind: 'tune', color: c }, { kind: 'boost', color: c }, { kind: 'en', color: 2 }, { kind: 'mon' }] }, turn: 'player', step: 1 });
    const cards = await page.$$eval('#hand .hand-card', els => els.map(e => ({ aux: e.classList.contains('aux'), text: e.textContent, bg: e.querySelector('.swatch') ? getComputedStyle(e.querySelector('.swatch')).backgroundColor : null })));
    const [tune, boost, en, mon] = cards;
    for (const k of [tune, boost]) { assert.equal(k.aux, true); assert.equal(k.bg, NEUTRAL); assert.ok(!NAMES.test(k.text), `colour name on an auxiliary card (internal colour ${c}): ${k.text}`); }
    assert.match(tune.text, /色調整/); assert.match(boost.text, /増強/);
    assert.equal(en.aux, false); assert.match(en.text, /黄/); assert.notEqual(en.bg, NEUTRAL);
    assert.ok(mon.text.includes('モンスター'));
  }
  await ctx.close();
});

test('KD-3: detail view and drag label of 色調整 / 増強 show no colour; the colour-adjust menu offers methods A and B', async () => {
  const { ctx, page } = await openGame(browser, { seed: 94, viewport: DESKTOP });
  await setup(page, { me: { active: { e: [0] }, bench: [], hand: [{ kind: 'tune', color: 4 }, { kind: 'boost', color: 5 }] }, turn: 'player', step: 1 });
  const [tid, bid] = await page.evaluate(() => game.me.hand.map(c => c.id));
  for (const id of [tid, bid]) {
    await page.click(dragHand(id)); await page.click('#modalButtons button:has-text("詳細")');
    const d = await page.$eval('#detailContent', e => ({ sw: getComputedStyle(e.querySelector('.detail-swatch')).backgroundColor, sText: e.querySelector('.detail-swatch').textContent, text: e.textContent }));
    assert.equal(d.sw, 'rgb(133, 149, 166)'); assert.ok(!/[赤橙黄緑青紫]{1}/.test(d.sText), d.sText);
    await page.click('#modalButtons button:has-text("閉じる")');
  }
  // drag ghost
  const a = await rect(page, dragHand(tid)); await page.evaluate(() => window.scrollBy(0, 300)); const a2 = await rect(page, dragHand(tid));
  await page.mouse.move(a2.x, a2.y); await page.mouse.down(); await page.mouse.move(a2.x + 30, a2.y - 30, { steps: 5 });
  const ghost = await page.textContent('#dragGhost'); assert.equal(ghost, '色調整'); await page.mouse.up(); await page.waitForTimeout(0);
  await ack(page).catch(() => {}); await page.evaluate(() => { closeModal(false); });
  const names = await page.evaluate(() => { document.getElementById('overlay').classList.remove('show'); return null; });
  // the new menu offers the two methods, not a free choice among six colours
  await setup(page, { me: { active: { e: [0] }, bench: [], hand: [{ kind: 'tune', color: 4 }] }, turn: 'player', step: 1 });
  await ev2(page, () => useHand(game.me.hand[0]));
  assert.equal(await page.textContent('#modalTitle'), '色調整：方式を選ぶ'); assert.ok((await modalButtons(page))[0].t.startsWith('A：') && (await modalButtons(page))[1].t.startsWith('B：'));
  await ctx.close();
});
const ev2 = (page, fn) => page.evaluate(fn);

// ---------------- header: logo | 勝利条件 | 対戦開始 in ONE row; logo opens the rules ----------------
const HEADER_VIEWPORTS = [['360', { width: 360, height: 740 }], ['393 (Pixel 7a-like)', { width: 393, height: 851 }], ['412', { width: 412, height: 892 }], ['desktop 1280', DESKTOP]];
for (const [name, viewport] of HEADER_VIEWPORTS) {
  test(`header (${name}): logo (left, ~1/3 of the old height) | 勝利条件 | 対戦開始 share ONE row; touch targets >= 44px; nothing overflows; picture decoded`, async () => {
    const { ctx, page, errors } = await openGame(browser, { seed: 95, viewport });
    const g = await page.evaluate(() => { const R = s => { const r = document.querySelector(s).getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height }; };
      const i = document.querySelector('#logoBtn img');
      return { top: R('#topbar'), logo: R('#logoBtn'), vic: R('.top-victory'), sel: R('#victoryTarget'), start: R('#startBtn'), battle: R('.battle'), ok: i.complete && i.naturalWidth > 0, nat: [i.naturalWidth, i.naturalHeight], img: R('#logoBtn img'),
        alt: i.alt, src: (i.dataset.art || i.getAttribute('src')), overflow: document.documentElement.scrollWidth - innerWidth, vw: innerWidth, label: document.getElementById('logoBtn').getAttribute('aria-label') }; });
    assert.equal(g.ok, true); assert.equal(g.src, 'paremon_logo_center_crop2.png'); assert.equal(g.alt, 'パレットモンスター（パレモン）のロゴ'); assert.equal(g.label, 'ルールと仮設定を開く');
    assert.ok(g.logo.h >= 76 && g.logo.h <= 84, `logo height ${g.logo.h} (the old one was 240px at phone width; about 1/3)`); assert.ok(Math.abs(g.img.w / g.img.h - g.nat[0] / g.nat[1]) < 0.02, 'aspect ratio preserved');
    assert.ok(g.logo.l <= g.top.l + 1, 'logo at the left edge of the header');
    // one row: all three overlap vertically inside the header, in the order logo < victory < start, no wrapping
    for (const k of ['logo', 'vic', 'start']) assert.ok(g[k].t >= g.top.t - 0.5 && g[k].b <= g.top.b + 0.5, `${k} inside the header row`);
    assert.ok(g.logo.r <= g.vic.l + 0.5 && g.vic.r <= g.start.l + 0.5, 'order: logo, 勝利条件, 対戦開始, left to right');
    assert.ok(g.top.h <= 84, `header height ${g.top.h}`); assert.ok(g.sel.h >= 44 && g.start.h >= 44, 'controls stay at least 44px tall'); assert.ok(g.sel.w >= 90 && g.start.w >= 80);
    assert.ok(g.start.r <= g.vw && g.overflow <= 0); assert.ok(g.battle.t >= g.top.b, 'board starts below the header');
    assert.deepEqual(errors, []); await ctx.close();
  });
}

test('header: the hand is much higher on the phone than before (412x892: hand bottom 898px -> ~730px)', async () => {
  const { ctx, page } = await openGame(browser, { seed: 96, viewport: MOBILE });
  const g = await page.evaluate(() => ({ handBottom: document.getElementById('hand').getBoundingClientRect().bottom, vh: innerHeight, start: document.getElementById('startBtn').getBoundingClientRect().bottom }));
  assert.ok(g.handBottom <= 775, `hand bottom ${g.handBottom}`); assert.ok(g.start < 100);   // 745 before the prototype tag (13px) and the longer hint line were added       // measured before the change: 898px with the start button below the hand
  await ctx.close();
});

test('header: tapping the logo opens 「ルールと仮設定」 in setup, during the player turn, while a message shows, and on the opponent turn; closing changes nothing', async () => {
  const { ctx, page, errors } = await openGame(browser, { seed: 97, viewport: MOBILE });
  const snap = () => page.evaluate(() => JSON.stringify([game.turn, game.step, game.me.hand.map(c => c.id), game.ai.hand.length, game.me.kos, game.ai.kos, !!game.me.active]));
  const check = async (label) => { const before = await snap(); await page.click('#logoBtn');
    assert.equal(await overlay(page), true, label); assert.equal(await page.textContent('#modalTitle'), 'ルールと仮設定', label);
    const txt = await page.textContent('#detailContent'); assert.ok(txt.includes('確定事項') && txt.includes('仮ルール') && txt.includes('補色'), label + ': rules text');
    assert.deepEqual((await modalButtons(page)).map(b => b.t), ['閉じる']); await page.click('#modalButtons button:has-text("閉じる")');
    assert.equal(await overlay(page), false, label); assert.equal(await snap(), before, label + ': nothing changed'); };
  await check('setup');
  await setup(page, { me: { active: { e: [0] }, bench: [] }, ai: { active: { e: [1] }, bench: [] }, turn: 'player', step: 1 }); await check('player turn');
  await page.evaluate(() => doMessage('center', 'テスト通知')); await check('message showing'); await ack(page);
  await setup(page, { me: { active: { e: [0] }, bench: [] }, ai: { active: { e: [1] }, bench: [] }, turn: 'ai', step: 1 }); await check('opponent turn');
  // the bottom 「ルールと仮設定」 panel still works
  await page.click('.panel.rules summary'); assert.ok((await page.textContent('.panel.rules details')).includes('確定事項'));
  assert.deepEqual(errors, []); await ctx.close();
});

test('header: 勝利条件 and 対戦開始 work from the header (2/3/4 selectable in setup; start needs a front monster; both locked once the match runs)', async () => {
  const { ctx, page, errors } = await openGame(browser, { seed: 98, viewport: { width: 393, height: 851 } });
  assert.equal(await page.isDisabled('#startBtn'), true, 'no front monster yet');
  for (const n of ['3', '4', '2']) { await page.selectOption('#victoryTarget', n); assert.deepEqual(await page.evaluate(() => [game.targetKos, document.getElementById('opScore').textContent]), [Number(n), `撃破 0/${n}`]); }
  await page.selectOption('#victoryTarget', '3');
  const id = await handId(page, 'mon'); await page.click(dragHand(id)); await page.click('#modalButtons button:has-text("使う")'); await page.click('#modalButtons button:has-text("前衛")'); await ack(page);
  assert.equal(await page.isDisabled('#startBtn'), false); assert.equal(await page.isDisabled('#victoryTarget'), false);
  await startMatch(page, 'G');
  assert.deepEqual(await page.evaluate(() => [game.turn, game.targetKos, game.step]), ['player', 3, 0]);
  assert.equal(await page.isDisabled('#startBtn'), true); assert.equal(await page.isDisabled('#victoryTarget'), true); assert.equal(await page.inputValue('#victoryTarget'), '3');
  await page.click('#logoBtn'); assert.equal(await overlay(page), true); await page.click('#modalButtons button:has-text("閉じる")');
  assert.deepEqual(errors, []); await ctx.close();
});

test('header: the start button cannot start a match while a message is showing or a menu is open', async () => {
  const { ctx, page } = await openGame(browser, { seed: 99, viewport: MOBILE });
  await setup(page, { me: { active: { e: [] }, bench: [] }, turn: 'setup', step: 0 });
  await page.evaluate(() => doMessage('center', 'テスト')); assert.equal(await page.isDisabled('#startBtn'), true); assert.equal(await page.isDisabled('#victoryTarget'), true);
  await ack(page); assert.equal(await page.isDisabled('#startBtn'), false);
  await ctx.close();
});

// ---------------- field cards: no 前衛/控え wording, bigger picture; central lane captions ----------------
for (const [name, viewport] of HEADER_VIEWPORTS) {
  test(`field cards (${name}): no 「前衛」「控え」 text inside monster cards, the picture is bigger than before, name/HP/energy stay readable`, async () => {
    const { ctx, page } = await openGame(browser, { seed: 3, viewport });
    await setup(page, { me: { active: { e: [0, 1], sp: 'centipede' }, bench: [{ e: [], sp: 'golem' }, { e: [2], sp: 'dragon' }] }, ai: { active: { e: [1], sp: 'knight' }, bench: [{ e: [], sp: 'skeleton' }] }, turn: 'player', step: 1 });
    await page.waitForFunction(() => [...document.images].every(i => i.complete));
    const r = await page.evaluate(() => [...document.querySelectorAll('#enemySlots .bcard,#playerSlots .bcard')].map(c => ({ text: c.textContent, aria: c.getAttribute('aria-label'), art: c.querySelector('.monster-art-panel').getBoundingClientRect().height, name: c.querySelector('.monster-name').getBoundingClientRect().height, hp: c.querySelector('.hp').textContent, en: c.querySelector('.energy').getBoundingClientRect().height })));
    assert.equal(r.length, 5);
    for (const c of r) { assert.ok(!/前衛|控え/.test(c.text), `card text still has the lane wording: ${c.text}`); assert.ok(/前衛|控え/.test(c.aria), 'screen-reader label keeps the lane');
      assert.ok(c.art >= (viewport.width >= 800 ? 78 : 80), `picture panel ${c.art}px (it was 69-71px on phones before)`); assert.ok(c.name >= 12 && c.en >= 11, 'text lines readable'); assert.match(c.hp, /HP \d+\/10/); }
    await ctx.close();
  });
  test(`lane captions (${name}): one shared row 「控え　前衛　控え」 in the central band, each centred exactly over its column`, async () => {
    const { ctx, page } = await openGame(browser, { seed: 3, viewport });
    const g = await page.evaluate(() => { const c = e => { const r = e.getBoundingClientRect(); return r.left + r.width / 2; }; const band = document.querySelector('.center-line').getBoundingClientRect();
      const ef = document.querySelector('.enemy-field').getBoundingClientRect(), pf = document.querySelector('.player-field').getBoundingClientRect();
      return { labels: [...document.querySelectorAll('.center-line .lanes span')].map(e => e.textContent), lc: [...document.querySelectorAll('.center-line .lanes span')].map(c), sc: [...document.querySelectorAll('#playerSlots .slot')].map(c), ec: [...document.querySelectorAll('#enemySlots .slot')].map(c),
        band: [band.top, band.bottom], ef: ef.bottom, pf: pf.top, hidden: document.querySelector('.center-line').getAttribute('aria-hidden') }; });
    assert.deepEqual(g.labels, ['控え', '前衛', '控え']);
    for (let k = 0; k < 3; k++) { assert.ok(Math.abs(g.lc[k] - g.sc[k]) <= 1, `caption ${k} centre ${g.lc[k]} vs player column ${g.sc[k]}`); assert.ok(Math.abs(g.lc[k] - g.ec[k]) <= 1, 'and the opponent column'); }
    assert.ok(g.band[0] >= g.ef - 0.5 && g.band[1] <= g.pf + 0.5, 'the captions sit between the two fields'); assert.equal(g.hidden, 'true');
    await ctx.close();
  });
}

test('touch targets: hand cards and board slots are at least 44px tall on the phone viewport (unchanged by the card redesign)', async () => {
  const { ctx, page } = await openGame(browser, { seed: 97, viewport: MOBILE });
  await setup(page, { me: { active: { e: [0] }, bench: [], hand: [{ kind: 'tune', color: 1 }, { kind: 'boost', color: 1 }, { kind: 'en', color: 1 }, { kind: 'mon' }, { kind: 'en', color: 3 }] }, turn: 'player', step: 1 });
  const hs = await page.$$eval('#hand button', bs => bs.map(b => b.getBoundingClientRect().height));
  assert.ok(hs.every(h => h >= 44), hs.join()); assert.equal(hs.length, 5);
  const ss = await page.$$eval('#playerSlots .slot', bs => bs.map(b => [b.getBoundingClientRect().width, b.getBoundingClientRect().height]));
  assert.ok(ss.every(([w, h]) => w >= 44 && h >= 44), JSON.stringify(ss));
  await ctx.close();
});

test('pictures: all 5 species x 7 states (35) render in the game with no 404 and a decoded image', async () => {
  const { ctx, page, errors } = await openGame(browser, { seed: 98, viewport: MOBILE });
  const failed = []; page.on('requestfailed', r => failed.push(r.url())); page.on('response', r => { if (r.status() >= 400) failed.push(r.url()); });
  const seen = new Set();
  for (const sp of ['centipede', 'dragon', 'golem', 'knight', 'skeleton']) for (let c = -1; c < 6; c++) {
    await setup(page, { me: { active: { e: c < 0 ? [] : [c], sp }, bench: [] }, turn: 'player', step: 1 });
    await page.waitForFunction(() => { const i = document.querySelector('#playerSlots [data-slot="player:1"] img'); return i && i.complete; });
    const r = await page.$eval('#playerSlots [data-slot="player:1"] img', i => ({ src: (i.dataset.art || i.getAttribute('src')), ok: i.naturalWidth > 0, r: i.getBoundingClientRect().width }));
    assert.equal(r.src, `paremon_monsters2/${sp}_${c + 1}.png`); assert.ok(r.ok, r.src); assert.ok(r.r > 30, `${r.src} drawn ${r.r}px wide`); seen.add(r.src);
  }
  assert.equal(seen.size, 35); assert.deepEqual(failed, []); assert.deepEqual(errors, []);
  await ctx.close();
});

// ---------------- KD-8: no clipped text on cards; card geometry unchanged ----------------
const KD8_VIEWPORTS = [['360', { width: 360, height: 740 }, { slot: [92, 144], hand: [62.4, 98], field: 198 }], ['393 (Pixel 7a-like)', { width: 393, height: 851 }, { slot: [96, 144], hand: [69, 98], field: 198 }],
  ['412', { width: 412, height: 892 }, { slot: [96, 144], hand: [72.8, 98], field: 198 }], ['desktop 1280', { width: 1280, height: 900 }, { slot: [112, 168], hand: [132, 120], field: 225 }]];
for (const [name, viewport, geo] of KD8_VIEWPORTS) {
  test(`KD-8 (${name}): species name, HP, energy line and labels are never clipped or overlapping on board and hand cards, for all 5 species`, async () => {
    const { ctx, page, errors } = await openGame(browser, { seed: 3, viewport });
    const bad = [];
    // Fonts differ per device (the CI runner's text is wider than this sandbox's): the same checks also run with deliberately wide text.
    for (const stress of [false, true]) for (const sp of ['centipede', 'dragon', 'golem', 'knight', 'skeleton']) {
      await page.evaluate(on => { let st = document.getElementById('stressFont'); if (!st) { st = document.createElement('style'); st.id = 'stressFont'; document.head.append(st); }
        st.textContent = on ? "html,body,button{font-family:'DejaVu Sans',sans-serif !important} .hand-card,.bcard{letter-spacing:.06em}" : ''; }, stress);
      await setup(page, { me: { active: { e: [0, 1], sp }, bench: [{ e: [], sp }, { e: [2], sp }], hand: [{ kind: 'mon' }, { kind: 'mon' }, { kind: 'en', color: 1 }, { kind: 'tune', color: 0 }, { kind: 'boost', color: 1 }] }, ai: { active: { e: [1], sp }, bench: [{ e: [], sp }] }, turn: 'player', step: 1 });
      await page.waitForFunction(() => [...document.images].every(i => i.complete));
      const r = await page.evaluate(sp => { const out = [];
        const cards = [...document.querySelectorAll('#enemySlots .bcard,#playerSlots .bcard'), ...document.querySelectorAll('#hand .hand-card')];
        for (const card of cards) { const box = card.getBoundingClientRect(); let prevBottom = -1;
          const lines = [...card.children].filter(e => !e.classList.contains('monster-art-panel') && !e.classList.contains('swatch'));
          for (const el of lines) { const r = el.getBoundingClientRect(), cs = getComputedStyle(el), lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2;
            const what = `${sp} ${card.className.split(' ')[0]} ${el.className || el.tagName}`;
            if (r.height + 0.6 < lh) out.push(`${what}: box ${r.height.toFixed(1)}px < line ${lh.toFixed(1)}px (clipped)`);
            if (el.scrollHeight > el.clientHeight + 1) out.push(`${what}: content taller than its box`);
            if (r.top < box.top - 0.5 || r.bottom > box.bottom + 0.5) out.push(`${what}: outside the card`);
            if (prevBottom > r.top + 0.5) out.push(`${what}: overlaps the line above`); prevBottom = r.bottom; }
          const art = card.querySelector('.monster-art-panel'); if (art) { const a = art.getBoundingClientRect(), im = art.querySelector('img').getBoundingClientRect();
            if (a.height < 38) out.push(`${sp}: picture panel only ${a.height.toFixed(0)}px tall`); if (im.height > a.height + 0.5 || im.width > a.width + 0.5) out.push(`${sp}: picture overflows its panel`); } }
        return out; }, sp);
      bad.push(...r);
    }
    assert.deepEqual([...new Set(bad)], []); assert.deepEqual(errors, []);
    await ctx.close();
  });
  test(`KD-8 (${name}): card, slot, hand and field sizes are exactly the pre-fix values (the fix must not move anything)`, async () => {
    const { ctx, page } = await openGame(browser, { seed: 3, viewport });
    await setup(page, { me: { active: { e: [0], sp: 'centipede' }, bench: [{ e: [], sp: 'golem' }], hand: [{ kind: 'mon' }, { kind: 'en', color: 1 }] }, ai: { active: { e: [1], sp: 'dragon' }, bench: [] }, turn: 'player', step: 1 });
    const g = await page.evaluate(() => { const R = e => { const r = e.getBoundingClientRect(); return [+r.width.toFixed(1), +r.height.toFixed(1)]; };
      const front = document.querySelector('#playerSlots [data-slot="player:1"]'), fc = front.querySelector('.bcard'); return { slot: R(front), card: R(fc), hand: R(document.querySelector('#hand button')), field: R(document.querySelector('.field'))[1], lift: +(fc.getBoundingClientRect().top - front.getBoundingClientRect().top).toFixed(1) }; });
    assert.deepEqual(g.slot, geo.slot); assert.deepEqual(g.card, geo.slot); assert.deepEqual(g.hand, geo.hand); assert.equal(g.field, geo.field); assert.equal(g.lift, -46, 'the front card keeps its 46px lift');
    await ctx.close();
  });
}


// ---------------- balance prototype 1: draw modal, labels, result panel, rules text, layout at phone widths ----------------
test('draw modal: at the start of my turn the two piles are offered with their remaining counts and a summary of my hand/field; an empty pile is disabled; choosing draws 1 + the extra growth card', async () => {
  const { ctx, page, errors } = await openGame(browser, { seed: 201, viewport: MOBILE });
  await setup(page, { me: { active: { e: [0] }, bench: [{ e: [] }], hand: [{ kind: 'en', color: 1 }, { kind: 'tune', color: 0 }] }, ai: { active: { e: [0] }, bench: [] }, turn: 'ai', step: 1 });
  await page.evaluate(() => { game.me.deckM.length = 3; game.me.deckG.length = 0; afterAi(); });     // growth pile empty -> only the monster pile is legal
  await page.waitForFunction(() => document.getElementById('overlay').classList.contains('show') || document.getElementById('message').classList.contains('show'));
  // only one legal pile: it is taken automatically (no pointless tap) and the message says which
  const t = await page.evaluate(() => document.getElementById('messageText').textContent); assert.match(t, /モンスター山札から1枚引いた/);
  await ack(page);
  await page.evaluate(() => newGame());   // fresh piles
  await setup(page, { me: { active: { e: [0] }, bench: [{ e: [] }], hand: [{ kind: 'en', color: 1 }, { kind: 'tune', color: 0 }] }, ai: { active: { e: [0] }, bench: [] }, turn: 'ai', step: 1 });
  await page.evaluate(() => { afterAi(); });
  await page.waitForFunction(() => /山札を選んで1枚引く/.test(document.getElementById('modalTitle').textContent));
  const b = await modalButtons(page); assert.deepEqual(b.map(x => x.t), ['モンスター山札（残り10）', '育成山札（残り15）']); assert.ok(b.every(x => !x.d));
  const txt = await page.textContent('#modalText'); assert.match(txt, /手札：モンスター0／エネルギー1（橙）／色調整1／増強0。場：前衛あり・控え1体。/); assert.match(txt, /追加で育成山札からも1枚/);
  const hs = await page.$$eval('#modalButtons button', bs => bs.map(x => x.getBoundingClientRect().height)); assert.ok(hs.every(h => h >= 44), hs.join());
  assert.equal(await page.evaluate(() => document.getElementById('modal').scrollWidth <= document.getElementById('modal').clientWidth), true, 'the modal does not overflow sideways');
  await page.click('#modalButtons button:has-text("育成山札")'); const seen = [];
  for (let i = 0; i < 5; i++) { const m = await page.evaluate(() => document.getElementById('message').classList.contains('show') ? document.getElementById('messageText').textContent : null); if (!m) break; seen.push(m); await page.click('#message'); }
  assert.deepEqual(seen.map(x => x.replace(/ターン \d+回目/, 'ターン n回目')), ['あなたのターン n回目。育成山札から1枚引いた。'.replace('n回目', 'n回目'), '追加ドロー：育成山札から1枚引いた。'].map(x => x.replace(/ターン \d+回目/, 'ターン n回目')));
  assert.deepEqual(await page.evaluate(() => [game.me.deckG.length, game.me.hand.length]), [13, 4], '15 - normal - extra; hand 2 + 2');
  assert.deepEqual(errors, []); await ctx.close();
});

test('draw modal: when both piles are empty nothing is drawn and the turn simply starts (no loss)', async () => {
  const { ctx, page } = await openGame(browser, { seed: 202, viewport: MOBILE });
  await setup(page, { me: { active: { e: [0] }, bench: [] }, ai: { active: { e: [0] }, bench: [] }, turn: 'ai', step: 1 });
  await page.evaluate(() => { game.me.deckM = []; game.me.deckG = []; afterAi(); });
  assert.match(await page.textContent('#messageText'), /引ける山札がありません/); assert.equal(await page.evaluate(() => game.over), false);
  await ctx.close();
});

test('prototype label and rules: 「バランス試作1／仮設定」 is visible on screen and in the rules dialog (confirmed directions vs provisional numbers vs rule changes)', async () => {
  const { ctx, page } = await openGame(browser, { seed: 203, viewport: MOBILE });
  assert.match(await page.textContent('.proto-tag'), /バランス試作1／仮設定（確定仕様ではありません）/); assert.equal(await page.isVisible('.proto-tag'), true);
  await page.click('#logoBtn'); const txt = await page.textContent('#detailContent');
  for (const must of ['バランス試作1（仮設定）', '確定した方向性', '仮ルール（数値・細則）', 'モンスター山札12枚と育成山札18枚', '追加で1枚引き', '有効エネルギー3と5で+1、最大4', '有効エネルギー4と6で+1、最大5', '同色', '控え専用の追加枠', '色調整は1ターン1回', 'A＝', 'B＝', '補充不能', '旧：早期決着', '旧：引けないと敗北', '40ターン', 'Git履歴']) assert.ok(txt.includes(must), `rules text lacks: ${must}`);
  await ctx.close();
});

test('result panel: shown after a finished match with the mode and indicators, kept after the restart, newest first, with a copy button', async () => {
  const { ctx, page } = await openGame(browser, { seed: 204, viewport: MOBILE });
  assert.equal(await page.isVisible('#resultPanel'), false, 'nothing to show before the first finished match');
  for (const target of [2, 3]) {
    await setup(page, { me: { active: { e: [0, 0] }, bench: [], kos: target - 1 }, ai: { active: { e: [0], d: 9 }, bench: [{ e: [] }] }, targetKos: target, turn: 'player', step: 1 });
    await page.evaluate(() => { sequence(attackEvents(game.me, false), () => {}); }); await page.click('#message'); await page.click('#message'); await page.click('#message');   // damage, knockout, victory (the tap on the victory message restarts)
  }
  assert.equal(await page.isVisible('#resultPanel'), true);
  const txt = await page.textContent('#resultText'); assert.ok(txt.indexOf('【3体撃破') < txt.indexOf('【2体撃破'), 'newest first'); assert.match(txt, /最大有効E\d+／平均付与/);
  await page.evaluate(() => { navigator.clipboard.writeText = async t => { window.__copied = t; }; });
  await page.click('#copyResult'); assert.equal((await page.evaluate(() => window.__copied)).includes('【2体撃破・バランス試作1】'), true); assert.equal(await page.textContent('#copyNote'), 'コピーしました');
  await ctx.close();
});

for (const [name, viewport] of HEADER_VIEWPORTS) {
  test(`prototype layout (${name}): no sideways overflow; header still one row; deck counts, tag and result panel fit; draw modal fits`, async () => {
    const { ctx, page, errors } = await openGame(browser, { seed: 205, viewport });
    await setup(page, { me: { active: { e: [0, 1] }, bench: [{ e: [] }], hand: [{ kind: 'en', color: 1 }, { kind: 'tune', color: 0 }, { kind: 'boost', color: 1 }, { kind: 'mon' }, { kind: 'en', color: 4 }] }, turn: 'ai', step: 1 });
    await page.evaluate(() => { RESULTS.unshift(resultText()); render(); });
    const g = async () => page.evaluate(() => { const R = s => { const r = document.querySelector(s).getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, h: r.height }; };
      return { over: document.documentElement.scrollWidth - innerWidth, top: R('#topbar'), tag: R('.proto-tag'), vw: innerWidth, deck: [...document.querySelectorAll('.team-bar .muted')].map(e => ({ h: e.getBoundingClientRect().height, r: e.getBoundingClientRect().right })), bars: [...document.querySelectorAll('.team-bar')].map(e => e.getBoundingClientRect().height), result: R('#resultPanel') }; });
    const a = await g(); assert.ok(a.over <= 0, `overflow ${a.over}`); assert.ok(a.top.h <= 84, `header ${a.top.h}`); assert.ok(a.tag.h > 0 && a.tag.h < 22 && a.tag.r <= a.vw); assert.ok(a.deck.every(d => d.h < 24 && d.r <= a.vw), JSON.stringify(a.deck)); assert.ok(a.bars.every(h => h <= 40), a.bars.join()); assert.ok(a.result.r <= a.vw);
    await page.evaluate(() => { afterAi(); });
    await page.waitForFunction(() => /山札を選んで1枚引く/.test(document.getElementById('modalTitle').textContent));
    const m = await page.evaluate(() => { const r = document.getElementById('modal').getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, vw: innerWidth, vh: innerHeight }; });
    assert.ok(m.l >= 0 && m.r <= m.vw && m.t >= 0 && m.b <= m.vh, JSON.stringify(m)); assert.deepEqual(errors, []); await ctx.close();
  });
}
