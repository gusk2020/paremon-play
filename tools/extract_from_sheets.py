#!/usr/bin/env python3
"""Re-extract the 35 monster pictures and the logo from the ORIGINAL source sheets in assets/sources/.

Nothing is repainted. A picture is a crop of the sheet; the only pixel work is background removal:
  * near-white background (and the faint chequerboard of the skeleton sheet) becomes transparent,
  * a 2px edge band is "un-matted" from white so there is no white fringe (alpha = 1 - min(R,G,B)/255, colour recovered),
  * everything else is copied bit for bit (the tests verify this against the sheet using assets/image-audit.json).
Sheet layout (all five): left = colourless line art, right = 2 rows x 3 columns = 赤 橙 黄 / 緑 青 紫, a thin divider line between.
Output names: paremon_monsters2/<species>_<0..6>.png  (_0 colourless, _1 赤 _2 橙 _3 黄 _4 緑 _5 青 _6 紫).
All seven pictures of a species share one canvas aspect and the same baseline/centre, so switching colour never makes the
figure jump or change size in the game. The skeleton squad (4 skeletons) is ONE figure.

Needs numpy + scipy + Pillow (development only; the game and CI do not need Python).
    python3 tools/extract_from_sheets.py [--report]
"""
import glob, json, os, sys
import numpy as np
from scipy import ndimage as ndi
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets', 'sources')
OUT = os.path.join(ROOT, 'paremon_monsters2')
SHEETS = {'centipede': 'worm_A.png', 'knight': 'armor_A.png', 'golem': 'golem_A.png', 'skeleton': 'skeletons_A.png', 'dragon': 'dragon_A.png'}
WHITE = 232        # min(R,G,B) >= WHITE counts as background paper (the chequerboard squares are 244..253)
HOLE = 150         # enclosed paper patches at least this big (px) in a COLOUR figure are see-through gaps, smaller ones are eyes/teeth/highlights
BAND = 2           # px edge band that is un-matted
PAD = 6            # transparent margin around the figure in the colour canvases (px, native scale)


def paper_mask(rgb, colourless_cell):
    """True where the sheet shows empty paper."""
    mn = rgb.min(2)
    white = mn >= WHITE
    lab, n = ndi.label(white)
    border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    paper = np.isin(lab, list(border))
    sizes = ndi.sum(white, lab, range(1, n + 1))
    for i in range(1, n + 1):
        if i in border: continue
        # colourless line art: its whole white inside is paper (the old pictures were see-through there too);
        # colour figures: only sizeable enclosed patches are gaps between limbs / loops
        if colourless_cell(lab, i) or sizes[i - 1] >= HOLE:
            paper |= (lab == i)
    return paper


def split_regions(fg):
    """x where the colourless cell ends and the colour grid begins: the widest empty column run in the middle third."""
    h, w = fg.shape
    cols = fg.sum(0)
    lo, hi = int(w * 0.3), int(w * 0.65)
    best, run_s = (0, 0, 0), None
    for x in range(lo, hi + 1):
        e = cols[x] == 0
        if e and run_s is None: run_s = x
        if (not e or x == hi) and run_s is not None:
            if x - run_s > best[0]: best = (x - run_s, run_s, x - 1)
            run_s = None
    return (best[1] + best[2]) // 2


def cell_labels(fg, split):
    """label image: 0 none, 1 = colourless cell, 2..7 = 赤 橙 黄 緑 青 紫 (nearest of six seed figures, so thin contacts such as
    a bow tip touching a neighbour's spear tip are split where the figures are thinnest)."""
    h, w = fg.shape
    lab = np.zeros((h, w), np.int32)
    left = fg.copy(); left[:, split:] = False
    lab[left] = 1
    right = fg.copy(); right[:, :split] = False
    seeds = None
    for k in range(0, 12):
        m = ndi.binary_erosion(right, iterations=k) if k else right
        l2, n2 = ndi.label(m, structure=np.ones((3, 3)))
        sizes = ndi.sum(m, l2, range(1, n2 + 1))
        big = [i + 1 for i, s in enumerate(sizes) if s >= 4000]
        if len(big) >= 6:
            top = sorted(big, key=lambda i: -sizes[i - 1])[:6]
            if k and len(big) > 6 and sizes[sorted(big, key=lambda i: -sizes[i - 1])[6] - 1] > 0.4 * sizes[top[-1] - 1]:
                continue
            seeds = (l2, top); break
    if seeds is None: raise SystemExit('could not find six figures in the colour grid')
    l2, top = seeds
    cen = {i: ndi.center_of_mass(l2 == i) for i in top}
    order = sorted(top, key=lambda i: cen[i][0])
    rows = [sorted(order[:3], key=lambda i: cen[i][1]), sorted(order[3:], key=lambda i: cen[i][1])]
    ordered = rows[0] + rows[1]                     # 赤 橙 黄 緑 青 紫
    seedimg = np.zeros((h, w), np.int32)
    for idx, i in enumerate(ordered): seedimg[l2 == i] = idx + 2
    dist, (iy, ix) = ndi.distance_transform_edt(seedimg == 0, return_indices=True)
    nearest = seedimg[iy, ix]
    lab[right] = nearest[right]
    return lab


