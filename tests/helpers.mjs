// Shared helpers for the browser tests. The game is one static HTML file opened over file://,
// so relative image paths are exercised exactly as shipped.
import { chromium } from 'playwright';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const HTML = path.join(ROOT, 'paremon_crossplatform_v17.html');
export const MOBILE = { width: 412, height: 892 }; // Pixel 7a-class viewport (emulation only, not a real device)
export const DESKTOP = { width: 1280, height: 900 };

export async function launch() { return chromium.launch(); }

// Deterministic Math.random (mulberry32) so decks, shuffles and the AI are reproducible.
export function seedScript(seed) {
  return `(()=>{let a=${seed >>> 0};Math.random=()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}})();`;
}

export async function openGame(browser, { seed = 1, viewport = MOBILE, touch = false } = {}) {
  const ctx = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.addInitScript(seedScript(seed));
  await page.goto(pathToFileURL(HTML).href);
  await page.waitForFunction(() => typeof game !== 'undefined' && document.querySelectorAll('#hand button').length > 0);
  return { ctx, page, errors };
}

// Replace the board with an exact situation, then re-render.
// side spec: { active: {e:[colors], d:damage}|null, bench:[{e,d}], hand:[{kind,color}] }
export async function setup(page, cfg) {
  await page.evaluate(cfg => {
    const build = s => s ? Object.assign(mon({ id: ++uid, species: 'knight' }), { energy: [...(s.e || [])], damage: s.d || 0 }) : null;
    for (const side of ['me', 'ai']) {
      const s = cfg[side]; if (!s) continue;
      const p = game[side];
      if ('active' in s) p.active = build(s.active);
      if ('bench' in s) p.bench = s.bench.map(build);
      if ('hand' in s) p.hand = s.hand.map(h => fresh(h.kind, h.color));
      // every flag is reset first, so no test can inherit state from the previous one
      Object.assign(p, { kos: 0, tuneColor: null, bonus: 0, attached: false, retreated: false, tuned: false, boosted: false });
      for (const k of ['kos', 'tuneColor', 'bonus', 'attached', 'retreated', 'tuned', 'boosted']) if (k in s) p[k] = s[k];
    }
    game.turn = cfg.turn || 'player'; game.step = cfg.step ?? 1;
    if ('targetKos' in cfg) game.targetKos = cfg.targetKos;
    game.over = false; game.promotion = false;
    selected = null; fieldSelected = null; pendingAttack = null; mode = null; queue = []; notice = null; onEmpty = null;
    document.getElementById('overlay').classList.remove('show');
    render();
  }, cfg);
}

// Run the real attack resolution and apply every message's side effect in order.
export async function attack(page, who, strong) {
  return page.evaluate(([who, strong]) => {
    const p = who === 'me' ? game.me : game.ai, t = who === 'me' ? game.ai : game.me;
    const before = t.active ? t.active.damage : null;
    const ev = resolveAttackSafe(p, strong);
    ev.forEach(e => e.fn && e.fn());
    return { texts: ev.map(e => e.text), before, after: t.active ? t.active.damage : null,
      kos: p.kos, over: game.over, promotion: game.promotion, targetActive: !!t.active, bonus: p.bonus };
  }, [who, strong]);
}

export const rect = (page, sel) => page.evaluate(sel => {
  const r = document.querySelector(sel).getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}, sel);

// A person scrolls so that the card and its destination are both on screen before dragging; do the same.
async function bringBothIntoView(page, from, to) {
  await page.evaluate(([f, t]) => {
    const a = document.querySelector(f).getBoundingClientRect(), b = document.querySelector(t).getBoundingClientRect();
    const mid = (a.top + a.bottom + b.top + b.bottom) / 4; window.scrollBy(0, mid - innerHeight / 2);
  }, [from, to]);
}

// Mouse drag (desktop). Movement is stepped so the >11px drag threshold and pointermove run.
export async function mouseDrag(page, from, to) {
  await bringBothIntoView(page, from, to);
  const a = await rect(page, from), b = await rect(page, to);
  await page.mouse.move(a.x, a.y); await page.mouse.down();
  await page.mouse.move(a.x + 20, a.y - 20, { steps: 4 });
  await page.mouse.move(b.x, b.y, { steps: 12 });
  await page.mouse.up();
}

// Touch drag through CDP: produces real touch pointer events like a finger on the phone.
export async function touchDrag(page, ctx, from, to) {
  const cdp = await ctx.newCDPSession(page);
  await bringBothIntoView(page, from, to);
  const a = await rect(page, from), b = await rect(page, to);
  const send = (type, pt) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pt ? [{ x: pt.x, y: pt.y }] : [] });
  await send('touchStart', a);
  for (let i = 1; i <= 12; i++) await send('touchMove', { x: a.x + (b.x - a.x) * i / 12, y: a.y + (b.y - a.y) * i / 12 });
  await send('touchEnd');
  await cdp.detach();
}

export async function ack(page) { // dismiss the field message(s) like a player tapping them
  for (let i = 0; i < 30; i++) {
    const shown = await page.evaluate(() => document.getElementById('message').classList.contains('show'));
    if (!shown) return;
    await page.click('#message');
  }
  throw new Error('message sequence did not finish');
}

export const handId = (page, kind, color) => page.evaluate(([k, c]) => {
  const f = game.me.hand.find(x => x.kind === k && (c === undefined || c === null || x.color === c));
  return f ? f.id : null;
}, [kind, color]);

// After a drag the game ignores clicks for 400 ms on purpose (suppressCardClickUntil). Wait for that condition itself.
export const clicksAllowed = page => page.waitForFunction(() => performance.now() >= suppressCardClickUntil);
