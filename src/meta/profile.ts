// ═══════════════════════════════════════════════════════════
//  〔層〕付属的な機能 / AUXILIARY ── メタ進行(ラン後の蓄積)
//
//  役割(マクロ): 1回のプレイ(ラン)を越えて積み上がる永続データの管理人。
//    累計記録・最高記録・発見状況(敵/武器/真化/加護)・称号・魂(通貨)・
//    恒久強化の段階・解放した装い。すべて localStorage に JSON で保存する。
//    エンジンには依存しない(ゲーム本体と切り離された蓄積層)。
//  挙動(ミクロ):
//    ・loadProfile/saveProfile … 読み書き。壊れていても emptyProfile に復帰。
//    ・recordRun(prev, stats) … ラン終了時の集計を1関数に集約。記録更新+
//      魂付与+称号判定+装い解放をまとめ、「新たに解放されたもの」を返す。
//    ・ACHIEVEMENTS / SKIN_REQUIREMENTS … 解放条件を cond(profile) で表現。
//  関連: 恒久強化の中身と効果計算は [meta/altar.ts] に分離している。
// ═══════════════════════════════════════════════════════════

import type { EnemyKind, GameMode, PassiveId, RunStats, SchoolId, WeaponId } from "../game/types";
import { EVOLUTIONS, DEFAULT_SKIN, TOTAL_CURIOS } from "../game/data";

const KEY = "nocturne.profile.v1";

export interface Achievement {
  id: string;
  name: string;
  icon: string;
  desc: string;
}

/** ホームのオートバトラー「タスクバーヒーロー」の装備スロットと戦利品。ロジックは meta/hero.ts。 */
export type GearSlot = "weapon" | "armor" | "charm";

/** 装備に宿る特性。効果量は meta/hero.ts の TRAITS が司る。 */
export type GearTrait = "crit" | "lifesteal" | "thorns" | "guard" | "regen" | "swift";

export interface GearItem {
  id: string; // 一意id(インベントリ管理・装着参照用)
  slot: GearSlot;
  name: string;
  rarity: number; // 0..4 (並/上/希少/秘宝/伝説)
  atk: number; // 攻撃力の加算
  hp: number; // 最大HPの加算
  haste: number; // 攻撃速度(回/秒)の加算
  power: number; // 比較・売却額の基準スコア
  affinity: string; // 適合する装い(skinId)。"none"=汎用。現装いと一致でセットボーナス
  trait?: GearTrait; // 特性(あれば)
}

/** プレイヤーキャラ自身が本編で拾った装備で強化され、ホームで自動戦闘する状態。 */
export interface HeroState {
  xp: number; // 累積の戦闘経験(レベルを導出)
  kills: number; // 累計撃破(表示用)
  depth: number; // 現在の到達ウェーブ(撃破で進み、敗北で後退する)
  found: number; // 拾った戦利品の総数(表示用)
  lastTick: number; // 最後に自動戦闘を精算した実時刻(ms)
  equipped: Partial<Record<GearSlot, GearItem>>; // スロットごとの装着中の装備
  inventory: GearItem[]; // 未装着の所持装備(宝物庫で手動装着/売却)
}

export interface Profile {
  version: number;
  runs: number;
  victories: number;
  totalKills: number;
  totalTime: number; // 累計生存秒
  totalDamage: number;
  bossKills: number;
  best: { time: number; kills: number; level: number; damage: number };
  discoveredEnemies: EnemyKind[];
  discoveredBosses: string[]; // 遭遇したボス(bossType)
  discoveredWeapons: WeaponId[]; // 基底+真化
  discoveredEvolutions: WeaponId[]; // 真化のみ
  discoveredPassives: PassiveId[];
  litSchoolsMax: Record<SchoolId, number>;
  achievements: string[]; // 解放済み id
  modeBest: Partial<Record<GameMode, { time: number; kills: number; cleared: boolean }>>;
  lastRun: {
    victory: boolean; time: number; kills: number; level: number; damage: number;
  } | null;
  // ---- 祭壇(恒久強化) ----
  souls: number; // 所持する魂(通貨)
  totalSouls: number; // 累計で得た魂(称号判定用・使っても減らない)
  upgrades: Record<string, number>; // 恒久強化の取得段階(id → level)
  // ---- 装い(スキン) ----
  selectedSkin: string;
  unlockedSkins: string[];
  // ---- 遺物(ホーム飾り棚の収集品) ----
  collectedCurios: string[]; // 収集済みの遺物 id
  curioLayout: Record<string, { x: number; y: number }>; // 飾り棚内の配置(0..1 正規化座標)
  // ---- タスクバーヒーロー(ホームの自動戦闘) ----
  hero: HeroState;
}

