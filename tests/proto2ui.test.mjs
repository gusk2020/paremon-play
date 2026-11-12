// Balance prototype 2: the standalone end-turn button is gone; 「ターン終了」 lives in the front monster's menu; bench actions and boost A/B
// are reachable by tap menus with confirmation; everything fits at 360/393/412/PC.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, openGame, setup, ack, MOBILE, DESKTOP, chooseDraw } from './helpers.mjs';

const browser = await launch();
after(async () => { await browser.close(); });
const modalButtons = page => page.$$eval('#modalButtons button', bs => bs.map(b => ({ t: b.textContent.trim(), d: b.disabled })));
const FRONT = '#playerSlots [data-slot="player:1"]', B0 = '#playerSlots [data-slot="player:0"]', B2 = '#playerSlots [data-slot="player:2"]';
const VIEWS = [['360x740', { width: 360, height: 740 }], ['393x851', { width: 393, height: 851 }], ['412x892', MOBILE], ['desktop 1280', DESKTOP]];

test('the old standalone 「攻撃せずターン終了」 button/area is gone in every state (setup, my turn, opponent turn, after the end)', async () => {
  const { ctx, page, errors } = await openGame(browser, { seed: 301, viewport: MOBILE });
  const gone = () => page.evaluate(() => ({ el: !!document.getElementById('turnControl'), text: [...document.querySelectorAll('button')].some(b => /攻撃せずターン終了/.test(b.textContent)), body: /攻撃せずターン終了/.test(document.body.innerText) }));
  assert.deepEqual(await gone(), { el: false, text: false, body: false }, 'setup');
  await setup(page, { me: { active: { e: [0] }, bench: [] }, turn: 'player', step: 1 }); assert.deepEqual(await gone(), { el: false, text: false, body: false }, 'my turn');
  await setup(page, { me: { active: { e: [0] }, bench: [] }, turn: 'ai', step: 1 }); assert.deepEqual(await gone(), { el: false, text: false, body: false }, 'opponent turn');
  await setup(page, { me: { active: { e: [0] }, bench: [] }, turn: 'end', step: 1 }); assert.deepEqual(await gone(), { el: false, text: false, body: false }, 'ended');
  assert.deepEqual(errors, []); await ctx.close();
});

test('front menu → ターン終了 → confirmation → the turn passes exactly once (also when the confirm button is pressed twice quickly)', async () => {
  const { ctx, page, errors } = await openGame(browser, { seed: 302, viewport: MOBILE });
  await setup(page, { me: { active: { e: [0] }, bench: [] }, turn: 'player', step: 1 });
  await page.click(FRONT);
  const b = await modalButtons(page);
  assert.ok(b.some(x => x.t === 'ターン終了（攻撃しない）' && !x.d), 'the end-turn entry is in the front menu and enabled'); assert.ok(b.some(x => x.t.startsWith('ワザ①')), 'attack entries are kept'); assert.ok(b.some(x => x.t.startsWith('前衛と控えの交代')), 'swap is kept');
  const before = await page.evaluate(() => ({ step: game.step, aiTurns: game.ai.st.turns, myTurns: game.me.st.turns }));
  await page.click('#modalButtons button:has-text("ターン終了（攻撃しない）")');
  assert.equal(await page.textContent('#modalTitle'), 'ターンを終了', 'a confirmation comes first: one accidental tap does not end the turn');
  assert.equal(await page.evaluate(() => game.turn), 'player');
  await page.evaluate(() => { const b = [...document.querySelectorAll('#modalButtons button')].find(x => x.textContent.trim() === 'ターン終了'); b.click(); b.click(); });
  assert.match(await page.textContent('#messageText'), /あなたはターンを終了した/); await page.click('#message');
  assert.equal(await page.evaluate(() => [game.turn, game.ai.st.turns].join()), `ai,${before.aiTurns + 1}`, 'the opponent turn started once');
  for (let i = 0; i < 40; i++) { const shown = await page.evaluate(() => document.getElementById('message').classList.contains('show')); if (!shown) break; await page.click('#message'); }
  await chooseDraw(page, 'M').catch(() => {});
  const after2 = await page.evaluate(() => ({ step: game.step, aiTurns: game.ai.st.turns, turn: game.turn }));
  assert.deepEqual([after2.step, after2.aiTurns], [before.step + 1, before.aiTurns + 1], 'exactly one opponent turn and one new turn for me');
  assert.deepEqual(errors, []); await ctx.close();
});

