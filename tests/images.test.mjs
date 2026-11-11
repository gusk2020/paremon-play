// Picture audit. The same audit runs on the cleaned pictures (must be clean) and on the untouched originals kept in
// assets/originals (must be FLAGGED), which proves the audit can see the defects it is guarding against.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { launch, ROOT } from './helpers.mjs';

const SPECIES = ['centipede', 'dragon', 'golem', 'knight', 'skeleton'];
const NAMES = SPECIES.flatMap(s => [0, 1, 2, 3, 4, 5, 6].map(i => `${s}_${i}`));
let browser, page, server, base;
before(async () => {
  // a tiny static server: pixel reads through canvas need a same-origin http page (file:// images taint the canvas)
  server = http.createServer((req, res) => {
    const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(f === path.join(ROOT, '/') ? 200 : 404, { 'content-type': 'text/html' }); res.end('<!doctype html><title>audit</title>'); return; }
    res.writeHead(200, { 'content-type': f.endsWith('.png') ? 'image/png' : 'text/plain' }); fs.createReadStream(f).pipe(res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); base = `http://127.0.0.1:${server.address().port}/`;
  browser = await launch(); page = await (await browser.newContext()).newPage();
  await page.goto(base);
  await page.evaluate(() => {
    window.audit = async url => {
      const img = new Image(); img.src = url; await img.decode();
      const w = img.naturalWidth, h = img.naturalHeight, c = document.createElement('canvas'); c.width = w; c.height = h;
      const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, w, h).data, op = new Uint8Array(w * h); let total = 0, transparent = 0;
      for (let i = 0; i < w * h; i++) { if (d[i * 4 + 3] > 128) { op[i] = 1; total++; } if (d[i * 4 + 3] < 10) transparent++; }
      const cols = new Int32Array(w); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) cols[x] += op[y * w + x];
      // sheet divider: thin, full-height and isolated on its right
      const dividers = []; for (let x = 0; x < w - 4; x++) if (cols[x] >= 0.9 * h && cols[x + 1] < 0.2 * h && cols[x + 2] < 0.2 * h && cols[x + 4] < 0.2 * h) dividers.push(x);
      // 8-connected components of the drawing, joined across gaps of up to 3px
      const R = 3, dil = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (op[y * w + x]) for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) { const yy = y + dy, xx = x + dx; if (yy >= 0 && yy < h && xx >= 0 && xx < w) dil[yy * w + xx] = 1; }
      const lab = new Int32Array(w * h), comps = []; let n = 0;
      for (let s = 0; s < w * h; s++) if (dil[s] && !lab[s]) { n++; const st = [s]; lab[s] = n; let area = 0, x0 = w, x1 = 0, y0 = h, y1 = 0;
        while (st.length) { const p = st.pop(), px = p % w, py = (p / w) | 0; if (op[p]) { area++; if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py; }
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const yy = py + dy, xx = px + dx; if (yy >= 0 && yy < h && xx >= 0 && xx < w) { const q = yy * w + xx; if (dil[q] && !lab[q]) { lab[q] = n; st.push(q); } } } }
        comps.push({ area, x0, x1, y0, y1 }); }
      comps.sort((a, b) => b.area - a.area);
      // valley split: columns with almost nothing in them that separate two substantial masses
      const thr = Math.max(14, Math.round(0.07 * h)), segs = []; let s0 = null, m = 0;
      for (let x = 0; x < w; x++) { const sep = cols[x] <= thr; if (!sep) { if (s0 === null) { s0 = x; m = 0; } m += cols[x]; } else if (s0 !== null) { segs.push({ s: s0, e: x - 1, m }); s0 = null; } }
      if (s0 !== null) segs.push({ s: s0, e: w - 1, m });
      const big = segs.filter(q => q.m >= 0.02 * total);
      // an edge cut = drawing reaches the last data column (a 2px transparent margin is always added around the subject)
      const colLen = (x) => { let k = 0; for (let y = 0; y < h; y++) if (op[y * w + x]) k++; return k; };
      const rowLen = (y) => { let k = 0; for (let x = 0; x < w; x++) if (op[y * w + x]) k++; return k; };
      const L = Math.max(colLen(2), colLen(3)), Rr = Math.max(colLen(w - 3), colLen(w - 4)), T = Math.max(rowLen(2), rowLen(3)), B = Math.max(rowLen(h - 3), rowLen(h - 4));
      return { w, h, total, solid: total / (w * h) > 0.2 && /_[1-6]\.png$/.test(url), transparent: transparent / (w * h), dividers, mainShare: comps[0].area / total, others: comps.slice(1, 4).map(c => c.area),
        bigSegments: big.length, cutL: L, cutR: Rr, cutT: T, cutB: B };
    };
  });
});
after(async () => { await browser.close(); server.close(); });
const url = (rel) => base + rel;
const run = rel => page.evaluate(u => window.audit(u), url(rel));
const problems = a => [
  a.dividers.length && `sheet divider line at x=${a.dividers}`,
  a.mainShare < 0.9 && `second figure/fragment: largest piece is only ${(a.mainShare * 100).toFixed(0)}% of the drawing`,
  a.solid && a.bigSegments > 1 && `${a.bigSegments} separate figures side by side`,   // valley test only for solid colour art: thin line art has low column occupancy by nature
].filter(Boolean);

