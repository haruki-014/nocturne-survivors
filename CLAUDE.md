# CLAUDE.md

このファイルは、Claude Code（および後続のAIエージェント）がこのリポジトリで作業するための手引きです。
人間向けの遊び方は [GAME_GUIDE.md](./GAME_GUIDE.md)、設計の深掘りは [ARCHITECTURE.md](./ARCHITECTURE.md)、
ファイルの地図は [CODE_MAP.md](./CODE_MAP.md) を参照してください。

## プロジェクト概要

**Nocturne Survivors（血月の夜想曲）** ― Vampire Survivors ライクなローグライク・サバイバー。
**Tauri v2 + React 18 + TypeScript** 製。ゲーム本体は React 非依存の純 TypeScript エンジン（Canvas 2D）で、
React はその上に被さるオーバーレイ UI に徹する。Tauri は Web をデスクトップアプリとして配るための薄い殻。

## コマンド

```bash
npm install            # 依存の取得
npm run dev            # ブラウザ用 dev サーバ（vite。ポートは 1420 固定 = strictPort）
npm run build          # tsc(型検査) → vite build。CI 相当の最終確認はこれ
npm run tauri dev      # デスクトップアプリとして起動
npm run tauri build    # 配布用ビルド（アイコンは同梱済み）
node tools/skilltree-sim.mjs  # スキルツリー多様性のモンテカルロ回帰チェック
```

変更後は最低限 `npm run build`（= `tsc && vite build`）を通すこと。`tsc` は strict。

## アーキテクチャの境界（まずここだけ覚える）

```
Engine（純TS / Canvas2D）        React（オーバーレイUI）
  start/setPaused/applyChoice/setMeta  ──▶  エンジンへの入口
  emit({type})  ◀──  "hud"/"levelup"/"gameover"/"victory"/"curio"
```

- **UI → エンジン**：`start()` / `setPaused()` / `applyChoice()` / `setMeta()` の4つだけ。
- **エンジン → UI**：`emit(EngineEvent)` の1本だけ。
- この契約はすべて [`src/game/types.ts`](src/game/types.ts) の共有型に集約。**UIとエンジンは型でのみ握手する。**
- **エンジンは DOM / localStorage に触れない**。永続化は [`src/meta/profile.ts`](src/meta/profile.ts) が担う。

## 中核ファイル（`src/game/`）

| ファイル | 役割 | 「ここを変える」の目安 |
|---|---|---|
| [`types.ts`](src/game/types.ts) | エンジン⇔UI の唯一の契約（型のみ） | 受け渡すデータ構造を増減するとき |
| [`data.ts`](src/game/data.ts) | 武器・真化・専用技・パッシブ・流派・敵・**ボス**・ウェーブ・モード・スキン・遺物の**数値とテーブル** | **バランス調整・コンテンツ追加はほぼここだけ** |
| [`engine.ts`](src/game/engine.ts) | ゲームループ／空間ハッシュ／発射／敵・ボス挙動／派生ステータス／カード生成 | 新しい**挙動**が要るとき |
| [`render.ts`](src/game/render.ts) | `World` を読んで Canvas2D に1フレーム描く（状態は読むだけ） | 見た目・演出・色 |

UI は [`src/App.tsx`](src/App.tsx)（司令塔）と [`src/ui/`](src/ui)（各画面）。メタ進行は [`src/meta/`](src/meta)。

## よくある変更レシピ

- **数値バランス（威力・範囲・湧き・モード難易度）** → `data.ts` の該当テーブル / `statsFor(lv)`。エンジンは触らない。
- **武器の挙動の質感** → `engine.ts` の `fireXxx`（`fireLightning` の AoE 半径など）。
- **新しい武器・真化** → `data.ts` に `WeaponDef`（`behavior` は既存を再利用）＋必要なら `EVOLUTIONS` の枝。エンジン改修は基本不要。
- **新しいボス** → `data.ts` の `BOSSES` に1行（`ability` と一言の `trait` を含む）。新しい能力なら `engine.ts` の `updateBossAbility` に `case` を1つ。
- **新しい流派** → `SchoolId` ＋ `SCHOOLS` ＋ `schoolBonusText` ＋ `recomputeDerived` の加点。

## 規約・流儀

- 各ソースの先頭に `〔層〕…` のバナーコメント（CORE / AUXILIARY / OUTER の三層）。新規ファイルも倣う。
- **絵文字を使わない**。アイコンは `ui/icons.tsx` の単色ストロークのシジル（`<Sigil name=…/>`）か、`render.ts` の手続き的スプライト。
- 全 UI は `styles.css` 末尾の**リキッドグラス**トークン（`--glass-*`）で統一。`prefers-reduced-motion` を尊重。
- 真化形態は基底と同じ `behavior` を再利用し、強化した `statsFor` で別物の手応えを出す（エンジンに分岐を増やさない）。

## 検証の注意（Canvas ゲーム特有）

- 本体は Canvas 描画なので、アクセシビリティ・スナップショットは中身がほぼ空（タイトル/ポーズ/カード等の React UI だけ拾える）。**確認は基本スクリーンショット**。
- dev サーバは vite で**ポート 1420 固定**（`strictPort`）。プレビュー用の `.claude/launch.json` も 1420 / `autoPort:false` に合わせてある。
- タイトル画面はエンジンを背景描画に使うので、**起動してコンソールエラーが無ければエンジンの初期化は健全**という早い信号になる。
- ボスは標準で 12:00（720s）出現。挙動を素早く確認したいときは `MODES.standard.bossTime` を一時的に下げる等で前倒しし、**確認後は必ず元に戻す**。
- オフラインだと WebGL のヘッドレス検証が難しいため、描画は Canvas2D を既定で維持（[MIGRATION.md](./MIGRATION.md) 参照）。

## 操作（実装の事実）

- 移動：`W A S D` / 矢印キー（攻撃は全自動）。
- 回避：`Space` または `Shift`（ローリング。スタミナを消費し、動作中は無敵）。
- 奥義：`E`（討伐で血月ゲージが満ちた時。中身は最多流派で決まる。定義は `data.ts` の `ULTIMATES`）。
- カード選択：`1` `2` `3`（または `A`/`D`＋`Enter`）。
- ポーズ：`Esc` / `P`。