test('「戻る」 on the confirmation keeps the turn; the end-turn entry is disabled with a reason before the match starts, and is unreachable in the opponent turn / during a message / after the game', async () => {
  const { ctx, page } = await openGame(browser, { seed: 303, viewport: MOBILE });
  await setup(page, { me: { active: { e: [0] }, bench: [] }, turn: 'setup', step: 0 });
  await page.click(FRONT);
  assert.equal((await modalButtons(page)).some(x => x.t.startsWith('ターン終了')), false, 'before 対戦開始 the entry is not offered at all');
  await page.evaluate(() => { closeModal(); game.turn = 'setup'; render(); confirmEndTurn(); });
  assert.equal(await page.evaluate(() => document.getElementById('overlay').classList.contains('show')), false, 'and the confirmation cannot be forced open'); assert.match(await page.evaluate(() => endTurnBlock()), /対戦開始前はターンを終了できません/);
  await page.evaluate(() => { game.turn = 'player'; game.drawPending = true; }); assert.match(await page.evaluate(() => endTurnBlock()), /山札を選んで/); await page.evaluate(() => { game.drawPending = false; game.promotion = 'bench'; }); assert.match(await page.evaluate(() => endTurnBlock()), /前衛を選ぶ/); await page.evaluate(() => { game.promotion = false; });
  await setup(page, { me: { active: { e: [0] }, bench: [] }, turn: 'setup', step: 0 }); await page.click(FRONT);
  await page.click('#modalButtons button:has-text("戻る")');
  await setup(page, { me: { active: { e: [0] }, bench: [] }, turn: 'player', step: 1 });
  await page.click(FRONT); await page.click('#modalButtons button:has-text("ターン終了（攻撃しない）")'); await page.click('#modalButtons button:has-text("戻る")');
  assert.deepEqual(await page.evaluate(() => [game.turn, document.getElementById('overlay').classList.contains('show')]), ['player', false], '戻る = nothing happened');
  for (const [label, cfg, extra] of [['opponent turn', { turn: 'ai' }], ['game over', { turn: 'end' }]]) {
    await setup(page, { me: { active: { e: [0] }, bench: [] }, step: 1, ...cfg }); if (cfg.turn === 'end') await page.evaluate(() => { game.over = true; render(); });
    await page.click(FRONT, { force: true }); assert.equal(await page.evaluate(() => document.getElementById('overlay').classList.contains('show')), false, label);
  }
  await setup(page, { me: { active: { e: [0] }, bench: [] }, turn: 'player', step: 1 });
  await page.evaluate(() => sequence([evt('center', 'メッセージ')])); await page.click(FRONT, { force: true });
  assert.equal(await page.evaluate(() => document.getElementById('overlay').classList.contains('show')), false, 'a pending message blocks the menu'); await ack(page);
  await ctx.close();
});

test('an empty front slot still offers ターン終了 (and a free bench→front move), so nothing can get stuck', async () => {
  const { ctx, page } = await openGame(browser, { seed: 304, viewport: MOBILE });
  await setup(page, { me: { active: null, bench: [{ e: [] }], hand: [] }, turn: 'player', step: 1 });
  await page.click(FRONT);
  const b = await modalButtons(page); assert.ok(b.some(x => x.t === 'ターン終了（攻撃しない）' && !x.d), b.map(x => x.t).join('|')); assert.ok(b.some(x => /前衛に出す（無料）/.test(x.t) && !x.d));
  await page.click('#modalButtons button:has-text("前衛に出す")'); await ack(page);
  assert.deepEqual(await page.evaluate(() => [!!game.me.active, game.me.bench.length, game.me.retreated]), [true, 0, false]);
  await ctx.close();
});

