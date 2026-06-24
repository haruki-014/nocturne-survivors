# Nocturne Survivors ― 内部実装解説（開発者向け）

Tauri v2 + React 18 + TypeScript 製のヴァンパイアサバイバー風ローグライク。
本書はアーキテクチャ、スキルツリー（真化＋流派）の実装、設計判断の根拠、描画とデザインシステムを解説する。

## 1. 全体構成 ― エンジンと UI の分離

中核の方針は **「ゲーム本体は React に依存しない純 TypeScript エンジン、React はその上に被さるオーバーレイ UI」** という明確な責務分離。

```
Engine (純TS / Canvas2D)            React (オーバーレイ)
  ├ ゲームループ rAF                  ├ TitleScreen
  ├ ワールド状態 World               ├ HUD
  ├ 物理・衝突・スポーン              ├ LevelUpModal（アルカナ／真化）
  ├ 武器発射・ダメージ                ├ PauseMenu（設定・ビルド・紋章）
  └ Canvas へ描画                    └ EndScreen
        │   ▲                              │   ▲
        │   └──── EngineEvent ────────────┘   │
        └──────── start / setPaused / applyChoice ┘
```

- **UI → エンジン** は `start()` / `setPaused()` / `applyChoice()` の 3 つだけ。
- **エンジン → UI** は `EngineEvent`（`hud` 約8Hz ／ `levelup` ／ `gameover` ／ `victory`）のコールバック 1 本。
- この境界の「契約」はすべて `src/game/types.ts` の共有型に集約される。UI とエンジンは型でのみ握手する。

利点：ゲームロジックは React の再レンダリングサイクルと完全に無関係に 60fps で回り、UI は状態のスナップショット（HudState）を受け取って描くだけ。テスト・差し替え・シミュレーションが容易。

## 2. ディレクトリ

```
src/
  main.tsx           エントリ（ReactDOM + styles.css）
  App.tsx            画面状態機械 + Engine ライフサイクル（canvas常設、設定の永続化）
  styles.css         デザイントークン／HUD／アルカナ／リキッドグラス
  ui/                Title / HUD / LevelUp / Pause / End
  game/
    types.ts         エンジン⇔UI の唯一の契約（共有型）
    data.ts          武器・加護・敵・ウェーブ・真化・流派（宣言的データ）
    engine.ts        ループ／空間ハッシュ／発射／派生ステータス／カード生成
    render.ts        Canvas 描画（スプライトキャッシュ／光源／演出）
src-tauri/           Tauri v2 シェル（Rust）
tools/
  skilltree-sim.mjs  スキルツリー多様性のモンテカルロ・シミュレータ
```

## 3. エンジンの要点

- **ループ**：`requestAnimationFrame`。`dt` は 0.05 秒で上限クランプ（タブ復帰時の暴走防止）。ポーズ状態 `'none' | 'menu' | 'levelup' | 'ended'`。
- **空間ハッシュ**：80px セルの `Map<string, Enemy[]>` で、投射物の衝突と敵同士の分離を近傍セルだけに限定。敵は最大 300 体。
- **武器発射**：後述の `behavior` ディスパッチ。投射物は `kind`（bolt/knife/axe/orb）ごとに更新・描画。雷とオーラは投射物を持たず即時判定。
- **派生ステータス `Derived`**：所持パッシブと流派セットから毎回算出（`recomputeDerived`）。発射側は `Derived` を読むだけで、装備構成を意識しない。

## 4. データ駆動設計（`data.ts`）

武器・加護・敵・ウェーブ・真化・流派は、すべて `data.ts` に宣言的に定義。バランス調整はこのファイルだけで完結する。

- `WEAPONS: Record<WeaponId, WeaponDef>`：各武器は `behavior`（発射挙動）と `school`（流派）を持ち、`statsFor(lv)` でレベル別ステータスを返す。**真化形態も同じ WEAPONS に同居** し、`evolved: true` で区別。
- `PASSIVES: Record<PassiveId, PassiveDef>`：各加護も `school` を持つ。
- `EVOLUTIONS: Partial<Record<WeaponId, EvolutionBranch[]>>`：`{ req: 必要パッシブ, evo: 真化先, desc }` の配列。**分岐** はこの配列が複数要素を持つことで表現（魔弾の書・裁きの雷）。
- `SCHOOLS` ＋ `schoolTier()` ＋ `schoolBonusText()`：流派メタデータと、所持数→段位（3個=1段, 5個=2段）、段位→説明文。

## 5. スキルツリーの実装

