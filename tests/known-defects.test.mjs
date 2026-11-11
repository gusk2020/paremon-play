// Documented defects in the shipped v0.17 logic (see docs/STATUS.md, KD-1).
// They are `todo`: node reports them as TODO (they still run) and they do not fail the suite, because the
// task for this migration was to record them without changing gameplay. Do NOT turn these into skip().
// When a defect is fixed, remove `todo` so the test guards it.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, openGame, setup } from './helpers.mjs';

let browser, page;
before(async () => { browser = await launch(); ({ page } = await openGame(browser, { seed: 3 })); });
after(async () => { await browser.close(); });

test('KD-1: when the AI cannot draw, the player should see the win message (not a silent restart)', { todo: 'KD-1 acknowledge() resets as soon as game.over is set by the AI draw message; unreachable in normal play because the first player runs out of deck first' }, async () => {
  await setup(page, { me: { active: { e: [0] }, bench: [] }, ai: { active: { e: [0] }, bench: [] }, turn: 'ai', step: 2 });
  const t = await page.evaluate(() => { game.ai.deck = []; aiPlan(); const texts = [];
    for (let i = 0; i < 12 && notice; i++) { texts.push(notice.text); if (game.over && notice.text.includes('勝利')) break; acknowledge(); }
    return texts; });
  assert.ok(t.some(x => x.includes('あなたの勝利')), t.join(' / '));
});