test('bench menu: swap / return to hand / recover all, each with its cost, shared once-per-turn slot, confirmation, and the right result', async () => {
  const { ctx, page, errors } = await openGame(browser, { seed: 305, viewport: MOBILE });
  await setup(page, { me: { active: { e: [0, 1] }, bench: [{ e: [2, 2], d: 3, sp: 'knight' }, { e: [4, 4, 4], sp: 'dragon' }], hand: [] }, turn: 'player', step: 1 });
  await page.click(B0);
  const b = await modalButtons(page); assert.deepEqual(b.map(x => x.t.slice(0, 6)), ['詳細', '前衛と交代（', '手札へ戻す（', 'エネルギー全', '戻る'].map(x => x.slice(0, 6))); assert.ok(b.slice(1, 4).every(x => !x.d));
  assert.match(await page.textContent('#modalText'), /合計1ターン1回/);
  await page.click('#modalButtons button:has-text("手札へ戻す")');
  assert.match(await page.textContent('#modalTitle'), /手札へ戻す・最終確認/); assert.match(await page.textContent('#modalText'), /エネルギー2枚は全て捨て札/);
  await page.click('#modalButtons button:has-text("戻る")');
  assert.equal(await page.evaluate(() => game.me.bench.length), 2, 'cancel changes nothing'); assert.equal(await page.evaluate(() => game.me.retreated), false);
  await page.click(B0); await page.click('#modalButtons button:has-text("手札へ戻す")'); await page.click('#modalButtons button:has-text("手札へ戻す"):not(:has-text("（"))');
  await ack(page);
  assert.deepEqual(await page.evaluate(() => [game.me.bench.length, game.me.hand.map(c => c.kind + ':' + c.species).join(), game.me.discard.length, game.me.retreated]), [1, 'mon:knight', 2, true]);
  await page.click(B0);                     // the dragon moved to the left bench slot
  const b2 = await modalButtons(page); assert.ok(b2.slice(1, 4).every(x => x.d), 'swap / return / recover are all disabled for the rest of the turn'); assert.match(await page.textContent('#modalText'), /使用済み/);
  await page.click('#modalButtons button:has-text("戻る")');
  await page.evaluate(() => { game.me.retreated = false; });          // (next turn) now recover
  await page.click(B0); await page.click('#modalButtons button:has-text("エネルギー全回収")');
  assert.match(await page.textContent('#modalText'), /消滅/); await page.click('#modalButtons button:has-text("全回収する")'); await ack(page);
  assert.deepEqual(await page.evaluate(() => [game.me.bench.length, game.me.hand.filter(c => c.kind === 'en').length, game.me.removed.length, game.ai.kos]), [0, 3, 1, 0]);
  assert.deepEqual(errors, []); await ctx.close();
});

test('front menu: swapping from the front still asks which bench monster and which energy to discard, then needs confirmation', async () => {
  const { ctx, page } = await openGame(browser, { seed: 306, viewport: MOBILE });
  await setup(page, { me: { active: { e: [0, 1] }, bench: [{ e: [] }] }, turn: 'player', step: 1 });
  await page.click(FRONT); await page.click('#modalButtons button:has-text("前衛と控えの交代")');
  assert.equal(await page.textContent('#modalTitle'), '交代する控え'); await page.click('#modalButtons button:nth-child(1)');
  assert.equal(await page.textContent('#modalTitle'), '捨てるエネルギー'); await page.click('#modalButtons button:nth-child(2)');
  assert.equal(await page.textContent('#modalTitle'), '交代の最終確認'); await page.click('#modalButtons button:has-text("交代を確定")'); await ack(page);
  assert.deepEqual(await page.evaluate(() => [game.me.active.energy.length, game.me.bench[0].energy.join(), game.me.discard.length, game.me.retreated]), [0, '0', 1, true]);
  await ctx.close();
});

