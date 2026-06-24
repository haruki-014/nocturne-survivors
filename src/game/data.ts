// ═══════════════════════════════════════════════════════════
//  〔層〕主要機能 / CORE ── コンテンツデータ(数値とテーブル)
//
//  役割(マクロ): ゲームに登場する「中身」をすべて宣言的に定義する台帳。
//    武器・真化・専用技・パッシブ・流派・敵・変種・ウェーブ・モード・スキン。
//    ロジック(engine.ts)はこの表を読むだけで動くので、バランス調整・追加要素は
//    原則このファイルの数値を書き換えるだけで完結する(コードを触らない)。
//  挙動(ミクロ): 大半は定数オブジェクト。可変なのは statsFor(lv) のような関数で、
//    「レベル lv のときの性能」を計算して返す(毎レベル必ず何かが伸びる設計)。
//    エンジンは毎フレーム statsFor を呼び、現在の威力・間隔・弾数を得る。
//
//  主な輸出: WEAPONS / EVOLUTIONS / PASSIVES / SCHOOLS / ENEMIES /
//    WAVE_TABLE / MODES / VARIANT / SKINS と、補助関数(hpScale 等)。
// ═══════════════════════════════════════════════════════════

import type {
  EnemyDef,
  EnemyKind,
  EnemyVariant,
  GameMode,
  ModeConfig,
  PassiveDef,
  PassiveId,
  SchoolId,
  WeaponBehavior,
  WeaponDef,
  WeaponId,
  WeaponStats,
} from "./types";

const fl = Math.floor;

// ------------------------------------------------------------
// 武器 (最大6スロット / 各 Lv8)
// statsFor は「毎レベル必ず何かが伸びる」よう設計する。
// ------------------------------------------------------------

