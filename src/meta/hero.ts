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

import { saveProfile, type GearItem, type GearSlot, type GearTrait, type HeroState, type Profile } from "./profile";
import { SKINS } from "../game/data";

// ---- チューニング ----
const OFFLINE_CAP_SEC = 12 * 3600; // 放置精算の上限(12時間ぶん)
const SLOTS: GearSlot[] = ["weapon", "armor", "charm"];
const INV_CAP = 30; // 宝物庫の所持上限(超過分は最弱を自動売却)
const BASE_CRIT_CHANCE = 0.16; // 装備なしの会心率
const CRIT_MULT = 1.8; // 会心の威力倍率

export const RARITY_NAMES = ["並", "上", "希少", "秘宝", "伝説"];
export const RARITY_COLORS = ["#9aa3b2", "#74c98a", "#5aa9ff", "#b483ff", "#ffce6b"];

const SLOT_LABEL: Record<GearSlot, string> = { weapon: "武器", armor: "鎧", charm: "護符" };

/** 装備特性の名・効果量・説明。heroStats と表示が同じ値を参照する唯一の表。 */
export const TRAITS: Record<GearTrait, { name: string; amount: number; desc: string }> = {
  crit: { name: "会心", amount: 0.12, desc: "会心率 +12%" },
  lifesteal: { name: "吸命", amount: 0.08, desc: "与ダメの8%を回復" },
  thorns: { name: "返し刃", amount: 0.3, desc: "近接被弾の30%を反射" },
  guard: { name: "守勢", amount: 0.12, desc: "被ダメ -12%" },
  regen: { name: "再生", amount: 0.6, desc: "毎秒回復 +60%" },
  swift: { name: "俊敏", amount: 0.25, desc: "攻撃速度 +0.25" },
};
const TRAIT_KEYS = Object.keys(TRAITS) as GearTrait[];

/** 各装いの固有特性。一致セット3個で開花する(その装いの戦い方を象徴)。 */
const SKIN_SIGNATURE: Record<string, GearTrait> = {
  wanderer: "swift",
  ash: "guard",
  crimson: "lifesteal",
  verdant: "regen",
  ember: "crit",
  frost: "guard",
  plague: "thorns",
  royal: "crit",
  gold: "regen",
  void: "lifesteal",
};
export const skinSignature = (skinId: string): GearTrait | undefined => SKIN_SIGNATURE[skinId];

const SKIN_IDS = SKINS.map((s) => s.id);
/** 一致セットの段階ボーナス(攻撃・HPの倍率)。index = 一致数(0..3)。 */
const SET_BONUS = [0, 0.06, 0.14, 0.24];
export const setBonusPct = (match: number): number => SET_BONUS[Math.min(3, Math.max(0, match))];

let _gearSeq = 0;
const gearId = (): string => `g${Date.now().toString(36)}${(_gearSeq++).toString(36)}`;

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

/** 適合する装いを抽選: 現在の装いに寄せて「自分の装い向けが集まる」喜びを作る。 */
function rollAffinity(currentSkin: string): string {
  const r = Math.random();
  if (r < 0.42) return currentSkin; // 現装いに適合
  if (r < 0.8) return SKIN_IDS[Math.floor(Math.random() * SKIN_IDS.length)]; // 他の装い向け
  return "none"; // 汎用
}

/** 特性を抽選: 希少(2)以上でレア度比例の確率(2:25% / 3:50% / 4:75%)。 */
function rollTrait(rarity: number): GearTrait | undefined {
  const chance = rarity >= 2 ? 0.25 + (rarity - 2) * 0.25 : 0;
  if (Math.random() > chance) return undefined;
  return TRAIT_KEYS[Math.floor(Math.random() * TRAIT_KEYS.length)];
}

/** 戦利品を1つ生成する(適合する装い・特性つき)。 */
export function rollLoot(tier: number, currentSkin: string): GearItem {
  const slot = SLOTS[Math.floor(Math.random() * SLOTS.length)];
  const rarity = rollRarity(tier);
  const s = rollStats(slot, rarity, tier);
  const noun = SLOT_NOUNS[slot][Math.min(SLOT_NOUNS[slot].length - 1, rarity)];
  const name = `${RARITY_PREFIX[rarity]}${noun}`;
  const trait = rollTrait(rarity);
  const power = s.atk * 2 + s.hp * 0.5 + s.haste * 40 + rarity * 4 + (trait ? 8 : 0);
  return { id: gearId(), slot, name, rarity, atk: s.atk, hp: s.hp, haste: s.haste, power, affinity: rollAffinity(currentSkin), trait };
}

