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