export const WEAPONS: Record<string, WeaponDef> = {
  grimoire: {
    id: "grimoire",
    name: "魔弾の書",
    icon: "grimoire",
    color: "#9d7bff",
    desc: "最も近い敵へ魔弾を放つ。導かれ、貫く。",
    maxLevel: 8,
    behavior: "bolt",
    school: "spirit",
    statsFor: (lv): WeaponStats => ({
      damage: 10 + 4 * (lv - 1),
      cooldown: 1.2 - 0.05 * (lv - 1),
      amount: 1 + fl((lv - 1) / 3), // Lv4:2発 Lv7:3発
      area: 1,
      speed: 400 + 12 * (lv - 1),
      pierce: lv >= 5 ? 2 : 1,
      duration: 1.6,
    }),
  },
  knife: {
    id: "knife",
    name: "銀のナイフ",
    icon: "knife",
    color: "#cfd8e6",
    desc: "最も近い骸へ銀刃を連射する。深々と貫き、列ごと薙ぎ倒す手数と貫通の刃。",
    maxLevel: 8,
    behavior: "knife",
    school: "steel",
    statsFor: (lv): WeaponStats => ({
      damage: 12 + 5 * (lv - 1), // Lv1:12 → Lv8:47(前方特化の高火力)
      cooldown: 0.68 - 0.05 * (lv - 1), // Lv1:0.68 → Lv8:0.33(屈指の手数)
      amount: 2 + fl((lv - 1) / 2), // Lv1:2 → Lv8:5本の斉射
      area: 1,
      speed: 700,
      pierce: 3 + fl((lv - 1) / 2), // Lv1:3 → Lv8:6(列を貫く強み)
      duration: 1.45, // 長射程で多くを貫く
    }),
  },
  orbs: {
    id: "orbs",
    name: "聖鎖の宝珠",
    icon: "orbs",
    color: "#6fd3ff",
    desc: "身を守るように周回する宝珠。触れた者を裁く。",
    maxLevel: 8,
    behavior: "orbs",
    school: "spirit",
    statsFor: (lv): WeaponStats => ({
      damage: 9 + 4 * (lv - 1),
      cooldown: 0.5, // 同一敵への再ヒット間隔
      amount: 1 + fl(lv / 2), // Lv8:5個
      area: 1 + 0.07 * (lv - 1), // 周回半径
      speed: 2.3 + 0.08 * (lv - 1), // 角速度 rad/s
      pierce: 999,
      duration: 0,
    }),
  },
  censer: {
    id: "censer",
    name: "忌避の薫香",
    icon: "censer",
    color: "#7be08a",
    desc: "周囲に漂う香煙が、近づく不浄を蝕む。",
    maxLevel: 8,
    behavior: "aura",
    school: "moon",
    statsFor: (lv): WeaponStats => ({
      damage: 5 + 2.5 * (lv - 1), // 0.5秒毎のtickダメージ
      cooldown: 0.5,
      amount: 1,
      area: 1 + 0.11 * (lv - 1), // 半径倍率
      speed: 0,
      pierce: 999,
      duration: 0,
    }),
  },
  lightning: {
    id: "lightning",
    name: "裁きの雷",
    icon: "lightning",
    color: "#ffd95e",
    desc: "夜天より落ちる雷が、無作為に咎人を撃つ。",
    maxLevel: 8,
    behavior: "lightning",
    school: "moon",
    statsFor: (lv): WeaponStats => ({
      damage: 22 + 8 * (lv - 1),
      cooldown: 2.4 - 0.15 * (lv - 1),
      amount: 1 + fl((lv - 1) / 2), // Lv8:4本
      area: 1 + 0.06 * (lv - 1), // 着弾範囲
      speed: 0,
      pierce: 999,
      duration: 0,
    }),
  },
  axe: {
    id: "axe",
    name: "戦斧・断罪",
    icon: "axe",
    color: "#ff8c5a",
    desc: "弧を描いて宙を舞い、群れごと薙ぎ払う重い一撃。",
    maxLevel: 8,
    behavior: "axe",
    school: "steel",
    statsFor: (lv): WeaponStats => ({
      damage: 18 + 6 * (lv - 1),
      cooldown: 1.7 - 0.08 * (lv - 1),
      amount: 1 + fl((lv - 1) / 3), // Lv4:2 Lv7:3
      area: 1 + 0.05 * (lv - 1),
      speed: 1,
      pierce: 999,
      duration: 2.4,
    }),
  },

  // ============================================================
  // 真化(進化)形態 ── 基底武器を最大Lv + 対パッシブで真化させると到達。
  // 挙動(behavior)は基底と同じものを再利用し、強化された statsFor で“別物の手応え”を出す。
  // 各 maxLevel は 5。真化後もさらに成長させられる。
  // ============================================================
  grimoire_codex: {
    id: "grimoire_codex", name: "禁書・無限詠唱", icon: "grimoire2", color: "#b9a0ff",
    desc: "途切れぬ詠唱。魔弾の奔流が貫いて止まらない。",
    maxLevel: 5, behavior: "bolt", school: "spirit", evolved: true,
    statsFor: (lv): WeaponStats => ({
      damage: 26 + 7 * (lv - 1), cooldown: 0.5 - 0.03 * (lv - 1),
      amount: 5 + (lv - 1), area: 1, speed: 540 + 20 * (lv - 1),
      pierce: 5 + (lv - 1), duration: 1.8,
    }),
  },
  grimoire_blasphemy: {
    id: "grimoire_blasphemy", name: "冒涜の聖句", icon: "grimoire3", color: "#d44a78",
    desc: "禁忌の一節。少数の巨弾がすべてを撃ち抜く。",
    maxLevel: 5, behavior: "bolt", school: "spirit", evolved: true,
    statsFor: (lv): WeaponStats => ({
      damage: 70 + 22 * (lv - 1), cooldown: 1.0 - 0.06 * (lv - 1),
      amount: 2 + fl((lv - 1) / 2), area: 1, speed: 470,
      pierce: 8 + 2 * (lv - 1), duration: 2.0,
    }),
  },
  knife_galewall: {
    id: "knife_galewall", name: "千刃・烈風", icon: "knives_ring", color: "#eaf2ff",
    desc: "疾走が刃を呼ぶ。全方位へ刃の壁を撒き散らす。",
    maxLevel: 5, behavior: "knife", school: "steel", evolved: true, ring: true,
    statsFor: (lv): WeaponStats => ({
      damage: 18 + 6 * (lv - 1), cooldown: 0.7 - 0.05 * (lv - 1),
      amount: 10 + 2 * (lv - 1), area: 1, speed: 560,
      pierce: 3 + (lv - 1), duration: 1.0,
    }),
  },
  orbs_halo: {
    id: "orbs_halo", name: "神罰の聖環", icon: "halo", color: "#aef0ff",
    desc: "月光が環を拡げる。高速旋回する聖環が灼く。",
    maxLevel: 5, behavior: "orbs", school: "spirit", evolved: true,
    statsFor: (lv): WeaponStats => ({
      damage: 24 + 8 * (lv - 1), cooldown: 0.4,
      amount: 6 + (lv - 1), area: 1.4 + 0.1 * (lv - 1),
      speed: 3.2 + 0.12 * (lv - 1), pierce: 999, duration: 0,
    }),
  },
  censer_sanctuary: {
    id: "censer_sanctuary", name: "業火の聖域", icon: "flame_ring", color: "#ffce6b",
    desc: "鼓動が炎を育てる。広大な聖域が不浄を焼く。",
    maxLevel: 5, behavior: "aura", school: "moon", evolved: true,
    statsFor: (lv): WeaponStats => ({
      damage: 16 + 6 * (lv - 1), cooldown: 0.4, amount: 1,
      area: 1.7 + 0.14 * (lv - 1), speed: 0, pierce: 999, duration: 0,
    }),
  },
  lightning_chain: {
    id: "lightning_chain", name: "神鳴・連雷", icon: "bolts2", color: "#fff0a6",
    desc: "怒りが雷を連ねる。落雷の数が爆発的に増す。",
    maxLevel: 5, behavior: "lightning", school: "moon", evolved: true,
    statsFor: (lv): WeaponStats => ({
      damage: 40 + 14 * (lv - 1), cooldown: 1.4 - 0.1 * (lv - 1),
      amount: 5 + (lv - 1), area: 1.25 + 0.06 * (lv - 1),
      speed: 0, pierce: 999, duration: 0,
    }),
  },
  lightning_storm: {
    id: "lightning_storm", name: "裁きの嵐", icon: "storm", color: "#ffe06a",
    desc: "焦点が嵐を生む。極大の落雷が大地を割る。",
    maxLevel: 5, behavior: "lightning", school: "moon", evolved: true,
    statsFor: (lv): WeaponStats => ({
      damage: 70 + 24 * (lv - 1), cooldown: 1.8 - 0.12 * (lv - 1),
      amount: 2 + fl((lv - 1) / 2), area: 2.0 + 0.12 * (lv - 1),
      speed: 0, pierce: 999, duration: 0,
    }),
  },
  axe_comet: {
    id: "axe_comet", name: "彗星・終末斧", icon: "comet_axe", color: "#ff9d63",
    desc: "引力が斧を加速する。無数の彗星斧が降り注ぐ。",
    maxLevel: 5, behavior: "axe", school: "steel", evolved: true,
    statsFor: (lv): WeaponStats => ({
      damage: 46 + 16 * (lv - 1), cooldown: 1.0 - 0.06 * (lv - 1),
      amount: 4 + (lv - 1), area: 1.6 + 0.1 * (lv - 1),
      speed: 1, pierce: 999, duration: 2.6,
    }),
  },

  // ---- 専用技(特別なスキンの秘伝) ----
  // 「虚無の影」専用: 全方位に虚空の刃環を放つ秘伝。
  void_chain: {
    id: "void_chain", name: "虚無の鎖環", icon: "knives_ring", color: "#b078ff",
    desc: "虚空より呼ぶ刃の環。全方位を断ち、深く貫く秘伝。",
    maxLevel: 8, behavior: "knife", school: "blood", signature: true, ring: true,
    statsFor: (lv): WeaponStats => ({
      damage: 14 + 6 * (lv - 1),
      cooldown: 1.5 - 0.08 * (lv - 1),
      amount: 6 + fl((lv - 1) / 2) * 2, // Lv1:6 → Lv8:12 の刃環
      area: 1,
      speed: 560,
      pierce: 3 + fl((lv - 1) / 2),
      duration: 1.2,
    }),
  },
  // 「黄金詠唱者」専用: 誘導する黄金弾を多数放つ秘伝。
  gold_verse: {
    id: "gold_verse", name: "黄金の聖句", icon: "grimoire3", color: "#ffd66a",
    desc: "黄金の一節が複数の敵を撃つ。詠唱者の秘伝。",
    maxLevel: 8, behavior: "bolt", school: "moon", signature: true,
    statsFor: (lv): WeaponStats => ({
      damage: 13 + 5 * (lv - 1),
      cooldown: 0.9 - 0.045 * (lv - 1),
      amount: 2 + fl((lv - 1) / 2), // Lv1:2 → Lv8:5発
      area: 1,
      speed: 440 + 14 * (lv - 1),
      pierce: lv >= 4 ? 3 : 2,
      duration: 1.7,
    }),
  },
  // 「霜夜の狩人」専用: 落雷を凍て雷に変えた連撃の秘伝。
  frost_lance: {
    id: "frost_lance", name: "氷牙の連弾", icon: "bolts2", color: "#8fe6ff",
    desc: "凍てつく雷が連なって落ちる。狩人の秘伝。",
    maxLevel: 8, behavior: "lightning", school: "spirit", signature: true,
    statsFor: (lv): WeaponStats => ({
      damage: 22 + 9 * (lv - 1),
      cooldown: 1.5 - 0.08 * (lv - 1),
      amount: 1 + fl(lv / 3), // Lv1:1 → Lv8:3条
      area: 1.2 + 0.1 * (lv - 1),
      speed: 0,
      pierce: 999,
      duration: 0,
    }),
  },
  // 「緋の伯爵狩り」専用: 返り血を撒く大鎌の投擲。
  crimson_scythe: {
    id: "crimson_scythe", name: "緋月の戦鎌", icon: "axe", color: "#e0455e",
    desc: "緋き弧を描いて舞う大鎌。返り血が群れを薙ぐ秘伝。",
    maxLevel: 8, behavior: "axe", school: "blood", signature: true,
    statsFor: (lv): WeaponStats => ({
      damage: 22 + 8 * (lv - 1),
      cooldown: 1.25 - 0.06 * (lv - 1),
      amount: 2 + fl((lv - 1) / 2), // Lv1:2 → Lv8:5枚
      area: 1.2 + 0.08 * (lv - 1),
      speed: 1, pierce: 999, duration: 2.3,
    }),
  },
  // 「月光の祭司」専用: 身を包む聖域の薫り。常時のオーラ。
  verdant_bloom: {
    id: "verdant_bloom", name: "聖域の薫光", icon: "censer", color: "#7be08a",
    desc: "聖域の緑光が身を包み、触れる不浄を絶えず灼く秘伝。",
    maxLevel: 8, behavior: "aura", school: "moon", signature: true,
    statsFor: (lv): WeaponStats => ({
      damage: 7 + 3 * (lv - 1), // 0.5秒毎のtick
      cooldown: 0.5,
      amount: 0,
      area: 1.15 + 0.09 * (lv - 1), // 半径
      speed: 0, pierce: 999, duration: 0,
    }),
  },
  // 「焔の巡礼」専用: 周回する焔の輪舞。
  ember_waltz: {
    id: "ember_waltz", name: "業火の輪舞", icon: "halo", color: "#ff7a3c",
    desc: "身を巡る焔の珠が、近づく者を焼べて踊る秘伝。",
    maxLevel: 8, behavior: "orbs", school: "moon", signature: true,
    statsFor: (lv): WeaponStats => ({
      damage: 11 + 4 * (lv - 1),
      cooldown: 0.5, // 同一敵への再ヒット間隔
      amount: 2 + fl(lv / 3), // Lv1:2 → Lv8:4珠
      area: 1 + 0.07 * (lv - 1),
      speed: 2.6 + 0.08 * (lv - 1), // 角速度
      pierce: 999, duration: 0,
    }),
  },
  // 「疫病の医師」専用: 毒刃を扇状に撒く。
  plague_fan: {
    id: "plague_fan", name: "疫癘の散弾", icon: "knife", color: "#b6d27a",
    desc: "扇状に撒かれる毒の刃。逃げ道を腐らせる秘伝。",
    maxLevel: 8, behavior: "knife", school: "spirit", signature: true,
    statsFor: (lv): WeaponStats => ({
      damage: 11 + 5 * (lv - 1),
      cooldown: 0.8 - 0.045 * (lv - 1),
      amount: 3 + fl((lv - 1) / 2), // Lv1:3 → Lv8:6枚の扇
      area: 1,
      speed: 600,
      pierce: 2 + fl((lv - 1) / 3),
      duration: 1.25,
    }),
  },
  // 「月の王」専用: 玉座より落とす王権の雷霆。
  royal_thunder: {
    id: "royal_thunder", name: "王権の雷霆", icon: "storm", color: "#c8a8ff",
    desc: "玉座の威光が雷霆となり、夜を裂いて落ちる秘伝。",
    maxLevel: 8, behavior: "lightning", school: "moon", signature: true,
    statsFor: (lv): WeaponStats => ({
      damage: 26 + 10 * (lv - 1),
      cooldown: 1.6 - 0.09 * (lv - 1),
      amount: 1 + fl(lv / 3), // Lv1:1 → Lv8:3条
      area: 1.3 + 0.1 * (lv - 1),
      speed: 0, pierce: 999, duration: 0,
    }),
  },
};

