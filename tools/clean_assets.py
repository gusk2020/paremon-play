#!/usr/bin/env python3
"""Clean the hand-cropped monster pictures and the logo WITHOUT repainting anything.

Only pixels that belong to *other* things are removed (a neighbouring character's fragment, a sheet divider line, a stray
piece from the row above, the logo's caption text and the leftovers of other logo drafts). No pixel of the subject is
modified, moved, recoloured or invented. Originals are kept untouched in assets/originals/ and this script always reads from there.

Not fixable here (needs the original sheets, which are not in the repository): subjects whose right-hand side was cut off
by the original crop. That is reported by `tests/images.test.mjs` and docs/STATUS.md (KD-4).

Needs numpy + scipy + Pillow (development only; the game and CI do not need Python).
    python3 tools/clean_assets.py            # rewrite paremon_monsters2/ and paremon_logo_center_crop2.png
    python3 tools/clean_assets.py --report   # also write assets/image-audit.json
"""
import json, sys, glob, os
import numpy as np
from scipy import ndimage as ndi
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets', 'originals')
OPAQUE = 128      # alpha above this counts as drawing
PAD = 2           # transparent margin kept around the subject


def runs(mask):
    out, s = [], None
    for i, v in enumerate(mask):
        if v and s is None: s = i
        if not v and s is not None: out.append((s, i - 1)); s = None
    if s is not None: out.append((s, len(mask) - 1))
    return out


def clean_monster(img):
    a = np.array(img.convert('RGBA'))
    h, w = a.shape[:2]
    op = a[..., 3] > OPAQUE
    log = []
    keep = np.ones((h, w), bool)

    # 1) sheet divider: a (near) full-height, thin vertical line. Everything left of it is the previous cell.
    cols = op.sum(0)
    # a divider is thin and isolated: nothing (or almost nothing) directly to its right, unlike e.g. a staff inside a drawing
    full = [x for x in range(w - 4) if cols[x] >= 0.9 * h and cols[x + 2] < 0.2 * h and cols[x + 4] < 0.2 * h and cols[x + 1] < 0.2 * h]
    if full:
        d = max(full)
        keep[:, :d + 2] = False
        log.append(f'divider at x={d}: removed everything left of it')

    # 2) neighbours at the sides: split at separator columns (almost empty valleys). The largest piece is the subject;
    #    pieces that touch the left/right image edge on the far side of a valley are neighbours.
    live = op & keep
    cols = live.sum(0)
    thr = max(14, round(0.07 * h))
    sep = cols <= thr
    sep[:2] = False; sep[-2:] = False
    seg_runs = runs(~sep)
    segs = [(s, e, int(live[:, s:e + 1].sum())) for s, e in seg_runs if live[:, s:e + 1].sum() > 400]
    if len(segs) > 1:
        main = max(segs, key=lambda t: t[2])
        second = sorted(segs, key=lambda t: -t[2])[1]
        log.append(f'segments {segs} main={main[:2]}')
        if main[2] < 1.1 * second[2]:
            log.append('WARNING: subject not clearly larger than its neighbour; needs a manual look')
        for s, e, m in segs:
            if (s, e) == main[:2]: continue
            if e < main[0] and s <= 2:           # left neighbour touching the left edge
                keep[:, :e + 1] = False; log.append(f'removed left neighbour x<={e} ({m}px)')
            elif s > main[1] and e >= w - 3:    # right neighbour touching the right edge
                keep[:, s:] = False; log.append(f'removed right neighbour x>={s} ({m}px)')
    # everything that is only a thin valley remnant next to a removed neighbour is cut at the valley itself
    live = op & keep

    # 3) stray pieces that touch the top/bottom edge and are not part of the subject (cells above/below on the sheet)
    lab, n = ndi.label(ndi.binary_dilation(live, iterations=3), structure=np.ones((3, 3)))
    sizes = [(int((live & (lab == i)).sum()), i) for i in range(1, n + 1)]
    if sizes:
        big = max(sizes)[1]
        for s, i in sizes:
            if i == big or s < 1: continue
            m = live & (lab == i)
            ys, xs = np.where(m)
            if (ys.min() == 0 or ys.max() == h - 1) and s < 0.08 * max(sizes)[0]:
                keep[m] = False; log.append(f'removed stray piece at edge ({s}px) x={xs.min()}..{xs.max()} y={ys.min()}..{ys.max()}')

    # remove only what was marked, everything else is copied bit for bit (including soft edge pixels)
    out = a.copy()
    out[~keep] = (0, 0, 0, 0)
    # drop orphan pieces that lie wholly to the left or right of the subject's own extent (what is left of a neighbour's tip
    # in the valley it was split at). Pieces inside the subject's extent (flame sparks, droplets, inner details) are kept.
    sub = (out[..., 3] > OPAQUE)
    lab, n = ndi.label(ndi.binary_dilation(sub, iterations=3), structure=np.ones((3, 3)))
    if n:
        sizes = ndi.sum(sub, lab, range(1, n + 1))
        mi = int(np.argmax(sizes)) + 1
        mx = np.where((lab == mi) & sub)[1]
        for i in range(1, n + 1):
            if i == mi: continue
            xs = np.where((lab == i) & sub)[1]
            if len(xs) and (xs.max() < mx.min() or xs.min() > mx.max()):
                out[(lab == i)] = (0, 0, 0, 0); log.append(f'removed orphan piece outside the subject ({len(xs)}px) x={xs.min()}..{xs.max()}')
            elif len(xs) and sizes[i - 1] < 60:
                out[(lab == i)] = (0, 0, 0, 0)
    ys, xs = np.where(out[..., 3] > 0)
    y0, y1, x0, x1 = max(0, ys.min() - PAD), min(h, ys.max() + 1 + PAD), max(0, xs.min() - PAD), min(w, xs.max() + 1 + PAD)
    cropped = out[y0:y1, x0:x1]
    # keep a transparent margin where the subject does not touch the original border
    canvas = np.zeros((cropped.shape[0] + 2 * PAD, cropped.shape[1] + 2 * PAD, 4), np.uint8)
    canvas[PAD:-PAD, PAD:-PAD] = cropped
    return Image.fromarray(canvas), log


