#!/usr/bin/env bash
# Build the private playtest ZIP: index.html + logo + 35 monster pictures + 9 card illustrations + PLAYTEST.txt, nothing else, no parent folder.
#   tools/build_playtest.sh <full-sha> <output-dir> [pr-url]
set -euo pipefail
SHA="${1:?full commit sha}"; OUT="${2:?output dir}"; PR="${3:-https://github.com/gusk2020/paremon-play/pull/1}"
SHORT="${SHA:0:7}"; ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAGE="$(mktemp -d)"; trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$OUT" "$STAGE/paremon_monsters2" "$STAGE/paremon_cards"
OUT="$(cd "$OUT" && pwd)"   # absolute: the zip is created from inside the staging folder, so a relative path (CI passes "dist") would break
cp "$ROOT/paremon_crossplatform_v17.html" "$STAGE/index.html"
cp "$ROOT/paremon_logo_center_crop2.png" "$STAGE/"
cp "$ROOT"/paremon_monsters2/*.png "$STAGE/paremon_monsters2/"
cp "$ROOT"/paremon_cards/*.png "$STAGE/paremon_cards/"
cat > "$STAGE/PLAYTEST.txt" <<EOF
パレモン 試遊版（非公開）  commit ${SHA}
PR: ${PR}
ゲーム本体: paremon_crossplatform_v17.html の複製（index.html）。外部サーバー・通信は不要です。

遊び方
 1. ZIPを「すべて展開」する（ZIPの中で直接開かない。index.html と paremon_monsters2・paremon_cards フォルダ、
    paremon_logo_center_crop2.png が同じ場所に並んでいる必要があります）
 2. 展開した index.html を Chrome で開く
 3. オフラインでそのまま遊べます

注意（未確認）
 - Android では、ファイルアプリ経由（content:// の URL）で開くと、画像が相対パスのため【表示されません】
   （Pixel 7a で実際に確認された不具合）。Android では、この複数ファイル版ではなく、画像を内蔵した
   「単体HTML版」（成果物 paremon-playtest-standalone-<SHA>、HTML 1個）を使ってください。
 - この試遊版は PC の Chromium での自動テストのみ確認済みです。Pixel 7a 実機は未確認です。
 - 非公開の試作です。再配布・公開はしないでください。
EOF
ZIP="$OUT/paremon-playtest-${SHORT}.zip"; rm -f "$ZIP"
( cd "$STAGE" && zip -X -q -r "$ZIP" index.html PLAYTEST.txt paremon_logo_center_crop2.png paremon_monsters2 paremon_cards )
echo "$ZIP"