/** Lv(lv-1)→Lv(lv) の差分を日本語で要約。カードの説明文に使う。 */
export function describeWeaponUpgrade(def: WeaponDef, lv: number): string {
  if (lv <= 1) return def.desc;
  const a = def.statsFor(lv - 1);
  const b = def.statsFor(lv);
  const r1 = (n: number) => Math.round(n * 10) / 10;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const parts: string[] = [];
  if (b.damage > a.damage) parts.push(`威力 +${r1(b.damage - a.damage)}`);
  if (b.amount > a.amount) parts.push(`数 +${b.amount - a.amount}`);
  if (b.cooldown < a.cooldown) parts.push(`間隔 -${r2(a.cooldown - b.cooldown)}秒`);
  if (b.area > a.area) parts.push(`範囲 +${Math.round((b.area / a.area - 1) * 100)}%`);
  if (b.pierce > a.pierce && b.pierce < 900) parts.push(`貫通 +${b.pierce - a.pierce}`);
  if (b.speed > a.speed && def.id !== "orbs") parts.push(`弾速 +${Math.round(b.speed - a.speed)}`);
  if (b.speed > a.speed && def.id === "orbs") parts.push(`回転速度上昇`);
  return parts.join(" ／ ") || "総合強化";
}

// ------------------------------------------------------------
// 真化(進化)ツリー
// 基底武器を「最大Lv」にし、対となるパッシブを「所持」していると真化カードが出現する。
// 一部の武器は対パッシブによって分岐し、別の真化形態へ至る(ビルド多様性の核)。
// ------------------------------------------------------------

