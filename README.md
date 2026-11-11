# 気温減率チェッカー

パラグライダー／ハンググライダーのサーマルソアリング向けに、足尾山エリアの気温減率（℃/100m）・サーマル到達高度・雲底を7日分表示する静的サイト。
ブラウザが [Open-Meteo](https://open-meteo.com/) から予報を直接取得し、その場で計算する（サーバー不要）。

- 1〜3日目: JMA MSM の気圧面から、毎時・高度別の減率と到達高度
- 4〜7日目: GSM・ECMWF・GFS の到達高度の傾向とモデル間のばらつき

## 開発

Node.js 24 以上（CI は `.node-version` の 26）と pnpm（`packageManager` で固定）を使う。

```bash
pnpm install
pnpm dev        # 開発サーバー
pnpm verify     # lint → 型チェック → テスト → ビルド
```

| コマンド         | 内容                               |
| ---------------- | ---------------------------------- |
| `pnpm dev`       | Vite の開発サーバー                |
| `pnpm build`     | `dist/` に公開用ファイルを出力     |
| `pnpm test`      | Vitest                             |
| `pnpm typecheck` | `tsc --noEmit`（TypeScript 7）     |
| `pnpm check`     | Biome で整形・lint（自動修正あり） |
| `pnpm lint`      | Biome の検査のみ（CI 用）          |

## 公開

`main` への push で CI（`.github/workflows/ci.yml`）が lint・型チェック・テスト・ビルドを行い、成功したビルドをそのまま GitHub Pages に公開する。

## データ

気象データ: [Open-Meteo](https://open-meteo.com/)（CC BY 4.0）。無料 API は非商用利用に限る。
