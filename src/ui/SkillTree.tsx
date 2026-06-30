// 〔層〕付属的な機能 / AUXILIARY ── 技の系統樹(スキル選択時の俯瞰オーバーレイ)
//   役割: レベルアップ(アルカナ選択)の最中に開く、現在のビルドを反映した真化系統の図。
//     所持スキルを画面下部に「横一列」で並べ、各スキルの系統樹を「上方向」へ伸ばす ──
//     根(基底武器)から各レベルで伸びる効果を段階ラダーで上に積み、最上段で真化先カードへ枝分かれする。
//     必要加護の所持や真化条件を色分けし、あと一歩で真化する枝を金に灯す。固有技(秘伝)も末尾に併記。
//     判定・保存は持たず props を映すだけの表示専用。
//   操作: 既定は一画面に全体を収める。所持スキルが多く横に溢れた時のみ A/D(←→)で横スクロール、
//     背の高い樹は W/S(↑↓)で縦スクロール。Esc/Tab/背景クリックで閉じる(閉じるは親が司る)。
//   世界観: 図鑑の真化表示の語彙を引き継ぎ、リキッドグラス＋シジル＋金/血/骨で統一。

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { HudSlot, WeaponId } from "../game/types";
import {
  EVOLUTIONS,
  PASSIVES,
  SKINS_BY_ID,
  WEAPONS,
  describeWeaponUpgrade,
} from "../game/data";
import { Sigil } from "./icons";

interface Props {
  weapons: HudSlot[]; // 所持中の武器(真化済みは evolved=true)
  passives: HudSlot[]; // 所持中の加護
  skinId: string;
  onClose: () => void;
}

type RowState = "done" | "ready" | "growing"; // 真化済み / 真化可能 / 育成中
const BADGE: Record<RowState, string> = { done: "真化済み", ready: "真化可能", growing: "育成中" };

type StageStatus = "done" | "next" | "future"; // 修得済み / 次の一段 / 未到達