export interface EvolutionBranch {
  req: PassiveId; // 必要パッシブ(所持していればよい)
  evo: WeaponId; // 真化先
  desc: string; // 真化カードの説明
}

export const EVOLUTIONS: Partial<Record<WeaponId, EvolutionBranch[]>> = {
  grimoire: [
    { req: "tome", evo: "grimoire_codex", desc: "詠唱が途切れぬ。魔弾は奔流となり、貫いて止まらない。" },
    { req: "might", evo: "grimoire_blasphemy", desc: "禁忌の一節。少数の弾が、すべてを撃ち抜く巨弾と化す。" },
  ],
  knife: [{ req: "boots", evo: "knife_galewall", desc: "疾走が刃を呼ぶ。全方位へ刃の壁を撒き散らす。" }],
  orbs: [{ req: "candle", evo: "orbs_halo", desc: "月光が環を拡げる。聖環が高速で旋回し、触れる者を灼く。" }],
  censer: [{ req: "heart", evo: "censer_sanctuary", desc: "鼓動が炎を育てる。広大な聖域が不浄を焼き続ける。" }],
  lightning: [
    { req: "might", evo: "lightning_chain", desc: "怒りが雷を連ねる。落雷の数が爆発的に増す。" },
    { req: "candle", evo: "lightning_storm", desc: "焦点が嵐を生む。極大の落雷が大地を割る。" },
  ],
  axe: [{ req: "magnet", evo: "axe_comet", desc: "引力が斧を加速する。無数の彗星斧が降り注ぐ。" }],
};

// ------------------------------------------------------------
// 流派(紋章)── 武器とパッシブが帯びる属性。所持数でセットボーナスが灯る。
//   3 個で第1段、5 個で第2段。異なる流派を伸ばすほど、別人のビルドになる。
// ------------------------------------------------------------

export interface SchoolDef {
  id: SchoolId;
  name: string;
  icon: string;
  color: string;
  desc: string;
}

export const SCHOOLS: Record<SchoolId, SchoolDef> = {
  steel: { id: "steel", name: "鋼", icon: "s_steel", color: "#cfd8e6", desc: "刃と投擲。貫きと手数の流派。" },
  spirit: { id: "spirit", name: "霊", icon: "s_spirit", color: "#9d7bff", desc: "魔と魂。詠唱と回転の流派。" },
  moon: { id: "moon", name: "月", icon: "moon", color: "#7be0c4", desc: "範囲と天災。聖環と雷の流派。" },
  blood: { id: "blood", name: "血", icon: "blood", color: "#ff5a5a", desc: "生命と膂力。耐久と吸命の流派。" },
};

export const schoolTier = (count: number): number => (count >= 5 ? 2 : count >= 3 ? 1 : 0);

