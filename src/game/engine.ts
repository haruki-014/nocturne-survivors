// ═══════════════════════════════════════════════════════════
//  〔層〕主要機能 / CORE ── ゲームエンジン(本体)
//
//  役割(マクロ): このゲームの「心臓」。プレイ中の全状態(World)を保持し、
//    毎フレーム「入力→移動→武器発射→投射物→敵→経験値→演出→湧き→勝敗」の
//    順で世界を1コマ進める。React には一切依存しない純 TypeScript。
//
//  境界(他層との接点) ── ここだけ理解すれば UI と繋がる:
//    ・受ける(UI→エンジン): start() 開始 / setPaused() 休止 /
//      applyChoice() カード選択を反映 / setMeta() 恒久強化と装いを反映。
//    ・返す(エンジン→UI): コンストラクタで渡された emit(e) を通じ
//      "hud"(表示更新)/"levelup"(カード提示)/"gameover"/"victory" を通知。
//    UI はこの数個の入口/出口だけを触る。内部実装は自由に差し替えられる。
//
//  挙動(ミクロ): requestAnimationFrame で loop() を回し続ける。pause 状態に
//    応じて update() を呼ぶか描画だけにするかを切り替える。update() は上記の
//    更新関数を一定順序で呼ぶ。当たり判定は空間グリッド(buildGrid/queryGrid)で
//    近傍だけ調べ、数百体でも軽い。描画は Renderer インターフェース越しに委譲。
// ═══════════════════════════════════════════════════════════

import {
  ARENA_RADIUS,
  BOSSES,
  BOSSES_BY_ID,
  CURIOS,
  DEFAULT_MODE,
  DEFAULT_SKIN,
  describeWeaponUpgrade,
  dmgScale,
  ELITE_TIMES,
  ENEMIES,
  EVOLUTIONS,
  SKINS_BY_ID,
  hpScale,
  MODES,
  PASSIVES,
  REGULAR_KINDS,
  SCHOOLS,
  schoolTier,
  variantTuning,
  weaponArchetype,
  weaponStatBadges,
  VICTORY_TIME,
  WAVE_TABLE,
  WEAPONS,
  xpNeeded,
} from "./data";
import type { BossAbility, BossDef } from "./data";
import { Canvas2DRenderer } from "./render";
import type {
  Derived,
  Enemy,
  EnemyKind,
  EnemyVariant,
  EngineEvent,
  GameMode,
  HudSchool,
  HudState,
  MetaBonus,
  ModeConfig,
  OwnedPassive,
  OwnedWeapon,
  PassiveDef,
  PassiveId,
  Projectile,
  RunStats,
  Renderer,
  SchoolId,
  Settings,
  UpgradeChoice,
  WeaponDef,
  WeaponId,
  World,
} from "./types";
import { NO_META_BONUS } from "./types";

const TAU = Math.PI * 2;
const MAX_ENEMIES = 300;
const RALLY_RADIUS = 340; // 灰燼の使者が雑魚を鼓舞(加速)する半径
// ブーメランの楕円弧パラメータ(area=1 のとき)
const BOOM_A = 120; // 水平半径(進行方向。プレイヤーから楕円中心までの距離)
const BOOM_B = 200; // 垂直半径(画面縦方向。B > A で縦に長い楕円)
const BOOM_SPEED = 3.8; // 角速度 rad/s(一周 ≈ 1.65 s)

// 被弾フィードバック(プレイヤーが接触/呪弾でダメージを受けたときの共通値)
const PLAYER_HIT_IFRAME = 0.6; // 被弾後の無敵時間(連続ヒットで一気に溶けるのを防ぐ)
const PLAYER_HIT_FLASH = 0.3; // 画面の緋い被弾フラッシュの強さ

// ローリング回避(スタミナ消費)
const STAMINA_MAX = 100;
const STAMINA_REGEN = 22; // 毎秒回復(満タンまで ~4.5 秒)
const ROLL_COST = 42; // 1回の消費(連発は約2回まで)
const ROLL_TIME = 0.34; // 回避動作の時間
const ROLL_IFRAME = 0.38; // 無敵時間(動作より少し長く)
const ROLL_SPEED = 2.7; // 通常移動速度に対する倍率

type PauseReason = "none" | "menu" | "levelup" | "ended";

export class Engine {
  private renderer: Renderer;
  private emit: (e: EngineEvent) => void;
  settings: Settings;

  private world!: World;
  private keys = new Set<string>();
  private raf = 0;
  private lastTime = 0;
  private running = false;
  private pause: PauseReason = "ended";

  private enemyId = 1;
  private spawnAcc = 0;
  private waveIndex = 0;
  private eliteIndex = 0;
  private bossSpawned = false;
  private mode: ModeConfig = MODES[DEFAULT_MODE];
  private nextBossTime = Infinity;
  private nextEliteTime = Infinity;
  private bossKills = 0;
  private lastBossId = ""; // 直前に出したボス(連続で同じを避ける)
  private wailT = 0; // 夜啼く女王の視界制限の残り秒(>0 の間ランタン光が狭まる)
  private aliveChampions = 0;
  private aliveWarlocks = 0; // 生存中の夜術師(遠距離敵の数を抑えるため)
  private championKills = 0; // このランで倒した特異種(大型/色違い)の数
  private metaBonus: MetaBonus = NO_META_BONUS; // 祭壇の恒久強化
  private skinId: string = DEFAULT_SKIN; // 選択中の装い
  private signatureWeapon: WeaponId | null = null; // 装いの専用技(あれば修得カードを提示)
  private collectedCurios = new Set<string>(); // 収集済み遺物(未収集のものだけを落とす)
  private nextCurioTime = Infinity; // 次に遺物を落とす時刻(秒)
  private levelPending = 0;
  private slowmo = 0; // 撃破演出のスローモー残り秒
  private victoryDelay = 0; // ボス撃破後、勝利画面までの余韻秒
  private hudTimer = 0;
  private rollRequested = false; // スペース押下でローリング要求(更新ループで消費)
  private vw = 0;
  private vh = 0;

