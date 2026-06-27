// ═══════════════════════════════════════════════════════════
//  〔層〕付属的な機能 / AUXILIARY ── タスクバーヒーローの戦闘シミュレーション
//
//  役割(マクロ): ホーム画面のオートバトラー「タスクバーヒーロー」の“動く中身”。
//    本編の engine.ts と UI の関係に倣い、ここは React/DOM に一切触れない純ロジック
//    として戦闘を 1 フレームずつ進める。描画(座標→%、SVG/CSS)は ui/TaskbarHero.tsx
//    に分離する。難度・装備の数値そのものは meta/hero.ts(rollLoot / heroStats /
//    waveCount …)に集約され、ここはそれらを読んで“状態機械”を回すだけ。
//  挙動(ミクロ): ウェーブ制の状態機械 ── rest(小休止/回復) → spawning/fighting
//    (波を湧かせて戦う) → 撃破で次の深度へ。HP が尽きると defeat(フェードアウト)
//    を経て深度を下げて立て直す。進行(撃破/XP/深度)はこの sim が正本で、保存は
//    呼び出し側(App)が onHeroSync で行う。
//
//  公開 API:
//    ・createSim(profile, now) … 離席ぶんを精算した初期状態を作る。
//    ・stepSim(sim, profile, dt) … 1 フレーム進める(sim を破壊的に更新)。
//    ・liveStats(sim, profile) … 生きた xp/深度を反映した戦闘ステータス。
//    ・VW / HERO_X / BOLT_TIME … 描画側が座標変換に使う共有定数。
// ═══════════════════════════════════════════════════════════

import type { EnemyKind } from "../game/types";
import type { Profile } from "./profile";
import {
  ENEMY_MELEE_CD,
  enemyAtkAt,
  enemyHpAt,
  FOE_THROW_CD,
  FOE_THROW_DMG_MUL,
  heroStats,
  offlineProgress,
  waveCount,
  xpPerKillAt,
  type HeroStats,
} from "./hero";

// ---- レイアウト(仮想座標。CSS 側で帯幅 100% に伸縮される) ----
export const VW = 560; // 仮想座標の横幅
export const HERO_X = 92; // ヒーローの定位置
const FRONT_X = HERO_X + 46; // 先頭の敵が止まる交戦位置
const FOE_SPACING = 38; // 後続の敵が縦列に並ぶ間隔(重なり防止)
export const BOLT_TIME = 0.14; // 魔弾がヒーロー→敵へ届くまでの秒数

// ---- ウェーブのテンポ(ゆったりした波・湧きが速すぎないように) ----
const REST_SEC = 3.4; // ウェーブ間の小休止(明確な波の切れ目・回復の間)
const WAVE_GAP = 1.0; // ウェーブ内の 1 体ずつの湧き間隔
const MAX_ON_SCREEN = 3; // 同時に画面へ出す敵数の上限

// ---- 戦闘の各種係数(挙動の質感) ----
// 会心率/会心倍率は装備特性で変わるため heroStats(stats.critChance/critMult)が司る。
const ENEMY_SPD_MAX = 118; // 敵の歩速の上限
const REGEN_REST = 0.6; // 小休止中の毎秒回復(最大HP比)
const REGEN_FIGHT = 0.03; // 戦闘中の微回復(最大HP比/秒)
const DEFEAT_DROP = 3; // 敗北時に下げる深度
const STRIKE_LIFE = 0.28; // 着弾炸裂の寿命
const FOE_SHOT_SPEED = 240; // 後列の敵が投げる飛び道具の速さ(自機へ向かう)

// 深度が上がるほど手強い種が前列に混じる
const FOES: EnemyKind[] = ["bat", "zombie", "skeleton", "wraith", "warlock", "brute"];
const enemyPool = (depth: number): EnemyKind[] =>
  FOES.slice(0, Math.min(FOES.length, 1 + Math.ceil(depth / 3)));

// ---- 実行時エンティティ(描画側が読み取る) ----
export type SimPhase = "rest" | "spawning" | "fighting" | "defeat";
export interface SimFoe { id: number; kind: EnemyKind; x: number; hp: number; maxHp: number; atkCd: number; throwCd: number; dying: number; hitFlash: number; }
export interface SimPop { id: number; x: number; y: number; text: string; life: number; kind: "kill" | "crit" | "reset" | "hurt" | "wave"; }
export interface SimStrike { id: number; x: number; life: number; crit: boolean; } // 魔弾の着弾(炸裂)
export interface SimBolt { id: number; fromX: number; toX: number; life: number; crit: boolean; } // ヒーローの魔弾(右向き)
export interface SimFoeShot { id: number; x: number; dmg: number; } // 後列の敵が投げる飛び道具(自機=左へ)

