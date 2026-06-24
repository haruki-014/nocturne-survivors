// 〔層〕付属的な機能 / AUXILIARY ── プレイ中の HUD(計器表示)
//   役割: エンジンが ~8Hz で送る HudState を、HP/Lv/経験値/時間/討伐数/装備/
//     流派として画面端に表示するだけの「読み取り専用の窓」。ゲームは進めない。
//   挙動: props.hud の数値から割合(%)を計算しバーやチップに反映。盤面の上に
//     pointer-events:none で重なり、クリックを奪わない。大きさは CSS 変数
//     --hud-scale(設定スライダー)に追従。低HP時は赤いビネットを足す。

import type { HudState, HudSlot } from "../game/types";
import { Sigil } from "./icons";

function fmtTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function Slots({ items, label }: { items: HudSlot[]; label: string }) {
  if (items.length === 0) return null;
  return (
    <div className="slots" aria-label={label}>
      {items.map((s) => {
        const pct = Math.min(100, (s.level / Math.max(1, s.maxLevel)) * 100);
        const maxed = s.level >= s.maxLevel;
        return (
          <div
            key={s.id}
            className={`slot${maxed ? " maxed" : ""}${s.evolved ? " evolved" : ""}`}
            title={`${s.name} Lv.${s.level}/${s.maxLevel}`}
            style={{ "--slot-color": s.color } as React.CSSProperties}
          >
            <span className="slot-icon"><Sigil name={s.icon} /></span>
            {s.evolved && <span className="slot-star">✶</span>}
            <span className="lv">{s.level}</span>
            <span className="slot-fill" style={{ width: `${pct}%` }} />
          </div>
        );
      })}
    </div>
  );
}

interface Props {
  hud: HudState;
}

export default function HUD({ hud }: Props) {
  const xpPct = Math.min(100, (hud.xp / Math.max(1, hud.xpNext)) * 100);
  const hpPct = Math.max(0, Math.min(100, (hud.hp / Math.max(1, hud.maxHp)) * 100));
  const stamPct = Math.max(0, Math.min(100, (hud.stamina / Math.max(1, hud.staminaMax)) * 100));
  const lowHp = hud.hp / Math.max(1, hud.maxHp) <= 0.3;
  const dawnPct =
    hud.victoryTime != null ? Math.min(100, (hud.time / hud.victoryTime) * 100) : 0;

  return (
    <div className="hud" aria-hidden="true">
      {lowHp && <div className="lowhp-vignette" />}

      <div className="hud-top">
        <div className="xpbar">
          <div style={{ width: `${xpPct}%` }} />
        </div>

        <div className="hud-row">
          <div className="hud-left">
            <div className="vitals">
              <div className="lvl-orb">
                <span className="cap">LV</span>
                <span className="n">{hud.level}</span>
              </div>
              <div className="bars">
                <div className={`hpbar${lowHp ? " low" : ""}`}>
                  <div className="hp-fill" style={{ width: `${hpPct}%` }} />
                  <span className="hp-num">
                    <strong>{Math.ceil(hud.hp)}</strong>
                    <i>/{Math.ceil(hud.maxHp)}</i>
                  </span>
                </div>
                <div className={`stambar${hud.rollReady ? " ready" : ""}`} title="スタミナ(Space/Shiftで回避)">
                  <div className="stam-fill" style={{ width: `${stamPct}%` }} />
                </div>
              </div>
            </div>
            <div className="slots-wrap">
              <Slots items={hud.weapons} label="武器" />
              <Slots items={hud.passives} label="加護" />
            </div>
          </div>

          <div className="hud-right">
            <span className="chip kills-chip">
              <span className="label">討伐</span>
              {hud.kills}
            </span>
            {hud.schools.filter((s) => s.tier > 0).length > 0 && (
              <div className="hud-crests">
                {hud.schools
                  .filter((s) => s.tier > 0)
                  .map((s) => (
                    <span
                      key={s.id}
                      className={`hud-crest tier-${s.tier}`}
                      title={`${s.name}の流派 ×${s.count}`}
                      style={{ "--accent": s.color } as React.CSSProperties}
                    >
                      <Sigil name={s.icon} className="crest-ico" />
                      {s.tier >= 2 && <span className="hud-crest-star">✦</span>}
                    </span>
                  ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="hud-timer">
        <span className="t">{fmtTime(hud.time)}</span>
        <span className="dawn">
          {hud.victoryTime != null ? `夜明け ${fmtTime(hud.victoryTime)}` : "∞ 果てなき夜"}
        </span>
        {hud.victoryTime != null && (
          <span className="dawn-track">
            <span className="dawn-fill" style={{ width: `${dawnPct}%` }} />
          </span>
        )}
      </div>

      {hud.bossHp && (
        <div className="bossbar">
          <div className="name">{hud.bossHp.name}</div>
          <div className="bar">
            <div style={{ width: `${Math.max(0, (hud.bossHp.hp / hud.bossHp.max) * 100)}%` }} />
          </div>
        </div>
      )}
    </div>
  );
}