  private onKeyDown = (e: KeyboardEvent) => {
    this.keys.add(e.code);
    // スペースでローリング回避(押し始めの一回のみ。押しっぱなしの自動連射は無効)
    if ((e.code === "Space" || e.code === "ShiftLeft" || e.code === "ShiftRight") && !e.repeat) {
      this.rollRequested = true;
      if (e.code === "Space") e.preventDefault(); // ページのスクロールを抑止
    }
  };
  private onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.code);
  private onBlur = () => this.keys.clear();
  private onResize = () => this.resize();

  constructor(
    canvas: HTMLCanvasElement,
    emit: (e: EngineEvent) => void,
    settings: Settings,
    makeRenderer: (canvas: HTMLCanvasElement) => Renderer = (c) => new Canvas2DRenderer(c),
  ) {
    this.renderer = makeRenderer(canvas);
    this.emit = emit;
    this.settings = settings;
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    window.addEventListener("resize", this.onResize);
    this.resize();
    this.world = this.freshWorld();
    this.draw(); // タイトル画面の背景として一度描く
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.running = false;
    this.renderer.dispose();
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    window.removeEventListener("resize", this.onResize);
  }

  // ---------- 外部 API ----------

  /** ラン開始前に祭壇の恒久強化・装い・収集済み遺物を反映する。装い変更はタイトル背景にも即時反映。 */
  setMeta(bonus: MetaBonus, skinId: string, collectedCurios: string[] = []): void {
    this.metaBonus = bonus;
    this.skinId = skinId;
    this.signatureWeapon = SKINS_BY_ID[skinId]?.signature ?? null;
    this.collectedCurios = new Set(collectedCurios);
    if (this.world) {
      this.world.skinId = skinId;
      this.draw(); // 静止しているタイトル背景を更新
    }
  }

  start(mode: GameMode = DEFAULT_MODE): void {
    this.mode = MODES[mode];
    this.world = this.freshWorld();
    this.enemyId = 1;
    this.spawnAcc = 0;
    this.waveIndex = 0;
    this.eliteIndex = 0;
    this.bossSpawned = false;
    this.bossKills = 0;
    this.wailT = 0;
    this.aliveChampions = 0;
    this.championKills = 0;
    // 恒久強化を反映した最大HPで満タン開始する
    this.recomputeDerived();
    this.world.player.maxHp = this.world.derived.maxHp;
    this.world.player.hp = this.world.derived.maxHp;
    this.nextBossTime = this.mode.bossTime ?? Infinity;
    this.nextEliteTime = this.mode.eliteInterval ?? Infinity;
    // 遺物の初回ドロップは 10〜14 分あたり(≒15分で1個)。未収集が無ければ落とさない。
    this.nextCurioTime = this.curiosRemain() ? 600 + Math.random() * 240 : Infinity;
    this.levelPending = 0;
    this.slowmo = 0;
    this.victoryDelay = 1.4;
    this.hudTimer = 0;
    this.pause = "none";
    this.pushHud();
    this.beginGrace(1.6); // 夜の始まり: 構えの間
    if (!this.running) {
      this.running = true;
      this.lastTime = performance.now();
      this.raf = requestAnimationFrame(this.loop);
    }
  }

  setPaused(v: boolean): void {
    if (this.pause === "ended" || this.pause === "levelup") return;
    this.pause = v ? "menu" : "none";
    this.lastTime = performance.now();
    if (!v) this.beginGrace(0.8); // 再開時の構え
  }

  isPaused(): boolean {
    return this.pause !== "none";
  }

  /** カード選択を適用。さらに保留中のレベルアップがあれば次の選択肢を返す。 */
  applyChoice(choice: UpgradeChoice): UpgradeChoice[] | null {
    const w = this.world;
    if (choice.evolution && choice.replaces && choice.id) {
      // 真化: 基底武器を進化形態へ置換する(レベルは 1 から再成長)
      const base = w.weapons.find((o) => o.id === choice.replaces);
      if (base) {
        base.id = choice.id as WeaponId;
        base.level = 1;
        base.cd = 0.2;
        base.tick = 0;
      }
    } else if (choice.kind === "weapon") {
      const owned = w.weapons.find((o) => o.id === choice.id);
      if (owned) owned.level = Math.min(owned.level + 1, WEAPONS[owned.id].maxLevel);
      else w.weapons.push({ id: choice.id as WeaponId, level: 1, cd: 0.3, tick: 0 });
    } else if (choice.kind === "passive") {
      const owned = w.passives.find((o) => o.id === choice.id);
      if (owned) owned.level = Math.min(owned.level + 1, PASSIVES[owned.id].maxLevel);
      else w.passives.push({ id: choice.id as PassiveId, level: 1 });
      if (choice.id === "heart") {
        this.recomputeDerived();
        w.player.maxHp = w.derived.maxHp;
        w.player.hp = Math.min(w.player.maxHp, w.player.hp + 25);
      }
    } else {
      w.player.hp = Math.min(w.player.maxHp, w.player.hp + 40);
    }
    this.recomputeDerived();
    this.pushHud();

    this.levelPending--;
    if (this.levelPending > 0) {
      return this.makeChoices();
    }
    this.pause = "none";
    this.lastTime = performance.now();
    this.beginGrace(1.2); // スキル獲得後の構え(回避の余裕)
    return null;
  }

  // ---------- 初期化 ----------

  private freshWorld(): World {
    const maxHp = 100;
    return {
      t: 0,
      kills: 0,
      damageDealt: 0,
      player: {
        x: 0, y: 0, hp: maxHp, maxHp,
        level: 1, xp: 0, xpNext: xpNeeded(1),
        dirX: 1, dirY: 0, moving: false, invuln: 0, anim: 0,
        stamina: STAMINA_MAX, staminaMax: STAMINA_MAX, roll: 0, rollDirX: 1, rollDirY: 0,
      },
      derived: {
        speed: 175, maxHp, might: 1, cooldown: 1,
        area: 1, magnet: 70, regen: 0, amountBonus: 0,
        pierceBonus: 0, lifesteal: 0,
      },
      enemies: [], enemyShots: [], projectiles: [], gems: [], pickups: [],
      particles: [], texts: [], bolts: [],
      weapons: [{ id: "grimoire", level: 1, cd: 0.4, tick: 0 }],
      passives: [],
      boss: null, bossDefeated: false,
      shake: 0, flash: 0, auraR: 0,
      grace: 0, graceMax: 0,
      visionScale: 1, playerSlow: 0, bossRally: false,
      auraSpeed: new Set<EnemyKind>(),
      auraTough: new Set<EnemyKind>(),
      seen: new Set<EnemyKind>(),
      seenBosses: new Set<string>(),
      maxTier: { steel: 0, spirit: 0, moon: 0, blood: 0 },
      skinId: this.skinId,
    };
  }

  private resize(): void {
    this.renderer.resize();
    this.vw = this.renderer.vw;
    this.vh = this.renderer.vh;
  }

  // ---------- メインループ ----------

  private loop = (now: number): void => {
    if (!this.running) return;
    const realDt = Math.min(0.05, (now - this.lastTime) / 1000);
    this.lastTime = now;
    if (this.pause === "none") {
      if (this.world.grace > 0) {
        // 構えの待機: 世界を止めて再開の猶予を与える
        this.world.grace = Math.max(0, this.world.grace - realDt);
        if (this.world.grace === 0) {
          this.world.player.invuln = Math.max(this.world.player.invuln, 0.7);
        }
      } else {
        let dt = realDt;
        if (this.slowmo > 0) {
          this.slowmo = Math.max(0, this.slowmo - realDt);
          dt = realDt * 0.34; // 撃破の余韻
        }
        this.update(dt, realDt);
      }
    }
    this.draw();
    this.raf = requestAnimationFrame(this.loop);
  };

  private beginGrace(sec: number): void {
    this.world.grace = sec;
    this.world.graceMax = sec;
    this.rollRequested = false; // 構え中のスペース押下で再開直後に暴発させない
  }

  // 世界を dt 秒ぶん進める「1フレームの本体」。下の呼び出し順そのものが処理の流れ:
  //   性能再計算 → 自機移動 → 武器発射 → 投射物前進/命中 → 敵移動/接触 →
  //   敵弾 → 経験石回収 → 演出減衰 → 湧き → (この後)HUD送信と勝敗判定。
  // dt はスローモー等で縮むゲーム内時間、realDt は実時間(タイマー類に使う)。
  private update(dt: number, realDt: number): void {
    const w = this.world;
    w.t += dt;

    this.recomputeDerived();    // パッシブ+恒久強化から今の総合性能(速度/威力/間隔…)を導出
    this.updatePlayer(dt);      // キー入力で移動、無敵時間・再生・聖域境界の処理
    this.updateWeapons(dt);     // 各武器のクールダウンを進め、来たものは発射
    this.updateProjectiles(dt); // 弾を前進させ、近傍の敵と当たり判定(貫通を消費)
    this.updateEnemies(dt);     // 敵をプレイヤーへ寄せる/夜術師は間合い取り、接触ダメージ
    this.updateEnemyShots(dt);  // 夜術師の呪弾を前進させ自機にのみ当てる
    this.updateGems(dt);        // 経験石・道具を磁力で吸い寄せ、触れたら取得
    this.updateEffects(dt);     // パーティクル/数字/雷/画面揺れ・赤フラッシュの減衰
    this.updateSpawner(dt);     // 時刻に応じて雑魚/エリート/ボス/夜術師を視界外に湧かす

    // HUD は ~8Hz で送る(React の再レンダリングを抑える)
    this.hudTimer -= realDt;
    if (this.hudTimer <= 0) {
      this.hudTimer = 0.12;
      this.pushHud();
    }

    // 勝敗判定
    if (w.player.hp <= 0) {
      this.endRun();
      this.emit({ type: "gameover", stats: this.stats() });
      return;
    }
    if (this.mode.victoryTime !== null && w.t >= this.mode.victoryTime) {
      this.endRun();
      this.emit({ type: "victory", stats: this.stats() });
      return;
    }
    if (w.bossDefeated) {
      // 撃破の余韻を見せてから勝利へ
      this.victoryDelay -= realDt;
      if (this.victoryDelay <= 0) {
        this.endRun();
        this.emit({ type: "victory", stats: this.stats() });
      }
      return;
    }

    // レベルアップ処理(撃破演出中は割り込まない)
    if (this.levelPending > 0 && this.pause === "none" && !w.bossDefeated) {
      this.pause = "levelup";
      this.emit({ type: "levelup", choices: this.makeChoices() });
    }
  }

  /** ランの終了処理。以降ループは描画のみ続けるため、揺れ・閃光の残りを消して画面を静める。 */
  private endRun(): void {
    this.pause = "ended";
    this.world.shake = 0;
    this.world.flash = 0;
  }

  private stats(): RunStats {
    const w = this.world;
    const evolved = w.weapons.filter((o) => WEAPONS[o.id].evolved).map((o) => o.id);
    return {
      time: w.t, kills: w.kills, level: w.player.level,
      damageDealt: Math.round(w.damageDealt),
      bossDefeated: w.bossDefeated,
      victory: w.player.hp > 0,
      mode: this.mode.id,
      bossKills: this.bossKills,
      weapons: w.weapons.map((o) => ({ id: o.id, level: o.level })),
      passives: w.passives.map((o) => ({ id: o.id, level: o.level })),
      evolved,
      seenEnemies: [...w.seen],
      seenBosses: [...w.seenBosses],
      schoolTiers: { ...w.maxTier },
      champions: this.championKills,
    };
  }

  // ---------- 派生ステータス ----------

  private passiveLv(id: PassiveId): number {
    return this.world.passives.find((p) => p.id === id)?.level ?? 0;
  }

  /** 武器アップグレードの差分をカード用バッジに変換する */
  private weaponDeltaBadges(def: WeaponDef, level: number): { label: string; value: string; up?: boolean }[] {
    const a = def.statsFor(level - 1);
    const b = def.statsFor(level);
    const out: { label: string; value: string; up?: boolean }[] = [];
    if (b.damage > a.damage) out.push({ label: "威力", value: `+${Math.round((b.damage - a.damage) * 10) / 10}`, up: true });
    if (b.amount > a.amount) out.push({ label: "数", value: `+${b.amount - a.amount}`, up: true });
    if (b.cooldown < a.cooldown) out.push({ label: "間隔", value: `-${Math.round((a.cooldown - b.cooldown) * 100) / 100}s`, up: true });
    if (b.area > a.area) out.push({ label: "範囲", value: `+${Math.round((b.area / a.area - 1) * 100)}%`, up: true });
    if (b.pierce > a.pierce && b.pierce < 900) out.push({ label: "貫通", value: `+${b.pierce - a.pierce}`, up: true });
    return out.slice(0, 3);
  }

  /** 所持中の武器・パッシブから、各流派の所持数を数える */
  private schoolCounts(): Record<SchoolId, number> {
    const c: Record<SchoolId, number> = { steel: 0, spirit: 0, moon: 0, blood: 0 };
    for (const ow of this.world.weapons) c[WEAPONS[ow.id].school]++;
    for (const op of this.world.passives) c[PASSIVES[op.id].school]++;
    return c;
  }

  /**
   * プレイヤーの総合性能(Derived)を毎フレーム導出する。発射側はこの結果だけを読み、
   * 装備構成を意識しない。3 段の積み上げ:
   *   ①基礎値(速度175 / 最大HP100 など) × パッシブのレベル補正(俊足+8%/Lv 等)
   *   ②祭壇の恒久強化(metaBonus。最大HP倍率・攻撃倍率…)を乗算/加算
   *   ③流派(紋章)セットボーナス(所持数→段位→貫通/間隔/範囲/再生など)を上乗せ
   * 各係数は data.ts(PASSIVES の levelDesc)/altar.ts/schoolBonusText と対応する。
   */
  private recomputeDerived(): void {
    const lv = (id: PassiveId) => this.passiveLv(id);
    const mb = this.metaBonus; // 祭壇の恒久強化(開始時ボーナス)
    // ---- ①基礎値 × パッシブ + ②祭壇の恒久強化 ----
    const d: Derived = {
      speed: 175 * (1 + 0.08 * lv("boots")) * mb.speedMul,
      maxHp: Math.round(100 * (1 + 0.15 * lv("heart")) * mb.maxHpMul),
      might: (1 + 0.08 * lv("might")) * mb.mightMul,
      cooldown: Math.max(0.5, 1 - 0.06 * lv("tome")) * mb.cooldownMul,
      area: 1 + 0.1 * lv("candle"),
      magnet: 70 * (1 + 0.3 * lv("magnet")) * mb.magnetMul,
      regen: 0.45 * lv("regen") + mb.regenAdd,
      amountBonus: lv("duplicator"),
      pierceBonus: 0,
      lifesteal: 0,
    };

    // ---- 流派(紋章)セットボーナス ----
    const c = this.schoolCounts();
    const tier = { steel: schoolTier(c.steel), spirit: schoolTier(c.spirit), moon: schoolTier(c.moon), blood: schoolTier(c.blood) };
    const mt = this.world.maxTier;
    mt.steel = Math.max(mt.steel, tier.steel);
    mt.spirit = Math.max(mt.spirit, tier.spirit);
    mt.moon = Math.max(mt.moon, tier.moon);
    mt.blood = Math.max(mt.blood, tier.blood);
    // 鋼: 貫通
    if (tier.steel >= 1) d.pierceBonus += tier.steel >= 2 ? 2 : 1;
    // 霊: 攻撃間隔
    if (tier.spirit >= 1) d.cooldown *= tier.spirit >= 2 ? 0.85 : 0.92;
    // 月: 範囲(と第2段で威力)
    if (tier.moon >= 1) {
      d.area *= tier.moon >= 2 ? 1.34 : 1.18;
      if (tier.moon >= 2) d.might *= 1.06;
    }
    // 血: 再生・最大HP(と第2段で吸命)
    if (tier.blood >= 1) {
      d.regen += tier.blood >= 2 ? 1.2 : 0.6;
      d.maxHp = Math.round(d.maxHp * (tier.blood >= 2 ? 1.16 : 1.08));
      if (tier.blood >= 2) d.lifesteal += 0.5;
    }
    d.cooldown = Math.max(0.4, d.cooldown);

    this.world.derived = d;
    this.world.player.maxHp = d.maxHp;
  }

  // ---------- プレイヤー ----------

  private updatePlayer(dt: number): void {
    const w = this.world;
    const p = w.player;
    const k = this.keys;
    let mx = 0;
    let my = 0;
    if (k.has("KeyW") || k.has("ArrowUp")) my -= 1;
    if (k.has("KeyS") || k.has("ArrowDown")) my += 1;
    if (k.has("KeyA") || k.has("ArrowLeft")) mx -= 1;
    if (k.has("KeyD") || k.has("ArrowRight")) mx += 1;
    const len = Math.hypot(mx, my);
    if (len > 0) { mx /= len; my /= len; }

    // スタミナ回復(ローリング中は回復しない)
    if (p.roll <= 0) p.stamina = Math.min(p.staminaMax, p.stamina + STAMINA_REGEN * dt);

    // ローリング開始要求の処理(押し始めの1回・スタミナが足り・回避中でない時のみ)
    if (this.rollRequested && p.roll <= 0 && p.stamina >= ROLL_COST) {
      p.stamina -= ROLL_COST;
      p.roll = ROLL_TIME;
      p.invuln = Math.max(p.invuln, ROLL_IFRAME); // 回避中は無敵
      // 回避方向: 入力があればその向き、無ければ最後の向き
      if (len > 0) { p.rollDirX = mx; p.rollDirY = my; }
      else { p.rollDirX = p.dirX; p.rollDirY = p.dirY; }
      p.dirX = p.rollDirX;
      p.dirY = p.rollDirY;
      this.burst(p.x, p.y, 10, "#bfe9ff", 2.4); // 残像風の塵
    }
    this.rollRequested = false; // 要求は1フレームで消費

    // 瘴気の鈍足デバフ(ローリングは気合で振り切れるよう影響を受けない)
    const slowMul = w.playerSlow > 0 ? 0.55 : 1;
    if (p.roll > 0) {
      // ローリング中: 入力を無視して回避方向へ高速移動
      p.roll = Math.max(0, p.roll - dt);
      p.x += p.rollDirX * w.derived.speed * ROLL_SPEED * dt;
      p.y += p.rollDirY * w.derived.speed * ROLL_SPEED * dt;
      p.moving = true;
      p.anim += dt * 2;
    } else if (len > 0) {
      // 通常移動
      p.x += mx * w.derived.speed * slowMul * dt;
      p.y += my * w.derived.speed * slowMul * dt;
      p.dirX = mx;
      p.dirY = my;
      p.moving = true;
      p.anim += dt;
    } else {
      p.moving = false;
    }

    p.invuln = Math.max(0, p.invuln - dt);
    if (w.derived.regen > 0) p.hp = Math.min(p.maxHp, p.hp + w.derived.regen * dt);

    // 聖域の境界: ここから先へは出られない(無限に逃げ続けることはできない)
    const cd = Math.hypot(p.x, p.y);
    const maxR = ARENA_RADIUS - 20;
    if (cd > maxR) {
      const s = maxR / cd;
      p.x *= s;
      p.y *= s;
    }
  }

  // ---------- 武器 ----------

  private updateWeapons(dt: number): void {
    const w = this.world;
    const d = w.derived;
    w.auraR = 0;

    for (const ow of w.weapons) {
      const def = WEAPONS[ow.id];
      const st = def.statsFor(ow.level);
      const amount = st.amount + (def.behavior === "aura" ? 0 : d.amountBonus);

      if (def.behavior === "orbs") {
        this.maintainOrbs(ow, amount, st.damage * d.might, st.area * d.area, st.speed, dt);
        continue;
      }
      if (def.behavior === "aura") {
        w.auraR = 86 * st.area * d.area;
        ow.tick -= dt;
        if (ow.tick <= 0) {
          ow.tick = st.cooldown * d.cooldown;
          this.auraTick(w.auraR, st.damage * d.might);
        }
        continue;
      }

      ow.cd -= dt;
      if (ow.cd > 0) continue;
      ow.cd = st.cooldown * d.cooldown;

      // 鋼の流派セットの貫通ボーナスを投射に上乗せ
      const stp = { ...st, pierce: st.pierce < 900 ? st.pierce + d.pierceBonus : st.pierce };

      switch (def.behavior) {
        case "bolt": this.fireGrimoire(amount, stp, d.might); break;
        case "knife": this.fireKnife(amount, stp, d.might, def.ring === true); break;
        case "boomerang": this.fireBoomerang(amount, stp, d.might, d.area); break;
        case "lightning": this.fireLightning(amount, stp, d.might, d.area); break;
      }
    }
  }

  private nearestEnemies(n: number, maxDist: number): Enemy[] {
    const p = this.world.player;
    const within = this.world.enemies
      .map((e) => ({ e, dd: (e.x - p.x) ** 2 + (e.y - p.y) ** 2 }))
      .filter((o) => o.dd < maxDist * maxDist)
      .sort((a, b) => a.dd - b.dd);
    return within.slice(0, n).map((o) => o.e);
  }

  private fireGrimoire(amount: number, st: { damage: number; speed: number; pierce: number; duration: number }, might: number): void {
    const p = this.world.player;
    const targets = this.nearestEnemies(amount, 760);
    for (let i = 0; i < amount; i++) {
      const tgt = targets[i % Math.max(1, targets.length)];
      let ang: number;
      if (tgt) ang = Math.atan2(tgt.y - p.y, tgt.x - p.x) + (i >= targets.length ? (Math.random() - 0.5) * 0.5 : 0);
      else ang = Math.random() * TAU;
      this.world.projectiles.push({
        kind: "bolt", x: p.x, y: p.y,
        vx: Math.cos(ang) * st.speed, vy: Math.sin(ang) * st.speed,
        damage: st.damage * might, radius: 8, pierce: st.pierce,
        life: st.duration, angle: ang, spin: 0, hit: new Set(),
      });
    }
  }

  private fireKnife(amount: number, st: { damage: number; speed: number; pierce: number; duration: number }, might: number, ring = false): void {
    const p = this.world.player;
    // 通常: 最も近い骸へ狙いを定める(銀のナイフの強み=確実に当たる前方斉射)。
    // 敵がいなければ進行方向へ。ring(真化): 全方位へ等間隔。
    let base = Math.atan2(p.dirY, p.dirX);
    if (!ring) {
      let best = Infinity;
      for (const e of this.world.enemies) {
        const d = (e.x - p.x) ** 2 + (e.y - p.y) ** 2;
        if (d < best) {
          best = d;
          base = Math.atan2(e.y - p.y, e.x - p.x);
        }
      }
    }
    for (let i = 0; i < amount; i++) {
      const ang = ring ? base + (i / amount) * TAU : base + (i - (amount - 1) / 2) * 0.09;
      const side = ring ? 0 : (i - (amount - 1) / 2) * 7;
      this.world.projectiles.push({
        kind: "knife",
        x: p.x + Math.cos(ang + Math.PI / 2) * side,
        y: p.y + Math.sin(ang + Math.PI / 2) * side,
        vx: Math.cos(ang) * st.speed, vy: Math.sin(ang) * st.speed,
        damage: st.damage * might, radius: 7, pierce: st.pierce,
        life: st.duration, angle: ang, spin: 0, hit: new Set(),
      });
    }
  }

  private fireBoomerang(amount: number, st: { damage: number }, might: number, area: number): void {
    const p = this.world.player;
    const boomA = BOOM_A * area;
    const boomB = BOOM_B * area;
    // 開始位相 π = 楕円の自機側端点(全個体ここから発つ)。θ 増加で「前方→側→後方→自機」と一周。
    const startAngle = Math.PI;
    // 全一周(2π)で自機に戻る。ライフは角速度から逆算した一周所要時間。
    const life = TAU / BOOM_SPEED;
    for (let i = 0; i < amount; i++) {
      // 宝珠と同様に個数で放射状に均等配分(1個:0°, 2個:0/180°, 3個:0/120/240°…)
      const boomDir = (i / amount) * TAU;
      this.world.projectiles.push({
        kind: "boomerang",
        x: p.x, y: p.y, // 開始は自機位置(初回 update で再計算される)
        vx: 0, vy: 0, // 位置は angle から毎フレーム再計算するため不使用
        damage: st.damage * might,
        radius: 20 * area, // 宝珠(10)の2倍
        pierce: 999,
        life,
        angle: startAngle, // 楕円位相として流用
        spin: BOOM_SPEED,  // 角速度 rad/s
        hit: new Set(),
        boomDir, boomA, boomB,
      });
    }
  }

  private fireLightning(amount: number, st: { damage: number; area: number }, might: number, areaMul: number): void {
    const w = this.world;
    const p = w.player;
    // 画面内(自機中心の視界内)の敵だけを標的にする。視界外への落雷はしない。
    const halfW = this.vw / 2;
    const halfH = this.vh / 2;
    const candidates = w.enemies.filter((e) => Math.abs(e.x - p.x) <= halfW && Math.abs(e.y - p.y) <= halfH);
    if (candidates.length === 0) return;
    for (let i = 0; i < amount; i++) {
      const tgt = candidates[Math.floor(Math.random() * candidates.length)];
      // 着弾の AoE 半径。威力は据え置き(高威力は直感的)で、範囲を絞って一掃力を抑える。
      const r = 36 * st.area * areaMul;
      w.bolts.push({ x: tgt.x, y: tgt.y, life: 0.28, seed: Math.random() * 100 });
      for (const e of w.enemies) {
        if ((e.x - tgt.x) ** 2 + (e.y - tgt.y) ** 2 < r * r) {
          this.damageEnemy(e, st.damage * might, "#ffd95e");
        }
      }
      this.burst(tgt.x, tgt.y, 8, "#ffd95e", 2.4);
      w.shake = Math.min(1, w.shake + 0.12);
    }
  }

  /** 周回する宝珠を amount 個に保ち、位置を更新する */
  private maintainOrbs(ow: OwnedWeapon, amount: number, damage: number, areaMul: number, angVel: number, dt: number): void {
    const w = this.world;
    const orbs = w.projectiles.filter((p) => p.kind === "orb");
    while (orbs.length < amount) {
      const o: Projectile = {
        kind: "orb", x: w.player.x, y: w.player.y, vx: 0, vy: 0,
        damage, radius: 10, pierce: 999, life: Infinity,
        angle: 0, spin: 0, hit: new Set(), orbIndex: orbs.length,
      };
      orbs.push(o);
      w.projectiles.push(o);
    }
    while (orbs.length > amount) {
      const o = orbs.pop()!;
      const idx = w.projectiles.indexOf(o);
      if (idx >= 0) w.projectiles.splice(idx, 1);
    }
    const radius = 78 * areaMul;
    const base = w.t * angVel;
    orbs.forEach((o, i) => {
      o.orbIndex = i;
      o.damage = damage;
      o.x = w.player.x + Math.cos(base + (i / amount) * TAU) * radius;
      o.y = w.player.y + Math.sin(base + (i / amount) * TAU) * radius;
    });
    // 接触判定(同一敵への再ヒットは 0.5 秒間隔)
    for (const e of w.enemies) {
      if (w.t - e.orbHitT < 0.5) continue;
      for (const o of orbs) {
        const rr = o.radius + e.radius;
        if ((e.x - o.x) ** 2 + (e.y - o.y) ** 2 < rr * rr) {
          e.orbHitT = w.t;
          this.damageEnemy(e, o.damage, "#6fd3ff", o.x, o.y, 130);
          break;
        }
      }
    }
  }

  private auraTick(radius: number, damage: number): void {
    const w = this.world;
    const p = w.player;
    for (const e of w.enemies) {
      const rr = radius + e.radius;
      if ((e.x - p.x) ** 2 + (e.y - p.y) ** 2 < rr * rr) {
        this.damageEnemy(e, damage, "#7be08a", p.x, p.y, 40);
      }
    }
  }

  // ---------- 投射物 ----------

  private updateProjectiles(dt: number): void {
    const w = this.world;
    const grid = this.buildGrid();
    for (let i = w.projectiles.length - 1; i >= 0; i--) {
      const pr = w.projectiles[i];
      if (pr.kind === "orb") continue; // 宝珠は maintainOrbs が管理
      pr.life -= dt;
      if (pr.kind === "boomerang") {
        // 楕円弧を投擲方向 boomDir へ回転させ、毎フレーム自機の現在位置を基準に再計算する。
        // ローカル楕円(進行方向 +X)は中心 (boomA,0)・点 (boomA cosθ, boomB sinθ)。
        // これを boomDir で回し自機へ加算。投擲後に自機が動いても楕円ごと追従し、
        // 自機側端点(位相2π)へ必ず戻る。
        pr.angle += pr.spin * dt;
        const a = pr.boomA ?? 0;
        const b = pr.boomB ?? 0;
        const cos = Math.cos(pr.boomDir ?? 0);
        const sin = Math.sin(pr.boomDir ?? 0);
        const lx = a + a * Math.cos(pr.angle); // ローカル x(自機からの距離)
        const ly = b * Math.sin(pr.angle);     // ローカル y(進行方向に直交)
        pr.x = w.player.x + lx * cos - ly * sin;
        pr.y = w.player.y + lx * sin + ly * cos;
      } else {
        pr.x += pr.vx * dt;
        pr.y += pr.vy * dt;
      }
      if (pr.life <= 0) {
        w.projectiles.splice(i, 1);
        continue;
      }
      // 近傍の敵とだけ衝突判定
      let dead = false;
      for (const e of this.queryGrid(grid, pr.x, pr.y, pr.radius + 28)) {
        if (pr.hit.has(e.id)) continue;
        const rr = pr.radius + e.radius;
        if ((e.x - pr.x) ** 2 + (e.y - pr.y) ** 2 < rr * rr) {
          pr.hit.add(e.id);
          const color = pr.kind === "bolt" ? "#cdbcff" : pr.kind === "knife" ? "#e8edf5" : "#e8c87a";
          this.damageEnemy(e, pr.damage, color, pr.x, pr.y, pr.kind === "boomerang" ? 160 : 90);
          if (pr.kind !== "boomerang") {
            pr.pierce--;
            if (pr.pierce <= 0) {
              w.projectiles.splice(i, 1);
              dead = true;
              break;
            }
          }
        }
      }
      if (dead) continue;
    }
  }

  // ---------- 敵 ----------

  private buildGrid(): Map<string, Enemy[]> {
    const grid = new Map<string, Enemy[]>();
    const CS = 80;
    for (const e of this.world.enemies) {
      const key = `${Math.floor(e.x / CS)},${Math.floor(e.y / CS)}`;
      const arr = grid.get(key);
      if (arr) arr.push(e);
      else grid.set(key, [e]);
    }
    return grid;
  }

  private queryGrid(grid: Map<string, Enemy[]>, x: number, y: number, r: number): Enemy[] {
    const CS = 80;
    const out: Enemy[] = [];
    const x0 = Math.floor((x - r) / CS);
    const x1 = Math.floor((x + r) / CS);
    const y0 = Math.floor((y - r) / CS);
    const y1 = Math.floor((y + r) / CS);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const arr = grid.get(`${cx},${cy}`);
        if (arr) out.push(...arr);
      }
    }
    return out;
  }

  private updateEnemies(dt: number): void {
    const w = this.world;
    const p = w.player;
    const grid = this.buildGrid();

    // 変種オーラの再計算: 大型種が生きていれば同種を加速、色違いが生きていれば同種を硬化
    w.auraSpeed.clear();
    w.auraTough.clear();
    w.bossRally = false; // 灰燼の使者の鼓舞は毎フレーム能力側で立て直す
    this.aliveChampions = 0;
    this.aliveWarlocks = 0;
    for (const e of w.enemies) {
      if (e.variant === "large") {
        w.auraSpeed.add(e.kind);
        this.aliveChampions++;
      } else if (e.variant === "recolor") {
        w.auraTough.add(e.kind);
        this.aliveChampions++;
      }
      if (e.kind === "warlock") this.aliveWarlocks++;
    }

    for (const e of w.enemies) {
      // プレイヤーへ直進 + ノックバック減衰
      const dx = p.x - e.x;
      const dy = p.y - e.y;
      const dist = Math.hypot(dx, dy) || 1;
      let spd = e.speed * (w.auraSpeed.has(e.kind) ? 1.4 : 1); // 大型種の加速オーラ
      // 灰燼の使者の鼓舞: 圏内の雑魚は奮い立って加速する(バフ)
      if (w.bossRally && w.boss && e.kind !== "boss" && REGULAR_KINDS.includes(e.kind)) {
        if ((e.x - w.boss.x) ** 2 + (e.y - w.boss.y) ** 2 < RALLY_RADIUS * RALLY_RADIUS) spd *= 1.5;
      }
      const nx = dx / dist;
      const ny = dy / dist;
      let vx = nx * spd;
      let vy = ny * spd;

      // 夜術師: 間合いを取り、横へ流れながら呪弾を放つ(密集に紛れて居座らせない)
      if (e.kind === "warlock") {
        const range = 300;
        const move = dist > range + 60 ? 1 : dist < range - 60 ? -1 : 0;
        vx = nx * spd * move;
        vy = ny * spd * move;
        if (move === 0) {
          // 間合いが取れているときは旋回して位置を散らす
          vx += -ny * spd * 0.55;
          vy += nx * spd * 0.55;
        }
        e.shootCd -= dt;
        if (e.shootCd <= 0 && dist < 600) {
          e.shootCd = 2.2 + Math.random() * 0.9;
          this.fireEnemyShot(e, dist);
        }
      } else if (e.kind === "boss" && e.bossType) {
        const bdef = BOSSES_BY_ID[e.bossType];
        if (bdef) {
          // 遠距離ボス: 追尾は続けつつ、周期的に三連の呪弾を扇状に放つ
          if (bdef.ranged) {
            e.shootCd -= dt;
            if (e.shootCd <= 0 && dist < 760) {
              e.shootCd = 2.6 + Math.random() * 1.0;
              this.fireBossVolley(e, dist);
            }
          }
          // ボス固有能力(召喚・分身・瘴気・夜啼き・鼓舞)
          this.updateBossAbility(e, bdef, dist, dt);
        }
      }

      // 近傍との分離(押し合い)
      let sx = 0;
      let sy = 0;
      for (const o of this.queryGrid(grid, e.x, e.y, e.radius + 16)) {
        if (o === e) continue;
        const ox = e.x - o.x;
        const oy = e.y - o.y;
        const dd = ox * ox + oy * oy;
        const min = e.radius + o.radius;
        if (dd > 0.01 && dd < min * min) {
          const d2 = Math.sqrt(dd);
          sx += (ox / d2) * (min - d2) * 3.2;
          sy += (oy / d2) * (min - d2) * 3.2;
        }
      }

      e.x += (vx + sx + e.kx) * dt;
      e.y += (vy + sy + e.ky) * dt;
      e.kx *= Math.pow(0.0015, dt);
      e.ky *= Math.pow(0.0015, dt);
      e.hitFlash = Math.max(0, e.hitFlash - dt);

      // 接触ダメージ
      const rr = e.radius + 12;
      if (p.invuln <= 0 && (e.x - p.x) ** 2 + (e.y - p.y) ** 2 < rr * rr) {
        p.hp -= e.damage * (1 - this.metaBonus.armor); // 鉄壁の祈り(被ダメ軽減)
        p.invuln = PLAYER_HIT_IFRAME;
        w.flash = PLAYER_HIT_FLASH;
        w.shake = Math.min(1, w.shake + 0.45);
        // 吸血卿の吸血: 打撃が通れば最大HPの一部を自己回復する
        if (e.kind === "boss" && e.bossType && BOSSES_BY_ID[e.bossType]?.ability === "swarm") {
          e.hp = Math.min(e.maxHp, e.hp + e.maxHp * 0.03);
          this.burst(e.x, e.y, 8, "#ff5a6e", 2.4);
        }
      }
    }
  }

  /** 夜術師が呪弾を放つ。プレイヤーの現在位置へ向け、わずかに進路を読む。 */
  private fireEnemyShot(e: Enemy, dist: number): void {
    const w = this.world;
    const p = w.player;
    const speed = 230;
    // 軽い偏差射撃: プレイヤーの移動方向へ少し先読みする
    const lead = p.moving ? Math.min(0.45, dist / speed) : 0;
    const aimX = p.x + p.dirX * w.derived.speed * lead;
    const aimY = p.y + p.dirY * w.derived.speed * lead;
    const ang = Math.atan2(aimY - e.y, aimX - e.x);
    w.enemyShots.push({
      x: e.x, y: e.y,
      vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed,
      damage: e.damage, radius: 8, life: 3.4, seed: Math.random() * 100,
    });
    this.burst(e.x, e.y, 5, "#c08aff", 2); // 発射の合図
  }

  /** 遠距離ボスの三連弾。プレイヤーへ向け扇状に放つ。弾は大きく遅く、接触より控えめな威力。 */
  private fireBossVolley(e: Enemy, dist: number): void {
    const w = this.world;
    const p = w.player;
    const speed = 210;
    const lead = p.moving ? Math.min(0.5, dist / speed) : 0;
    const base = Math.atan2(p.y + p.dirY * w.derived.speed * lead - e.y, p.x + p.dirX * w.derived.speed * lead - e.x);
    const col = BOSSES_BY_ID[e.bossType ?? ""]?.eye ?? "#ffb38a";
    const dmg = Math.round(e.damage * 0.55); // 弾は接触より弱め(回避前提)
    for (let i = -1; i <= 1; i++) {
      const ang = base + i * 0.22;
      w.enemyShots.push({
        x: e.x, y: e.y,
        vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed,
        damage: dmg, radius: 11, life: 4, seed: Math.random() * 100,
      });
    }
    this.burst(e.x, e.y, 10, col, 3);
  }

  /**
   * ボス固有能力の発動。各ボスを「ただ硬い的」から個性ある一戦に変える。
   *   swarm  … 蝙蝠へ分身(召喚)。打撃の吸血は接触判定側で処理。
   *   raise  … プレイヤーを囲う骸骨兵を蘇生召喚。
   *   miasma … 圏内なら鈍足デバフ+継続ダメージ(常時オーラ)。
   *   wail   … 夜啼きで視界を狭める(視界制限)。呪弾は ranged で別途。
   *   rally  … 周囲の雑魚を鼓舞(加速バフ)し、火炎弾を全方位へ放つ。
   */
  private updateBossAbility(e: Enemy, def: BossDef, dist: number, dt: number): void {
    const w = this.world;
    const p = w.player;
    switch (def.ability) {
      case "swarm": {
        e.abilityCd -= dt;
        if (e.abilityCd <= 0) {
          e.abilityCd = 6 + Math.random() * 1.5;
          this.summonSwarm(e);
        }
        break;
      }
      case "raise": {
        e.abilityCd -= dt;
        if (e.abilityCd <= 0) {
          e.abilityCd = 7.5 + Math.random() * 1.5;
          this.raiseSkeletons();
        }
        break;
      }
      case "miasma": {
        // 瘴気の圏内に居る間は鈍足を維持し、周期的に蝕む(離れれば自然減衰)
        const miasmaR = e.radius + 160;
        if (dist < miasmaR) {
          w.playerSlow = 0.5;
          e.abilityCd -= dt;
          if (e.abilityCd <= 0) {
            e.abilityCd = 0.6;
            p.hp -= Math.max(2, Math.round(e.damage * 0.12)) * (1 - this.metaBonus.armor);
            w.flash = Math.max(w.flash, 0.16);
            this.burst(p.x, p.y, 4, "#a6d96a", 1.6);
          }
        } else {
          e.abilityCd = 0; // 圏外では即時に蝕めるよう戻す
        }
        break;
      }
      case "wail": {
        e.abilityCd -= dt;
        if (e.abilityCd <= 0 && dist < 1000) {
          e.abilityCd = 7 + Math.random() * 2.5;
          this.wailT = 4; // 視界を数秒狭める
          w.shake = Math.min(1, w.shake + 0.4);
          this.burst(e.x, e.y, 26, def.eye, 4);
          w.texts.push({ x: e.x, y: e.y - e.radius - 10, text: "夜啼き…", life: 1.4, color: def.eye, size: 15 });
        }
        break;
      }
      case "rally": {
        w.bossRally = true; // 圏内の雑魚を加速(movement で反映)
        e.abilityCd -= dt;
        if (e.abilityCd <= 0) {
          e.abilityCd = 5 + Math.random() * 1.5;
          this.fireNova(e);
        }
        break;
      }
    }
  }

  /** 吸血卿の分身: 自身の周囲に蝙蝠の眷属を撒く。 */
  private summonSwarm(e: Enemy): void {
    const w = this.world;
    const n = 5;
    this.burst(e.x, e.y, 24, "#ff3d54", 4);
    w.texts.push({ x: e.x, y: e.y - e.radius - 10, text: "眷属召喚", life: 1.4, color: "#ff6f7e", size: 15 });
    for (let i = 0; i < n; i++) {
      if (w.enemies.length >= MAX_ENEMIES) break;
      const ang = (i / n) * TAU + Math.random() * 0.4;
      const d = e.radius + 24 + Math.random() * 30;
      this.spawnAt("bat", { x: e.x + Math.cos(ang) * d, y: e.y + Math.sin(ang) * d });
    }
  }

  /** 骸の王の召喚: プレイヤーを囲うリング状に骸骨兵を蘇らせる。 */
  private raiseSkeletons(): void {
    const w = this.world;
    const p = w.player;
    const n = 6;
    const base = Math.random() * TAU;
    const lim = ARENA_RADIUS - 40;
    w.texts.push({ x: p.x, y: p.y - 40, text: "死者復活", life: 1.4, color: "#9ad8ff", size: 15 });
    for (let i = 0; i < n; i++) {
      if (w.enemies.length >= MAX_ENEMIES) break;
      const ang = base + (i / n) * TAU;
      let x = p.x + Math.cos(ang) * 230;
      let y = p.y + Math.sin(ang) * 230;
      const d = Math.hypot(x, y);
      if (d > lim) { x = (x / d) * lim; y = (y / d) * lim; }
      this.burst(x, y, 12, "#cfe6ff", 3); // 蘇生の土埃
      this.spawnAt("skeleton", { x, y });
    }
  }

  /** 灰燼の使者の火炎弾: 自身を中心に全方位へ等間隔の呪弾を放つ。 */
  private fireNova(e: Enemy): void {
    const w = this.world;
    const def = BOSSES_BY_ID[e.bossType ?? ""];
    const col = def?.eye ?? "#ffd06a";
    const n = 14;
    const speed = 190;
    const dmg = Math.round(e.damage * 0.5);
    const off = Math.random() * TAU;
    for (let i = 0; i < n; i++) {
      const ang = off + (i / n) * TAU;
      w.enemyShots.push({
        x: e.x, y: e.y,
        vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed,
        damage: dmg, radius: 10, life: 4.2, seed: Math.random() * 100,
      });
    }
    this.burst(e.x, e.y, 24, col, 4);
  }

  /** 呪弾の更新。プレイヤーにのみ当たり、聖域外や寿命切れで消える。 */
  private updateEnemyShots(dt: number): void {
    const w = this.world;
    const p = w.player;
    const lim = ARENA_RADIUS + 40;
    for (let i = w.enemyShots.length - 1; i >= 0; i--) {
      const s = w.enemyShots[i];
      s.life -= dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      if (s.life <= 0 || s.x * s.x + s.y * s.y > lim * lim) {
        w.enemyShots.splice(i, 1);
        continue;
      }
      const rr = s.radius + 12;
      if (p.invuln <= 0 && (s.x - p.x) ** 2 + (s.y - p.y) ** 2 < rr * rr) {
        p.hp -= s.damage * (1 - this.metaBonus.armor);
        p.invuln = PLAYER_HIT_IFRAME;
        w.flash = PLAYER_HIT_FLASH;
        w.shake = Math.min(1, w.shake + 0.35);
        this.burst(s.x, s.y, 8, "#c08aff", 2.4);
        w.enemyShots.splice(i, 1);
      }
    }
  }

  private damageEnemy(e: Enemy, dmg: number, color: string, fromX?: number, fromY?: number, knock = 0): void {
    const w = this.world;
    // 色違いの硬化オーラ: 同種は被ダメージ軽減
    if (w.auraTough.has(e.kind)) dmg *= 0.7;
    e.hp -= dmg;
    e.hitFlash = 0.09;
    w.damageDealt += dmg;
    if (knock > 0 && fromX !== undefined && fromY !== undefined && e.kind !== "boss" && e.kind !== "elite") {
      const dx = e.x - fromX;
      const dy = e.y - fromY;
      const d = Math.hypot(dx, dy) || 1;
      e.kx += (dx / d) * knock;
      e.ky += (dy / d) * knock;
    }
    if (this.settings.damageNumbers && w.texts.length < 80) {
      w.texts.push({
        x: e.x + (Math.random() - 0.5) * 12, y: e.y - e.radius - 6,
        text: String(Math.round(dmg)), life: 0.6, color,
        size: dmg >= 40 ? 16 : 12,
      });
    }
    if (e.hp <= 0) this.killEnemy(e);
  }

  private killEnemy(e: Enemy): void {
    const w = this.world;
    const idx = w.enemies.indexOf(e);
    if (idx < 0) return;
    w.enemies.splice(idx, 1);
    w.kills++;
    if (e.variant !== "normal") {
      this.aliveChampions = Math.max(0, this.aliveChampions - 1);
      this.championKills++;
    }
    // 血の流派(第2段)の吸命: 撃破ごとに回復
    if (w.derived.lifesteal > 0) {
      w.player.hp = Math.min(w.player.maxHp, w.player.hp + w.derived.lifesteal);
    }
    const bossCol = e.kind === "boss" ? BOSSES_BY_ID[e.bossType ?? ""]?.color ?? ENEMIES.boss.color : ENEMIES[e.kind].color;
    this.burst(e.x, e.y, e.kind === "boss" ? 40 : 6, bossCol, e.kind === "boss" ? 5 : 2.2);

    if (e.kind === "boss") {
      w.boss = null;
      this.bossKills++;
      // 撃破の見せ場: 大爆発・閃光・震動・スローモー(主色で彩る)
      this.burst(e.x, e.y, 90, bossCol, 7);
      this.burst(e.x, e.y, 50, "#ffd9a0", 5);
      w.flash = 1;
      w.shake = 1;
      // 反復ボス(長征/無限)では撃破は勝利にならず、報酬を落として続行
      if (this.mode.bossRepeat) {
        for (let i = 0; i < 8; i++) {
          w.gems.push({ x: e.x + (Math.random() - 0.5) * 80, y: e.y + (Math.random() - 0.5) * 80, value: 14, vx: 0, vy: 0, big: true });
        }
        w.pickups.push({ kind: "potion", x: e.x, y: e.y });
        w.pickups.push({ kind: "magnet", x: e.x + 28, y: e.y });
        w.pickups.push({ kind: "loot", x: e.x - 28, y: e.y, lootTier: 2 }); // ボスは上質の戦利品
        this.slowmo = 0.6;
      } else {
        w.bossDefeated = true;
        this.slowmo = 1.4;
        this.victoryDelay = 1.4;
      }
      return;
    }
    if (e.kind === "elite") {
      for (let i = 0; i < 5; i++) {
        w.gems.push({ x: e.x + (Math.random() - 0.5) * 50, y: e.y + (Math.random() - 0.5) * 50, value: 10, vx: 0, vy: 0, big: true });
      }
      w.pickups.push({ kind: "potion", x: e.x, y: e.y + 20 });
      w.pickups.push({ kind: "magnet", x: e.x + 26, y: e.y });
      w.pickups.push({ kind: "loot", x: e.x - 26, y: e.y, lootTier: 1 }); // エリートは良質の戦利品を確定で落とす
      return;
    }
    // 通常ドロップ
    w.gems.push({ x: e.x, y: e.y, value: e.xp, vx: 0, vy: 0, big: e.xp >= 8 });
    if (e.kind !== "bat" && Math.random() < 0.025) {
      w.pickups.push({ kind: "potion", x: e.x, y: e.y });
    }
    // 戦利品(装備): 蝙蝠以外から低確率で(特異種は出やすい)。ホームのオートバトラーで装備する。
    if (e.kind !== "bat" && Math.random() < (e.variant !== "normal" ? 0.08 : 0.012)) {
      w.pickups.push({ kind: "loot", x: e.x, y: e.y - 6, lootTier: e.variant !== "normal" ? 1 : 0 });
    }
    // 経験石が増えすぎたら古いものを統合
    if (w.gems.length > 320) {
      const a = w.gems.shift()!;
      const b = w.gems[0];
      if (b) b.value += a.value;
    }
  }

  // ---------- 経験石・回復 ----------

  /**
   * 経験石と道具(秘薬/磁石/遺物/戦利品)の更新。
   * 経験石は回収範囲(magnet)に入ると自機へ吸い寄せられ、近いほど速く引かれる。
   * 触れた経験石は取得して XP に、道具は種別ごとに即時処理する。
   */
  private updateGems(dt: number): void {
    const w = this.world;
    const p = w.player;
    const magnet = w.derived.magnet; // 回収範囲(骸の磁鉄パッシブ等で拡大)

    for (let i = w.gems.length - 1; i >= 0; i--) {
      const g = w.gems[i];
      const dx = p.x - g.x;
      const dy = p.y - g.y;
      const dd = dx * dx + dy * dy;
      // 回収範囲内なら自機方向へ加速(残り距離が近いほど強く引く)
      if (dd < magnet * magnet) {
        const d = Math.sqrt(dd) || 1;
        const pull = 420 + (magnet - d) * 4;
        g.vx = (dx / d) * pull;
        g.vy = (dy / d) * pull;
      }
      g.x += g.vx * dt;
      g.y += g.vy * dt;
      g.vx *= Math.pow(0.01, dt); // 範囲外では速やかに減速して漂う
      g.vy *= Math.pow(0.01, dt);
      if (dd < 22 * 22) { // 触れた(22px 以内)→ 取得
        w.gems.splice(i, 1);
        this.gainXp(g.value);
      }
    }

    for (let i = w.pickups.length - 1; i >= 0; i--) {
      const pk = w.pickups[i];
      if ((pk.x - p.x) ** 2 + (pk.y - p.y) ** 2 < 26 * 26) {
        w.pickups.splice(i, 1);
        if (pk.kind === "potion") {
          p.hp = Math.min(p.maxHp, p.hp + 30);
          w.texts.push({ x: p.x, y: p.y - 30, text: "+30", life: 0.8, color: "#7be08a", size: 15 });
        } else if (pk.kind === "magnet") {
          // 磁石: 全経験石を引き寄せる
          for (const g of w.gems) {
            const d = Math.hypot(p.x - g.x, p.y - g.y) || 1;
            g.vx = ((p.x - g.x) / d) * 900;
            g.vy = ((p.y - g.y) / d) * 900;
          }
        } else if (pk.kind === "curio" && pk.curioId) {
          // 遺物を獲得: その場で収集済みに加え(同ラン再湧き防止)、UI へ通知して保存させる
          this.collectCurio(pk.curioId);
        } else if (pk.kind === "loot") {
          // 戦利品(装備): 取得を UI へ通知(ホームのオートバトラーで自動装備させる)
          this.burst(p.x, p.y, 12, "#ffce6b", 2.8);
          w.texts.push({ x: p.x, y: p.y - 30, text: "戦利品", life: 0.9, color: "#ffe0a0", size: 14 });
          this.emit({ type: "loot", tier: pk.lootTier ?? 0 });
        }
      }
    }
  }

  /** 遺物の獲得演出と通知。UI 側がプロファイルへ保存し、ホーム飾り棚に並ぶ。 */
  private collectCurio(id: string): void {
    if (this.collectedCurios.has(id)) return;
    this.collectedCurios.add(id);
    const w = this.world;
    const p = w.player;
    const c = CURIOS.find((x) => x.id === id);
    this.burst(p.x, p.y, 26, c?.color ?? "#ffe28a", 4);
    w.texts.push({ x: p.x, y: p.y - 34, text: `遺物「${c?.name ?? "？"}」`, life: 1.8, color: c?.color ?? "#ffe28a", size: 16 });
    this.emit({ type: "curio", id });
  }

  /**
   * 経験値を加算し、必要量に達するごとにレベルアップする。
   * 1 フレームで複数レベル上がることもあるため while で繰り上げ、上がった回数を
   * levelPending に積む(update がポーズ無しの間に1枚ずつカード提示へ消化する)。
   */
  private gainXp(v: number): void {
    const p = this.world.player;
    p.xp += v * this.metaBonus.xpMul; // 強欲の瞳(取得経験値増)
    while (p.xp >= p.xpNext) {
      p.xp -= p.xpNext;
      p.level++;
      p.xpNext = xpNeeded(p.level); // 次レベルの必要量(曲線は data.ts の xpNeeded)
      this.levelPending++;
    }
  }

  // ---------- エフェクト ----------

  private burst(x: number, y: number, n: number, color: string, size: number): void {
    const w = this.world;
    if (w.particles.length > 240) return;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const sp = 40 + Math.random() * 140;
      w.particles.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40,
        life: 0.5 + Math.random() * 0.3, maxLife: 0.8,
        size: size * (0.6 + Math.random() * 0.8), color, grav: 220,
      });
    }
  }

  private updateEffects(dt: number): void {
    const w = this.world;
    for (let i = w.particles.length - 1; i >= 0; i--) {
      const pa = w.particles[i];
      pa.life -= dt;
      if (pa.life <= 0) {
        w.particles.splice(i, 1);
        continue;
      }
      pa.vy += pa.grav * dt;
      pa.x += pa.vx * dt;
      pa.y += pa.vy * dt;
    }
    for (let i = w.texts.length - 1; i >= 0; i--) {
      const tx = w.texts[i];
      tx.life -= dt;
      tx.y -= 36 * dt;
      if (tx.life <= 0) w.texts.splice(i, 1);
    }
    for (let i = w.bolts.length - 1; i >= 0; i--) {
      w.bolts[i].life -= dt;
      if (w.bolts[i].life <= 0) w.bolts.splice(i, 1);
    }
    w.shake = Math.max(0, w.shake - dt * 2.4);
    w.flash = Math.max(0, w.flash - dt * 1.6);

    // ボス由来のプレイヤー状態異常の減衰
    w.playerSlow = Math.max(0, w.playerSlow - dt); // 瘴気を出れば鈍足は解ける
    this.wailT = Math.max(0, this.wailT - dt); // 夜啼きの視界制限
    // 視界倍率を目標(夜啼き中=0.58 / 通常=1)へ滑らかに寄せる
    const visTarget = this.wailT > 0 ? 0.58 : 1;
    w.visionScale += (visTarget - w.visionScale) * Math.min(1, dt * 4);
  }

  // ---------- スポーン ----------

  private currentWave() {
    while (
      this.waveIndex + 1 < WAVE_TABLE.length &&
      this.world.t >= WAVE_TABLE[this.waveIndex + 1].t
    ) {
      this.waveIndex++;
      const burst = WAVE_TABLE[this.waveIndex].burst;
      if (burst) this.spawnRing(burst.kind, burst.count);
    }
    return WAVE_TABLE[this.waveIndex];
  }

  private updateSpawner(dt: number): void {
    const w = this.world;
    const wave = this.currentWave();
    const m = this.mode;
    const esc = 1 + (w.t / 60) * m.escalate; // 経過に伴う増勢

    // 遺物(収集品)。時刻が来たら未収集を1つ場に落とす。場に出ている間は次を待つ。
    if (w.t >= this.nextCurioTime) {
      if (!this.curiosRemain()) {
        this.nextCurioTime = Infinity; // 全て集め終えた → 以降は落とさない
      } else if (w.pickups.some((pk) => pk.kind === "curio")) {
        this.nextCurioTime += 30; // まだ前の遺物が場に在る → 少し待って再確認
      } else {
        this.spawnCurio();
        this.nextCurioTime += 900; // 以降は約15分間隔(長征/無限向け)
      }
    }

    // エリート(モードにより固定テーブル or 周期)
    if (m.eliteInterval !== null) {
      if (w.t >= this.nextEliteTime) {
        this.nextEliteTime += m.eliteInterval;
        this.spawnAt("elite", this.edgePoint());
      }
    } else if (this.eliteIndex < ELITE_TIMES.length && w.t >= ELITE_TIMES[this.eliteIndex]) {
      this.eliteIndex++;
      this.spawnAt("elite", this.edgePoint());
    }

    // ボス(モードにより出現時刻・反復)。出現するボスはランダムで選ばれる。
    if (w.t >= this.nextBossTime && !w.boss) {
      w.boss = this.spawnBoss(this.edgePoint());
      this.bossSpawned = true;
      this.nextBossTime = m.bossRepeat ? this.nextBossTime + m.bossInterval : Infinity;
    }

    if (w.enemies.length >= MAX_ENEMIES) return;
    this.spawnAcc += dt * wave.rate * m.rateMul * esc;
    while (this.spawnAcc >= 1) {
      this.spawnAcc -= 1;
      const total = wave.kinds.reduce((s, [, wgt]) => s + wgt, 0);
      let r = Math.random() * total;
      let kind: EnemyKind = wave.kinds[0][0];
      for (const [k, wgt] of wave.kinds) {
        r -= wgt;
        if (r <= 0) {
          kind = k;
          break;
        }
      }
      // 夜術師(遠距離)は数を抑える。上限を超えたら通常種へ差し替える。
      if (kind === "warlock") {
        const cap = m.id === "endless" ? 8 : m.id === "long" ? 6 : 5;
        if (this.aliveWarlocks >= cap) kind = "bat";
        else this.aliveWarlocks++; // 同フレーム多重湧きでも上限を守る
      }
      this.spawnAt(kind, this.edgePoint(), this.rollVariant(kind));
    }
  }

  /** 通常モンスターに変種(大型/色違い)を確率的に付与する */
  private rollVariant(kind: EnemyKind): EnemyVariant {
    if (!REGULAR_KINDS.includes(kind)) return "normal";
    if (this.world.t < 75) return "normal"; // 序盤は出さない
    const cap = this.mode.id === "endless" ? 6 : this.mode.id === "long" ? 4 : 2;
    if (this.aliveChampions >= cap) return "normal";
    let p = 0.045 + (this.world.t / 600) * 0.09;
    if (this.mode.id === "long") p *= 1.4;
    if (this.mode.id === "endless") p *= 1.8;
    if (Math.random() > p) return "normal";
    return Math.random() < 0.5 ? "large" : "recolor";
  }

  /** まだ収集していない遺物が残っているか。 */
  private curiosRemain(): boolean {
    return CURIOS.some((c) => !this.collectedCurios.has(c.id));
  }

  /** 未収集の遺物を1つ、プレイヤーの近〜中距離(聖域内)に落とす。ミニマップにも映る。 */
  private spawnCurio(): void {
    const remaining = CURIOS.filter((c) => !this.collectedCurios.has(c.id));
    if (remaining.length === 0) return;
    const c = remaining[Math.floor(Math.random() * remaining.length)];
    const p = this.world.player;
    const lim = ARENA_RADIUS - 60;
    // プレイヤーから 220〜460px の取りに行ける距離へ。聖域内に収める。
    let x = 0;
    let y = 0;
    for (let i = 0; i < 12; i++) {
      const ang = Math.random() * TAU;
      const dist = 220 + Math.random() * 240;
      x = p.x + Math.cos(ang) * dist;
      y = p.y + Math.sin(ang) * dist;
      if (x * x + y * y <= lim * lim) break;
    }
    const d = Math.hypot(x, y);
    if (d > lim) { x = (x / d) * lim; y = (y / d) * lim; }
    this.world.pickups.push({ kind: "curio", x, y, curioId: c.id });
    // 出現の合図(取りこぼさないよう少し派手に)
    this.burst(x, y, 18, c.color, 3);
    this.world.texts.push({ x, y: y - 28, text: "遺物の気配…", life: 2.2, color: c.color, size: 14 });
  }

  /**
   * 湧き点を「視界の外」かつ「聖域の内」に取る。
   * これで敵が画面内に唐突に現れることも、境界外から延々歩いて来ることもなくなる。
   */
  private edgePoint(): { x: number; y: number } {
    const p = this.world.player;
    const minDist = Math.hypot(this.vw, this.vh) / 2 + 50; // 視界の外接円 + 余白
    const lim = ARENA_RADIUS - 30; // 聖域の内側

    // まずは全方位から: 視界外かつ聖域内の点が取れたら採用
    for (let i = 0; i < 16; i++) {
      const ang = Math.random() * TAU;
      const dist = minDist + Math.random() * 90;
      const x = p.x + Math.cos(ang) * dist;
      const y = p.y + Math.sin(ang) * dist;
      if (x * x + y * y <= lim * lim) return { x, y };
    }

    // プレイヤーが境界際にいると上の全方位では収まりにくい。
    // 中心側(±90°)へ絞り、その向きで聖域の縁に達する最長距離 tMax 内に湧かせる。
    const toCenter = Math.atan2(-p.y, -p.x);
    const solveEdge = (dx: number, dy: number) => {
      // |p + t·d| = lim を解いた正の根(d は単位ベクトル)
      const b = p.x * dx + p.y * dy;
      const c = p.x * p.x + p.y * p.y - lim * lim;
      return -b + Math.sqrt(Math.max(0, b * b - c));
    };
    for (let i = 0; i < 16; i++) {
      const ang = toCenter + (Math.random() - 0.5) * Math.PI;
      const dx = Math.cos(ang);
      const dy = Math.sin(ang);
      const tMax = solveEdge(dx, dy);
      if (tMax > minDist) {
        const dist = minDist + Math.random() * (tMax - minDist);
        return { x: p.x + dx * dist, y: p.y + dy * dist };
      }
    }

    // 最終手段(視界が聖域より広い極端な画面): 中心方向の最も遠い聖域内の点。
    const dx = Math.cos(toCenter);
    const dy = Math.sin(toCenter);
    const tMax = solveEdge(dx, dy);
    return { x: p.x + dx * tMax, y: p.y + dy * tMax };
  }

  private spawnRing(kind: EnemyKind, count: number): void {
    const p = this.world.player;
    const dist = Math.hypot(this.vw, this.vh) / 2 + 40;
    for (let i = 0; i < count; i++) {
      const ang = (i / count) * TAU;
      this.spawnAt(kind, { x: p.x + Math.cos(ang) * dist, y: p.y + Math.sin(ang) * dist });
    }
  }

  private spawnAt(kind: EnemyKind, pos: { x: number; y: number }, variant: EnemyVariant = "normal"): Enemy {
    const w = this.world;
    const m = this.mode;
    // 聖域内に収める(境界外に湧いて延々歩いてこない)
    const pd = Math.hypot(pos.x, pos.y);
    const lim = ARENA_RADIUS - 30;
    if (pd > lim) {
      pos.x = (pos.x / pd) * lim;
      pos.y = (pos.y / pd) * lim;
    }
    const def = ENEMIES[kind];
    const esc = 1 + (w.t / 60) * m.escalate;
    const hMul = (kind === "boss" || kind === "elite" ? 1 + (w.t / 60) * 0.02 : hpScale(w.t)) * m.hpMul * esc;
    const v = variantTuning(variant);
    const hp = Math.round(def.hp * hMul * (v?.hpMul ?? 1));
    const e: Enemy = {
      id: this.enemyId++, kind, variant,
      x: pos.x, y: pos.y,
      hp, maxHp: hp,
      speed: def.speed * (0.92 + Math.random() * 0.16) * (v?.speedMul ?? 1),
      damage: Math.round(def.damage * dmgScale(w.t) * m.dmgMul * (v?.dmgMul ?? 1)),
      radius: def.radius * (v?.radiusMul ?? 1),
      xp: Math.round(def.xp * (v?.xpMul ?? 1)),
      hitFlash: 0, kx: 0, ky: 0, orbHitT: -1,
      wobble: Math.random() * TAU,
      shootCd: kind === "warlock" ? 1.2 + Math.random() * 1.6 : 0, // 初撃をばらけさせる
      abilityCd: 0,
    };
    w.enemies.push(e);
    w.seen.add(kind);
    if (variant !== "normal") {
      this.aliveChampions++;
      // 出現の合図: オーラ色の塵を撒く(視界内なら閃きとして、外でも到来の余韻として)
      this.burst(e.x, e.y, 14, variant === "large" ? "#ffc45a" : "#b078ff", 3);
    }
    return e;
  }

  /** ランダムに1体のボスを選び、基準ボスに倍率を掛けて生成する(直前と同じは避ける)。 */
  private spawnBoss(pos: { x: number; y: number }): Enemy {
    const pool = BOSSES.filter((b) => b.id !== this.lastBossId);
    const def = (pool.length ? pool : BOSSES)[Math.floor(Math.random() * (pool.length || BOSSES.length))];
    this.lastBossId = def.id;
    const e = this.spawnAt("boss", pos);
    // 個性付け: 基準ボスのステータスに倍率を掛ける
    e.bossType = def.id;
    this.world.seenBosses.add(def.id); // ボス図鑑の発見記録
    e.hp = Math.round(e.hp * def.hpMul);
    e.maxHp = e.hp;
    e.speed *= def.speedMul;
    e.damage = Math.round(e.damage * def.dmgMul);
    e.radius *= def.radiusMul;
    e.shootCd = def.ranged ? 2.4 + Math.random() * 1.2 : 0;
    e.abilityCd = this.abilityFirstDelay(def.ability); // 初回発動までの猶予
    // 到来の地鳴り(画面の震えと主色の塵)+ 異名と能力の予告
    this.world.shake = Math.min(1, this.world.shake + 0.6);
    this.burst(e.x, e.y, 30, def.color, 5);
    this.world.texts.push({ x: e.x, y: e.y - e.radius - 26, text: def.name, life: 2.6, color: def.color, size: 20 });
    this.world.texts.push({ x: e.x, y: e.y - e.radius - 4, text: def.trait, life: 2.6, color: "#e7dcc6", size: 13 });
    return e;
  }

  /** 各能力の初回発動までの遅延秒(出現直後に撃たれないよう猶予を置く)。 */
  private abilityFirstDelay(ability: BossAbility): number {
    switch (ability) {
      case "swarm": return 3.5;
      case "raise": return 4.0;
      case "miasma": return 0; // 常時オーラ(クールダウン不要)
      case "wail": return 5.0;
      case "rally": return 3.0;
    }
  }

  // ---------- レベルアップ選択肢 ----------

  private makeChoices(): UpgradeChoice[] {
    const w = this.world;
    const pool: UpgradeChoice[] = [];
    const evoPool: UpgradeChoice[] = [];

    const weaponChoice = (def: WeaponDef, level: number, isNew: boolean): UpgradeChoice => ({
      key: `w:${def.id}`, kind: "weapon", id: def.id,
      name: def.name, icon: def.icon, color: def.color,
      level, isNew,
      desc: isNew ? def.desc : describeWeaponUpgrade(def, level),
      school: def.school,
      archetype: weaponArchetype(def),
      levelMax: def.maxLevel,
      stats: isNew ? weaponStatBadges(def, 1) : this.weaponDeltaBadges(def, level),
    });
    const passiveChoice = (def: PassiveDef, level: number, isNew: boolean): UpgradeChoice => ({
      key: `p:${def.id}`, kind: "passive", id: def.id,
      name: def.name, icon: def.icon, color: def.color,
      level, isNew,
      desc: isNew ? def.desc : def.levelDesc(level),
      school: def.school,
      levelMax: def.maxLevel,
      stats: [{ label: isNew ? "効果" : `Lv.${level}`, value: def.levelDesc(level).replace(/（.*?）/g, "").trim(), up: true }],
    });

    for (const ow of w.weapons) {
      const def = WEAPONS[ow.id];
      if (ow.level < def.maxLevel) pool.push(weaponChoice(def, ow.level + 1, false));

      // 真化カード: 基底武器が最大Lv かつ 対パッシブを所持しているとき出現
      if (!def.evolved && ow.level >= def.maxLevel) {
        for (const branch of EVOLUTIONS[ow.id] ?? []) {
          if (this.passiveLv(branch.req) < 1) continue;
          const evo = WEAPONS[branch.evo];
          evoPool.push({
            key: `evo:${evo.id}`, kind: "weapon", id: evo.id,
            name: evo.name, icon: evo.icon, color: evo.color,
            level: 1, isNew: false, evolution: true, replaces: ow.id, fromName: def.name,
            desc: branch.desc,
            school: evo.school, archetype: weaponArchetype(evo), levelMax: evo.maxLevel,
            stats: weaponStatBadges(evo, 1),
          });
        }
      }
    }
    for (const op of w.passives) {
      const def = PASSIVES[op.id];
      if (op.level < def.maxLevel) pool.push(passiveChoice(def, op.level + 1, false));
    }
    if (w.weapons.length < 6) {
      for (const def of Object.values(WEAPONS)) {
        if (def.evolved || def.signature) continue; // 進化形態・専用技は通常プールに出さない
        if (!w.weapons.some((o) => o.id === def.id)) pool.push(weaponChoice(def, 1, true));
      }
    }
    if (w.passives.length < 6) {
      for (const def of Object.values(PASSIVES)) {
        if (!w.passives.some((o) => o.id === def.id)) pool.push(passiveChoice(def, 1, true));
      }
    }

    // 専用技(スキン秘伝): 装備中・未所持・枠があれば修得カードを必ず1枚提示する。
    let sigChoice: UpgradeChoice | null = null;
    if (
      this.signatureWeapon &&
      w.weapons.length < 6 &&
      !w.weapons.some((o) => o.id === this.signatureWeapon)
    ) {
      const def = WEAPONS[this.signatureWeapon];
      if (def) sigChoice = { ...weaponChoice(def, 1, true), key: `sig:${def.id}`, signature: true };
    }

    if (pool.length === 0 && evoPool.length === 0 && !sigChoice) {
      return [{
        key: "heal", kind: "heal",
        name: "聖餐", icon: "chalice", color: "#e0455e",
        level: 0, isNew: false, desc: "すべてを極めた。HP を 40 回復する。",
      }];
    }

    // Fisher–Yates で通常プールを混ぜる
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }

    // 真化・専用技は優先的に枠を確保する(到達感を保証)
    const forced: UpgradeChoice[] = [];
    if (evoPool.length > 0) {
      for (let i = evoPool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [evoPool[i], evoPool[j]] = [evoPool[j], evoPool[i]];
      }
      forced.push(evoPool[0]);
      // 専用技と競合しないときは 2 枚目の真化(分岐)を稀に同時提示
      if (evoPool[1] && !sigChoice && Math.random() < 0.4) forced.push(evoPool[1]);
    }
    if (sigChoice) forced.push(sigChoice);

    return [...forced, ...pool].slice(0, 3);
  }

  // ---------- HUD ----------

  private pushHud(): void {
    const w = this.world;
    const hud: HudState = {
      hp: Math.max(0, Math.round(w.player.hp)),
      maxHp: w.player.maxHp,
      stamina: Math.max(0, Math.round(w.player.stamina)),
      staminaMax: w.player.staminaMax,
      rollReady: w.player.stamina >= ROLL_COST,
      level: w.player.level,
      xp: w.player.xp,
      xpNext: w.player.xpNext,
      time: w.t,
      kills: w.kills,
      mode: this.mode.id,
      victoryTime: this.mode.victoryTime,
      weapons: w.weapons.map((o) => {
        const d = WEAPONS[o.id];
        return { id: o.id, icon: d.icon, level: o.level, maxLevel: d.maxLevel, evolved: d.evolved === true, color: d.color, name: d.name };
      }),
      passives: w.passives.map((o) => {
        const d = PASSIVES[o.id];
        return { id: o.id, icon: d.icon, level: o.level, maxLevel: d.maxLevel, evolved: false, color: d.color, name: d.name };
      }),
      schools: (() => {
        const counts = this.schoolCounts();
        const out: HudSchool[] = [];
        for (const s of Object.values(SCHOOLS)) {
          const count = counts[s.id];
          if (count <= 0) continue;
          out.push({ id: s.id, name: s.name, icon: s.icon, color: s.color, count, tier: schoolTier(count) });
        }
        return out.sort((a, b) => b.count - a.count);
      })(),
      bossHp: w.boss
        ? { hp: Math.max(0, w.boss.hp), max: w.boss.maxHp, name: BOSSES_BY_ID[w.boss.bossType ?? ""]?.name ?? ENEMIES.boss.name }
        : null,
    };
    this.emit({ type: "hud", hud });
  }

  // ---------- 描画 ----------

  private draw(): void {
    this.renderer.render(this.world, this.settings);
  }
}