/** セットボーナスの説明(UI 表示用) */
export function schoolBonusText(id: SchoolId, tier: number): string {
  if (tier <= 0) return "未発現";
  const T: Record<SchoolId, [string, string]> = {
    steel: ["貫通 +1", "貫通 +2"],
    spirit: ["攻撃間隔 -8%", "攻撃間隔 -15%"],
    moon: ["効果範囲 +18%", "効果範囲 +34% ／ 威力 +6%"],
    blood: ["毎秒 +0.6 HP ／ 最大HP +8%", "毎秒 +1.2 HP ／ 最大HP +16% ／ 撃破毎 +0.5 HP"],
  };
  return T[id][tier - 1];
}

// ------------------------------------------------------------
// パッシブ (最大6スロット)
// ------------------------------------------------------------

export const PASSIVES: Record<string, PassiveDef> = {
  boots: {
    id: "boots",
    name: "俊足のブーツ",
    school: "steel",
    icon: "boots",
    color: "#8fd4ff",
    desc: "夜霧を駆ける足取り。",
    maxLevel: 5,
    levelDesc: (lv) => `移動速度 +8%（合計 +${8 * lv}%）`,
  },
  heart: {
    id: "heart",
    name: "不死者の心臓",
    school: "blood",
    icon: "heart",
    color: "#ff6b7d",
    desc: "脈打つたび、器が広がる。",
    maxLevel: 5,
    levelDesc: (lv) => `最大HP +15%（合計 +${15 * lv}%）＋ 取得時 25 回復`,
  },
  might: {
    id: "might",
    name: "血の腕輪",
    school: "blood",
    icon: "might",
    color: "#ff5a5a",
    desc: "流した血の分だけ、腕は重くなる。",
    maxLevel: 5,
    levelDesc: (lv) => `全武器の威力 +8%（合計 +${8 * lv}%）`,
  },
  tome: {
    id: "tome",
    name: "古き砂時計",
    school: "spirit",
    icon: "hourglass",
    color: "#e8c87b",
    desc: "刻は、求める者にだけ速く流れる。",
    maxLevel: 5,
    levelDesc: (lv) => `攻撃間隔 -6%（合計 -${6 * lv}%）`,
  },
  candle: {
    id: "candle",
    name: "月光のレンズ",
    school: "moon",
    icon: "lens",
    color: "#cfe8ff",
    desc: "蒼い焦点が、災いの輪を広げる。",
    maxLevel: 5,
    levelDesc: (lv) => `効果範囲 +10%（合計 +${10 * lv}%）`,
  },
  magnet: {
    id: "magnet",
    name: "骸の磁鉄",
    school: "spirit",
    icon: "magnet",
    color: "#b08cff",
    desc: "魂魄は、引かれるように掌へ。",
    maxLevel: 5,
    levelDesc: (lv) => `経験石の回収範囲 +30%（合計 +${30 * lv}%）`,
  },
  regen: {
    id: "regen",
    name: "緋き聖杯",
    school: "blood",
    icon: "chalice",
    color: "#e0455e",
    desc: "満たされた杯は、傷を忘れさせる。",
    maxLevel: 5,
    levelDesc: (lv) => `毎秒 +0.45 HP 再生（合計 +${(0.45 * lv).toFixed(2)}/秒）`,
  },
  duplicator: {
    id: "duplicator",
    name: "写し身の鏡",
    school: "steel",
    icon: "mirror",
    color: "#9adbe8",
    desc: "鏡の中のあなたも、引き金を引く。",
    maxLevel: 2,
    levelDesc: () => `投射武器の数 +1`,
  },
};

// ------------------------------------------------------------
// 敵
// ------------------------------------------------------------

export const ENEMIES: Record<EnemyKind, EnemyDef> = {
  bat: { kind: "bat", name: "宵蝙蝠", hp: 8, speed: 96, damage: 6, radius: 9, xp: 1, color: "#8a7bd1" },
  zombie: { kind: "zombie", name: "屍鬼", hp: 26, speed: 54, damage: 10, radius: 12, xp: 2, color: "#6fae6f" },
  skeleton: { kind: "skeleton", name: "骸骨兵", hp: 62, speed: 68, damage: 14, radius: 12, xp: 3, color: "#d8d3c0" },
  wraith: { kind: "wraith", name: "怨霊", hp: 48, speed: 122, damage: 12, radius: 11, xp: 4, color: "#79e0e8" },
  brute: { kind: "brute", name: "巨躯", hp: 300, speed: 44, damage: 22, radius: 20, xp: 12, color: "#c97e4a" },
  warlock: { kind: "warlock", name: "夜術師", hp: 42, speed: 60, damage: 10, radius: 11, xp: 7, color: "#b06be0" },
  elite: { kind: "elite", name: "黄金の巨躯", hp: 1600, speed: 50, damage: 26, radius: 24, xp: 48, color: "#e8b54d" },
  // boss は「基準値」。実際の各ボスは下の BOSSES が倍率で味付けする。
  boss: { kind: "boss", name: "夜の主", hp: 6000, speed: 76, damage: 32, radius: 30, xp: 300, color: "#ff3d54" },
};

// ------------------------------------------------------------
// ボス図鑑 ── ボス出現時はこの中からランダムで1体が選ばれる(直前と同じは避ける)。
//   ENEMIES.boss を基準に各倍率で個性付け。art は描画の絵柄、ranged は呪弾を撃つか。
// ------------------------------------------------------------
export type BossArt = "count" | "boneKing" | "plagueTitan" | "wraithQueen" | "ashHerald";