多様性は **「真化（進化）」** と **「流派セットボーナス」** の二層で生む。装備の表面的な組み合わせではなく、*意味のある終局状態* の数を増やすことを狙う。

### 5.1 発射の `behavior` ディスパッチ

真化形態を増やしてもエンジンのコードが増えないよう、発射は武器 id ではなく `def.behavior`（`bolt|knife|axe|lightning|orbs|aura`）で分岐する。

```ts
switch (def.behavior) {
  case "bolt":      this.fireGrimoire(amount, stp, might); break;
  case "knife":     this.fireKnife(amount, stp, might, def.ring === true); break;
  case "axe":       this.fireAxe(amount, stp, might, area); break;
  case "lightning": this.fireLightning(amount, stp, might, area); break;
}
```

真化形態は基底と同じ `behavior` を再利用し、強化された `statsFor`（弾数・威力・貫通の桁を上げる）で「別物の手応え」を出す。`千刃・烈風` だけは `ring: true` で `fireKnife` を全方位モードに切り替える（唯一の挙動分岐）。これで 8 種の真化を追加してもエンジンの新規分岐はほぼゼロ。

### 5.2 カード生成 `makeChoices`

通常プール（既存の強化＋新規取得）に加え、真化可能な武器があれば真化カードを `evoPool` に積む。

- 真化条件：基底武器が **最大 Lv** かつ 対パッシブを **所持（lv ≥ 1）**。
- **到達感の保証**：真化が一つでも可能なら、3 枚のうち最低 1 枚を必ず真化カードにする（VS 流）。分岐が二つ揃うと 40% の確率で 2 枚目の真化も提示。
- 進化形態は `evolved` フラグで「新規取得プール」から除外（真化でのみ到達）。

### 5.3 カード適用 `applyChoice`

真化カードは `evolution / replaces / id` を持つ。適用時は、`replaces`（基底武器）を所持武器から探し、その `id` を真化先へ置換、レベルを 1 にリセット（真化後の成長曲線で再び伸ばせる）。

### 5.4 セットボーナス `recomputeDerived`

所持武器・加護を流派ごとに数え、`schoolTier()` で段位を出して `Derived` に上乗せする。

```
鋼: 貫通(pierceBonus) +1 / +2
霊: 攻撃間隔(cooldown) ×0.92 / ×0.85
月: 効果範囲(area) ×1.18 / ×1.34（2段で威力 ×1.06）
血: 再生・最大HP（2段で lifesteal=撃破時回復）
```

`lifesteal` は `killEnemy` で撃破時に回復として消費。`pierceBonus` は発射直前に `st.pierce` へ加算（貫通 999 の武器は対象外）。`Derived` に集約したことで、UI も `HudState.schools` 経由で同じ計算結果（段位）を表示できる。

## 6. 設計判断の根拠 ― モンテカルロ・シミュレーション

「真化あり／なし」「流派セットあり／なし」を直感で決めず、`tools/skilltree-sim.mjs` で **3 システム × 4 プレイ方針 × 4,000 回 = 48,000 ラン** を回して定量比較した。

候補：A=フラット（現行）／B=真化のみ／C=真化＋流派。方針：random / weapon偏重 / archetype偏重 / 真化ハンター。
指標：固有ビルド数、ビルド・エントロピー、**固有アイデンティティ数**（真化集合＋主流派＋点灯セット段位）、ID エントロピー、真化到達率。

結果（4 方針平均）：

| システム | 固有アイデンティティ | ID 多様性 (bit) | 真化到達率（最大） |
| --- | --- | --- | --- |
| A フラット | ≈3 | 0.99 | 0% |
| B 真化のみ | ≈40 | 2.60 | 71% |
| **C 真化＋紋章** | **≈161** | **5.19** | **75%** |

初回の試行では真化条件が厳しすぎ（武器最大Lv＋パッシブLv3）、到達率がほぼ 0% に沈んだ。これを受けて条件を「対パッシブを所持（lv1）」へ緩和し、レベルアップ数を 36 に補正して再試行 ―― 機構が機能し、C が **アイデンティティ多様性でフラットの約40倍** という結論を得た。最終的に C を採用。シミュレータは将来のバランス変更の回帰チェックにも使える。

実行：`node tools/skilltree-sim.mjs`

## 7. レンダラ（`render.ts`）