// 真化先 → 基底 の逆引き(真化を取ったとき基底も「発見」済みにする)
const EVO_TO_BASE: Partial<Record<WeaponId, WeaponId>> = (() => {
  const m: Partial<Record<WeaponId, WeaponId>> = {};
  for (const [base, branches] of Object.entries(EVOLUTIONS)) {
    for (const b of branches ?? []) m[b.evo] = base as WeaponId;
  }
  return m;
})();

export const TOTAL_EVOLUTIONS = Object.values(EVOLUTIONS).reduce((n, b) => n + (b?.length ?? 0), 0);

// ---- 称号の定義と判定 ----
export const ACHIEVEMENTS: (Achievement & { cond: (p: Profile) => boolean })[] = [
  { id: "first_blood", name: "初討伐", icon: "blood", desc: "最初の一体を屠る", cond: (p) => p.totalKills >= 1 },
  { id: "nightfall", name: "夜更け", icon: "moon", desc: "5:00 を越えて生存する", cond: (p) => p.best.time >= 300 },
  { id: "dawn", name: "夜明けを見た者", icon: "dawn", desc: "一夜を生き延びる(勝利)", cond: (p) => p.victories >= 1 },
  { id: "count_slain", name: "夜の主を討つ", icon: "stake", desc: "いずれかのボスを撃破する", cond: (p) => p.bossKills >= 1 },
  { id: "first_evo", name: "最初の真化", icon: "star4", desc: "武器を真化させる", cond: (p) => p.discoveredEvolutions.length >= 1 },
  { id: "collector", name: "真化蒐集家", icon: "tome", desc: `全 ${TOTAL_EVOLUTIONS} の真化を発見する`, cond: (p) => p.discoveredEvolutions.length >= TOTAL_EVOLUTIONS },
  { id: "naturalist", name: "夜の博物学者", icon: "bat", desc: "全 8 種の敵を記録する", cond: (p) => p.discoveredEnemies.length >= 8 },
  { id: "crest_master", name: "紋章の達人", icon: "starburst", desc: "いずれかの流派を第2段へ", cond: (p) => Object.values(p.litSchoolsMax).some((t) => t >= 2) },
  { id: "four_crests", name: "四紋ことごとく", icon: "shield", desc: "全流派を発現させる(累積)", cond: (p) => (["steel", "spirit", "moon", "blood"] as SchoolId[]).every((s) => p.litSchoolsMax[s] >= 1) },
  { id: "centurion", name: "百人斬り", icon: "blades", desc: "一夜で 100 体を討つ", cond: (p) => p.best.kills >= 100 },
  { id: "millennium", name: "千の亡者", icon: "skull", desc: "累計 1000 討伐", cond: (p) => p.totalKills >= 1000 },
  { id: "persistent", name: "夜を重ねる者", icon: "candle", desc: "10 夜を踏破する(10回プレイ)", cond: (p) => p.runs >= 10 },
  { id: "soul_reaper", name: "魂の収穫者", icon: "skull", desc: "累計 2000 の魂を集める", cond: (p) => p.totalSouls >= 2000 },
  { id: "all_modes", name: "三道踏破", icon: "shield", desc: "全モードを制覇する", cond: (p) => (["standard", "long", "endless"] as GameMode[]).every((m) => p.modeBest[m]?.cleared) },
  { id: "wardrobe", name: "夜の装い", icon: "star4", desc: "全ての装いを解放する", cond: (p) => p.unlockedSkins.length >= SKIN_REQUIREMENTS.length },
  { id: "antiquarian", name: "夜の蒐集家", icon: "tome", desc: `全 ${TOTAL_CURIOS} の遺物を集める`, cond: (p) => p.collectedCurios.length >= TOTAL_CURIOS },
];

// 称号や踏破実績で開放される装い。条件はメタ記録のみで判定する。
export const SKIN_REQUIREMENTS: { id: string; req: string; cond: (p: Profile) => boolean }[] = [
  { id: "wanderer", req: "最初から纏える", cond: () => true },
  { id: "ash", req: "3 夜を踏破する", cond: (p) => p.runs >= 3 },
  { id: "crimson", req: "いずれかのボスを撃破する", cond: (p) => p.bossKills >= 1 },
  { id: "verdant", req: "いずれかの流派を第2段へ", cond: (p) => Object.values(p.litSchoolsMax).some((t) => t >= 2) },
  { id: "ember", req: "累計 3000 体を討つ", cond: (p) => p.totalKills >= 3000 },
  { id: "frost", req: "10:00 を越えて生存する", cond: (p) => p.best.time >= 600 },
  { id: "plague", req: "全 8 種の敵を記録する", cond: (p) => p.discoveredEnemies.length >= 8 },
  { id: "royal", req: "全モードを制覇する", cond: (p) => (["standard", "long", "endless"] as GameMode[]).every((m) => p.modeBest[m]?.cleared) },
  { id: "gold", req: "3 度の夜明けを見る", cond: (p) => p.victories >= 3 },
  { id: "void", req: `全 ${TOTAL_EVOLUTIONS} の真化を発見する`, cond: (p) => p.discoveredEvolutions.length >= TOTAL_EVOLUTIONS },
];