/**
 * ボス固有能力。各ボスを「ただ硬い雑魚」から個性ある一戦にする要。
 *   swarm  … 蝙蝠の眷属へ分身して散らし、打撃で吸血(自己回復)する。
 *   raise  … プレイヤーを囲うように骸骨兵を蘇生召喚する。
 *   miasma … 瘴気をまとい、圏内のプレイヤーを鈍足化+継続ダメージ(デバフ)。
 *   wail   … 夜啼きでプレイヤーの視界を狭め(視界制限)、呪弾を放つ。
 *   rally  … 周囲の雑魚を鼓舞して強化(バフ)し、火炎弾を全方位へ放つ(攻撃方法)。
 */
export type BossAbility = "swarm" | "raise" | "miasma" | "wail" | "rally";

export interface BossDef {
  id: string;
  name: string;
  title: string; // 一言の異名(出現演出に出す)
  art: BossArt;
  color: string; // 主色(HPリング・撃破爆発・ミニマップ)
  eye: string; // 双眸の発光色
  hpMul: number;
  speedMul: number;
  dmgMul: number;
  radiusMul: number;
  ability: BossAbility; // 固有能力(下の説明 trait と対応)
  trait: string; // 図鑑・出現演出に出す能力の一言
  ranged?: boolean; // 追尾しつつ呪弾を放つ(wail/rally と併用可)
}

export const BOSSES: BossDef[] = [
  { id: "count", name: "緋き伯爵 ヴァルナハト", title: "夜を統べる吸血卿", art: "count",
    color: "#ff3d54", eye: "#ff2740", hpMul: 1.0, speedMul: 1.0, dmgMul: 1.0, radiusMul: 1.0,
    ability: "swarm", trait: "蝙蝠へ分身し、打てば打つほど血を吸い癒える" },
  { id: "boneKing", name: "骸の王 オスァリオン", title: "朽ちぬ玉座の亡王", art: "boneKing",
    color: "#e9e2cf", eye: "#9ad8ff", hpMul: 1.15, speedMul: 0.82, dmgMul: 1.15, radiusMul: 1.22,
    ability: "raise", trait: "骸骨兵を蘇らせ、四方から囲い込む" },
  { id: "plagueTitan", name: "腐肉の巨躯 モルバス", title: "歩く疫病の山", art: "plagueTitan",
    color: "#8fbf63", eye: "#d6ff7a", hpMul: 1.55, speedMul: 0.66, dmgMul: 1.2, radiusMul: 1.34,
    ability: "miasma", trait: "瘴気を撒き、近づく者を鈍らせ蝕む" },
  { id: "wraithQueen", name: "夜啼く女王 ノクトゥルナ", title: "嘆きを振り撒く亡き女王", art: "wraithQueen",
    color: "#9b6bff", eye: "#d7b8ff", hpMul: 0.82, speedMul: 1.22, dmgMul: 0.95, radiusMul: 0.96,
    ability: "wail", trait: "夜啼きで灯を狭め、呪弾を放つ", ranged: true },
  { id: "ashHerald", name: "灰燼の使者 セラフ", title: "焼け落ちる翼の伝令", art: "ashHerald",
    color: "#ff8a3c", eye: "#ffd06a", hpMul: 1.1, speedMul: 1.05, dmgMul: 1.1, radiusMul: 1.08,
    ability: "rally", trait: "夜の眷属を鼓舞し、火炎弾を撒き散らす" },
];

export const BOSSES_BY_ID: Record<string, BossDef> = Object.fromEntries(BOSSES.map((b) => [b.id, b]));

// ------------------------------------------------------------
// ウェーブテーブル(時間秒 → 出現レートと構成)
// burst を持つ行は、その時刻に到達した瞬間リング状の大量出現を起こす。
// ------------------------------------------------------------

export interface WaveRow {
  t: number;
  rate: number; // 毎秒の出現数
  kinds: [EnemyKind, number][]; // [種類, 重み]
  burst?: { kind: EnemyKind; count: number };
}

export const WAVE_TABLE: WaveRow[] = [
  { t: 0, rate: 1.3, kinds: [["bat", 1]] },
  { t: 40, rate: 1.9, kinds: [["bat", 3], ["zombie", 1]] },
  { t: 110, rate: 2.5, kinds: [["zombie", 3], ["bat", 2], ["skeleton", 1]] },
  { t: 200, rate: 3.1, kinds: [["skeleton", 3], ["zombie", 2], ["warlock", 1]] },
  { t: 300, rate: 3.7, kinds: [["wraith", 2], ["skeleton", 2], ["zombie", 1], ["warlock", 1]], burst: { kind: "bat", count: 36 } },
  { t: 420, rate: 4.4, kinds: [["wraith", 3], ["skeleton", 3], ["brute", 1], ["warlock", 1]] },
  { t: 540, rate: 5.2, kinds: [["brute", 2], ["wraith", 3], ["skeleton", 2], ["warlock", 1]] },
  { t: 600, rate: 5.8, kinds: [["wraith", 4], ["brute", 2], ["warlock", 1]], burst: { kind: "wraith", count: 24 } },
  { t: 720, rate: 6.4, kinds: [["brute", 3], ["wraith", 3], ["skeleton", 4], ["warlock", 2]] },
  { t: 840, rate: 7.5, kinds: [["brute", 4], ["wraith", 4], ["warlock", 2]], burst: { kind: "skeleton", count: 40 } },
];