def matte(rgb, paper, fg_mask):
    """RGBA for the pixels in fg_mask (bool full image). Edge band un-matted from white, interior untouched."""
    h, w = paper.shape
    near_paper = ndi.binary_dilation(paper, iterations=BAND) & ~paper
    mn = rgb.min(2).astype(float)
    a = np.where(fg_mask, 255, 0).astype(float)
    colour = rgb.astype(float).copy()
    band = near_paper & fg_mask
    alpha = np.clip(1.0 - mn / 255.0, 0.0, 1.0)
    alpha = np.maximum(alpha, 0.04)
    a[band] = alpha[band] * 255
    for c in range(3):
        ch = colour[..., c]
        ch[band] = np.clip((rgb[..., c][band] - 255.0 * (1 - alpha[band])) / alpha[band], 0, 255)
    out = np.dstack([np.clip(colour, 0, 255), a]).round().astype(np.uint8)
    out[~fg_mask] = 0
    return out


def bbox(mask):
    ys, xs = np.where(mask)
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def paste(canvas_w, canvas_h, piece, cx, bottom):
    """put `piece` (RGBA) on a transparent canvas with its horizontal centre at cx and its bottom at `bottom`."""
    canvas = np.zeros((canvas_h, canvas_w, 4), np.uint8)
    ph, pw = piece.shape[:2]
    x0 = int(round(cx - pw / 2)); y0 = int(bottom - ph)
    assert x0 >= 0 and y0 >= 0 and x0 + pw <= canvas_w and y0 + ph <= canvas_h, (x0, y0, pw, ph, canvas_w, canvas_h)
    canvas[y0:y0 + ph, x0:x0 + pw] = piece
    return canvas, (x0, y0)


def process_sheet(species, fname, report):
    img = Image.open(os.path.join(SRC, fname)).convert('RGB')
    rgb = np.array(img)
    H, W = rgb.shape[:2]
    # 1) paper vs figure; the colourless cell is whatever lies left of the colour grid, so find the split on a first rough mask
    rough = ~paper_mask(rgb, lambda lab, i: False)
    # the thin divider line (tall, only a few px wide) is not part of any figure
    lab, n = ndi.label(rough, structure=np.ones((3, 3)))
    for i in range(1, n + 1):
        ys, xs = np.where(lab == i)
        if (xs.max() - xs.min()) <= 6 and (ys.max() - ys.min()) >= 0.85 * H:
            rough[lab == i] = False
    split = split_regions(rough)
    xs_all = np.arange(W)[None, :].repeat(H, 0)
    paper = paper_mask(rgb, lambda lab, i: ndi.center_of_mass(lab == i)[1] < split)
    fg = ~paper
    lab, n = ndi.label(fg, structure=np.ones((3, 3)))
    for i in range(1, n + 1):                      # divider line again on the final mask
        ys, xs = np.where(lab == i)
        if (xs.max() - xs.min()) <= 6 and (ys.max() - ys.min()) >= 0.85 * H:
            fg[lab == i] = False
    paper = ~fg
    cells = cell_labels(fg, split)
    # specks (< 25px) far from any figure are dust, drop them
    info = {'sheet': fname, 'sheet_size': [W, H], 'split_x': int(split), 'pictures': {}}
    figs = {}
    for k in range(1, 8):
        m = cells == k
        # keep the figure's own detached bits (sparks, flames) but drop isolated dust
        l, nn = ndi.label(m, structure=np.ones((3, 3)))
        if nn:
            sz = ndi.sum(m, l, range(1, nn + 1)); main = int(np.argmax(sz)) + 1
            keep = np.zeros_like(m)
            md = ndi.distance_transform_edt(l != main)
            for i in range(1, nn + 1):
                if i == main or sz[i - 1] >= 25 or md[l == i].min() < 40: keep |= (l == i)
            keep |= (l == main); m = keep
        figs[k] = m
    boxes = {k: bbox(figs[k]) for k in figs}
    # edge-of-sheet check: nothing may be cut by the sheet border
    for k, (x0, y0, x1, y1) in boxes.items():
        assert x0 > 0 and y0 > 0 and x1 < W and y1 < H, f'{species} cell {k} touches the sheet border {boxes[k]}'
    mattes = {k: matte(rgb, paper, figs[k])[boxes[k][1]:boxes[k][3], boxes[k][0]:boxes[k][2]] for k in figs}
    # 2) common canvases. Colour pictures: native size, union of the six figures. Colourless: same aspect and proportions.
    cw = max(boxes[k][2] - boxes[k][0] for k in range(2, 8)); ch = max(boxes[k][3] - boxes[k][1] for k in range(2, 8))
    hc = np.median([boxes[k][3] - boxes[k][1] for k in range(2, 8)])
    w0, h0 = boxes[1][2] - boxes[1][0], boxes[1][3] - boxes[1][1]
    s0 = hc / h0                                     # colourless figure is s0 times as large on the sheet's colour scale
    cw = max(cw, int(np.ceil(w0 * s0))); ch = max(ch, int(np.ceil(h0 * s0)))   # the colourless figure must fit with the same margin
    canvas_w, canvas_h = cw + 2 * PAD, ch + 2 * PAD
    c0w, c0h = int(round(canvas_w / s0)), int(round(canvas_h / s0))
    assert w0 + 2 * PAD / s0 - 1 <= c0w and h0 + 2 * PAD / s0 - 1 <= c0h, (species, w0, h0, c0w, c0h)
    res = {}
    for k in range(1, 8):
        piece = mattes[k]
        if k == 1:
            cvs, off = paste(c0w, c0h, piece, c0w / 2, c0h - PAD / s0)
        else:
            cvs, off = paste(canvas_w, canvas_h, piece, canvas_w / 2, canvas_h - PAD)
        name = f'{species}_{k - 1}.png'
        res[name] = cvs
        x0, y0 = boxes[k][0], boxes[k][1]
        info['pictures'][name] = {'size': [cvs.shape[1], cvs.shape[0]], 'sheet_box': list(boxes[k]), 'paste_offset': list(map(int, off)),
                                  'scale': 1.0, 'area_px': int(figs[k].sum())}
    return res, info