- **スプライトキャッシュ**：プレイヤー・敵7種・経験石・地形装飾をオフスクリーン canvas に事前ラスタライズし `drawImage`。数百体でも軽い。
- **ランタン光源**：主題は「闇を持ち歩く者」。画面中心（プレイヤー）を中心とした放射状の闇を敷き、その内側だけを世界として浮かび上がらせる。温かいランタンの芯光を加算合成。
- **雰囲気**：視差で流れる霧、光源に近いほど明るい微塵、魔弾・宝珠・雷・経験石の加算ブルーム、コロナ付きの血月、被弾の緋いフラッシュ。
- **DPR 対応**：`ctx.scale(dpr, dpr)` 配下で全描画を CSS ピクセルで扱う。ウィンドウリサイズに追従。
- **描画バックエンドの抽象**：エンジンは具体的な描画 API ではなく `Renderer` インターフェース（`render` / `resize` / `dispose`）だけに依存する。既定は `Canvas2DRenderer`（`renderWorld` への委譲）。コンストラクタにレンダラ生成関数を渡せば WebGL(three.js) 実装に差し替えられる。移行の評価と設計は [MIGRATION.md](./MIGRATION.md) を参照。

## 8. デザインシステム ― リキッドグラスの統一

全 UI を一枚の **「黒曜のガラス」** として統一する。`styles.css` 末尾に `--glass-fill / --glass-edge / --glass-rim / --glass-blur` などのトークンを定義し、パネル・アルカナカード・チップ・スロット・ボタン・トグル・バー・**真化カード・流派紋章**まで同じ規則を適用する。

- **共通材**：半透明の暗いフィル ＋ `backdrop-filter: blur() saturate()`（背後の戦場をすりガラス越しに凍結＝没入）＋ 上辺の鏡面ハイライト（`inset` 白リム）＋ 浮遊するドロップシャドウ。
- **シグネチャ**：レベルアップのアルカナカード。位階のローマ数字、四隅の菱、アイコン背後の光輪、ホバーの帯光。
- **真化カードは頂点**：同じ硝子素材のまま、金白の `evo-pulse`（鼓動する外光）と常時流れる鏡面光沢で「家系の最上位」を表現。
- **流派紋章**：ポーズの `.crest`（段位で accent グローが強まる硝子チップ＋進捗ピップ）と、HUD 右上の発現バッジ（`.hud-crest`）。いずれも accent = 流派色で、`color-mix()` により縁とグローを生成。

`prefers-reduced-motion` 下では、流れる光沢・残り火・真化の鼓動を停止する。

- **アイコンの統一**：世界観から浮く絵文字を排し、図鑑のモンスターは**実際のゲーム内スプライト**（`render.ts` の `enemyPortrait()` が PNG データ URL を返す。未発見はシルエット）で、称号・武器・加護・真化・流派は**単色ストロークの紋章シジル**（`ui/icons.tsx` の `Sigil` コンポーネント、`currentColor` を継ぐ SVG 線画を 37 種）で表示する。ホームの戦績ダイジェストも同じシジルで飾る。戦場に落ちる道具（秘薬・磁石）も絵文字をやめ、`render.ts` の `pickupSprite()` でベクター描画する。これにより HUD・カード・記録の間・戦場まで**絵文字ゼロ**で統一された（残る ✶✦ や矢印は単色の活字記号で意匠に沿う）。

## 9. 型安全と検証

- **境界は型で固定**：`WeaponId` 共用体は真化形態 8 種を含み、`WEAPONS` のキーと一致。`OwnedWeapon.id` が真化 id を取れるのもこの共用体のおかげ。
- **静的検査**：`tsc --strict` で `src/game/*.ts` と全 TSX がエラーゼロ（本物の `@types/react` は `npm install` 後に解決）。
- **データ結線検査**：真化先・必要パッシブの存在、`evolved` フラグ、挙動の一致、各流派が 3 個以上で発現可能か（steel4 / spirit4 / moon3 / blood3）を機械的に確認済み。

## 10. メタプロゲッション（ラン後も楽しむ層）

ホーム画面と「記録の間（コーデックス）」は、エンジンとは独立した **UI 側の蓄積層** として実装する。エンジンは DOM・localStorage に触れないという原則を守るため、永続化はすべて `src/meta/profile.ts` が担う。