/** 戦利品を獲得: 空きスロットは自動装着、それ以外は宝物庫へ(上限超過は最弱を売却=XP)。 */
export function addLoot(prev: Profile, tier: number): Profile {
  const item = rollLoot(tier, prev.selectedSkin);
  const h = prev.hero;
  let equipped = h.equipped;
  const inventory = [...h.inventory];
  let xpGain = 0;
  if (!equipped[item.slot]) {
    equipped = { ...equipped, [item.slot]: item }; // 序盤に裸にしない: 空きは自動装着
  } else {
    inventory.push(item);
    if (inventory.length > INV_CAP) {
      // 宝物庫が満杯: 最も価値の低い1点を売却して XP に換える
      inventory.sort((a, b) => a.power - b.power);
      const sold = inventory.shift()!;
      xpGain = Math.round(sold.power * 0.5);
    }
  }
  const hero: HeroState = { ...h, equipped, inventory, found: h.found + 1, xp: h.xp + xpGain };
  const p = { ...prev, hero };
  saveProfile(p);
  return p;
}

/** 宝物庫の装備をスロットへ装着する。元の装備があれば宝物庫へ戻す。 */
export function equipItem(prev: Profile, id: string): Profile {
  const h = prev.hero;
  const idx = h.inventory.findIndex((i) => i.id === id);
  if (idx < 0) return prev;
  const item = h.inventory[idx];
  const inventory = h.inventory.filter((_, i) => i !== idx);
  const prevEq = h.equipped[item.slot];
  if (prevEq) inventory.push(prevEq);
  const equipped = { ...h.equipped, [item.slot]: item };
  const p = { ...prev, hero: { ...h, equipped, inventory } };
  saveProfile(p);
  return p;
}

/** 装着中の装備を外して宝物庫へ戻す。 */
export function unequipItem(prev: Profile, slot: GearSlot): Profile {
  const h = prev.hero;
  const it = h.equipped[slot];
  if (!it) return prev;
  const equipped = { ...h.equipped };
  delete equipped[slot];
  const p = { ...prev, hero: { ...h, equipped, inventory: [...h.inventory, it] } };
  saveProfile(p);
  return p;
}

/** 宝物庫の装備を売却して XP に換える(power の半分)。 */
export function sellItem(prev: Profile, id: string): Profile {
  const h = prev.hero;
  const it = h.inventory.find((i) => i.id === id);
  if (!it) return prev;
  const inventory = h.inventory.filter((i) => i.id !== id);
  const p = { ...prev, hero: { ...h, inventory, xp: h.xp + Math.round(it.power * 0.5) } };
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
  // ---- 特性・セットボーナス由来の戦闘パラメータ(heroSim が参照) ----
  critChance: number; // 会心率
  critMult: number; // 会心の威力倍率
  lifesteal: number; // 与ダメに対する回復割合
  thorns: number; // 近接被弾に対する反射割合
  dmgReduction: number; // 被ダメ軽減割合(0..0.6)
  regenMul: number; // 回復係数(1=等倍)
  setMatch: number; // 現在の装いに適合する装着数(0..3)
}

/** レベル(基礎)＋装備＋特性＋一致セットから戦闘ステータスを合成する。 */
export function heroStats(prev: Profile): HeroStats {
  const h = prev.hero;
  const level = levelFromXp(h.xp);
  // レベルによる基礎値(装備なしでも少しずつ伸びる土台)
  let atk = 6 + (level - 1) * 1.6;
  let maxHp = 60 + (level - 1) * 10;
  let atkSpeed = 1.0; // 攻撃速度(回/秒)。護符の haste で上がる
  const traitCount: Record<GearTrait, number> = { crit: 0, lifesteal: 0, thorns: 0, guard: 0, regen: 0, swift: 0 };
  let setMatch = 0;
  // 装備3スロット(武器=攻撃 / 鎧=HP / 護符=手数)の補正を加算
  for (const slot of SLOTS) {
    const it = h.equipped[slot];
    if (!it) continue;
    atk += it.atk;
    maxHp += it.hp;
    atkSpeed += it.haste;
    if (it.trait) traitCount[it.trait]++;
    if (it.affinity !== "none" && it.affinity === prev.selectedSkin) setMatch++;
  }
  // 一致セットボーナス(攻撃・HP)。3一致で装いの固有特性が開花。
  const matchMul = setBonusPct(setMatch);
  atk *= 1 + matchMul;
  maxHp *= 1 + matchMul;
  if (setMatch >= 3) {
    const sig = SKIN_SIGNATURE[prev.selectedSkin];
    if (sig) traitCount[sig]++;
  }
  // 特性 → 戦闘パラメータ
  atkSpeed += traitCount.swift * TRAITS.swift.amount;
  atkSpeed = Math.min(4, atkSpeed); // 手数は上限を設けて青天井を防ぐ
  const critChance = Math.min(0.9, BASE_CRIT_CHANCE + traitCount.crit * TRAITS.crit.amount);
  const lifesteal = traitCount.lifesteal * TRAITS.lifesteal.amount;
  const thorns = Math.min(1.5, traitCount.thorns * TRAITS.thorns.amount);
  const dmgReduction = Math.min(0.6, traitCount.guard * TRAITS.guard.amount);
  const regenMul = 1 + traitCount.regen * TRAITS.regen.amount;
  atk = Math.round(atk);
  maxHp = Math.round(maxHp);
  return { level, maxHp, atk, atkSpeed, dps: atk * atkSpeed, critChance, critMult: CRIT_MULT, lifesteal, thorns, dmgReduction, regenMul, setMatch };
}

