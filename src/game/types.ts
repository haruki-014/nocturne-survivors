// ═══════════════════════════════════════════════════════════
//  〔層〕主要機能 / CORE ── 型定義(共有の契約)
//
//  役割(マクロ): エンジン(純TS)と UI(React) が受け渡すデータの「形」を
//    一箇所で定義する。ここに無い構造はやり取りされない。両者はこのファイル
//    だけを共通言語として疎結合に保たれる(描画やセーブを差し替えても壊れない)。
//  挙動(ミクロ): 実行時のコードは一切持たない。型(interface/type)と、初期値の
//    ような定数(例: NO_META_BONUS)だけを輸出する。コンパイル後は消える注釈層。
//
//  読み方の目印:
//    ・Def 系(WeaponDef 等)   = 静的な定義データ(data.ts が中身を埋める)
//    ・実行時エンティティ(Enemy/Projectile 等) = 毎フレーム動く可変の状態
//    ・World                   = 1ラン分の全状態を束ねる中心オブジェクト
//    ・Hud*/RunStats/Engine*   = UI へ渡すための読み取り専用スナップショット
// ═══════════════════════════════════════════════════════════

export type WeaponId =
  | "grimoire" // 魔弾の書
  | "knife" // 銀のナイフ
  | "orbs" // 聖鎖の宝珠
  | "censer" // 忌避の薫香
  | "lightning" // 裁きの雷
  | "boomerang" // 帰刃・断月
  // ---- 真化(進化)形態 ----
  | "grimoire_codex" // 禁書・無限詠唱
  | "grimoire_blasphemy" // 冒涜の聖句
  | "knife_galewall" // 千刃・烈風
  | "orbs_halo" // 神罰の聖環
  | "censer_sanctuary" // 業火の聖域
  | "lightning_chain" // 神鳴・連雷
  | "lightning_storm" // 裁きの嵐
  | "boomerang_comet" // 彗星・帰刃
  // ---- 専用技(特別なスキンの秘伝。通常プールには出ず、その装いでのみ修得可) ----
  | "void_chain" // 虚無の鎖環 (虚無の影)
  | "gold_verse" // 黄金の聖句 (黄金詠唱者)
  | "frost_lance" // 氷牙の連弾 (霜夜の狩人)
  | "crimson_scythe" // 緋月の戦鎌 (緋の伯爵狩り)
  | "verdant_bloom" // 聖域の薫光 (月光の祭司)
  | "ember_waltz" // 業火の輪舞 (焔の巡礼)
  | "plague_fan" // 疫癘の散弾 (疫病の医師)
  | "royal_thunder"; // 王権の雷霆 (月の王)

/** 武器の発射挙動。真化形態は基底と同じ挙動を、強化された statsFor で再利用する。 */
export type WeaponBehavior = "bolt" | "knife" | "boomerang" | "lightning" | "orbs" | "aura";

/** 流派(紋章)。武器とパッシブに付与され、所持数でセットボーナスが灯る。 */
export type SchoolId = "steel" | "spirit" | "moon" | "blood";

export type PassiveId =
  | "boots" // 俊足のブーツ
  | "heart" // 不死者の心臓
  | "might" // 血の腕輪
  | "tome" // 古き砂時計
  | "candle" // 月光のレンズ
  | "magnet" // 骸の磁鉄
  | "regen" // 緋き聖杯
  | "duplicator"; // 写し身の鏡

export interface WeaponStats {
  damage: number;
  cooldown: number; // 秒
  amount: number; // 弾数 / 同時数
  area: number; // 範囲倍率
  speed: number; // 弾速
  pierce: number; // 貫通数
  duration: number; // 寿命(秒)
}

export interface WeaponDef {
  id: WeaponId;
  name: string;
  icon: string;
  color: string;
  desc: string;
  maxLevel: number;
  behavior: WeaponBehavior;
  school: SchoolId;
  evolved?: boolean; // 真化形態か
  signature?: boolean; // 専用技(特別なスキンの秘伝)。通常プールには出さない。
  ring?: boolean; // knife挙動を全方位リングにする(千刃・烈風)
  statsFor: (lv: number) => WeaponStats;
}

