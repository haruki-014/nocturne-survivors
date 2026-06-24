// ═══════════════════════════════════════════════════════════
//  〔層〕付属的な機能 / AUXILIARY ── 祭壇(恒久強化の定義と計算)
//
//  役割(マクロ): 魂(通貨)で買う「開始時から効く永続強化」の一覧と、その効果を
//    1つの MetaBonus(倍率の束)へ合成する計算を担う。買った内容は profile に
//    段階(level)で保存され、ラン開始時に engine.setMeta() 経由で反映される。
//  挙動(ミクロ):
//    ・META_UPGRADES … 各強化の定義。apply(b, level) が MetaBonus を書き換える。
//    ・nextCost(def, level) … 次の1段の費用。等比(×1.85)で逓増し終盤ほど重い。
//    ・computeMetaBonus(profile) … 全強化の apply を畳み込み、最終ボーナスを得る。
//    ・buyUpgrade(prev, id) … 魂と上限を確認して1段購入(失敗時 null)。
//  ※ MetaBonus がどう体感性能になるかは engine.recomputeDerived() を参照。
// ═══════════════════════════════════════════════════════════

import type { MetaBonus } from "../game/types";
import { NO_META_BONUS } from "../game/types";
import { saveProfile, type Profile } from "./profile";

export interface MetaUpgradeDef {
  id: string;
  name: string;
  icon: string;
  desc: string;
  color: string;
  max: number;
  baseCost: number; // 1段目の費用。段が上がるごとに baseCost ずつ増える。
  step: string; // 1段あたりの効果(表示用)
  apply: (b: MetaBonus, level: number) => void;
}

// baseCost は「1 段目の費用」。1 プレイの獲得魂(概ね 400〜700)で初段がやっと1つ買える
// よう、強い強化ほど高く設定する。段が上がるごとに COST_GROWTH 倍で逓増する。
export const META_UPGRADES: MetaUpgradeDef[] = [
  {
    id: "vitality", name: "不死の祈り", icon: "heart", color: "#e0455e",
    desc: "夜を耐える肉体。最大HPを底上げする。", max: 5, baseCost: 420, step: "最大HP +8%",
    apply: (b, l) => { b.maxHpMul *= 1 + 0.08 * l; },
  },
  {
    id: "wrath", name: "血の渇き", icon: "blood", color: "#c8323e",
    desc: "渇望が刃を鋭くする。与ダメージを高める。", max: 5, baseCost: 480, step: "攻撃力 +4%",
    apply: (b, l) => { b.mightMul *= 1 + 0.04 * l; },
  },
  {
    id: "swift", name: "俊足の加護", icon: "boots", color: "#8fd3ff",
    desc: "夜風のごとき足取り。移動速度を上げる。", max: 4, baseCost: 360, step: "移動速度 +3%",
    apply: (b, l) => { b.speedMul *= 1 + 0.03 * l; },
  },
  {
    id: "haste", name: "焦燥の刻", icon: "hourglass", color: "#cdbcff",
    desc: "刻が急く。武具の発動間隔を縮める。", max: 4, baseCost: 520, step: "攻撃間隔 -2.5%",
    apply: (b, l) => { b.cooldownMul *= 1 - 0.025 * l; },
  },
  {
    id: "greed", name: "強欲の瞳", icon: "tome", color: "#7be0c4",
    desc: "経験を貪る瞳。取得経験値を増やす。", max: 5, baseCost: 380, step: "取得経験 +6%",
    apply: (b, l) => { b.xpMul *= 1 + 0.06 * l; },
  },
  {
    id: "lodestone", name: "骸寄せの磁", icon: "magnet", color: "#ff9a5a",
    desc: "骸が手元へ転がり来る。回収範囲を広げる。", max: 4, baseCost: 320, step: "回収範囲 +10%",
    apply: (b, l) => { b.magnetMul *= 1 + 0.1 * l; },
  },
  {
    id: "blessing", name: "緋き祝福", icon: "chalice", color: "#7be08a",
    desc: "緩やかに傷を癒やす聖杯の恵み。", max: 4, baseCost: 460, step: "毎秒 +0.3 回復",
    apply: (b, l) => { b.regenAdd += 0.3 * l; },
  },
  {
    id: "bulwark", name: "鉄壁の祈り", icon: "shield", color: "#cfd8e6",
    desc: "魂が皮膚を硬くする。被ダメージを軽減する。", max: 4, baseCost: 560, step: "被ダメ -5%",
    apply: (b, l) => { b.armor = Math.min(0.6, b.armor + 0.05 * l); },
  },
];

export const META_UPGRADES_BY_ID: Record<string, MetaUpgradeDef> =
  Object.fromEntries(META_UPGRADES.map((u) => [u.id, u]));

/** 段が上がるごとに費用が逓増する(等比 ~1.6 倍)。終盤ほど重く、カンストまで長く遊べる。 */
const COST_GROWTH = 1.6;

/** 現在 level 段所持しているとき、次の 1 段を買う費用(0 段目→1 段目が baseCost)。 */
export function nextCost(def: MetaUpgradeDef, level: number): number {
  return Math.round((def.baseCost * Math.pow(COST_GROWTH, level)) / 10) * 10;
}

/** プロファイルの取得段階から、ラン開始時ボーナスを合成する。 */
export function computeMetaBonus(profile: Profile): MetaBonus {
  const b: MetaBonus = { ...NO_META_BONUS };
  for (const def of META_UPGRADES) {
    const lv = profile.upgrades[def.id] ?? 0;
    if (lv > 0) def.apply(b, lv);
  }
  return b;
}

/** 1 段購入。魂が足りて上限未満なら反映したプロファイルを返す。失敗時は null。 */
export function buyUpgrade(prev: Profile, id: string): Profile | null {
  const def = META_UPGRADES_BY_ID[id];
  if (!def) return null;
  const lv = prev.upgrades[id] ?? 0;
  if (lv >= def.max) return null;
  const cost = nextCost(def, lv);
  if (prev.souls < cost) return null;
  const p: Profile = {
    ...prev,
    souls: prev.souls - cost,
    upgrades: { ...prev.upgrades, [id]: lv + 1 },
  };
  saveProfile(p);
  return p;
}