/** ラン結果から得られる魂(通貨)。撃破・生存・特異種・ボス・勝利を評価する。 */
export function soulsForRun(s: RunStats): number {
  return Math.round(
    s.kills * 1 +
    s.time / 4 +
    s.champions * 6 +
    s.bossKills * 40 +
    (s.victory ? 80 : 0),
  );
}

// プロファイルの世代。コスト改定に伴い恒久強化のレベルを一度だけリセットするため 2 に上げた。
export const PROFILE_VERSION = 2;

export function emptyProfile(): Profile {
  return {
    version: PROFILE_VERSION, runs: 0, victories: 0, totalKills: 0, totalTime: 0, totalDamage: 0, bossKills: 0,
    best: { time: 0, kills: 0, level: 0, damage: 0 },
    discoveredEnemies: [], discoveredBosses: [], discoveredWeapons: [], discoveredEvolutions: [], discoveredPassives: [],
    litSchoolsMax: { steel: 0, spirit: 0, moon: 0, blood: 0 },
    achievements: [], modeBest: {}, lastRun: null,
    souls: 0, totalSouls: 0, upgrades: {}, selectedSkin: DEFAULT_SKIN, unlockedSkins: [DEFAULT_SKIN],
    collectedCurios: [], curioLayout: {},
    hero: { xp: 0, kills: 0, depth: 1, found: 0, lastTick: Date.now(), equipped: {}, inventory: [] },
  };
}

/** 旧データ/外部由来の装備に id・affinity を補い、欠損を許容する(マイグレーション補助)。 */
function normalizeGear(it: GearItem | undefined, slot: GearSlot): GearItem | undefined {
  if (!it) return undefined;
  return {
    ...it,
    slot: it.slot ?? slot,
    id: it.id ?? `g${Math.random().toString(36).slice(2, 9)}`,
    affinity: it.affinity ?? "none",
  };
}

export function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyProfile();
    const p = JSON.parse(raw) as Partial<Profile>;
    const merged: Profile = {
      ...emptyProfile(), ...p,
      best: { ...emptyProfile().best, ...(p.best ?? {}) },
      litSchoolsMax: { ...emptyProfile().litSchoolsMax, ...(p.litSchoolsMax ?? {}) },
      upgrades: { ...(p.upgrades ?? {}) },
      unlockedSkins: Array.from(new Set([DEFAULT_SKIN, ...(p.unlockedSkins ?? [])])),
      selectedSkin: p.selectedSkin ?? DEFAULT_SKIN,
      collectedCurios: [...(p.collectedCurios ?? [])],
      curioLayout: { ...(p.curioLayout ?? {}) },
      hero: {
        xp: p.hero?.xp ?? 0,
        kills: p.hero?.kills ?? 0,
        depth: p.hero?.depth ?? 1,
        found: p.hero?.found ?? 0,
        lastTick: p.hero?.lastTick ?? Date.now(),
        equipped: {
          weapon: normalizeGear(p.hero?.equipped?.weapon, "weapon"),
          armor: normalizeGear(p.hero?.equipped?.armor, "armor"),
          charm: normalizeGear(p.hero?.equipped?.charm, "charm"),
        },
        inventory: (p.hero?.inventory ?? [])
          .map((it) => normalizeGear(it, it?.slot ?? "weapon"))
          .filter((it): it is GearItem => !!it),
      },
    };
    // 世代マイグレーション: v2 でコスト改定。既存の恒久強化レベルを一度だけ全リセットする
    //(魂残高・記録・装い・図鑑は保持。新しい高コストで再育成してもらう)。
    if ((p.version ?? 1) < PROFILE_VERSION) {
      merged.upgrades = {};
      merged.version = PROFILE_VERSION;
      saveProfile(merged);
    }
    return merged;
  } catch {
    return emptyProfile();
  }
}

export function saveProfile(p: Profile): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* 保存不可でも続行 */
  }
}

export function resetProfile(): Profile {
  const p = emptyProfile();
  saveProfile(p);
  return p;
}

const uni = <T,>(arr: T[], add: T[]): T[] => Array.from(new Set([...arr, ...add]));