export interface PassiveDef {
  id: PassiveId;
  name: string;
  icon: string;
  color: string;
  desc: string;
  maxLevel: number;
  school: SchoolId;
  levelDesc: (lv: number) => string;
}

export type EnemyKind =
  | "bat"
  | "zombie"
  | "skeleton"
  | "wraith"
  | "brute"
  | "warlock" // 遠距離から呪弾を放つ術者(密集で固まらせない)
  | "elite"
  | "boss";

/** 同種モンスターの変種。large=大型種(同種を加速), recolor=色違い(同種を硬化) */
export type EnemyVariant = "normal" | "large" | "recolor";

/** ゲームモード */
export type GameMode = "standard" | "long" | "endless";

export interface EnemyDef {
  kind: EnemyKind;
  name: string;
  hp: number;
  speed: number;
  damage: number;
  radius: number;
  xp: number;
  color: string;
}

// ---------- 実行時エンティティ ----------

export interface Enemy {
  id: number;
  kind: EnemyKind;
  variant: EnemyVariant; // 通常/大型/色違い
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  speed: number;
  damage: number;
  radius: number;
  xp: number;
  hitFlash: number; // 被弾フラッシュ残時間
  kx: number; // ノックバック速度
  ky: number;
  orbHitT: number; // 宝珠による最終被弾時刻
  wobble: number; // 描画用位相
  shootCd: number; // 遠距離敵の発射クールダウン残り(術者・遠距離ボスが使用)
  abilityCd: number; // ボス固有能力(召喚・分身・咆哮など)の再発動までの残り秒
  windup: number; // ボス能力の予備動作(チャージ)残り秒。>0 の間はテレグラフを描く
  windAng: number; // テレグラフ基準角/シード(骸の王の召喚地点など発動位置の予告に使う)
  bossType?: string; // kind==="boss" のとき、どのボスか(見た目・名・挙動を選ぶ)
}

/**
 * 拡大する衝波(ハザード)。ボスの予備動作の後に放たれ、環帯を通過する瞬間にだけ当たる。
 * プレイヤーは環の外/内へ踏み出して回避できる。damage===0 は視覚専用のテレグラフ輪。
 */
export interface Shockwave {
  x: number;
  y: number;
  r: number; // 現在半径
  maxR: number; // 拡大の終端半径
  speed: number; // 拡大速度 px/s
  width: number; // 当たり判定の環帯の太さ
  life: number; // 終端到達後のフェード残り秒
  color: string;
  damage: number; // 0=視覚専用
  hit: boolean; // 既にプレイヤーへ当てたか(一度きり)
}

/** 敵が放つ呪弾。プレイヤーにのみ当たる。 */
export interface EnemyShot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  damage: number;
  radius: number;
  life: number;
  seed: number; // 描画の揺らぎ用
}

export type ProjectileKind = "bolt" | "knife" | "boomerang" | "orb";

export interface Projectile {
  kind: ProjectileKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  damage: number;
  radius: number;
  pierce: number;
  life: number;
  angle: number; // boomerang では楕円位相(ラジアン)として流用
  spin: number;
  hit: Set<number>; // 既にヒットした敵ID(多段ヒット防止)
  orbIndex?: number; // 宝珠の位相インデックス
  // ── ブーメラン専用 ──
  boomDir?: number; // 投擲方向(ラジアン)。個数で放射状に均等配分。楕円ごとこの向きへ回転
  boomA?: number;   // 進行方向の半径(短軸)
  boomB?: number;   // 進行方向に直交する半径(長軸)
}

export interface Gem {
  x: number;
  y: number;
  value: number;
  vx: number;
  vy: number;
  big: boolean;
}

export type PickupKind = "potion" | "magnet" | "curio" | "loot";

export interface Pickup {
  kind: PickupKind;
  x: number;
  y: number;
  curioId?: string; // kind==="curio" のとき、どの遺物かを指す
  lootTier?: number; // kind==="loot" のとき、戦利品の質(0=雑魚 1=エリート 2=ボス)
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  grav: number;
}

export interface FloatText {
  x: number;
  y: number;
  text: string;
  life: number;
  color: string;
  size: number;
}

export interface Bolt {
  x: number;
  y: number;
  life: number;
  seed: number;
}