test('boost from the hand: A/B choice; B asks for the bench target, then confirms; backing out keeps the card; A applies at once', async () => {
  const { ctx, page, errors } = await openGame(browser, { seed: 307, viewport: MOBILE });
  const cfg = { me: { active: { e: [1, 1] }, bench: [], hand: [{ kind: 'boost', color: 0 }] }, ai: { active: { e: [0] }, bench: [{ e: [0], d: 6 }] }, turn: 'player', step: 1 };
  await setup(page, cfg);
  await page.click('#hand button'); await page.click('#modalButtons button:has-text("使う")');
  assert.equal(await page.textContent('#modalTitle'), '増強：効果を選ぶ');
  const c = await modalButtons(page); assert.ok(c[0].t.startsWith('A：') && !c[0].d && c[1].t.startsWith('B：') && !c[1].d);
  await page.click('#modalButtons button:has-text("B：")');
  assert.equal(await page.textContent('#modalTitle'), '増強B：攻撃する控えを選ぶ'); assert.match(await modalButtons(page).then(x => x[0].t), /→撃破/);
  await page.click('#modalButtons button:nth-child(1)');
  assert.equal(await page.textContent('#modalTitle'), '増強Bの最終確認'); await page.click('#modalButtons button:has-text("戻る")');
  assert.deepEqual(await page.evaluate(() => [game.me.hand.length, game.me.boosted, game.ai.bench[0].damage, game.turn]), [1, false, 6, 'player'], 'cancel keeps the card and the turn');
  await page.click('#hand button'); await page.click('#modalButtons button:has-text("使う")'); await page.click('#modalButtons button:has-text("B：")'); await page.click('#modalButtons button:nth-child(1)'); await page.click('#modalButtons button:has-text("攻撃する")');
  assert.match(await page.textContent('#messageText'), /増強Bで相手の控え/); assert.equal(await page.evaluate(() => game.ai.bench[0].damage), 10);
  await page.click('#message'); assert.match(await page.textContent('#messageText'), /控えのモンスターを1体撃破！ 1\/2/);
  assert.deepEqual(await page.evaluate(() => [game.me.kos, game.ai.bench.length, !!game.ai.active]), [1, 0, true]);
  await setup(page, cfg);
  await page.click('#hand button'); await page.click('#modalButtons button:has-text("使う")'); await page.click('#modalButtons button:has-text("A：")');
  assert.deepEqual(await page.evaluate(() => [game.me.boostA, game.me.boosted, game.me.hand.length]), [true, true, 0]);
  assert.deepEqual(errors, []); await ctx.close();
});