test('cleaned pictures (35): one figure each, no neighbour fragment, no divider line, real transparency', async () => {
  const bad = [];
  for (const n of NAMES) { const a = await run(`paremon_monsters2/${n}.png`);
    const pr = problems(a); if (a.transparent < 0.1) pr.push('not transparent'); if (a.w < 120 || a.h < 200) pr.push(`too small ${a.w}x${a.h}`);
    if (pr.length) bad.push(`${n}: ${pr.join('; ')}`); }
  assert.deepEqual(bad, []);
});

test('the audit really sees the problems: the untouched originals are flagged (at least 25 of 35)', async () => {
  const flagged = [];
  for (const n of NAMES) { const a = await run(`assets/originals/paremon_monsters2/${n}.png`); if (problems(a).length) flagged.push(n); }
  assert.ok(flagged.length >= 25, `only ${flagged.length} originals flagged`);
  for (const must of ['centipede_2', 'centipede_5', 'golem_4', 'dragon_1', 'skeleton_1', 'skeleton_5']) assert.ok(flagged.includes(must), `${must} should be flagged in the original`);
});

test('nothing is repainted: every fully opaque pixel of all 35 pictures equals the pixel of the original sheet it was cut from', async () => {
  const audit = await (await fetch(url('assets/image-audit.json'))).json();
  const r = await page.evaluate(async ([base, audit]) => {
    const load = async u => { const i = new Image(); i.src = u; await i.decode(); const c = document.createElement('canvas'); c.width = i.naturalWidth; c.height = i.naturalHeight; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(i, 0, 0); return { w: c.width, h: c.height, d: g.getImageData(0, 0, c.width, c.height).data }; };
    const out = {};
    for (const [species, info] of Object.entries(audit.monsters)) {
      const sheet = await load(base + 'assets/sources/' + info.sheet);
      for (const [name, p] of Object.entries(info.pictures)) {
        const pic = await load(base + 'paremon_monsters2/' + name);
        const [bx, by] = p.sheet_box, [ox, oy] = p.paste_offset; let opaque = 0, equal = 0;
        for (let y = 0; y < pic.h; y++) for (let x = 0; x < pic.w; x++) { const i = (y * pic.w + x) * 4; if (pic.d[i + 3] !== 255) continue; opaque++;
          const sx = bx + x - ox, sy = by + y - oy; if (sx < 0 || sy < 0 || sx >= sheet.w || sy >= sheet.h) continue; const j = (sy * sheet.w + sx) * 4;
          if (sheet.d[j] === pic.d[i] && sheet.d[j + 1] === pic.d[i + 1] && sheet.d[j + 2] === pic.d[i + 2]) equal++; }
        out[name] = [opaque, equal];
      }
    }
    return out;
  }, [base, audit]);
  const bad = Object.entries(r).filter(([, [o, e]]) => o < 5000 || e / o < 0.999).map(([n, [o, e]]) => `${n}: ${e}/${o}`);
  assert.equal(Object.keys(r).length, 35); assert.deepEqual(bad, []);
});

test('every figure lies strictly inside its original sheet (nothing was cut by the sheet border) and keeps 1:1 scale', async () => {
  const audit = await (await fetch(url('assets/image-audit.json'))).json(); let n = 0;
  for (const info of Object.values(audit.monsters)) { const [W, H] = info.sheet_size;
    for (const [name, p] of Object.entries(info.pictures)) { const [x0, y0, x1, y1] = p.sheet_box; n++; assert.ok(x0 > 0 && y0 > 0 && x1 < W && y1 < H, `${name} touches the sheet border`); assert.equal(p.scale, 1); } }
  assert.equal(n, 35);
});