export interface Player {
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  level: number;
  xp: number;
  xpNext: number;
  dirX: number; // 最後の移動方向(ナイフ等の発射方向)
  dirY: number;
  moving: boolean;
  invuln: number;
  anim: number;
  stamina: number; // スタミナ(ローリング回避の消費資源)
  staminaMax: number;
  roll: number; // 残りローリング時間(>0 の間は回避中・無敵)
  rollDirX: number; // ローリングの進行方向
  rollDirY: number;
}

export interface OwnedWeapon {
  id: WeaponId;
  level: number;
  cd: number; // 残クールダウン
  tick: number; // 薫香などの内部タイマー
}

export interface OwnedPassive {
  id: PassiveId;
  level: number;
}

/** パッシブから毎フレーム導出されるプレイヤー総合性能 */
export interface Derived {
  speed: number;
  maxHp: number;
  might: number;
  cooldown: number;
  area: number;
  magnet: number;
  regen: number;
  amountBonus: number;
  pierceBonus: number; // 鋼の流派セット
  lifesteal: number; // 血の流派セット(撃破毎の回復HP)
}

export interface World {
  t: number;
  kills: number;
  damageDealt: number;
  player: Player;
  derived: Derived;
  enemies: Enemy[];
  enemyShots: EnemyShot[];
  shockwaves: Shockwave[];
  projectiles: Projectile[];
  gems: Gem[];
  pickups: Pickup[];
  particles: Particle[];
  texts: FloatText[];
  bolts: Bolt[];
  weapons: OwnedWeapon[];
  passives: OwnedPassive[];
  boss: Enemy | null;
  bossDefeated: boolean;
  shake: number;
  flash: number; // 被弾時の赤フラッシュ
  auraR: number; // 薫香の現在半径(0=未所持)
  grace: number; // 再開前の待機(構え)残り秒。>0 の間は時間停止
  graceMax: number; // 待機の総秒(リング表示用)
  visionScale: number; // 視界(ランタン光)の倍率。1=通常、<1=女王の夜啼きで狭まる
  playerSlow: number; // 鈍足デバフ残り秒(腐肉の巨躯の瘴気)。>0 の間は移動が鈍る
  bossRally: boolean; // 灰燼の使者が周囲の雑魚を鼓舞中か(描画と加速判定用)
  auraSpeed: Set<EnemyKind>; // 大型種が生存している種(同種が加速)
  auraTough: Set<EnemyKind>; // 色違いが生存している種(同種が硬化)
  seen: Set<EnemyKind>; // このランで遭遇した敵
  seenBosses: Set<string>; // このランで遭遇したボス(bossType)
  maxTier: Record<SchoolId, number>; // このランで到達した流派の最高段位
  skinId: string; // 選択中のプレイヤースキン(描画用)
  sigWield: boolean; // 装いの専用技(秘伝)を所持中か。装備者の特別演出に使う
  sigColor: string; // 専用技の主色(装備者グロー・統一演出の色)
}

// ---------- UI との橋渡し ----------

export interface UpgradeChoice {
  key: string; // "w:grimoire" | "p:might" | "heal" | "evo:grimoire_codex"
  kind: "weapon" | "passive" | "heal";
  id?: string;
  name: string;
  icon: string;
  color: string;
  level: number; // 取得後のレベル(新規=1)
  isNew: boolean;
  desc: string;
  evolution?: boolean; // 真化カードか
  signature?: boolean; // 専用技(スキン秘伝)カードか
  replaces?: string; // 真化で置き換える基底武器 id
  fromName?: string; // 真化元の名(カード表示用)
  school?: SchoolId; // 流派(チップ表示)
  archetype?: string; // 武具の型(例: 貫通弾 / 周回 / 設置オーラ)
  levelMax?: number; // レベルピップ表示用
  stats?: { label: string; value: string; up?: boolean }[]; // 主要ステータス/差分の見える化
}

export interface HudSlot {
  id: string;
  icon: string;
  level: number;
  maxLevel: number;
  evolved: boolean;
  color: string;
  name: string;
}

export interface HudSchool {
  id: SchoolId;
  name: string;
  icon: string;
  color: string;
  count: number;
  tier: number; // 0 / 1 / 2
}

