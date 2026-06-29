// 〔層〕付属的な機能 / AUXILIARY ── 技の系統樹(スキル選択時の俯瞰オーバーレイ)
//   役割: レベルアップ(アルカナ選択)の最中に開く、現在のビルドを反映した真化系統の図。
//     「基底武器 ＋ 必要加護 ▶ 真化先」を所持状況で色分けし、あと一歩で真化する枝を金に灯す。
//     固有技(装いの秘伝)も併記する。判定・保存は持たず props を映すだけの表示専用。
//   世界観: 図鑑の真化表示の語彙を引き継ぎ、リキッドグラス＋シジル＋金/血/骨で統一。

import type { HudSlot } from "../game/types";
import { EVOLUTIONS, PASSIVES, SKINS_BY_ID, WEAPONS } from "../game/data";
import type { WeaponId } from "../game/types";
import { Sigil } from "./icons";

interface Props {
  weapons: HudSlot[]; // 所持中の武器(真化済みは evolved=true)
  passives: HudSlot[]; // 所持中の加護
  skinId: string;
  onClose: () => void;
}

type RowState = "done" | "ready" | "growing"; // 真化済み / 真化可能 / 育成中
const BADGE: Record<RowState, string> = { done: "真化済み", ready: "真化可能", growing: "育成中" };

/** 小さなレベルピップ(x/max)。 */
function Pips({ level, max }: { level: number; max: number }) {
  return (
    <span className="skt-pips" aria-label={`Lv ${level}/${max}`}>
      {Array.from({ length: max }, (_, k) => (
        <i key={k} className={k < level ? "on" : ""} />
      ))}
    </span>
  );
}

export default function SkillTree({ weapons, passives, skinId, onClose }: Props) {
  const ownedW = new Map(weapons.map((w) => [w.id, w]));
  const passiveLv = (id: string): number => passives.find((p) => p.id === id)?.level ?? 0;

  // 所持に関わる真化系統だけを行にする(基底を所持 or その真化を所持)
  const rows = (Object.keys(EVOLUTIONS) as WeaponId[]).flatMap((baseId) => {
    const base = WEAPONS[baseId];
    const baseSlot = ownedW.get(baseId); // 真化前の基底を所持していれば slot(真化済みなら消えている)
    return (EVOLUTIONS[baseId] ?? []).map((branch) => {
      const evo = WEAPONS[branch.evo];
      const req = PASSIVES[branch.req];
      const evoOwned = ownedW.has(branch.evo);
      const inBuild = !!baseSlot || evoOwned;
      const reqOwned = passiveLv(branch.req) >= 1;
      let state: RowState = "growing";
      if (evoOwned) state = "done";
      else if (baseSlot && baseSlot.level >= baseSlot.maxLevel && reqOwned) state = "ready";
      return { key: branch.evo, base, evo, req, baseSlot, reqOwned, state, inBuild };
    });
  }).filter((r) => r.inBuild);

  // 固有技(装いの秘伝)
  const skin = SKINS_BY_ID[skinId];
  const sigId = skin?.signature;
  const sig = sigId ? WEAPONS[sigId] : undefined;
  const sigOwned = sigId ? ownedW.has(sigId) : false;

  return (
    <div className="skilltree-overlay" onClick={onClose}>
      <div className="skilltree" role="dialog" aria-label="技の系統" onClick={(e) => e.stopPropagation()}>
        <div className="skt-head">月 詠 の 系 統</div>
        <p className="skt-sub">いま組み上がる技の系譜 ── あと一歩で真化する枝は金に灯る</p>

        <div className="skt-rows">
          {rows.length === 0 && <p className="skt-empty">まだ系統は芽吹いていない。武器を手に取れ。</p>}

          {rows.map((r) => (
            <div key={r.key} className={`skt-row is-${r.state}`} style={{ "--accent": r.evo.color } as React.CSSProperties}>
              {/* 基底武器 */}
              <span className="skt-node skt-base">
                <span className="skt-medallion"><Sigil name={r.base.icon} /></span>
                <span className="skt-node-body">
                  <span className="skt-name">{r.base.name}</span>
                  {r.baseSlot
                    ? <Pips level={r.baseSlot.level} max={r.baseSlot.maxLevel} />
                    : <span className="skt-foot">真化の母体</span>}
                </span>
              </span>

              <span className="skt-plus">＋</span>

              {/* 必要加護 */}
              <span className={`skt-node skt-req${r.reqOwned ? " on" : ""}`}>
                <span className="skt-medallion sm"><Sigil name={r.req.icon} /></span>
                <span className="skt-node-body">
                  <span className="skt-name">{r.req.name}</span>
                  <span className="skt-foot">{r.reqOwned ? "所持" : "未所持"}</span>
                </span>
              </span>

              <span className="skt-arrow">▶</span>

              {/* 真化先 */}
              <span className="skt-node skt-evo">
                <span className="skt-medallion big">
                  <Sigil name={r.state === "growing" && !r.baseSlot ? "lock" : r.state === "done" ? r.evo.icon : r.evo.icon} />
                </span>
                <span className="skt-node-body">
                  <span className="skt-name evo">{r.evo.name}</span>
                  <span className="skt-badge">{BADGE[r.state]}</span>
                </span>
              </span>
            </div>
          ))}

          {/* 固有技(秘伝) */}
          {sig && (
            <div className={`skt-row skt-signature${sigOwned ? " is-done" : ""}`} style={{ "--accent": skin?.scarf ?? "#c8a8ff" } as React.CSSProperties}>
              <span className="skt-node skt-base">
                <span className="skt-medallion"><Sigil name="moon" /></span>
                <span className="skt-node-body">
                  <span className="skt-name">{skin?.name ?? "装い"}</span>
                  <span className="skt-foot">この装いの秘伝</span>
                </span>
              </span>
              <span className="skt-arrow">▶</span>
              <span className="skt-node skt-evo">
                <span className="skt-medallion big"><Sigil name={sigOwned ? sig.icon : "lock"} /></span>
                <span className="skt-node-body">
                  <span className="skt-name evo">{sig.name}</span>
                  <span className="skt-badge">{sigOwned ? "修得済み" : "秘伝"}</span>
                </span>
              </span>
            </div>
          )}
        </div>

        <button className="btn ghost skt-close" onClick={onClose}>閉じる ── <kbd>Tab</kbd></button>
      </div>
    </div>
  );
}
