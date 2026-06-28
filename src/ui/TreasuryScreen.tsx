// 〔層〕付属的な機能 / AUXILIARY ── 宝物庫画面(ミニゲームの装備管理)
//   役割: ホームのオートバトラー「タスクバーヒーロー」の装備を、プレイヤー自身が
//     選んで着替える「武具庫」。3スロット(武器/鎧/護符)への装着・取り外し・売却と、
//     現在の装いに適合する装備を揃える「一致セット」の進捗を見せる。
//   挙動: 判定・保存は持たず、heroView(profile) を読んで一覧化し、操作は親(App)の
//     onEquip/onUnequip/onSell へ流すだけ(祭壇/記録の間と同じ作法)。

import type { GearItem, GearSlot, Profile } from "../meta/profile";
import { heroView, isAffinityMatch, RARITY_COLORS, RARITY_NAMES, TRAITS, slotLabel, skinSignature, setBonusPct } from "../meta/hero";
import { SKINS_BY_ID } from "../game/data";
import { Sigil } from "./icons";

interface Props {
  profile: Profile;
  onEquip: (id: string) => void;
  onUnequip: (slot: GearSlot) => void;
  onSell: (id: string) => void;
  onBack: () => void;
}

const SLOT_ICON: Record<GearSlot, string> = { weapon: "axe", armor: "shield", charm: "halo" };

/** 適合する装いの表示名(none=汎用)。 */
function affinityName(affinity: string): string {
  if (affinity === "none") return "汎用";
  return SKINS_BY_ID[affinity]?.name ?? affinity;
}

/** 1点の装備カードの中身(装着スロット枠でも宝物庫グリッドでも共用)。 */
function GearBody({ item, currentSkin }: { item: GearItem; currentSkin: string }) {
  const match = isAffinityMatch(item, currentSkin);
  const tr = item.trait ? TRAITS[item.trait] : null;
  return (
    <>
      <div className="gear-name" style={{ color: RARITY_COLORS[item.rarity] }}>
        {item.name}
        <span className="gear-rar">{RARITY_NAMES[item.rarity]}</span>
      </div>
      <div className="gear-stats">
        {item.atk > 0 && <span>攻 {item.atk}</span>}
        {item.hp > 0 && <span>体 {item.hp}</span>}
        {item.haste > 0 && <span>速 {item.haste.toFixed(2)}</span>}
      </div>
      <div className={`gear-affinity${match ? " match" : ""}`}>
        <Sigil name="moon" className="gear-aff-ico" />
        {affinityName(item.affinity)}
        {match && <b>適合</b>}
      </div>
      {tr && (
        <div className="gear-trait" title={tr.desc}>
          <i>{tr.name}</i> {tr.desc}
        </div>
      )}
    </>
  );
}

export default function TreasuryScreen({ profile, onEquip, onUnequip, onSell, onBack }: Props) {
  const v = heroView(profile);
  const skin = SKINS_BY_ID[profile.selectedSkin];
  const sig = skinSignature(profile.selectedSkin);
  const sigInfo = sig ? TRAITS[sig] : null;
  const bonusPct = Math.round(setBonusPct(v.setMatch) * 100);
  // 宝物庫は希少度→価値の順で見やすく並べる(元配列は壊さない)
  const inv = [...v.inventory].sort((a, b) => b.rarity - a.rarity || b.power - a.power);

  return (
    <div className="overlay dim">
      <div className="treasury" role="dialog" aria-label="宝物庫">
        <div className="treasury-head">
          <h2 className="treasury-title">宝 物 庫</h2>
          <div className="treasury-hero">
            <span>Lv.{v.level}</span>
            <span>深度 {v.depth}</span>
            <span>攻 {v.stats.atk}</span>
            <span>体 {v.stats.maxHp}</span>
            <span>手数 {v.stats.atkSpeed.toFixed(2)}</span>
          </div>
        </div>
        <p className="treasury-sub">
          本編で集めた装備を選んで纏え。今の装い「{skin?.name ?? "—"}」に適合する装備を揃えるほど強くなる。
        </p>

        {/* ── 一致セットの進捗 ── */}
        <div className="set-banner" style={{ "--accent": skin?.scarf ?? "#d9a441" } as React.CSSProperties}>
          <span className="set-label">
            {skin?.name ?? "装い"} 適合
            <b>{v.setMatch}/3</b>
          </span>
          <span className="set-pips" aria-hidden="true">
            {[0, 1, 2].map((k) => (
              <i key={k} className={k < v.setMatch ? "on" : ""} />
            ))}
          </span>
          <span className="set-bonus">
            攻撃・体力 +{bonusPct}%
            {sigInfo && <em>{v.setMatch >= 3 ? `${sigInfo.name} 開花` : `3揃いで「${sigInfo.name}」`}</em>}
          </span>
        </div>

        {/* ── 装着スロット ── */}
        <div className="treasury-slots">
          {v.equipped.map((g) => (
            <div
              key={g.slot}
              className={`gear-slot${g.item ? "" : " empty"}`}
              style={g.item ? ({ "--rar": RARITY_COLORS[g.item.rarity] } as React.CSSProperties) : undefined}
            >
              <div className="slot-head">
                <Sigil name={SLOT_ICON[g.slot]} className="slot-ico" />
                {g.label}
              </div>
              {g.item ? (
                <>
                  <GearBody item={g.item} currentSkin={profile.selectedSkin} />
                  <button className="btn ghost gear-act" onClick={() => onUnequip(g.slot)}>外す</button>
                </>
              ) : (
                <div className="slot-empty">未装備</div>
              )}
            </div>
          ))}
        </div>

        {/* ── 宝物庫(未装着の所持) ── */}
        <div className="treasury-section-label">所 持 ── {inv.length}</div>
        {inv.length === 0 ? (
          <p className="treasury-empty">夜に踏み出し、骸が落とす装備を集めよ。拾った装備はここに納まる。</p>
        ) : (
          <div className="treasury-inv">
            {inv.map((item) => (
              <div
                key={item.id}
                className="gear-card"
                style={{ "--rar": RARITY_COLORS[item.rarity] } as React.CSSProperties}
              >
                <div className="gear-card-slot">
                  <Sigil name={SLOT_ICON[item.slot]} className="slot-ico" />
                  {slotLabel(item.slot)}
                </div>
                <GearBody item={item} currentSkin={profile.selectedSkin} />
                <div className="gear-actions">
                  <button className="btn gear-act" onClick={() => onEquip(item.id)}>装着</button>
                  <button className="btn ghost gear-act" onClick={() => onSell(item.id)}>売却</button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="btn-col">
          <button className="btn ghost" onClick={onBack} autoFocus>
            戻る
          </button>
        </div>
      </div>
    </div>
  );
}