/** ミニゲーム 1 ラン分の可変状態。すべて stepSim が破壊的に進める。 */
export interface HeroSim {
  live: { kills: number; xp: number; depth: number }; // 進行の正本(保存対象)
  phase: SimPhase;
  hp: number;
  foes: SimFoe[];
  pops: SimPop[];
  strikes: SimStrike[];
  bolts: SimBolt[]; // ヒーローの魔弾
  foeShots: SimFoeShot[]; // 後列の敵が投げた飛び道具
  // ヒーローの演出タイマー(1→0 に減衰)
  cast: number; // 詠唱の閃光
  lunge: number; // 踏み込み
  heroFlash: number; // 被弾フラッシュ
  heroAlpha: number; // 敗北フェード(1=不透明)
  // ウェーブ進行タイマー
  queue: number; // この波で残り湧かせる数
  spawnTimer: number;
  restTimer: number;
  defeatTimer: number;
  heroAtkCd: number;
  _id: number; // エンティティ id の採番
}

/** 生きた xp/深度を反映した戦闘ステータス(装備は profile から)。 */
export function liveStats(sim: HeroSim, profile: Profile): HeroStats {
  return heroStats({ ...profile, hero: { ...profile.hero, xp: sim.live.xp, depth: sim.live.depth } });
}

/** 離席ぶんを精算した初期状態を作る。 */
export function createSim(profile: Profile, now: number): HeroSim {
  const seed = offlineProgress(profile, now);
  const maxHp = heroStats({ ...profile, hero: { ...profile.hero, xp: seed.xp } }).maxHp;
  return {
    live: { kills: seed.kills, xp: seed.xp, depth: seed.depth },
    phase: "rest", hp: maxHp,
    foes: [], pops: [], strikes: [], bolts: [], foeShots: [],
    cast: 0, lunge: 0, heroFlash: 0, heroAlpha: 1,
    queue: 0, spawnTimer: 0, restTimer: 1.0, defeatTimer: 0, heroAtkCd: 0,
    _id: 1,
  };
}

/** 1 フレーム進める。dt は秒(呼び出し側で上限クランプ済みを想定)。 */
export function stepSim(sim: HeroSim, profile: Profile, dt: number): void {
  const stats = liveStats(sim, profile);
  if (sim.hp > stats.maxHp) sim.hp = stats.maxHp; // 装備変更で最大HPが縮んだ時の調整

  // ヒーロー演出タイマーの減衰
  sim.lunge = Math.max(0, sim.lunge - dt * 4);
  sim.cast = Math.max(0, sim.cast - dt * 6);
  sim.heroFlash = Math.max(0, sim.heroFlash - dt * 5);

  if (sim.phase === "rest") stepRest(sim, stats, dt);
  else if (sim.phase === "defeat") stepDefeat(sim, stats, dt);
  else stepCombat(sim, stats, dt);

  advanceEffects(sim, dt);
}

// ---------- 状態ごとの 1 フレーム処理 ----------

/** 小休止: HP を素早く回復し、時間が来たら次の波を始める。 */
function stepRest(sim: HeroSim, stats: HeroStats, dt: number): void {
  sim.hp = Math.min(stats.maxHp, sim.hp + stats.maxHp * REGEN_REST * stats.regenMul * dt);
  sim.restTimer -= dt;
  if (sim.restTimer <= 0) beginWave(sim);
}

/** 波の開始: 残敵を一掃し、湧き数を仕込み、「第N波」を予告する。 */
function beginWave(sim: HeroSim): void {
  sim.phase = "spawning";
  sim.queue = waveCount(sim.live.depth);
  sim.spawnTimer = 0.4; // 波の頭に小さな“間”
  sim.foes.length = 0;
  sim.foeShots.length = 0; // 前の波の飛び道具は持ち越さない
  sim.pops.push({ id: sim._id++, x: VW * 0.5, y: 16, text: `第 ${sim.live.depth} 波`, life: 1.6, kind: "wave" });
}

/** 敗北: フェードアウトののち、深度を下げて立て直す(戦闘リセット)。 */
function stepDefeat(sim: HeroSim, stats: HeroStats, dt: number): void {
  sim.heroAlpha = Math.max(0, sim.heroAlpha - dt / 0.6);
  sim.defeatTimer -= dt;
  if (sim.defeatTimer <= 0) {
    sim.live.depth = Math.max(1, sim.live.depth - DEFEAT_DROP);
    sim.hp = stats.maxHp;
    sim.heroAlpha = 1;
    sim.foes.length = 0;
    sim.foeShots.length = 0;
    sim.phase = "rest";
    sim.restTimer = 1.0;
  }
}