for (const [name, viewport] of VIEWS) {
  test(`menus fit (${name}): front menu, bench menu, boost menu — inside the screen, no sideways scroll, every button >= 44px, hand and field geometry unchanged by the removed button`, async () => {
    const { ctx, page, errors } = await openGame(browser, { seed: 308, viewport });
    await setup(page, { me: { active: { e: [0, 1], sp: 'knight' }, bench: [{ e: [2, 2, 2], d: 3, sp: 'dragon' }], hand: [{ kind: 'boost', color: 0 }, { kind: 'mon', sp: 'dragon' }, { kind: 'en', color: 2 }] }, ai: { active: { e: [0] }, bench: [{ e: [0], d: 6 }] }, turn: 'player', step: 1 });
    const fits = async label => { const g = await page.evaluate(() => { const m = document.getElementById('modal').getBoundingClientRect(), bs = [...document.querySelectorAll('#modalButtons button')].map(b => b.getBoundingClientRect());
      return { l: m.left, r: m.right, t: m.top, b: m.bottom, w: innerWidth, h: innerHeight, sw: document.getElementById('modal').scrollWidth, cw: document.getElementById('modal').clientWidth, minH: Math.min(...bs.map(x => x.height)), over: document.documentElement.scrollWidth - innerWidth }; });
      assert.ok(g.l >= 0 && g.r <= g.w && g.t >= 0 && g.b <= g.h + 1, `${label} inside the screen ${JSON.stringify(g)}`); assert.ok(g.sw <= g.cw + 1, `${label} no horizontal scroll`); assert.ok(g.minH >= 44, `${label} buttons ${g.minH}px`); assert.ok(g.over <= 0); };
    await page.click(FRONT); await fits('front menu'); await page.click('#modalButtons button:has-text("戻る")');
    await page.click(B0); await fits('bench menu'); await page.click('#modalButtons button:has-text("戻る")');
    await page.click('#hand button:nth-child(1)'); await page.click('#modalButtons button:has-text("使う")'); await fits('boost menu'); await page.click('#modalButtons button:has-text("B：")'); await fits('boost target'); 
    await page.click('#modalButtons button:nth-child(1)'); await fits('boost confirm');
    const geo = await page.evaluate(() => { const R = s => { const r = document.querySelector(s).getBoundingClientRect(); return [+r.width.toFixed(1), +r.height.toFixed(1)]; }; return { slot: R('#playerSlots .slot'), hand: R('#hand button'), field: R('.player-field')[1] }; });
    assert.ok(geo.slot[0] > 80 && geo.hand[0] > 60 && geo.field > 100, JSON.stringify(geo)); assert.deepEqual(errors, []); await ctx.close();
  });
}

test('hand: with more cards than fit, a horizontal finger swipe scrolls the hand (the off-screen cards become reachable), and a vertical drag onto the field still works', async () => {
  const { ctx, page, errors } = await openGame(browser, { seed: 309, viewport: { width: 393, height: 851 }, touch: true });
  await setup(page, { me: { active: { e: [0] }, bench: [], hand: Array.from({ length: 9 }, (_, i) => ({ kind: 'en', color: i % 6 })) }, turn: 'player', step: 1 });
  const m = await page.evaluate(() => { const h = document.getElementById('hand'); return { sw: h.scrollWidth, cw: h.clientWidth, ta: getComputedStyle(h.querySelector('button')).touchAction }; });
  assert.ok(m.sw > m.cw + 20, `hand overflows (${m.sw} > ${m.cw})`); assert.equal(m.ta, 'pan-x');
  const cdp = await ctx.newCDPSession(page);
  const swipe = async dx => { const box = await page.$eval('#hand', b => { const r = b.getBoundingClientRect(); return { x: r.left + r.width * 0.8, y: r.top + r.height / 2 }; });
    const send = (type, pt) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pt ? [{ x: pt.x, y: pt.y }] : [] });
    await send('touchStart', box); for (let i = 1; i <= 15; i++) { await send('touchMove', { x: box.x + dx * i / 15, y: box.y }); await page.waitForTimeout(16); } await send('touchEnd'); await page.waitForTimeout(400); };
  await swipe(-180);
  const left = await page.evaluate(() => document.getElementById('hand').scrollLeft);
  assert.ok(left > 80, `the hand scrolled (scrollLeft ${left})`);
  for (let i = 0; i < 3; i++) await swipe(-150);
  assert.equal(await page.$eval('#hand button:last-child', b => { const r = b.getBoundingClientRect(), h = document.getElementById('hand').getBoundingClientRect(); return r.right <= h.right + 1; }), true, 'the last card can be brought fully into view');
  assert.equal(await page.evaluate(() => game.me.hand.length), 9, 'swiping played no card');
  assert.deepEqual(errors, []); await ctx.close();
});