- **拡張した `RunStats`**：終局イベントに、最終ビルド（武器・加護の id と Lv）、到達した真化（`evolved`）、遭遇した敵（`seenEnemies`）、流派の最高段位（`schoolTiers`）を載せる。エンジンは `World.seen: Set<EnemyKind>` をスポーン時に、`World.maxTier` を `recomputeDerived` のたびに更新して集計する。
- **`Profile`**：localStorage（`nocturne.profile.v1`）に保存される恒久データ。累計（夜数・討伐・生存・ダメージ・撃破）、最高記録、発見集合（敵・武器・真化・加護）、流派の最高段位、解放済み称号、直近のラン。`loadProfile/saveProfile/recordRun/resetProfile` を提供。
- **`recordRun(profile, stats)`**：ラン結果を統合し、`ACHIEVEMENTS` の述語を評価して **新規解放された称号** を返す。App はこれを `gameover/victory` で呼び、プロファイルを更新・保存し、リザルト画面に解放称号を渡す。
- **画面**：`TitleScreen` をハブ化（夜へ / 記録の間 / 祭壇 / 戦績ダイジェスト / 飾り棚）。`CodexScreen` は記録・図鑑・武具（真化レシピのコレクション）・称号の 4 タブで、図鑑は**夜の主（ボス）を別枠で表示し、撃破済みなら能力（`trait`）まで見せる**。未発見でも真化レシピ（基底＋必要加護 ▶ 真化先）を道標として表示する。
- **装い（スキン）と専用技**：`SKINS` の各装いは見た目を差し替えるだけだが、一部は `signature`（専用技の `WeaponId`）を持つ。エンジンは `start` 時にその装いの専用技を控え、`makeChoices` が通常プールとは別にその修得カードだけを提示する（`WeaponDef.signature:true` は通常プールから除外）。これで「装い＝固有のビルド起点」を性能差なしの解放要素として両立させる。
- **遺物（`CurioDef`）と飾り棚**：プレイ中に稀に `spawnCurio()` が未収集の遺物をステージへ落とす。取得すると `emit({type:"curio"})` で UI に通知し、`profile` が収集を保存。ホームの `DioramaShelf` が収集済み遺物をドラッグ配置できる展示棚として描く（配置も localStorage）。性能差は無い、夜を重ねた証のコレクション。
- **デザイン**：これらも同じリキッドグラス・トークンで統一。ガラスのタブ、半透明セル（発見＝accent発光／未発見＝減光・グレースケール）、金彩の称号バッジ。

なお、ラン放棄（タイトルへ戻る）では記録しない。記録は死亡または勝利の終局時のみ。

## 11. モード・変種・カードの差別化

- **モード（`ModeConfig`）**：`data.ts` の `MODES` に標準/長征/無限の3種を宣言。勝利条件（`victoryTime`/`bossTime`/`bossRepeat`）と難易度（`hpMul`/`dmgMul`/`rateMul`/`escalate`）を持つ。エンジンは `start(mode)` で `this.mode` を保持し、スポーン・スケーリング・勝利判定・エリート/ボスの周期をモード駆動にする。反復ボス（長征/無限）は撃破しても勝利にならず、報酬を落として `nextBossTime += bossInterval` で再武装する。`RunStats.mode`/`bossKills` を記録し、プロファイルはモード別ベスト（`modeBest`）を保持、モード選択画面に表示する。

- **変種（`EnemyVariant`）と同種オーラ**：通常モンスターは `rollVariant()` で `large`/`recolor` を確率的に付与（中盤以降・モードで頻度と上限が変化）。`large` は巨大・硬く、生存中は同種を加速。`recolor` は別パレットで、生存中は同種を硬化。`updateEnemies` が毎フレーム生存変種から `world.auraSpeed`/`auraTough`（種の集合）を再計算し、移動速度（×1.4）と被ダメージ（×0.7、`damageEnemy`）に反映する。描画は徽章リング（琥珀=加速/紫=硬化、破線・脈動）とサイズ・配色で差別化。

- **ボス固有能力（`BossAbility`）**：各ボスは `data.ts` の `BossDef.ability`（`swarm`/`raise`/`miasma`/`wail`/`rally`）と一言の `trait` を持つ。これで「ただ硬い的」から戦法の違う一戦へ差別化する。エンジンは `updateBossAbility(e, def, dist, dt)` で `Enemy.abilityCd` を回し、`swarm`=蝙蝠召喚（分身）＋接触時の吸血、`raise`=プレイヤーを囲う骸骨の蘇生召喚、`miasma`=瘴気圏内の鈍足デバフ＋継続ダメージ、`wail`=視界制限（`World.visionScale` を `wailT` 駆動で縮める）、`rally`=圏内の雑魚を加速（`World.bossRally`）＋全方位の火炎弾（`fireNova`）を担う。プレイヤー状態異常は `World.playerSlow`/`visionScale` に集約し、`render.ts` が瘴気の雲・鼓舞の輪・狭まる灯・毒の縁取りとして描く。`wraithQueen`/`ashHerald` 等は既存の `ranged` 呪弾（`fireBossVolley`）と能力を併用できる。能力は図鑑（`CodexScreen`）にも `trait` として表示される。新規ボス追加は `BOSSES` に1行＋必要なら能力の `case` を足すだけ。

