// node tools/balance_report.mjs [games-per-mode]   -> prints the 2/3/4-knockout comparison table (needs playwright + chromium, like the tests)
import { launch, openGame } from '../tests/helpers.mjs';
import { SIM_SRC, measure, markdownTable } from '../tests/sim.mjs';
const n = +process.argv[2] || 1000, b = await launch(), { page } = await openGame(b, { seed: 1 });
await page.evaluate(SIM_SRC); const m = await measure(page, [2, 3, 4], n);
console.log(`同一条件：両者とも同じAI、先攻はプレイヤー側、${n}試合×3条件、シード10000〜${9999 + n}（3条件で同じ初期山札）\n`); console.log(markdownTable(m));
for (const t of [2, 3, 4]) { const w = m[t].raw.reduce((a, r) => (a[r.winner] = (a[r.winner] || 0) + 1, a), {}); console.log(`${t}体戦 勝者内訳`, JSON.stringify(w), '終局理由', JSON.stringify(m[t].raw.reduce((a, r) => (a[r.reason] = (a[r.reason] || 0) + 1, a), {}))); }
await b.close();