export interface HudState {
  hp: number;
  maxHp: number;
  stamina: number;
  staminaMax: number;
  rollReady: boolean; // ローリングに足るスタミナがあるか(UIの色分け用)
  level: number;
  xp: number;
  xpNext: number;
  time: number;
  kills: number;
  mode: GameMode;
  victoryTime: number | null;
  weapons: HudSlot[];
  passives: HudSlot[];
  schools: HudSchool[];
  bossHp: { hp: number; max: number; name: string } | null;
}

export interface RunStats {
  time: number;
  kills: number;
  level: number;
  damageDealt: number;
  bossDefeated: boolean;
  victory: boolean;
  mode: GameMode;
  bossKills: number; // このランでのボス撃破数(長征/無限は複数)
  weapons: { id: WeaponId; level: number }[];
  passives: { id: PassiveId; level: number }[];
  evolved: WeaponId[]; // 最終ビルドに含まれる真化形態
  seenEnemies: EnemyKind[];
  seenBosses: string[]; // このランで遭遇したボス(bossType の一覧)
  schoolTiers: Record<SchoolId, number>; // 到達した最高段位
  champions: number; // このランで撃破した特異種(大型/色違い)の数
}

/** モード設定(勝利条件・難易度) */
export interface ModeConfig {
  id: GameMode;
  name: string;
  tag: string; // 一言の目的
  desc: string;
  victoryTime: number | null; // 生存勝利の時刻。null=生存勝利なし
  bossTime: number | null; // ボス出現時刻。null=出現しない
  bossRepeat: boolean; // 撃破後も再出現(撃破は勝利にならない)
  bossInterval: number; // 再出現の間隔秒(bossRepeat時)
  eliteInterval: number | null; // エリート周期(null=固定テーブル ELITE_TIMES を使う)
  hpMul: number; // 敵HP倍率
  dmgMul: number; // 敵攻撃力倍率
  rateMul: number; // 湧き速度倍率
  escalate: number; // 経過に伴う追加上昇(0=なし。無限/長征で>0)
}

export type EngineEvent =
  | { type: "hud"; hud: HudState }
  | { type: "levelup"; choices: UpgradeChoice[] }
  | { type: "gameover"; stats: RunStats }
  | { type: "victory"; stats: RunStats }
  | { type: "curio"; id: string } // ステージ上の遺物を拾った(ホーム飾り棚へ収集)
  | { type: "loot"; tier: number }; // 装備(戦利品)を拾った(ホームのオートバトラーへ)

/**
 * 描画バックエンドの抽象。エンジンはワールド状態を渡すだけで、
 * Canvas2D / WebGL(three.js) など実装を問わず差し替えられる。
 */
export interface Renderer {
  /** 論理サイズ(CSS px)。エンジンは湧き座標の計算に用いる。 */
  readonly vw: number;
  readonly vh: number;
  /** キャンバスの実サイズ・DPR を測り直す。 */
  resize(): void;
  /** 1 フレーム描画する。 */
  render(world: World, settings: Settings): void;
  /** 後始末(WebGL コンテキストの破棄など)。 */
  dispose(): void;
}

export interface Settings {
  damageNumbers: boolean;
  screenShake: boolean;
  hudScale: number; // 0.8 - 1.4
}

/**
 * 恒久強化(祭壇)からエンジンへ渡される開始時ボーナス。
 * メタ層(profile)が算出し、エンジンは派生ステータス計算で反映するだけ。
 */
export interface MetaBonus {
  maxHpMul: number; // 最大HP倍率
  mightMul: number; // 攻撃力倍率
  speedMul: number; // 移動速度倍率
  cooldownMul: number; // 攻撃間隔倍率(<1 で短縮)
  magnetMul: number; // 回収範囲倍率
  xpMul: number; // 取得経験値倍率
  regenAdd: number; // 追加HP再生(毎秒)
  armor: number; // 被ダメージ軽減割合(0〜0.6)
}

export const NO_META_BONUS: MetaBonus = {
  maxHpMul: 1, mightMul: 1, speedMul: 1, cooldownMul: 1,
  magnetMul: 1, xpMul: 1, regenAdd: 0, armor: 0,
};