- **敵スプライトの作り込み**：`render.ts` の `enemySprite(kind, variant)` を全面再描画。`shade()` による陰影グラデ、縁取り、`glowEye()` の発光眼、膜翼/骨格/フード/装甲などを描き、変種はパレットとサイズで分岐する。スプライトは種×変種でキャッシュ。

- **カードの差別化**：`UpgradeChoice` に `school`/`archetype`/`levelMax`/`stats` を付与。`makeChoices` が武器の型ラベル（`weaponArchetype`）と数値バッジ（新規=基準値、強化=差分 `weaponDeltaBadges`）を載せ、`LevelUpModal` が流派チップ・型タグ・レベルピップ・ステータスバッジとして描く。ひと目で流派・型・進捗・効果が分かる。

## 12. 体験の調整（アリーナ・再開猶予・回避・撃破演出・ミニマップ）

実プレイで判明した手触りの問題を、主に次の点で解消した。

- **再開の猶予（時間停止の構え）**：`World.grace` が >0 の間、ループは `update()` を呼ばずに世界を凍結し、`grace` を実時間で減らす。`start()`（1.6s）・レベルアップ適用後（1.2s）・ポーズ解除（0.8s）で `beginGrace()` が走り、終了時にプレイヤーへ短い無敵を付与する。スキル獲得直後に敵へ囲まれて回避不能になる問題を解消。描画側は中央にカウントダウンのリングと「構えよ」を出す。
- **ローリング回避（スタミナ）**：`Space`/`Shift` で `rollRequested` を立て、`updatePlayer` が `stamina >= ROLL_COST` を条件に `roll`（動作 0.34s）と `invuln`（0.38s の無敵）を発火、向き方向へ高速移動する。スタミナは毎秒回復し連発は約2回まで。瘴気の鈍足（`World.playerSlow`）下でも回避の踏み込みだけは鈍らない。能動的な被弾回避の選択肢を与え、群れ/呪弾に対する立ち回りを成立させる。
- **聖域（アリーナ境界）**：`ARENA_RADIUS`（原点中心の円）で可動域を制限。`updatePlayer` がプレイヤー座標を円内へクランプし、`spawnAt` が湧き座標も円内へ寄せる。これで「無限に逃げ続けるのが最適解」になる退行を防ぐ。描画は緋の結界リングと外側の暗化（even-odd 塗り）で可視化。
- **撃破の爽快感**：ボス HP と時間スケーリングを引き下げ（9500→6000、係数 0.04→0.02）、経験値曲線を緩めて（より多くのレベルアップ＝真化や最大Lvに時間内に届く）、集中ビルドなら確実に夜の主（ボス）を倒せるようにした。撃破時は `slowmo`（dt×0.34）と `victoryDelay`（約1.4s）で“時が緩む”余韻を作り、大爆発・閃光・震動を経てから勝利画面へ遷移する。ループは実時間 `realDt` とシミュレーション用 `dt` を分け、スローモー中も猶予タイマは実時間で進む。
- **ミニマップ**：`render.ts` の `drawMinimap()` が画面右下にガラス調の円盤を描き、聖域全体に対する自機（金の菱＋脈動リング）・敵（種別色の点）・エリート（金）・ボス（脈打つ赤）・道具を点で示す。エンジンの描画ループ内（60fps、全エンティティに直接アクセス）で描くため、HUD 経由で大量の座標を React に渡す必要がなく軽い。
- **HUD の作り込み**：体力バー＋レベルオーブ（数値表示）、スロットのレベル進捗バーと真化の金星、モード対応タイマー（夜明けの目標時刻と進捗トラック／無限は「∞」）、低HP時の画面端の緋い明滅で危険を直感的に伝える。`HudSlot` に `maxLevel`/`evolved`、`HudState` に `mode`/`victoryTime` を持たせ、React 側はデータ参照なしに描ける。パネルの入場・ボタン押下・キーボードフォーカスなどの所作も統一。

## 13. 拡張ポイント

- **新武器・新真化**：`data.ts` に `WeaponDef`（`behavior` は既存のものを再利用）と `EVOLUTIONS` の枝を足すだけ。エンジン改修は基本不要。
- **新流派**：`SchoolId` と `SCHOOLS`、`schoolBonusText`、`recomputeDerived` の加点を追加。
- **バランス調整後**：`tools/skilltree-sim.mjs` を回し、多様性指標が劣化していないか回帰確認する。
