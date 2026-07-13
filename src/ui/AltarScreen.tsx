// 〔層〕付属的な機能 / AUXILIARY ── 祭壇画面(恒久強化と装いの選択)
//   役割: meta/altar の強化一覧と data の SKINS を一覧化し、購入(onBuy)と
//     装い選択(onSelectSkin)を親(App)へ通知する「店頭」。判定・保存は持たない。
//   挙動(ミクロ): profile.upgrades の段階から各強化の費用/上限/購入可否を計算し、
//     魂が足りないボタンは無効化。装いは unlockedSkins で解錠状態を出し分け、
//     skinPortrait() で実スプライトを見本表示する。特別な装いには専用技を明記。

import type { Profile } from "../meta/profile";
import { SKIN_REQUIREMENTS } from "../meta/profile";
import { META_UPGRADES, nextCost } from "../meta/altar";
import { SKINS, SKINS_BY_ID } from "../game/data";
import { skinPortrait } from "../game/render";
import { Sigil } from "./icons";
import { EmberField, RiteHeader } from "./ornaments";

interface Props {
  profile: Profile;
  onBuy: (id: string) => void;
  onSelectSkin: (id: string) => void;
  onBack: () => void;
}

export default function AltarScreen({ profile, onBuy, onSelectSkin, onBack }: Props) {
  return (
    <div className="overlay dim">
      <EmberField count={12} tint="#ff8a7a" seed={3} />
      <div
        className="altar rite-panel"
        role="dialog"
        aria-label="祭壇"
        style={{ "--rite-tint": "#c8323e" } as React.CSSProperties}
      >
        <RiteHeader
          title="祭 壇"
          icon="altar_flame"
          sub="倒れた骸から集めた魂を捧げ、来たる夜に備えよ。強化は永く残る。"
          aside={
            <div className="souls-badge" title="所持する魂">
              <Sigil name="skull" className="souls-ico" />
              <b>{profile.souls.toLocaleString()}</b>
              <i>魂</i>
            </div>
          }
        />

        {/* ── 恒久強化 ── */}
        <div className="altar-section-label rite-label">恒 久 強 化</div>
        <div className="upgrade-grid rise-seq">
          {META_UPGRADES.map((u) => {
            const lv = profile.upgrades[u.id] ?? 0;
            const maxed = lv >= u.max;
            const cost = maxed ? 0 : nextCost(u, lv);
            const afford = profile.souls >= cost;
            return (
              <div
                key={u.id}
                className={`upgrade${maxed ? " maxed" : ""}`}
                style={{ "--accent": u.color } as React.CSSProperties}
              >
                {maxed && <span className="rite-stamp" aria-hidden="true">極</span>}
                <div className="upgrade-top">
                  <span className="upgrade-ico"><Sigil name={u.icon} /></span>
                  <span className="upgrade-name">{u.name}</span>
                </div>
                <p className="upgrade-desc">{u.desc}</p>
                {/* key に段階を含め、購入時に再マウント → 灯が順に点く */}
                <div key={`${u.id}-${lv}`} className="upgrade-pips" aria-label={`段階 ${lv}/${u.max}`}>
                  {Array.from({ length: u.max }, (_, k) => (
                    <i key={k} className={k < lv ? "on" : ""} />
                  ))}
                </div>
                <div className="upgrade-step">{u.step}／段</div>
                <button
                  className="btn buy"
                  disabled={maxed || !afford}
                  onClick={() => onBuy(u.id)}
                >
                  {maxed ? (
                    "極 ── MAX"
                  ) : (
                    <>
                      捧げる<span className="cost"><Sigil name="skull" className="cost-ico" />{cost}</span>
                    </>
                  )}
                </button>
              </div>
            );
          })}
        </div>

        {/* ── 装い(スキン) ── */}
        <div className="altar-section-label rite-label">夜 の 装 い</div>
        <div className="skin-grid rise-seq">
          {SKINS.map((sk) => {
            const unlocked = profile.unlockedSkins.includes(sk.id);
            const selected = profile.selectedSkin === sk.id;
            const reqText = SKIN_REQUIREMENTS.find((r) => r.id === sk.id)?.req ?? "";
            const def = SKINS_BY_ID[sk.id];
            return (
              <button
                key={sk.id}
                className={`skin${selected ? " selected" : ""}${unlocked ? "" : " locked"}`}
                style={{ "--accent": def.scarf } as React.CSSProperties}
                disabled={!unlocked}
                onClick={() => unlocked && onSelectSkin(sk.id)}
                aria-label={`${sk.name}${unlocked ? "" : "(未解放)"}`}
              >
                <span className="skin-portrait">
                  <img src={skinPortrait(sk.id)} alt="" width={44} height={44} />
                  {!unlocked && <span className="skin-lock"><Sigil name="lock" /></span>}
                </span>
                <span className="skin-name">{sk.name}</span>
                <span className="skin-foot">
                  {selected ? "纏っている" : unlocked ? sk.desc : reqText}
                </span>
              </button>
            );
          })}
        </div>

        <div className="btn-col">
          <button className="btn ghost" onClick={onBack} autoFocus>
            戻る
          </button>
        </div>
      </div>
    </div>
  );
}