test('one canvas per species: the 6 colour pictures have identical size; colourless has the same proportions, centre and baseline', async () => {
  const bad = [];
  for (const sp of SPECIES) {
    const as = []; for (let i = 0; i < 7; i++) as.push(await page.evaluate(async u => { const img = new Image(); img.src = u; await img.decode(); const w = img.naturalWidth, h = img.naturalHeight, c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0); const d = g.getImageData(0, 0, w, h).data;
      let x0 = w, x1 = 0, y1 = 0; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 128) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y > y1) y1 = y; }
      return { w, h, cx: (x0 + x1 + 1) / 2 / w, bottom: (h - 1 - y1) / h }; }, url(`paremon_monsters2/${sp}_${i}.png`)));
    for (let i = 2; i <= 6; i++) if (as[i].w !== as[1].w || as[i].h !== as[1].h) bad.push(`${sp}_${i} size ${as[i].w}x${as[i].h} != ${as[1].w}x${as[1].h}`);
    if (Math.abs(as[0].w / as[0].h - as[1].w / as[1].h) > 0.01) bad.push(`${sp}_0 aspect ${(as[0].w / as[0].h).toFixed(3)} vs ${(as[1].w / as[1].h).toFixed(3)}`);
    for (let i = 0; i <= 6; i++) { if (Math.abs(as[i].cx - 0.5) > 0.03) bad.push(`${sp}_${i} not centred (${as[i].cx.toFixed(3)})`); if (Math.abs(as[i].bottom - as[1].bottom) > 0.006) bad.push(`${sp}_${i} baseline ${as[i].bottom.toFixed(3)} vs ${as[1].bottom.toFixed(3)}`); }
  }
  assert.deepEqual(bad, []);
});

// KD-4b (was todo until the original sheets arrived): the figures are no longer cut off at any edge.
test('KD-4b: no picture is cut off at any of its four edges (a transparent margin surrounds every figure)', async () => {
  const cut = [];
  for (const n of NAMES) { const a = await run(`paremon_monsters2/${n}.png`); const e = [['L', a.cutL], ['R', a.cutR], ['T', a.cutT], ['B', a.cutB]].filter(([, v]) => v > 0).map(([k, v]) => `${k}${v}px`).join(','); if (e) cut.push(`${n}(${e})`); }
  assert.deepEqual(cut, []);
});

test('logo: only the coloured mark + "パレモン(Palemon)" + pencil remain (caption, other-draft leftovers and stray lines removed)', async () => {
  const r = await page.evaluate(async u => {
    const i = new Image(); i.src = u; await i.decode(); const w = i.naturalWidth, h = i.naturalHeight, c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'); g.drawImage(i, 0, 0); const d = g.getImageData(0, 0, w, h).data;
    const px = (x, y) => [d[(y * w + x) * 4], d[(y * w + x) * 4 + 1], d[(y * w + x) * 4 + 2]];
    const nonwhite = (x, y) => Math.min(...px(x, y)) < 235;
    let black = 0, firstRow = -1, margin = { l: 0, r: 0, t: 0, b: 0 };
    for (let y = 0; y < Math.round(h * 0.2); y++) for (let x = 0; x < w; x++) { const [r, gg, b] = px(x, y); if (Math.max(r, gg, b) < 90 && Math.max(r, gg, b) - Math.min(r, gg, b) < 25) black++; }
    for (let y = 0; y < h; y++) { for (let x = 0; x < w; x++) if (nonwhite(x, y)) { firstRow = y; break; } if (firstRow >= 0) break; }
    const rowAny = y => { for (let x = 0; x < w; x++) if (nonwhite(x, y)) return true; return false; }, colAny = x => { for (let y = 0; y < h; y++) if (nonwhite(x, y)) return true; return false; };
    for (let k = 0; k < 8; k++) { if (!rowAny(k)) margin.t++; if (!rowAny(h - 1 - k)) margin.b++; if (!colAny(k)) margin.l++; if (!colAny(w - 1 - k)) margin.r++; }
    // connected pieces of non-white (joined across 2px): mark, pencil and the sub-title letters only; no flat stray lines
    const nw = new Uint8Array(w * h), dl = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (nonwhite(x, y)) { nw[y * w + x] = 1; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const yy = y + dy, xx = x + dx; if (yy >= 0 && yy < h && xx >= 0 && xx < w) dl[yy * w + xx] = 1; } }
    const lab = new Int32Array(w * h); let pieces = 0, strayLine = 0;
    for (let s0 = 0; s0 < w * h; s0++) if (dl[s0] && !lab[s0]) { const st = [s0]; lab[s0] = 1; let area = 0, x0 = w, x1 = 0, y0 = h, y1 = 0;
      while (st.length) { const p = st.pop(), px0 = p % w, py0 = (p / w) | 0; if (nw[p]) { area++; x0 = Math.min(x0, px0); x1 = Math.max(x1, px0); y0 = Math.min(y0, py0); y1 = Math.max(y1, py0); }
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const yy = py0 + dy, xx = px0 + dx; if (yy >= 0 && yy < h && xx >= 0 && xx < w) { const q = yy * w + xx; if (dl[q] && !lab[q]) { lab[q] = 1; st.push(q); } } } }
      if (area >= 15) { pieces++; if (x1 - x0 >= 20 && y1 - y0 <= 5) strayLine++; } }
    return { w, h, ratio: w / h, black, margin, strayLine, pieces, corners: [px(0, 0), px(w - 1, 0), px(0, h - 1), px(w - 1, h - 1)].map(p => Math.min(...p)) };
  }, url('paremon_logo_center_crop2.png'));
  assert.ok(r.black === 0, `black caption text remains near the top (${r.black}px)`);
  assert.deepEqual(r.margin, { l: 8, r: 8, t: 8, b: 8 }, 'clean white margin on all four sides');
  assert.equal(r.strayLine, 0, 'no leftover flat coloured lines');
  assert.ok(r.pieces >= 5 && r.pieces <= 9, `mark + pencil + sub-title letters only (${r.pieces} pieces)`);
  assert.ok(r.corners.every(v => v >= 250), 'white background');
  assert.ok(r.ratio > 1.35 && r.ratio < 1.7, `aspect ratio ${r.ratio.toFixed(2)} (caption rows are gone; mark + sub-title + pencil remain)`);
  assert.ok(r.w >= 380 && r.h >= 250, `logo resolution kept (${r.w}x${r.h})`);
});