# Logo: keep the coloured "パレットモンスター" mark, its sub-title "パレモン(Palemon)" and the pencil; remove the caption
# lines above it (a description of the draft, not part of the logo), the leftovers of neighbouring drafts and stray lines.
LOGO_BOX = (34, 90, 430, 356)   # left, top, right, bottom of the region that holds only the logo (original pixel coordinates)


def clean_logo(img):
    a = np.array(img.convert('RGB'))
    nw = a.astype(int).min(2) < 235
    lab, n = ndi.label(ndi.binary_dilation(nw, iterations=2), structure=np.ones((3, 3)))
    x0, y0, x1, y1 = LOGO_BOX
    keep = np.zeros(nw.shape, bool)
    log = []
    for i in range(1, n + 1):
        m = (lab == i) & nw
        s = int(m.sum())
        if s < 15: continue
        ys, xs = np.where(m)
        inside = xs.min() >= x0 - 4 and ys.min() >= y0 and xs.max() < x1 and ys.max() < y1
        # a component is kept when its core lies in the logo box; stray comps hug the left edge or the top caption area
        if ys.min() >= y0 and xs.max() >= x0 and (xs.min() >= x0 - 4 or s > 20000):
            keep |= ndi.binary_dilation(m, iterations=3)
            log.append(f'kept component {i}: {s}px bbox=({xs.min()},{ys.min()})-({xs.max()},{ys.max()})')
        else:
            log.append(f'removed component {i}: {s}px bbox=({xs.min()},{ys.min()})-({xs.max()},{ys.max()})')
    out = np.full_like(a, 255)
    keep[:, :x0] = False; keep[:y0, :] = False                    # nothing left of / above the logo box
    out[keep] = a[keep]
    margin = 8
    crop = out[y0:y1, x0:x1 + 4]
    ys, xs = np.where(crop.astype(int).min(2) < 250)
    crop = crop[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    canvas = np.pad(crop, ((margin, margin), (margin, margin), (0, 0)), constant_values=255)   # always a clean white margin
    return Image.fromarray(canvas), log


def main():
    report = {}
    for f in sorted(glob.glob(os.path.join(SRC, 'paremon_monsters2', '*.png'))):
        name = os.path.basename(f)
        img = Image.open(f)
        out, log = clean_monster(img)
        out.save(os.path.join(ROOT, 'paremon_monsters2', name), optimize=True)
        report[name] = {'before': img.size, 'after': out.size, 'log': log}
    logo, log = clean_logo(Image.open(os.path.join(SRC, 'paremon_logo_center_crop2.png')))
    logo.save(os.path.join(ROOT, 'paremon_logo_center_crop2.png'), optimize=True)
    report['paremon_logo_center_crop2.png'] = {'before': Image.open(os.path.join(SRC, 'paremon_logo_center_crop2.png')).size, 'after': logo.size, 'log': log}
    if '--report' in sys.argv:
        with open(os.path.join(ROOT, 'assets', 'image-audit.json'), 'w', encoding='utf-8') as fh:
            json.dump(report, fh, ensure_ascii=False, indent=1, default=int)
    for k, v in report.items():
        print(k, v['before'], '->', v['after'])
        for l in v['log']: print('   ', l)


if __name__ == '__main__':
    main()