/** 戦闘中: 湧き→整列前進→ヒーロー攻撃→微回復→勝敗/次波の判定。 */
function stepCombat(sim: HeroSim, stats: HeroStats, dt: number): void {
  // 湧き(画面内の上限まで、1 体ずつ間隔をあけて)
  sim.spawnTimer -= dt;
  const aliveOnScreen = sim.foes.filter((f) => f.dying === 0).length;
  if (sim.queue > 0 && sim.spawnTimer <= 0 && aliveOnScreen < MAX_ON_SCREEN) {
    spawnFoe(sim);
    sim.queue--;
    sim.spawnTimer = WAVE_GAP;
  }

  advanceFoes(sim, stats, dt); // 縦列に整列して前進・先頭は近接/後列は投擲
  advanceFoeShots(sim, stats, dt); // 投げられた飛び道具を進め、到達分を被弾(同フレームの敗北判定に含める)
  heroAttack(sim, stats, dt); // 最前の敵へ魔弾

  // 微回復
  sim.hp = Math.min(stats.maxHp, sim.hp + stats.maxHp * REGEN_FIGHT * stats.regenMul * dt);

  // 完全に消えた敵を除く(生存=dying0 / 消滅中=dying>0 / 消滅=dying<0)
  sim.foes = sim.foes.filter((f) => f.dying >= 0);

  if (sim.hp <= 0) {
    // 押し負け → フェードアウトして立て直しへ
    sim.phase = "defeat";
    sim.defeatTimer = 0.95;
    sim.pops.push({ id: sim._id++, x: HERO_X, y: 18, text: "態勢を立て直す", life: 1.4, kind: "reset" });
  } else if (sim.queue === 0 && sim.foes.filter((f) => f.dying === 0).length === 0) {
    // 波を殲滅 → 小休止して次の深度へ
    sim.live.depth += 1;
    sim.foes.length = 0;
    sim.foeShots.length = 0;
    sim.phase = "rest";
    sim.restTimer = REST_SEC;
  }
}

/** 1 体を画面右の外から湧かせる。深度に応じた種・HP。 */
function spawnFoe(sim: HeroSim): void {
  const pool = enemyPool(sim.live.depth);
  const kind = pool[Math.floor(Math.random() * pool.length)];
  const hp = enemyHpAt(sim.live.depth);
  // throwCd は初手をばらけさせるため乱数で始める(湧いた直後に一斉投擲しない)
  sim.foes.push({ id: sim._id++, kind, x: VW + 24 + Math.random() * 40, hp, maxHp: hp, atkCd: 0.4 + Math.random() * 0.5, throwCd: 0.4 + Math.random() * 0.8, dying: 0, hitFlash: 0 });
}

/**
 * 敵を縦列(先頭=自機側)に整列させて前進させる。停止位置に着いた敵は:
 *   ・先頭(i===0)        … 接敵して近接攻撃(打撃間隔ごとに HP を削る)
 *   ・後列(i>=1)         … 待ちながら自機へ飛び道具を投げる(近接の半分の威力)
 * これで「後ろで待つだけ」の退屈さを無くし、列が深いほど圧が増す。
 */
function advanceFoes(sim: HeroSim, stats: HeroStats, dt: number): void {
  const depth = sim.live.depth;
  const enemySpd = Math.min(ENEMY_SPD_MAX, 56 + depth * 2);
  const queue = sim.foes.filter((f) => f.dying === 0).sort((a, b) => a.x - b.x);
  for (let i = 0; i < queue.length; i++) {
    const f = queue[i];
    f.hitFlash = Math.max(0, f.hitFlash - dt);
    const stopX = FRONT_X + i * FOE_SPACING; // 並ぶ位置(重なり防止)
    if (f.x > stopX) f.x = Math.max(stopX, f.x - enemySpd * dt); // 列の位置まで前進
    // 攻撃は移動と独立。先頭は交戦距離で近接、後列は画面内なら投擲する。
    if (i === 0) {
      if (f.x <= stopX + 2) {
        f.atkCd -= dt;
        if (f.atkCd <= 0) {
          f.atkCd = ENEMY_MELEE_CD;
          const raw = enemyAtkAt(depth);
          hurtHero(sim, stats, raw);
          // 返し刃(thorns): 近接してきた先頭へ反射ダメージ
          if (stats.thorns > 0) {
            f.hp -= raw * stats.thorns;
            f.hitFlash = 0.16;
            if (f.hp <= 0 && f.dying === 0) killFoe(sim, f, depth, "反射", "kill");
          }
        }
      }
    } else if (f.x < VW * 0.92) {
      // 後列は近づきながら自機へ飛び道具を投げる(近接より控えめな威力)
      f.throwCd -= dt;
      if (f.throwCd <= 0) {
        f.throwCd = FOE_THROW_CD * (0.85 + Math.random() * 0.3);
        sim.foeShots.push({ id: sim._id++, x: f.x, dmg: enemyAtkAt(depth) * FOE_THROW_DMG_MUL });
      }
    }
  }
}