test('the same logo audit flags the original (caption text and stray lines present)', async () => {
  const r = await page.evaluate(async u => {
    const i = new Image(); i.src = u; await i.decode(); const w = i.naturalWidth, h = i.naturalHeight, c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'); g.drawImage(i, 0, 0); const d = g.getImageData(0, 0, w, h).data; let black = 0;
    for (let y = 0; y < Math.round(h * 0.2); y++) for (let x = 0; x < w; x++) { const o = (y * w + x) * 4, mx = Math.max(d[o], d[o + 1], d[o + 2]), mn = Math.min(d[o], d[o + 1], d[o + 2]); if (mx < 90 && mx - mn < 25) black++; }
    return { black, ratio: w / h };
  }, url('assets/originals/paremon_logo_center_crop2.png'));
  assert.ok(r.black > 500, `original should contain the black caption (found ${r.black}px)`);
});

test('logo: every non-white pixel equals the pixel of the original logo sheet (nothing redrawn); the logo is complete (not cut at the left)', async () => {
  const audit = await (await fetch(url('assets/image-audit.json'))).json();
  const r = await page.evaluate(async ([base, info]) => {
    const load = async u => { const i = new Image(); i.src = u; await i.decode(); const c = document.createElement('canvas'); c.width = i.naturalWidth; c.height = i.naturalHeight; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(i, 0, 0); return { w: c.width, h: c.height, d: g.getImageData(0, 0, c.width, c.height).data }; };
    const sheet = await load(base + 'assets/sources/' + info.sheet), logo = await load(base + 'paremon_logo_center_crop2.png');
    const [bx, by] = info.box; let n = 0, eq = 0;
    for (let y = 0; y < logo.h; y++) for (let x = 0; x < logo.w; x++) { const i = (y * logo.w + x) * 4; if (Math.min(logo.d[i], logo.d[i + 1], logo.d[i + 2]) >= 250) continue; n++;
      const j = ((by + y - 8) * sheet.w + (bx + x - 8)) * 4; if (sheet.d[j] === logo.d[i] && sheet.d[j + 1] === logo.d[i + 1] && sheet.d[j + 2] === logo.d[i + 2]) eq++; }
    return { n, eq, size: [logo.w, logo.h] };
  }, [base, audit.logo]);
  assert.ok(r.n > 30000 && r.eq === r.n, `${r.eq}/${r.n} logo pixels equal the sheet`); assert.deepEqual(r.size, audit.logo.size);
});
