# パレモン（パレットモンスター）

スマホ・PC向けの個人用カードバトル試作。色相環の相性とエネルギー管理で遊ぶ、AI（ランダムな対戦相手）との1対1。
現行版は **v0.17**（単体HTML、ビルド不要）。私用の試作で、公開・販売は想定していません。

## 遊ぶ・動かす
`paremon_crossplatform_v17.html` をブラウザで開くだけです（画像は同じフォルダの相対パス参照なので、
`paremon_monsters2/` と `paremon_logo_center_crop2.png` を同じ場所に置いてください）。
Pixel 7a 実機での動作は **未確認** です（下記テストはPCのChromiumによるエミュレーション）。

## 正本はこのリポジトリ
| 文書 | 内容 |
| --- | --- |
| [docs/SPEC.md](docs/SPEC.md) | 仕様。確定／実装・検証済み／確定だが未実装・未確認／保留 を区別 |
| [docs/DECISIONS.md](docs/DECISIONS.md) | 判断記録（なぜそうしたか、採否） |
| [docs/TESTING.md](docs/TESTING.md) | テストの内容・実行方法・限界 |
| [docs/STATUS.md](docs/STATUS.md) | 現状、既知の問題、次の作業、再開情報 |
| [docs/source/](docs/source/) | 移行元の元資料（原文のまま保全） |
| [assets/sources/](assets/sources/) | **元画像シート6枚**（5種のモンスターシート＋ロゴ5案）。画像はここから `python3 tools/extract_from_sheets.py` で再生成（削除しない） |
| [assets/originals/](assets/originals/) | 旧い手作業の切り抜き（比較用、削除しない） |
| [.claude/skills/game-development/SKILL.md](.claude/skills/game-development/SKILL.md) | ゲーム開発スキル v4.0（正本のコピー、無改変） |

## 試遊版（非公開）
PRのCIが、テスト成功後に試遊用の成果物を2種類作ります。
- **`paremon-playtest-standalone-<短いSHA>`（Android・Pixel 7a 用、推奨）**：ゲームと画像を内蔵したHTML 1個。ダウンロード→展開→そのHTMLをChromeで開くだけ。Androidの `content://` では複数ファイル版の画像が表示されないため（実機で確認済みの不具合）。
- `paremon-playtest-<短いSHA>`（PC向けの互換用）：`index.html`＋ロゴ＋画像35枚＋`PLAYTEST.txt`。Privateリポジトリ内、14日保存。PRの「Checks」→ CI → **Artifacts** から取得し、展開して `index.html` を Chrome で開きます（詳細は [docs/STATUS.md](docs/STATUS.md)）。公開や外部ホスティングはしていません。

## テスト
```
npm ci
npx playwright install chromium   # 初回のみ
npm test
```
CI（GitHub Actions）は PR ごとに同じテストを実行します。

## 運用ルール（要約）
- 役割：ChatGPT＝企画・仕様・監査／Claude＝実装・テスト・Draft PR／ユーザー＝試遊と重要判断。
- 作業は独立ブランチ＋Draft PR。main へのマージ・Ready化・公開は事前許可がある場合のみ。
- ロゴ・画像はAI生成素材を手作業で切り出したもので、品質と利用許諾は未監査（docs/STATUS.md 参照）。