const SCROLL_STEP = 220; // キー1打ぶんのスクロール量(px)

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

  // 所持に関わる真化系統だけを系統樹にする(基底を所持 or その真化を所持)
  const systems = (Object.keys(EVOLUTIONS) as WeaponId[])
    .map((baseId) => {
      const base = WEAPONS[baseId];
      const baseSlot = ownedW.get(baseId); // 基底を所持していれば slot(真化済みなら消えている)
      const branches = (EVOLUTIONS[baseId] ?? []).map((branch) => {
        const evo = WEAPONS[branch.evo];
        const req = PASSIVES[branch.req];
        const evoOwned = ownedW.has(branch.evo);
        const reqOwned = passiveLv(branch.req) >= 1;
        let state: RowState = "growing";
        if (evoOwned) state = "done";
        else if (baseSlot && baseSlot.level >= baseSlot.maxLevel && reqOwned) state = "ready";
        return { key: branch.evo, evo, req, reqOwned, state, desc: branch.desc };
      });
      const inBuild = !!baseSlot || branches.some((b) => b.state === "done");
      if (!inBuild) return null;

      // 各レベルで伸びる効果(段階ラダー)。Lv2..maxLevel の差分文を再利用。
      const curLv = baseSlot?.level ?? base.maxLevel; // 真化済みで基底が消えている場合は満了扱い
      const stages = Array.from({ length: base.maxLevel - 1 }, (_, i) => {
        const lv = i + 2;
        const text = describeWeaponUpgrade(base, lv);
        const milestone = /数|貫通|範囲/.test(text); // 質的に手応えが変わる段
        const status: StageStatus = lv <= curLv ? "done" : lv === curLv + 1 ? "next" : "future";
        return { lv, text, milestone, status, last: lv === base.maxLevel };
      });

      return { baseId, base, baseSlot, curLv, stages, branches };
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);

  // 固有技(装いの秘伝)
  const skin = SKINS_BY_ID[skinId];
  const sigId = skin?.signature;
  const sig = sigId ? WEAPONS[sigId] : undefined;
  const sigOwned = sigId ? ownedW.has(sigId) : false;

  // 横溢れ時のみ A/D 横スクロールを許す。器(scrollRef)をキーで動かす。
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollable, setScrollable] = useState<{ x: boolean; y: boolean }>({ x: false, y: false });

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () =>
      setScrollable({
        x: el.scrollWidth > el.clientWidth + 1,
        y: el.scrollHeight > el.clientHeight + 1,
      });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [systems.length]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      let dx = 0;
      let dy = 0;
      if (e.code === "KeyA" || e.code === "ArrowLeft") dx = -SCROLL_STEP;
      else if (e.code === "KeyD" || e.code === "ArrowRight") dx = SCROLL_STEP;
      else if (e.code === "KeyW" || e.code === "ArrowUp") dy = -SCROLL_STEP;
      else if (e.code === "KeyS" || e.code === "ArrowDown") dy = SCROLL_STEP;
      else return;
      e.preventDefault();
      e.stopPropagation();
      el.scrollBy({ left: dx, top: dy, behavior: "smooth" });
    };
    // capture で親(LevelUpModal)より先に受け、誤決定や素通りを防ぐ
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  return (
    <div className="skilltree-overlay" onClick={onClose}>
      <div className="skilltree" role="dialog" aria-label="技の系統" onClick={(e) => e.stopPropagation()}>
        <div className="skt-head">月 詠 の 系 統</div>
        <p className="skt-sub">
          根は持つ技、上へ伸びるは真化の先 ── あと一歩で真化する枝は金に灯る
          {(scrollable.x || scrollable.y) && (
            <span className="skt-scrollhint">
              {scrollable.x && <> 　<kbd>A</kbd><kbd>D</kbd> 横移動</>}
              {scrollable.y && <> 　<kbd>W</kbd><kbd>S</kbd> 縦移動</>}
            </span>
          )}
        </p>

        <div className="skt-scroll" ref={scrollRef}>
          <div className="skt-forest">
            {systems.length === 0 && !sig && (
              <p className="skt-empty">まだ系統は芽吹いていない。武器を手に取れ。</p>
            )}

            {systems.map((s) => (
              <div key={s.baseId} className="skt-system" style={{ "--accent": s.base.color } as React.CSSProperties}>
                {/* 上端: 真化先カード(分岐) */}
                {s.branches.length > 0 && (
                  <div className="skt-branches">
                    {s.branches.map((b) => (
                      <div
                        key={b.key}
                        className={`skt-branch is-${b.state}`}
                        style={{ "--accent": b.evo.color } as React.CSSProperties}
                      >
                        <div className="skt-evo-card">
                          <div className="skt-evo-head">
                            <span className="skt-medallion big">
                              <Sigil name={b.state === "growing" && !s.baseSlot ? "lock" : b.evo.icon} />
                            </span>
                            <span className="skt-node-body">
                              <span className="skt-name evo">{b.evo.name}</span>
                              <span className="skt-badge">{BADGE[b.state]}</span>
                            </span>
                          </div>
                          <p className="skt-evo-desc">{b.desc}</p>
                          <div className={`skt-reqchip${b.reqOwned ? " on" : ""}`}>
                            <span className="skt-medallion sm"><Sigil name={b.req.icon} /></span>
                            <span className="skt-reqchip-body">
                              <span className="skt-reqchip-name">{b.req.name}</span>
                              <span className="skt-foot">{b.reqOwned ? "所持" : "未所持"}</span>
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* 根から枝へ伸びる金の幹線(上向き) */}
                {s.branches.length > 0 && <div className="skt-link" aria-hidden />}

                {/* 中段: 段階の効果(最大Lvを上に=上へ伸びる) */}
                <ol className="skt-stages">
                  {[...s.stages].reverse().map((st) => (
                    <li
                      key={st.lv}
                      className={`skt-stage is-${st.status}${st.milestone ? " is-milestone" : ""}${st.last ? " is-last" : ""}`}
                    >
                      <span className="skt-stage-lv">Lv{st.lv}</span>
                      <span className="skt-stage-text">{st.text}</span>
                      {st.last && <span className="skt-stage-tag">真化解放</span>}
                    </li>
                  ))}
                </ol>

                {/* 根: 基底武器(現在Lv) */}
                <div className="skt-root">
                  <span className="skt-medallion"><Sigil name={s.base.icon} /></span>
                  <span className="skt-node-body">
                    <span className="skt-name">{s.base.name}</span>
                    {s.baseSlot ? (
                      <Pips level={s.baseSlot.level} max={s.baseSlot.maxLevel} />
                    ) : (
                      <span className="skt-foot">真化の母体（満了）</span>
                    )}
                  </span>
                </div>
              </div>
            ))}

            {/* 固有技(秘伝): 同形式の 1 列 */}
            {sig && (
              <div className="skt-system skt-signature" style={{ "--accent": skin?.scarf ?? "#c8a8ff" } as React.CSSProperties}>
                <div className="skt-branches">
                  <div className={`skt-branch${sigOwned ? " is-done" : " is-growing"}`}>
                    <div className="skt-evo-card">
                      <div className="skt-evo-head">
                        <span className="skt-medallion big"><Sigil name={sigOwned ? sig.icon : "lock"} /></span>
                        <span className="skt-node-body">
                          <span className="skt-name evo">{sig.name}</span>
                          <span className="skt-badge">{sigOwned ? "修得済み" : "秘伝"}</span>
                        </span>
                      </div>
                      <p className="skt-evo-desc">{sig.desc}</p>
                    </div>
                  </div>
                </div>

                <div className="skt-link" aria-hidden />

                <div className="skt-root">
                  <span className="skt-medallion"><Sigil name="moon" /></span>
                  <span className="skt-node-body">
                    <span className="skt-name">{skin?.name ?? "装い"}</span>
                    <span className="skt-foot">この装いの秘伝</span>
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        <button className="btn ghost skt-close" onClick={onClose}>閉じる ── <kbd>Tab</kbd></button>
      </div>
    </div>
  );
}
