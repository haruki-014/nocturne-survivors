// ═══════════════════════════════════════════════════════════
//  〔層〕付属的な機能 / AUXILIARY ── タスクバーヒーロー(ホームの自動戦闘)
//
//  役割(マクロ): 本編で操作しているキャラ自身を、ランで拾った「戦利品(装備)」で
//    強化し、ホーム画面でウェーブ制の敵を相手に自動戦闘させるアイドル・オートバトラー
//    の純ロジック層。DOM/React/エンジンに依存しない。保存は profile.ts に委ねる。
//  挙動(ミクロ):
//    ・rollLoot / addLoot … 戦利品の生成と、ベスト装備の自動装着(劣れば売却=XP)。
//    ・heroStats(p)      … レベル(基礎)＋装備から戦闘ステータスを合成。
//    ・waveSpec 群        … ウェーブ(深度)ごとの敵数・敵HP・敵攻撃力・XP。
//    ・sustainableDepth   … その装備で“勝ち切れる”最深ウェーブ(壁=放置の落ち着き先)。
//    ・offlineProgress(p) … 離席中の自動戦闘を近似精算(撃破/XP/深度)。保存はしない。
//    ・syncHero(p, live)  … ライブ戦闘の到達値(撃破/XP/深度)を絶対値で保存。
//  ※ この強化は「ミニゲーム内だけ」効く。本編ランのバランスには影響させない。
// ═══════════════════════════════════════════════════════════

import { saveProfile, type GearItem, type GearSlot, type HeroState, type Profile } from "./profile";

// ---- チューニング ----
const OFFLINE_CAP_SEC = 12 * 3600; // 放置精算の上限(12時間ぶん)
const SLOTS: GearSlot[] = ["weapon", "armor", "charm"];

export const RARITY_NAMES = ["並", "上", "希少", "秘宝", "伝説"];
export const RARITY_COLORS = ["#9aa3b2", "#74c98a", "#5aa9ff", "#b483ff", "#ffce6b"];

const SLOT_LABEL: Record<GearSlot, string> = { weapon: "武器", armor: "鎧", charm: "護符" };

// スロット別の名詞プール(レアリティで接頭辞を付ける)
const SLOT_NOUNS: Record<GearSlot, string[]> = {
  weapon: ["短刀", "長剣", "戦斧", "刺突剣", "大鎌"],
  armor: ["革鎧", "鎖帷子", "胸甲", "重鎧", "外套"],
  charm: ["護符", "指輪", "耳飾り", "聖印", "宝珠"],
};
const RARITY_PREFIX = ["錆びた", "鉄の", "銀月の", "血染めの", "夜王の"];

/** レアリティ抽選: tier が高いほど上位が出やすい。 */
function rollRarity(tier: number): number {
  const r = Math.random() + tier * 0.22;
  if (r > 1.18) return 4;
  if (r > 0.95) return 3;
  if (r > 0.7) return 2;
  if (r > 0.4) return 1;
  return 0;
}

/** スロット別の主ステータス配分。武器=攻撃、鎧=HP、護符=攻撃速度+α。 */
function rollStats(slot: GearSlot, rarity: number, tier: number): { atk: number; hp: number; haste: number } {
  const budget = (1 + rarity) * (1 + tier * 0.5);
  const jitter = 0.75 + Math.random() * 0.5;
  if (slot === "weapon") return { atk: Math.round((3 + budget * 2.2) * jitter), hp: Math.round(budget * 2 * jitter), haste: 0 };
  if (slot === "armor") return { atk: Math.round(budget * 0.6 * jitter), hp: Math.round((10 + budget * 9) * jitter), haste: 0 };
  return { atk: Math.round(budget * 1.0 * jitter), hp: Math.round(budget * 3 * jitter), haste: Math.round((0.08 + budget * 0.06) * jitter * 100) / 100 };
}

/** 戦利品を1つ生成する。 */
export function rollLoot(tier: number): GearItem {
  const slot = SLOTS[Math.floor(Math.random() * SLOTS.length)];
  const rarity = rollRarity(tier);
  const s = rollStats(slot, rarity, tier);
  const noun = SLOT_NOUNS[slot][Math.min(SLOT_NOUNS[slot].length - 1, rarity)];
  const name = `${RARITY_PREFIX[rarity]}${noun}`;
  const power = s.atk * 2 + s.hp * 0.5 + s.haste * 40 + rarity * 4;
  return { slot, name, rarity, atk: s.atk, hp: s.hp, haste: s.haste, power };
}

/** 戦利品を獲得: ベスト装備なら自動装着、劣るなら少量XPに換える(売却)。 */
export function addLoot(prev: Profile, tier: number): Profile {
  const item = rollLoot(tier);
  const h = prev.hero;
  const cur = h.equipped[item.slot];
  let equipped = h.equipped;
  let xpGain = 0;
  if (!cur || item.power > cur.power) {
    equipped = { ...h.equipped, [item.slot]: item };
    if (cur) xpGain = Math.round(cur.power * 0.5);
  } else {
    xpGain = Math.round(item.power * 0.5);
  }
  const hero: HeroState = { ...h, equipped, found: h.found + 1, xp: h.xp + xpGain };
  const p = { ...prev, hero };
  saveProfile(p);
  return p;
}

// ---- レベルの導出 ----
function xpForLevel(lv: number): number {
  return 60 + (lv - 1) * 40;
}
export function levelFromXp(xp: number): number {
  let lv = 1;
  let acc = 0;
  while (acc + xpForLevel(lv) <= xp && lv < 999) { acc += xpForLevel(lv); lv++; }
  return lv;
}
function totalXpForLevel(lv: number): number {
  let acc = 0;
  for (let l = 1; l < lv; l++) acc += xpForLevel(l);
  return acc;
}

