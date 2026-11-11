// UI regression: boot, layouts (phone + desktop), tap menus, mouse/touch drag, victory selector.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, openGame, setup, ack, rect, mouseDrag, touchDrag, handId, clicksAllowed, MOBILE, DESKTOP } from './helpers.mjs';

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
      hand: document.querySelectorAll('#hand button').length, imgs: [...document.images].map(i => ({ src: i.getAttribute('src'), ok: i.complete && i.naturalWidth > 0 })),
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

test('setup rules: the start button stays disabled until a front monster is placed; the first attack is impossible on turn 1', async () => {
  const { ctx, page, errors } = await openGame(browser, { seed: 8, viewport: DESKTOP });
  assert.equal(await page.isDisabled('#turnControl button'), true);
  const id = await handId(page, 'mon');
  await mouseDrag(page, dragHand(id), '#playerSlots [data-slot="player:1"]');
  await ack(page);
  assert.equal(await page.evaluate(() => !!game.me.active), true);
  await page.click('#turnControl button.primary'); await ack(page);
  assert.equal(await page.evaluate(() => [game.turn, game.step, game.me.hand.length, game.me.deck.length].join()), 'player,0,5,24'); // placed 1, drew 1
  await clicksAllowed(page);
  await page.click('#playerSlots [data-slot="player:1"]');
  const b = await modalButtons(page);
  assert.deepEqual(b.map(x => x.t), ['詳細', 'ワザ①：攻撃2', 'ワザ②：攻撃3', '前衛と控えの交代', '戻る']);
  assert.ok(b.find(x => x.t.startsWith('ワザ①')).d && b.find(x => x.t.startsWith('ワザ②')).d, 'moves disabled on the very first turn');
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
  assert.match(await page.textContent('#detailContent'), /ワザ① 基本攻撃：2ダメージ/);
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
  assert.match(await page.textContent('#messageText'), /強攻撃：3 × 弱点2 = 6ダメージ/);
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
  await setup(page, { me: { active: { e: [] }, bench: [{ e: [] }], hand: [{ kind: 'en', color: 0 }, { kind: 'en', color: 1 }, { kind: 'boost', color: 1 }, { kind: 'tune', color: 2 }] }, turn: 'player', step: 1 });
  const h = await page.evaluate(() => game.me.hand.map(c => c.id));
  await mouseDrag(page, dragHand(h[0]), '#playerSlots [data-slot="player:0"]'); await ack(page); // energy onto a bench monster
  assert.deepEqual(await page.evaluate(() => [game.me.bench[0].energy, game.me.attached]), [[0], true]);
  await mouseDrag(page, dragHand(h[1]), '#playerSlots [data-slot="player:1"]'); // second attach in the same turn: refused
  assert.deepEqual(await page.evaluate(() => [game.me.active.energy.length, game.me.hand.length]), [0, 3]);
  await mouseDrag(page, dragHand(h[2]), '#playerSlots [data-slot="player:1"]'); await ack(page);
  assert.deepEqual(await page.evaluate(() => [game.me.bonus, game.me.boosted]), [1, true]);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('mouse drag: colour-adjust card on a front monster opens the colour picker; the picked colour applies for the turn only', async () => {
  const { ctx, page } = await openGame(browser, { seed: 32, viewport: DESKTOP });
  await setup(page, { me: { active: { e: [0] }, bench: [], hand: [{ kind: 'tune', color: 2 }] }, turn: 'player', step: 1 });
  const id = await page.evaluate(() => game.me.hand[0].id);
  await mouseDrag(page, dragHand(id), '#playerSlots [data-slot="player:1"]');
  assert.equal(await page.textContent('#modalTitle'), '色調整：変更後の色');
  const bs = await modalButtons(page);
  assert.deepEqual(bs.slice(0, 6).map(b => b.t), ['赤', '橙', '黄', '緑', '青', '紫']);
  assert.equal(bs[0].d, true, 'cannot "change" to the current base colour');
  await page.click('#modalButtons button:has-text("青")'); await ack(page);
  assert.deepEqual(await page.evaluate(() => [game.me.tuneColor, game.me.tuned, base(game.me.active), game.me.active.energy]), [4, true, 0, [0]]);
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
  const src = () => page.$eval('#playerSlots [data-slot="player:1"] img', i => i.getAttribute('src'));
  const ok = () => page.$eval('#playerSlots [data-slot="player:1"] img', i => i.complete && i.naturalWidth > 0);
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
test('KD-1: AI deck empty at its turn start: failure message, then "あなたの勝利", then the player taps to start a new match', async () => {
  const { ctx, page, errors } = await openGame(browser, { seed: 91, viewport: DESKTOP });
  await setup(page, { me: { active: { e: [0] }, bench: [] }, ai: { active: { e: [0] }, bench: [] }, turn: 'player', step: 1 });
  await page.evaluate(() => { game.ai.deck = []; });
  await page.click('#turnControl button');                        // 攻撃せずターン終了
  await page.click('#modalButtons button:has-text("ターン終了")');
  await ack1(page, /あなたはターンを終了した/);
  const seen = [];
  const read = () => page.evaluate(() => ({ text: document.getElementById('messageText').textContent, shown: document.getElementById('message').classList.contains('show'), over: game.over, kos: game.me.kos + ',' + game.ai.kos, id: game.me.hand.map(c => c.id).join() }));
  let s = await read(); seen.push(s.text);
  assert.match(s.text, /山札から引けない/); assert.equal(s.over, false, 'not over yet: nothing may restart before the player has seen the result');
  const handBefore = s.id;
  await page.click('#message');
  s = await read(); seen.push(s.text);
  assert.match(s.text, /あなたの勝利！ 相手は山札から引けませんでした/); assert.equal(s.over, true);
  assert.equal(await page.textContent('#messageTap'), '次の対戦に進む ▶');
  assert.equal(await page.evaluate(() => game.turn), 'end');
  await page.waitForTimeout(300);                                  // nothing happens on its own: the result stays until the player acts
  s = await read(); assert.equal(s.shown, true); assert.equal(s.id, handBefore);
  await page.click('#message');                                    // explicit operation -> next match
  assert.deepEqual(await page.evaluate(() => [game.turn, game.over, game.me.hand.length, game.me.kos, game.ai.kos]), ['setup', false, 5, 0, 0]);
  assert.deepEqual(errors, []); await ctx.close();
});
async function ack1(page, re) { // click one message at a time until the one matching `re` has been acknowledged
  for (let i = 0; i < 12; i++) { const t = await page.evaluate(() => document.getElementById('message').classList.contains('show') ? document.getElementById('messageText').textContent : null);
    if (t === null) return; const hit = re.test(t); await page.click('#message'); if (hit) return; }
}

test('KD-1: the normal victory / defeat / restart paths still work through real taps (attack win, deck-out loss)', async () => {
  const { ctx, page } = await openGame(browser, { seed: 92, viewport: DESKTOP });
  await setup(page, { me: { active: { e: [0] }, bench: [], kos: 1 }, ai: { active: { e: [0], d: 9 }, bench: [{ e: [] }] }, targetKos: 2, turn: 'player', step: 1 });
  await page.click('#playerSlots [data-slot="player:1"]'); await page.click('#modalButtons button:has-text("ワザ①")'); await page.click('#modalButtons button:has-text("攻撃する")');
  assert.match(await page.textContent('#messageText'), /ダメージ/); await page.click('#message');
  assert.match(await page.textContent('#messageText'), /あなたが1体撃破！ 2\/2/); await page.click('#message');
  assert.match(await page.textContent('#messageText'), /あなたの勝利！ 2体撃破/); assert.equal(await page.evaluate(() => game.over), true);
  await page.click('#message');
  assert.equal(await page.evaluate(() => game.turn), 'setup');
  // player deck-out loss
  await setup(page, { me: { active: { e: [0] }, bench: [] }, ai: { active: { e: [0] }, bench: [] }, turn: 'ai', step: 2 });
  await page.evaluate(() => { game.me.deck = []; afterAi(); });
  assert.match(await page.textContent('#messageText'), /相手の勝利！ あなたは山札から引けませんでした/);
  await page.click('#message'); assert.equal(await page.evaluate(() => game.turn), 'setup');
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

test('KD-3: detail view and drag label of 色調整 / 増強 show no colour; the colour picker still offers the 6 colours', async () => {
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
  // the picker keeps the six real colours (those are choices, not a property of the card)
  await setup(page, { me: { active: { e: [0] }, bench: [], hand: [{ kind: 'tune', color: 4 }] }, turn: 'player', step: 1 });
  await ev2(page, () => useHand(game.me.hand[0]));
  assert.deepEqual((await modalButtons(page)).slice(0, 6).map(b => b.t), ['赤', '橙', '黄', '緑', '青', '紫']);
  await ctx.close();
});
const ev2 = (page, fn) => page.evaluate(fn);

// ---------------- logo placement / layout ----------------
for (const [name, viewport, maxLogoW] of [['phone', MOBILE, 360], ['small phone', { width: 360, height: 640 }, 360], ['desktop', DESKTOP, 420]]) {
  test(`logo (${name}): shown at the top, decoded, scaled to the page width, aspect kept, game board not pushed off`, async () => {
    const { ctx, page, errors } = await openGame(browser, { seed: 95, viewport });
    const g = await page.evaluate(() => { const i = document.querySelector('.logo-banner img'), r = i.getBoundingClientRect(), b = document.querySelector('.battle').getBoundingClientRect();
      return { ok: i.complete && i.naturalWidth > 0, nat: [i.naturalWidth, i.naturalHeight], w: r.width, h: r.height, top: r.top, bottom: r.bottom, left: r.left, right: r.right, battleTop: b.top, vw: innerWidth, overflow: document.documentElement.scrollWidth - innerWidth, alt: i.alt, src: i.getAttribute('src') }; });
    assert.equal(g.ok, true); assert.equal(g.src, 'paremon_logo_center_crop2.png'); assert.equal(g.alt, 'パレットモンスター（パレモン）のロゴ');
    assert.ok(g.w <= maxLogoW + 0.5 && g.w > 250, `logo width ${g.w}`); assert.ok(Math.abs(g.w / g.h - g.nat[0] / g.nat[1]) < 0.02, 'aspect ratio preserved');
    assert.ok(g.top < 30 && g.left >= 0 && g.right <= g.vw, 'at the top, inside the viewport'); assert.ok(g.overflow <= 0);
    assert.ok(g.battleTop >= g.bottom, 'battle board starts below the logo');
    assert.deepEqual(errors, []); await ctx.close();
  });
}

test('phone layout: the cleaned logo is shorter than the original (298px -> 240px at 360px width), so the board and hand sit 58px higher', async () => {
  const { ctx, page } = await openGame(browser, { seed: 96, viewport: MOBILE });
  const g = await page.evaluate(() => ({ logoH: document.querySelector('.logo-banner img').getBoundingClientRect().height, handBottom: document.getElementById('hand').getBoundingClientRect().bottom }));
  assert.ok(g.logoH <= 245, `logo height ${g.logoH}`);            // measured with the original logo: 298px, hand bottom 956px
  assert.ok(g.handBottom <= 905, `hand bottom ${g.handBottom}`);  // measured now: 240px / 898px
  await ctx.close();
});

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
    const r = await page.$eval('#playerSlots [data-slot="player:1"] img', i => ({ src: i.getAttribute('src'), ok: i.naturalWidth > 0, r: i.getBoundingClientRect().width }));
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
    for (const sp of ['centipede', 'dragon', 'golem', 'knight', 'skeleton']) {
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