/** ラン結果をプロファイルへ統合し、新たに解放された称号・装いを返す */
export function recordRun(
  prev: Profile,
  s: RunStats,
): { profile: Profile; unlocked: Achievement[]; unlockedSkins: string[]; soulsEarned: number } {
  const baseFromEvo = s.evolved.map((e) => EVO_TO_BASE[e]).filter((x): x is WeaponId => !!x);
  const soulsEarned = soulsForRun(s);
  const p: Profile = {
    ...prev,
    runs: prev.runs + 1,
    souls: prev.souls + soulsEarned,
    totalSouls: prev.totalSouls + soulsEarned,
    victories: prev.victories + (s.victory ? 1 : 0),
    totalKills: prev.totalKills + s.kills,
    totalTime: prev.totalTime + s.time,
    totalDamage: prev.totalDamage + s.damageDealt,
    bossKills: prev.bossKills + (s.bossDefeated ? 1 : 0),
    best: {
      time: Math.max(prev.best.time, s.time),
      kills: Math.max(prev.best.kills, s.kills),
      level: Math.max(prev.best.level, s.level),
      damage: Math.max(prev.best.damage, s.damageDealt),
    },
    discoveredEnemies: uni(prev.discoveredEnemies, s.seenEnemies),
    discoveredBosses: uni(prev.discoveredBosses ?? [], s.seenBosses),
    discoveredWeapons: uni(prev.discoveredWeapons, [...s.weapons.map((w) => w.id), ...baseFromEvo]),
    discoveredEvolutions: uni(prev.discoveredEvolutions, s.evolved),
    discoveredPassives: uni(prev.discoveredPassives, s.passives.map((x) => x.id)),
    litSchoolsMax: {
      steel: Math.max(prev.litSchoolsMax.steel, s.schoolTiers.steel ?? 0),
      spirit: Math.max(prev.litSchoolsMax.spirit, s.schoolTiers.spirit ?? 0),
      moon: Math.max(prev.litSchoolsMax.moon, s.schoolTiers.moon ?? 0),
      blood: Math.max(prev.litSchoolsMax.blood, s.schoolTiers.blood ?? 0),
    },
    lastRun: { victory: s.victory, time: s.time, kills: s.kills, level: s.level, damage: s.damageDealt },
  };

  // モード別のベスト記録
  const prevBest = prev.modeBest[s.mode];
  p.modeBest = {
    ...prev.modeBest,
    [s.mode]: {
      time: Math.max(prevBest?.time ?? 0, s.time),
      kills: Math.max(prevBest?.kills ?? 0, s.kills),
      cleared: (prevBest?.cleared ?? false) || s.victory,
    },
  };

  const unlocked: Achievement[] = [];
  for (const a of ACHIEVEMENTS) {
    if (!p.achievements.includes(a.id) && a.cond(p)) {
      p.achievements.push(a.id);
      unlocked.push({ id: a.id, name: a.name, icon: a.icon, desc: a.desc });
    }
  }

  // 装い(スキン)の解放判定
  const unlockedSkins: string[] = [];
  for (const sk of SKIN_REQUIREMENTS) {
    if (!p.unlockedSkins.includes(sk.id) && sk.cond(p)) {
      p.unlockedSkins.push(sk.id);
      unlockedSkins.push(sk.id);
    }
  }

  saveProfile(p);
  return { profile: p, unlocked, unlockedSkins, soulsEarned };
}

/** 装い選択を保存して更新後のプロファイルを返す */
export function selectSkin(prev: Profile, id: string): Profile {
  if (!prev.unlockedSkins.includes(id)) return prev;
  const p = { ...prev, selectedSkin: id };
  saveProfile(p);
  return p;
}

/** 遺物を収集に加える。新規なら飾り棚の初期位置も決めて保存する。 */
export function collectCurio(prev: Profile, id: string): Profile {
  if (prev.collectedCurios.includes(id)) return prev;
  const collectedCurios = [...prev.collectedCurios, id];
  // 初期配置: まだ位置が無ければ棚の上段に左から順へ並べる(後でドラッグ移動可)
  const n = collectedCurios.length - 1;
  const curioLayout = { ...prev.curioLayout };
  if (!curioLayout[id]) {
    curioLayout[id] = { x: 0.1 + (n % 5) * 0.2, y: n < 5 ? 0.32 : 0.7 };
  }
  const p = { ...prev, collectedCurios, curioLayout };
  saveProfile(p);
  return p;
}

/** 飾り棚での遺物の位置(0..1 正規化)を保存する。 */
export function setCurioPosition(prev: Profile, id: string, x: number, y: number): Profile {
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  const p = { ...prev, curioLayout: { ...prev.curioLayout, [id]: { x: clamp(x), y: clamp(y) } } };
  saveProfile(p);
  return p;
}