export interface HeroStats {
  level: number;
  maxHp: number;
  atk: number;
  atkSpeed: number; // 回/秒
  dps: number;
}

/** レベル(基礎)＋装備から戦闘ステータスを合成する。 */
export function heroStats(prev: Profile): HeroStats {
  const h = prev.hero;
  const level = levelFromXp(h.xp);
  // レベルによる基礎値(装備なしでも少しずつ伸びる土台)
  let atk = 6 + (level - 1) * 1.6;
  let maxHp = 60 + (level - 1) * 10;
  let atkSpeed = 1.0; // 攻撃速度(回/秒)。護符の haste で上がる
  // 装備3スロット(武器=攻撃 / 鎧=HP / 護符=手数)の補正を加算
  for (const slot of SLOTS) {
    const it = h.equipped[slot];
    if (!it) continue;
    atk += it.atk;
    maxHp += it.hp;
    atkSpeed += it.haste;
  }
  atkSpeed = Math.min(4, atkSpeed); // 手数は上限を設けて青天井を防ぐ
  return { level, maxHp, atk, atkSpeed, dps: atk * atkSpeed };
}

// ---- ウェーブ(深度)ごとの仕様 ----
//   深度 depth が上がるほど、敵は数(waveCount)・硬さ(enemyHpAt)・打撃(enemyAtkAt)が
//   線形に増える。装備で攻撃/HP/手数が伸びれば、より深い波まで“勝ち切れる”ようになる、
//   という単純で予測しやすいカーブにしてある(数値はここだけで調整できる)。
export const ENEMY_MELEE_CD = 1.1; // 敵の打撃間隔(秒)
export const waveCount = (depth: number): number => Math.min(6, 3 + Math.floor(depth / 4)); // 1波の敵数(3→最大6)
export const enemyHpAt = (depth: number): number => 14 + depth * 10; // 敵1体のHP
export const enemyAtkAt = (depth: number): number => 2 + depth * 1.4; // 敵の1撃ダメージ
export const xpPerKillAt = (depth: number): number => 4 + depth * 2; // 撃破1体あたりのXP

/**
 * その装備で“勝ち切れる”最深ウェーブ。放置(オフライン)精算の落ち着き先であり、
 * ライブ戦闘でも実質の壁になる目安。
 *
 * 考え方: 深度 d の波を「先頭から1体ずつ縦列で削る」と仮定すると、
 *   ・殲滅にかかる時間  clearTime = (敵数 × 敵HP) / 自機DPS
 *   ・その間に受ける総ダメ dmg   = 敵の打撃 × (clearTime / 打撃間隔)   ※殴るのは先頭の1体だけ
 *   ・その間の微回復       regen  = 最大HP × 0.04 × clearTime
 * 「最大HP + regen が dmg(+5%の余裕) を上回る」最も深い d を探す。
 * 浅い順に試して最初に破綻した手前を壁とする(単調なので break で十分)。
 */
export function sustainableDepth(stats: HeroStats): number {
  let best = 1;
  for (let d = 1; d <= 500; d++) {
    const clearTime = (waveCount(d) * enemyHpAt(d)) / Math.max(1, stats.dps);
    const dmg = enemyAtkAt(d) * (clearTime / ENEMY_MELEE_CD); // 先頭の一体だけが攻撃(ライブ挙動と一致)
    const regen = stats.maxHp * 0.04 * clearTime;
    if (stats.maxHp + regen > dmg * 1.05) best = d;
    else break;
  }
  return best;
}

/** 離席中の自動戦闘を近似精算する(保存しない)。勝ち切れる深度で撃破を稼ぐ。 */
export function offlineProgress(prev: Profile, now: number): { kills: number; xp: number; depth: number } {
  const h = prev.hero;
  const elapsed = Math.max(0, Math.min(OFFLINE_CAP_SEC, (now - h.lastTick) / 1000));
  const stats = heroStats(prev);
  const sd = sustainableDepth(stats);
  const kps = Math.max(0.05, Math.min(3, stats.dps / enemyHpAt(sd)));
  const dk = kps * elapsed;
  return { kills: h.kills + dk, xp: h.xp + dk * xpPerKillAt(sd), depth: Math.max(1, sd) };
}

/** ライブ戦闘の到達値(絶対値)を保存する。 */
export function syncHero(prev: Profile, live: { kills: number; xp: number; depth: number }): Profile {
  const hero: HeroState = {
    ...prev.hero,
    kills: Math.max(prev.hero.kills, live.kills),
    xp: Math.max(prev.hero.xp, live.xp),
    depth: Math.max(1, Math.round(live.depth)),
    lastTick: Date.now(),
  };
  const p = { ...prev, hero };
  saveProfile(p);
  return p;
}

export interface HeroView {
  level: number;
  stats: HeroStats;
  sustainable: number;
  depth: number;
  kills: number;
  found: number;
  xpIntoLevel: number;
  xpForNext: number;
  equipped: { slot: GearSlot; label: string; item: GearItem | null }[];
}

/** UI 表示用の導出(現在のプロファイル値そのまま。ライブ値はコンポーネント側で管理)。 */
export function heroView(prev: Profile): HeroView {
  const h = prev.hero;
  const stats = heroStats(prev);
  const base = totalXpForLevel(stats.level);
  return {
    level: stats.level,
    stats,
    sustainable: sustainableDepth(stats),
    depth: h.depth,
    kills: Math.floor(h.kills),
    found: h.found,
    xpIntoLevel: Math.max(0, h.xp - base),
    xpForNext: xpForLevel(stats.level),
    equipped: SLOTS.map((slot) => ({ slot, label: SLOT_LABEL[slot], item: h.equipped[slot] ?? null })),
  };
}