def logo(report):
    """Centre logo of logo_5_drafts.png: the coloured mark, its sub-title and the pencil. The caption above it
    ("小中学生向け…") and the small English line under it are not part of the logo; neighbouring drafts are other figures."""
    sheet = np.array(Image.open(os.path.join(SRC, 'logo_5_drafts.png')).convert('RGB'))
    H, W = sheet.shape[:2]
    nw = sheet.astype(int).min(2) < 235
    lab, n = ndi.label(ndi.binary_dilation(nw, iterations=2), structure=np.ones((3, 3)))
    # the central draft occupies this region of the sheet; its caption sits above y=190 and the English line below y=452
    X0, X1, Y0, Y1 = 534, 935, 190, 452
    keep = np.zeros(nw.shape, bool); log = []
    for i in range(1, n + 1):
        m = (lab == i) & nw
        if m.sum() < 15: continue
        ys, xs = np.where(m)
        if xs.min() >= X0 - 2 and xs.max() < X1 and ys.min() >= Y0 and ys.max() < Y1:
            keep |= ndi.binary_dilation(m, iterations=3); log.append([int(m.sum()), int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())])
    out = np.full_like(sheet, 255); out[keep] = sheet[keep]
    ys, xs = np.where(out.astype(int).min(2) < 250)
    box = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
    crop = out[box[1]:box[3], box[0]:box[2]]
    canvas = np.pad(crop, ((8, 8), (8, 8), (0, 0)), constant_values=255)
    return Image.fromarray(canvas), {'sheet': 'logo_5_drafts.png', 'box': list(box), 'kept_components': log, 'size': [canvas.shape[1], canvas.shape[0]]}


def main():
    report = {'monsters': {}, 'logo': None}
    for species, fname in SHEETS.items():
        res, info = process_sheet(species, fname, report)
        for name, arr in res.items():
            Image.fromarray(arr, 'RGBA').save(os.path.join(OUT, name), optimize=True)
        report['monsters'][species] = info
        print(species, info['sheet_size'], 'split', info['split_x'], {k: v['size'] for k, v in info['pictures'].items()})
    img, info = logo(report)
    img.save(os.path.join(ROOT, 'paremon_logo_center_crop2.png'), optimize=True)
    report['logo'] = info
    print('logo', info['size'], info['box'])
    if '--report' in sys.argv:
        with open(os.path.join(ROOT, 'assets', 'image-audit.json'), 'w', encoding='utf-8') as fh:
            json.dump(report, fh, ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