/** エリート出現時刻(各1体・宝を落とす) */
export const ELITE_TIMES = [180, 360, 540, 660];

/** ボス出現とクリア時刻 */
export const BOSS_TIME = 720; // 12:00
export const VICTORY_TIME = 900; // 15:00 生存でも勝利

/** 時間経過による敵HP倍率 */
export const hpScale = (t: number) => 1 + (t / 60) * 0.11;
/** 時間経過による敵攻撃力倍率 */
export const dmgScale = (t: number) => 1 + (t / 60) * 0.035;

/** レベルアップに必要な経験値曲線(集中ビルドが時間内に真化へ届くよう緩やか) */
export const xpNeeded = (level: number) =>
  Math.round(5 + (level - 1) * 5 + Math.pow(level, 1.55));

/** 聖域(プレイ可能領域)の半径。これを越えて逃げ続けることはできない。 */
export const ARENA_RADIUS = 1500;

// ------------------------------------------------------------
// ゲームモード
// ------------------------------------------------------------
export const MODES: Record<GameMode, ModeConfig> = {
  standard: {
    id: "standard", name: "標準", tag: "15分を生き延びよ",
    desc: "12:00 にボスが出現。撃破するか、15:00 まで生き延びれば夜明け。基本の難易度。",
    victoryTime: 900, bossTime: 720, bossRepeat: false, bossInterval: 0,
    eliteInterval: null, hpMul: 1.0, dmgMul: 1.0, rateMul: 1.0, escalate: 0,
  },
  long: {
    id: "long", name: "長征", tag: "30分の死闘",
    desc: "30:00 までの長丁場。ボスは繰り返し襲来し、敵は刻々と強くなる。腰を据えたビルド向き。",
    victoryTime: 1800, bossTime: 1200, bossRepeat: true, bossInterval: 360,
    eliteInterval: 140, hpMul: 1.15, dmgMul: 1.1, rateMul: 1.15, escalate: 0.12,
  },
  endless: {
    id: "endless", name: "無限", tag: "果てなき夜",
    desc: "終わりはない。敵は無限に強く、密になる。倒れるまで、どこまで行けるか。",
    victoryTime: null, bossTime: 600, bossRepeat: true, bossInterval: 300,
    eliteInterval: 110, hpMul: 1.2, dmgMul: 1.15, rateMul: 1.25, escalate: 0.22,
  },
};
export const DEFAULT_MODE: GameMode = "standard";

// ------------------------------------------------------------
// 武具の型(カードでひと目で差別化するためのラベル)
// ------------------------------------------------------------
const ARCHETYPE: Record<WeaponBehavior, string> = {
  bolt: "誘導弾",
  knife: "貫通刃",
  axe: "投擲",
  lightning: "落雷",
  orbs: "周回",
  aura: "設置オーラ",
};
export function weaponArchetype(def: WeaponDef): string {
  if (def.ring) return "全方位刃";
  return ARCHETYPE[def.behavior];
}

/** カード表示用の主要ステータス(新規取得時の基準値) */
export function weaponStatBadges(def: WeaponDef, lv: number): { label: string; value: string }[] {
  const s = def.statsFor(lv);
  const out: { label: string; value: string }[] = [{ label: "威力", value: String(Math.round(s.damage)) }];
  if (def.behavior !== "aura") out.push({ label: "数", value: String(s.amount) });
  out.push({ label: "間隔", value: `${(Math.round(s.cooldown * 100) / 100).toFixed(2)}s` });
  return out;
}

// ------------------------------------------------------------
// 変種(通常種 / 大型種 / 色違い)
//   large  … 大型種: 同種を加速させる。巨大で硬い。
//   recolor… 色違い: 同種を硬化(被ダメ軽減)させる。別色の体躯。
// 変種を持てるのは通常モンスターのみ(elite/boss は対象外)。
// ------------------------------------------------------------
export const REGULAR_KINDS: EnemyKind[] = ["bat", "zombie", "skeleton", "wraith", "brute"];

export const VARIANT = {
  large: { radiusMul: 1.7, hpMul: 3.2, dmgMul: 1.4, xpMul: 4, speedMul: 0.82, auraSpeed: 1.4 },
  recolor: { radiusMul: 1.15, hpMul: 2.0, dmgMul: 1.15, xpMul: 3, speedMul: 1.0, toughReduce: 0.7 },
} as const;

/** 色違いの代替パレット(種ごと) */
export const RECOLOR_PALETTE: Record<EnemyKind, string> = {
  bat: "#e85cc8",
  zombie: "#5cc7e8",
  skeleton: "#b48cff",
  wraith: "#ffb14e",
  brute: "#8a5cff",
  warlock: "#6be0b0",
  elite: "#e8b54d",
  boss: "#ff3d54",
};

export function variantTuning(variant: EnemyVariant) {
  if (variant === "large") return VARIANT.large;
  if (variant === "recolor") return VARIANT.recolor;
  return null;
}

// ------------------------------------------------------------
// プレイヤースキン(見た目のみ・性能差なし)
//   外套(cloak)・縁取り(rim)・襟巻(scarf)・面立ち(face)・燈火(lantern)の配色を差し替える。
//   解放条件はメタ層(profile)が判定する。
// ------------------------------------------------------------
export interface SkinDef {
  id: string;
  name: string;
  desc: string;
  cloak: string;
  rim: string;
  scarf: string;
  face: string;
  lantern: string;
  signature?: WeaponId; // 専用技。この装いのときだけ修得カードが出現する。
}

