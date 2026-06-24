# コードマップ ── 機能の三層分類

このプロジェクトを「中心(ゲームそのもの)」から「外側(配布の器)」へ向かう
3つの層に分けて整理した地図です。各ソースファイルの先頭にも同じ
`〔層〕…` のバナーコメントを置いてあるので、ファイル単体を開いても
「これはどの層の、何をする部品か」が分かるようになっています。

```
        ┌──────────────────────────────────────────────┐
        │  第3層 より外円 / OUTER  … 配布と土台          │
        │   ┌────────────────────────────────────────┐  │
        │   │ 第2層 付属的 / AUXILIARY … 周辺の仕組み │  │
        │   │   ┌──────────────────────────────────┐ │  │
        │   │   │ 第1層 主要 / CORE … ゲーム本体    │ │  │
        │   │   │   types / data / engine / render  │ │  │
        │   │   └──────────────────────────────────┘ │  │
        │   │  App統合 / メタ進行 / 各画面UI          │  │
        │   └────────────────────────────────────────┘  │
        │  エントリ / ビルド設定 / Tauri(デスクトップ化) │
        └──────────────────────────────────────────────┘
```

---

## 第1層：主要な機能 / CORE（`src/game/`）

「ゲームそのもの」。これだけで遊びが成立する核。React も Tauri も知らない純粋な
TypeScript で、ブラウザでもデスクトップでも同じように動きます。

| ファイル | 役割（マクロ） | 挙動（ミクロ）の要点 |
|---|---|---|
| [`types.ts`](src/game/types.ts) | エンジンと UI が受け渡すデータの**型(契約)**を一元定義 | 実行コードは持たない注釈層。`World` が1ラン分の全状態を束ねる中心。 |
| [`data.ts`](src/game/data.ts) | 武器・真化・専用技・加護・流派・敵・**ボス(`BOSSES`＋`ability`)**・ウェーブ・モード・スキン・遺物の**数値とテーブル** | 大半は定数。`statsFor(lv)` がレベルごとの性能を計算して返す。**バランス調整はここだけ**で完結。 |
| [`engine.ts`](src/game/engine.ts) | プレイ中の全状態を持ち、毎フレーム世界を1コマ進める**心臓** | `requestAnimationFrame` で `loop()` を回し、`update()` が「入力→武器→弾→敵→経験値→演出→湧き→勝敗」を一定順で処理。ローリング回避・**ボス固有能力(`updateBossAbility`)** もここ。UI とは `start/setPaused/applyChoice/setMeta`(入口)と `emit`(出口)だけで繋がる。 |
| [`render.ts`](src/game/render.ts) | `World` を読んで Canvas2D に1フレーム描く**目** | スプライトを事前ラスタライズしてキャッシュ→`drawImage`。状態は読むだけ。`Renderer` インターフェースなので将来 WebGL へ差し替え可。 |

**この層の境界（ここだけ覚えれば全体が繋がる）**
- UI →エンジン：`start()` / `setPaused()` / `applyChoice()` / `setMeta()`
- エンジン→UI：`emit({type})` で `"hud"` / `"levelup"` / `"gameover"` / `"victory"`

---

## 第2層：付属的な機能 / AUXILIARY（`src/App.tsx`, `src/meta/`, `src/ui/`）

核を「遊びやすく・続けたく」する周辺の仕組み。画面遷移、ラン後の蓄積（やり込み）、
各画面の見せ方など。ゲーム計算そのものは持たず、**エンジンに指示を出し、結果を映す**役。

| ファイル | 役割 | 挙動の要点 |
|---|---|---|
| [`App.tsx`](src/App.tsx) | エンジンと全画面を束ねる**司令塔** | `screen` state で表示画面を切替。エンジンの `emit` を受けて記録保存(`recordRun`)・カード提示・HUD更新を行う。 |
| [`meta/profile.ts`](src/meta/profile.ts) | ランを越えて積む**永続データ**(記録/称号/魂/解放) | `localStorage` に保存。`recordRun()` がラン終了の集計(記録更新+魂付与+称号/装い解放)を一括処理。 |
| [`meta/altar.ts`](src/meta/altar.ts) | **恒久強化**の定義と効果計算 | `computeMetaBonus(profile)` が全強化を畳み込み `MetaBonus` を生成→`engine.setMeta()` へ。費用は等比で逓増。 |
| [`ui/LevelUpModal.tsx`](src/ui/LevelUpModal.tsx) | レベルアップの**カード選択** | A/D＋Enter のキー操作。選んだ1枚を `onPick` で返すだけ(候補生成はエンジン)。 |
| [`ui/HUD.tsx`](src/ui/HUD.tsx) | プレイ中の**計器表示** | `HudState` の数値を割合に直してバー化。`pointer-events:none` で入力を奪わない。 |
| [`ui/AltarScreen.tsx`](src/ui/AltarScreen.tsx) | 祭壇(強化購入・装い選択)の**店頭** | 購入/選択を親へ通知。判定・保存は持たない。 |
| [`ui/TitleScreen.tsx`](src/ui/TitleScreen.tsx) / [`ModeSelect.tsx`](src/ui/ModeSelect.tsx) / [`EndScreen.tsx`](src/ui/EndScreen.tsx) / [`PauseMenu.tsx`](src/ui/PauseMenu.tsx) / [`CodexScreen.tsx`](src/ui/CodexScreen.tsx) | 各画面（題/モード選択/結果/休息/図鑑） | いずれも props を映してコールバックを返すだけの「窓」。図鑑は敵・**夜の主(ボス能力)**・武具・称号の4タブ。 |
| [`ui/DioramaShelf.tsx`](src/ui/DioramaShelf.tsx) | ホームの**飾り棚**(集めた遺物の展示) | 収集済み遺物をドラッグで自由配置。配置は localStorage に保存。性能差は無い。 |
| [`ui/icons.tsx`](src/ui/icons.tsx) | 紋章SVGアイコンの**共有辞書** | `<Sigil name=…/>` で各UIが参照。色は親の文字色を継ぐ。 |

