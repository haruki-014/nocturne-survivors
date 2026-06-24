# Nocturne Survivors ― 血月の夜想曲

Vampire Survivors ライクなローグライク・サバイバー。
**Tauri v2 + React 18 + TypeScript** 製。ゲーム本体は React 非依存の純 TypeScript エンジン(Canvas 2D)で、React はその上のオーバーレイ UI に徹します。

血月が沈むまでの **15 分** を生き延びるか、12 分に現れる **夜の主**（緋き伯爵ヴァルナハトら五体のいずれかが選ばれ、それぞれ分身・召喚・瘴気・視界制限・鼓舞などの固有能力を持つ）を討てば勝利です。

## 動かし方

前提: Node.js 18+、Rust(stable)、および [Tauri v2 の各 OS 前提条件](https://v2.tauri.app/start/prerequisites/)。

```bash
npm install

# デスクトップアプリとして起動(推奨)
npm run tauri dev

# ブラウザだけで動作確認したい場合
npm run dev
```

### リリースビルド

アイコン一式（`src-tauri/icons/`）は **同梱済み** なので、追加生成なしでそのままビルドできます:

```bash
npm run tauri build
```

アイコンを差し替えたい場合は、次のいずれか:

```bash
# A) 同梱の生成スクリプトで作り直す(元絵は src-tauri/icons/icon.svg)
node src-tauri/icons/gen-icons.cjs

# B) tauri 公式コマンドで任意の 1024x1024 PNG から生成する
# ↓ "path/to/icon.png" は実在する PNG の実パスに置き換えること(プレースホルダのまま実行しない)
npm run tauri icon ./my-icon.png
```

## 操作

| 入力 | 動作 |
| --- | --- |
| `W A S D` / 矢印キー | 移動(攻撃は全自動) |
| `Space` / `Shift` | ローリング回避(スタミナ消費・動作中は無敵) |
| `1` `2` `3` | レベルアップ時のアルカナカード選択 |
| `Esc` / `P` | ポーズ(設定・ビルド確認) |

## ゲーム内容

- **武器 6 種**(各 Lv.8 / 最大 6 スロット): 魔弾の書、銀のナイフ、聖鎖の宝珠、忌避の薫香、裁きの雷、戦斧・断罪
- **真化(進化)8 種** ＋ **専用技(秘伝)8 種**(特定の装いでのみ修得できる武器)
- **加護(パッシブ)8 種**(最大 6 スロット): 移動速度 / 最大HP / 威力 / 攻撃間隔 / 効果範囲 / 回収範囲 / 自動回復 / 投射数+1
- **通常敵 6 種**(蝙蝠・屍鬼・骸骨兵・怨霊・巨躯・夜術師) ＋ **変種**(大型/色違い) ＋ 定刻の **エリート**(宝を落とす) ＋ **固有能力を持つ夜の主(ボス)5 体**
- **ローリング回避**(スタミナ)で呪弾や突進をかわす
- レベルアップごとにタロット風 **アルカナカード** から 1 枚を選択
- **遺物**(全10種)を集めてホームの **飾り棚** に飾る・**装い(スキン)** と **祭壇の恒久強化** で次の夜に備える

## 柔軟な UI

- HUD スケール(0.8〜1.4)をポーズメニューのスライダーで変更(CSS 変数 `--hud-scale` 連動)
- ダメージ数字 / 画面シェイクの ON・OFF
- 設定は `localStorage` に保存され、次回起動時も維持
- ウィンドウリサイズ・高 DPI(devicePixelRatio)対応のレスポンシブ Canvas
- カード選択はキーボード(1–3)・マウス両対応、`prefers-reduced-motion` 尊重

## 構成

```
src/
 main.tsx エントリ
 App.tsx 画面状態機械 + Engine のライフサイクル管理
 styles.css デザイントークン / HUD / アルカナカード
 ui/ React オーバーレイ(Title / HUD / LevelUp / Pause / End)
 game/
 types.ts エンジン⇔UI の唯一の契約(共有型)
 data.ts 武器・加護・敵・ウェーブ定義
 engine.ts ゲームループ / 空間ハッシュ / スポーン / レベルアップ
 render.ts Canvas 描画(スプライトキャッシュ / 地形装飾 / 演出)
src-tauri/ Tauri v2 シェル(Rust)
```

UI → エンジンは `start()` / `setPaused()` / `applyChoice()` の 3 つだけ。
エンジン → UI は `EngineEvent`(`hud` 約8Hz / `levelup` / `gameover` / `victory`)のコールバック 1 本。この境界が `src/game/types.ts` に集約されています。

## スキルツリー（真化＋流派）

武器を最大Lvまで育て、対の加護を所持していると **真化（EVOLUTION）** カードが出現し、武器が強大な姿へ変わる（魔弾の書・裁きの雷は加護によって分岐）。
さらに全装備は 4 つの **流派**（鋼・霊・月・血）のいずれかに属し、同流派を 3／5 個集めると **紋章（セットボーナス）** が灯る。発現状況はポーズの「紋章」とHUD右上で確認できる。

- 遊び方の詳細は [GAME_GUIDE.md](./GAME_GUIDE.md)
- 設計・実装の解説は [ARCHITECTURE.md](./ARCHITECTURE.md)
- スキルツリー多様性の検証：`node tools/skilltree-sim.mjs`（48,000ランのモンテカルロ比較）

## 記録の間（メタプロゲッション）

ホーム画面の「記録の間」から、ラン後も楽しめるコレクションにアクセスできる。累計記録・最高記録、敵図鑑、武具と **真化レシピのコレクション（全8種）**、12 種の称号を収録。進捗は `localStorage` に自動保存される。実装の詳細は [ARCHITECTURE.md](./ARCHITECTURE.md) の「メタプロゲッション」を参照。