export const SKINS: SkinDef[] = [
  { id: "wanderer", name: "夜の放浪者", desc: "標準の装い。緋いマフラーと琥珀の燈火。", cloak: "#2a2140", rim: "#5b4886", scarf: "#c8323e", face: "#e8dcc3", lantern: "#d9a441" },
  { id: "ash", name: "灰被りの巡礼", desc: "灰にまみれた沈黙の巡礼装。", cloak: "#2b2b33", rim: "#6f6f7e", scarf: "#9aa0ab", face: "#e3ddd2", lantern: "#c9c2b0" },
  { id: "crimson", name: "緋の伯爵狩り", desc: "返り血の色を纏う、討伐者の証。【専用技：緋月の戦鎌】", cloak: "#3a1020", rim: "#8a2230", scarf: "#e0455e", face: "#efe0d2", lantern: "#ff6f7e", signature: "crimson_scythe" },
  { id: "verdant", name: "月光の祭司", desc: "聖域の緑を映す、祈りの法衣。【専用技：聖域の薫光】", cloak: "#163228", rim: "#3f7f6f", scarf: "#7be08a", face: "#e6ddc8", lantern: "#a8e6b0", signature: "verdant_bloom" },
  { id: "ember", name: "焔の巡礼", desc: "灰の下にくすぶる熾火を宿す装い。【専用技：業火の輪舞】", cloak: "#341812", rim: "#7e3a22", scarf: "#ff7a3c", face: "#efdcc6", lantern: "#ff9a4e", signature: "ember_waltz" },
  { id: "frost", name: "霜夜の狩人", desc: "凍てつく夜気を切り裂く白の狩衣。【専用技：氷牙の連弾】", cloak: "#16222e", rim: "#3f6f8f", scarf: "#8fe6ff", face: "#e6eef2", lantern: "#bfe9ff", signature: "frost_lance" },
  { id: "plague", name: "疫病の医師", desc: "腐臭の只中を歩む、鴉面の医師。【専用技：疫癘の散弾】", cloak: "#1c2418", rim: "#4f6a3f", scarf: "#b6d27a", face: "#cdd6c0", lantern: "#cfe08a", signature: "plague_fan" },
  { id: "royal", name: "月の王", desc: "夜を統べる者にのみ許される紫紺の式装。【専用技：王権の雷霆】", cloak: "#1d1630", rim: "#7a5cc0", scarf: "#c8a8ff", face: "#efe6ff", lantern: "#e0c8ff", signature: "royal_thunder" },
  { id: "gold", name: "黄金詠唱者", desc: "勝利を重ねた者に灯る黄金の威光。【専用技：黄金の聖句】", cloak: "#2a2410", rim: "#a9791f", scarf: "#ffe28a", face: "#f0e6cf", lantern: "#ffd66a", signature: "gold_verse" },
  { id: "void", name: "虚無の影", desc: "真化の極みに触れた者が沈む紫闇。【専用技：虚無の鎖環】", cloak: "#14121c", rim: "#3a3152", scarf: "#b078ff", face: "#d8cfe6", lantern: "#c69bff", signature: "void_chain" },
];

export const SKINS_BY_ID: Record<string, SkinDef> = Object.fromEntries(SKINS.map((s) => [s.id, s]));
export const DEFAULT_SKIN = "wanderer";

// ------------------------------------------------------------
// 遺物(curio) ── プレイ中に稀にステージへ落ちる収集品。触れて獲得し、
//   ホーム(タイトル)の「飾り棚」へドラッグで自由配置して飾れる。性能差は無い。
//   アイコンは既存のシジル(icons.tsx)を流用する(新規SVGは増やさない)。
// ------------------------------------------------------------
export interface CurioDef {
  id: string;
  name: string;
  desc: string;
  icon: string; // Sigil 名
  color: string;
}

export const CURIOS: CurioDef[] = [
  { id: "chalice", name: "緋の聖杯", desc: "尽きぬ緋酒を湛えるという銀の杯。", icon: "chalice", color: "#e0455e" },
  { id: "skull", name: "賢者の髑髏", desc: "死してなお夜を見通すと噂の頭蓋。", icon: "skull", color: "#e8dcc3" },
  { id: "tome", name: "禁断の書", desc: "誰も最後まで読めぬ、囁く一冊。", icon: "tome", color: "#7be0c4" },
  { id: "candle", name: "不滅の燭", desc: "風にも消えぬ、青く揺らぐ蝋燭。", icon: "candle", color: "#ffd66a" },
  { id: "hourglass", name: "止まりし砂時計", desc: "夜の間だけ砂が逆しまに流れる。", icon: "hourglass", color: "#cdbcff" },
  { id: "moon", name: "欠けし月片", desc: "血月から剥がれ落ちたという欠片。", icon: "moon", color: "#ff6f7e" },
  { id: "star", name: "墜ちた星屑", desc: "聖域の隅に静かに灯る小さな星。", icon: "star4", color: "#ffe28a" },
  { id: "crest", name: "古びた紋章盾", desc: "もう誰も覚えていない家の紋。", icon: "shield", color: "#8fd3ff" },
  { id: "stake", name: "銀の杭", desc: "幾度も伯爵を貫いたという銀杭。", icon: "stake", color: "#cfd8e6" },
  { id: "rose", name: "枯れぬ薔薇", desc: "緋を保ったまま朽ちない一輪。", icon: "blood", color: "#c8323e" },
];

export const CURIOS_BY_ID: Record<string, CurioDef> = Object.fromEntries(CURIOS.map((c) => [c.id, c]));
export const TOTAL_CURIOS = CURIOS.length;