---

## 第3層：より外円な機能 / OUTER（土台・ビルド・配布）

ゲームの中身ではなく、「どう起動し、どう束ね、どう配るか」を担う外殻。
ここは普段あまり触りませんが、**Tauri に馴染みが無くても困らないよう**要点だけ。

### 起動の土台
| ファイル | 説明 |
|---|---|
| [`index.html`](index.html) | 空の `<div id="root">` だけのページ。ここに React を描き込む。 |
| [`src/main.tsx`](src/main.tsx) | `<App/>` を root に描き始める点火スイッチ。 |
| [`src/styles.css`](src/styles.css) | 全UIの見た目。`:root` の CSS 変数(色/書体)を各規則が参照。 |

### ビルド設定（※ JSON はコメント不可なのでここで解説）
| ファイル | 説明 |
|---|---|
| [`vite.config.ts`](vite.config.ts) | 開発サーバ＆本番ビルドの道具。Tauri 連携でポートを **1420 固定**。 |
| `package.json` | 依存ライブラリ(React 等)と `npm run dev/build` 等のコマンド定義。 |
| `tsconfig.json` | TypeScript の型チェック設定。 |

### Tauri ＝「Web をデスクトップアプリにする薄い殻」

**結論から：** このゲームの本体は Web（React + Canvas）です。Tauri は、その Web を
**ネイティブの窓に入れて `.app` / `.exe` として配る**ためだけの外側の殻です。
ブラウザを開かなくても単体アプリとして起動でき、Electron より軽いのが特徴。
ゲームの挙動は一切 Tauri 側にありません。**Web として完成していれば、Tauri 部分は
ほぼ定型のまま**で構いません。

| ファイル | 役割（知らなくても基本OK、の度合いで） | 一言 |
|---|---|---|
| [`src-tauri/src/main.rs`](src-tauri/src/main.rs) | ネイティブ窓を開き、中に Web を表示する**入口**(Rust) | 今は「窓を開いて Web を出す」だけ。JS から Rust を呼びたくなったら関数を足す場所。 |
| [`src-tauri/tauri.conf.json`](src-tauri/tauri.conf.json) | **窓の設定**(タイトル/サイズ/読み込む URL 等) | `devUrl: localhost:1420`(開発時)と `frontendDist: ../dist`(本番)で「何を表示するか」を指定。だから vite のポートを 1420 に固定している。 |
| `src-tauri/Cargo.toml` | Rust 側の依存とビルド設定 | npm の package.json の Rust 版。 |
| `src-tauri/build.rs` | ビルド前の定型準備 | ほぼ触らない。 |
| `src-tauri/capabilities/default.json` | アプリに許す**権限**の宣言 | 既定の最小権限のみ。機能追加時にだけ増やす。 |
| `src-tauri/icons/` | アプリアイコン各サイズ | 配布物の見た目。 |

**動かし方の対応関係（Tauri の気持ち）**
- 開発：`npm run tauri dev` → Tauri が裏で `npm run dev`(vite 1420)を起動 → その URL を窓に表示。
- 配布：`npm run tauri build` → 先に `npm run build`(dist 生成）→ dist を同梱した単体アプリを出力。
- ブラウザだけで動かしたい時：`npm run dev` し `localhost:1420` を開けば Tauri 抜きで遊べます（＝本体は Web という証拠）。

---

## 1フレームの流れ（層をまたぐ全体像）

```
[入力] キー(WASD等)
   │
[第1層 engine.loop] 毎フレーム:
   update(): 移動→武器発射→弾の命中→敵→敵弾→経験値→演出→湧き→勝敗
   draw():   render.ts が World を Canvas に描画
   │  ▲                                   │
   │  └ setMeta/applyChoice 等で指示 ──────┘(第2層 App/UI から)
   ▼
[emit] "hud"/"levelup"/"gameover"/"victory"
   │
[第2層 App] 受け取って画面切替・記録保存(profile)・カード提示(LevelUpModal)
   │
[第3層] index.html＋main.tsx が全体を起動、Tauri は窓として包む
```