// ---- ウェーブ(深度)ごとの仕様 ----
//   深度 depth が上がるほど、敵は数(waveCount)・硬さ(enemyHpAt)・打撃(enemyAtkAt)が
//   線形に増える。装備で攻撃/HP/手数が伸びれば、より深い波まで“勝ち切れる”ようになる、
//   という単純で予測しやすいカーブにしてある(数値はここだけで調整できる)。
export const ENEMY_MELEE_CD = 1.1; // 先頭の敵の打撃間隔(秒)
export const FOE_THROW_CD = 1.9; // 後列の敵が投擲する間隔(秒)
export const FOE_THROW_DMG_MUL = 0.5; // 投擲ダメージは近接の半分(遠隔ぶん控えめ)
export const FOE_THROWERS_MAX = 2; // 同時に投げてくる後列の上限(画面内上限3体=先頭1+後列2)
export const waveCount = (depth: number): number => Math.min(6, 3 + Math.floor(depth / 4)); // 1波の敵数(3→最大6)
export const enemyHpAt = (depth: number): number => 14 + depth * 10; // 敵1体のHP
export const enemyAtkAt = (depth: number): number => 2 + depth * 1.4; // 敵の1撃ダメージ(近接)
export const xpPerKillAt = (depth: number): number => 4 + depth * 2; // 撃破1体あたりのXP

/**
 * その装備で“勝ち切れる”最深ウェーブ。放置(オフライン)精算の落ち着き先であり、
 * ライブ戦闘でも実質の壁になる目安。
 *
 * 考え方: 深度 d の波を「先頭から1体ずつ縦列で削る」と仮定すると、
 *   ・殲滅にかかる時間  clearTime = (敵数 × 敵HP) / 自機DPS
 *   ・先頭の近接ダメ    melee = 敵の打撃 × (clearTime / 打撃間隔)        ※殴るのは先頭の1体
 *   ・後列の投擲ダメ    throw = 敵の打撃 × 0.5 × (clearTime / 投擲間隔) × 投擲者数
 *                       (投擲者は最大2、波の消耗で常時いるわけではないので 0.6 で割り引く)
 *   ・その間の微回復     regen = 最大HP × 0.04 × clearTime
 * 「最大HP + regen が (melee+throw)(+5%の余裕) を上回る」最も深い d を探す。
 * 浅い順に試して最初に破綻した手前を壁とする(単調なので break で十分)。
 */
export function sustainableDepth(stats: HeroStats): number {
  let best = 1;
  for (let d = 1; d <= 500; d++) {
    const clearTime = (waveCount(d) * enemyHpAt(d)) / Math.max(1, stats.dps);
    const melee = enemyAtkAt(d) * (clearTime / ENEMY_MELEE_CD); // 先頭の近接(ライブ挙動と一致)
    const throwers = Math.min(Math.max(0, waveCount(d) - 1), FOE_THROWERS_MAX);
    const thrown = enemyAtkAt(d) * FOE_THROW_DMG_MUL * (clearTime / FOE_THROW_CD) * throwers * 0.6; // 後列の投擲
    const regen = stats.maxHp * 0.04 * clearTime;
    if (stats.maxHp + regen > (melee + thrown) * 1.05) best = d;
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
  inventory: GearItem[];
  setMatch: number; // 現装いに適合する装着数(0..3)
}

export const slotLabel = (slot: GearSlot): string => SLOT_LABEL[slot];

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
    inventory: h.inventory,
    setMatch: stats.setMatch,
  };
}