/** 自機が被弾する共通処理(守勢で軽減・HP 減・被弾フラッシュ・ダメージ表示)。 */
function hurtHero(sim: HeroSim, stats: HeroStats, dmg: number): void {
  const taken = dmg * (1 - stats.dmgReduction);
  sim.hp -= taken;
  sim.heroFlash = 1;
  sim.pops.push({ id: sim._id++, x: HERO_X, y: 4 + Math.random() * 4, text: `-${Math.round(taken)}`, life: 0.7, kind: "hurt" });
}

/** 撃破の共通処理(消滅アニメ・撃破/XP の加算・ポップ表示)。 */
function killFoe(sim: HeroSim, f: SimFoe, depth: number, text: string, kind: SimPop["kind"]): void {
  f.dying = 0.32;
  sim.live.kills += 1;
  sim.live.xp += xpPerKillAt(depth);
  sim.pops.push({ id: sim._id++, x: f.x, y: 8 + Math.random() * 6, text, life: 0.8, kind });
}

/** 後列が投げた飛び道具を自機へ進め、到達したら被弾させる。 */
function advanceFoeShots(sim: HeroSim, stats: HeroStats, dt: number): void {
  for (const s of sim.foeShots) {
    s.x -= FOE_SHOT_SPEED * dt;
    if (s.x <= HERO_X + 8) hurtHero(sim, stats, s.dmg);
  }
  sim.foeShots = sim.foeShots.filter((s) => s.x > HERO_X + 8);
}

/** ヒーローの攻撃: クールダウンが空いたら最前の敵へ魔弾を放つ(着弾炸裂は弾の寿命で出す)。 */
function heroAttack(sim: HeroSim, stats: HeroStats, dt: number): void {
  sim.heroAtkCd -= dt;
  const alive = sim.foes.filter((f) => f.dying === 0).sort((a, b) => a.x - b.x);
  if (sim.heroAtkCd > 0 || alive.length === 0) return;
  sim.heroAtkCd = 1 / stats.atkSpeed;
  sim.lunge = 1;
  sim.cast = 1; // 詠唱の閃光
  const crit = Math.random() < stats.critChance;
  const dmg = stats.atk * (crit ? stats.critMult : 1);
  const target = alive[0];
  target.hp -= dmg;
  target.hitFlash = 0.16; // 被弾で白く光る
  target.x = Math.min(VW, target.x + (crit ? 9 : 5)); // のけぞり(ノックバック)
  sim.bolts.push({ id: sim._id++, fromX: HERO_X + 12, toX: target.x, life: BOLT_TIME, crit });
  // 吸命(lifesteal): 与ダメに応じて回復
  if (stats.lifesteal > 0) sim.hp = Math.min(stats.maxHp, sim.hp + dmg * stats.lifesteal);
  if (target.hp <= 0) killFoe(sim, target, sim.live.depth, crit ? "会心!" : "撃破", crit ? "crit" : "kill");
}

/** 魔弾・着弾・ポップの寿命を進める。弾は寿命切れで着弾炸裂に変わる。 */
function advanceEffects(sim: HeroSim, dt: number): void {
  for (const b of sim.bolts) {
    b.life -= dt;
    if (b.life <= 0) sim.strikes.push({ id: sim._id++, x: b.toX, life: STRIKE_LIFE, crit: b.crit });
  }
  sim.bolts = sim.bolts.filter((b) => b.life > 0);

  for (const p of sim.pops) { p.life -= dt; p.y += dt * 16; }
  sim.pops = sim.pops.filter((p) => p.life > 0);

  for (const s of sim.strikes) s.life -= dt;
  sim.strikes = sim.strikes.filter((s) => s.life > 0);
}
