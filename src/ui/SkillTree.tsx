// 〔層〕付属的な機能 / AUXILIARY ── 技の系統樹(スキル選択時の俯瞰オーバーレイ)
//   役割: レベルアップ(アルカナ選択)の最中に開く、現在のビルドを反映した真化系統の図。
//     所持スキルを画面下部に「横一列」で並べ、各スキルの系統樹を「上方向」へ伸ばす ──
//     根(基底武器)から、手応えが質的に変わる節目(数/貫通/範囲の伸び)だけを段階ラダーに積み、
//     最上段で真化先カードへ枝分かれする。必要加護の所持や真化条件を色分けする。
//     情報は要点に絞る: 毎レベルの威力伸びは根に一言、ラダーは節目のみ、真化先は名と条件だけ。
//   操作: 既定は一画面に収める。溢れた時のみ A/D(←→)横スクロール、W/S(↑↓)縦スクロール。
//     Esc/Tab/背景クリックで閉じる(閉じるは親が司る)。
//   世界観: 図鑑の真化表示の語彙を引き継ぎ、リキッドグラス＋シジル＋金/血/骨で統一。

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { HudSlot, WeaponDef, WeaponId } from "../game/types";
import { EVOLUTIONS, PASSIVES, SKINS_BY_ID, WEAPONS } from "../game/data";
import { Sigil } from "./icons";

interface Props {
  weapons: HudSlot[]; // 所持中の武器(真化済みは evolved=true)
  passives: HudSlot[]; // 所持中の加護
  skinId: string;
  onClose: () => void;
}

type RowState = "done" | "ready" | "growing"; // 真化済み / 真化可能 / 育成中
const BADGE: Record<RowState, string> = { done: "真化済", ready: "真化可", growing: "育成中" };

type StageStatus = "done" | "next" | "future"; // 修得済み / 次の一段 / 未到達
interface Badge { k: string; v: string } // 例: { k:"数", v:"+1" }

const SCROLL_STEP = 220; // キー1打ぶんのスクロール量(px)

/** Lv(lv-1)→lv で質的に変わる節目(数/貫通/範囲)だけを抜き出す。威力等の数値伸びは根の要約に集約。 */
function milestoneBadges(def: WeaponDef, lv: number): Badge[] {
  const a = def.statsFor(lv - 1);
  const b = def.statsFor(lv);
  const out: Badge[] = [];
  if (b.amount > a.amount) out.push({ k: "数", v: `+${b.amount - a.amount}` });
  if (b.pierce > a.pierce && b.pierce < 900) out.push({ k: "貫", v: `+${b.pierce - a.pierce}` });
  if (b.area > a.area) out.push({ k: "範", v: `+${Math.round((b.area / a.area - 1) * 100)}%` });
  return out;
}

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
        return { key: branch.evo, evo, req, reqOwned, state };
      });
      const inBuild = !!baseSlot || branches.some((b) => b.state === "done");
      if (!inBuild) return null;

      const curLv = baseSlot?.level ?? base.maxLevel; // 真化済みで基底が消えている場合は満了扱い
      // 毎レベルの威力伸び(要約)。一定でない場合も Lv1→2 を代表値に。
      const dmgPerLv = Math.round(base.statsFor(2).damage - base.statsFor(1).damage);
      // 段階ラダーは「節目(数/貫通/範囲が伸びる段)」と「最大Lv(真化解放)」だけに絞る。
      const ladder = [];
      for (let lv = 2; lv <= base.maxLevel; lv++) {
        const badges = milestoneBadges(base, lv);
        const last = lv === base.maxLevel;
        if (badges.length === 0 && !last) continue;
        const status: StageStatus = lv <= curLv ? "done" : lv === curLv + 1 ? "next" : "future";
        ladder.push({ lv, badges, status, last });
      }
      ladder.reverse(); // 最大Lvを上に=上へ伸びる

      return { baseId, base, baseSlot, dmgPerLv, ladder, branches };
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);

  // ラダーの高さを全系統で揃える(根=下端 / 真化先=上端 がきれいに整列するように)
  const maxRows = Math.max(1, ...systems.map((s) => s.ladder.length));

  // 固有技(装いの秘伝)
  const skin = SKINS_BY_ID[skinId];
  const sigId = skin?.signature;
  const sig = sigId ? WEAPONS[sigId] : undefined;
  const sigOwned = sigId ? ownedW.has(sigId) : false;

  // 横/縦に溢れた時のみキー操作を許す。器(scrollRef)をキーで動かす。
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

  // 真化先カード(分岐1本ぶん)。説明文は持たず、名と状態と必要加護だけに絞る。
  const EvoCard = ({
    icon,
    name,
    badge,
    req,
  }: {
    icon: string;
    name: string;
    badge: string;
    req?: { icon: string; name: string; owned: boolean };
  }) => (
    <div className="skt-evo-card">
      <span className="skt-medallion big"><Sigil name={icon} /></span>
      <span className="skt-name evo">{name}</span>
      <span className="skt-badge">{badge}</span>
      {req && (
        <div className={`skt-reqchip${req.owned ? " on" : ""}`} title={req.owned ? "所持" : "未所持"}>
          <span className="skt-medallion sm"><Sigil name={req.icon} /></span>
          <span className="skt-reqchip-name">{req.name}</span>
        </div>
      )}
    </div>
  );

  return (
    <div className="skilltree-overlay" onClick={onClose}>
      <div className="skilltree" role="dialog" aria-label="技の系統" onClick={(e) => e.stopPropagation()}>
        <div className="skt-head">月 詠 の 系 統</div>
        <p className="skt-sub">
          下が手持ち、上が真化の先 ── 金は真化目前
          {(scrollable.x || scrollable.y) && (
            <span className="skt-scrollhint">
              {scrollable.x && <> 　<kbd>A</kbd><kbd>D</kbd></>}
              {scrollable.y && <> 　<kbd>W</kbd><kbd>S</kbd></>}
            </span>
          )}
        </p>

        <div className="skt-scroll" ref={scrollRef}>
          <div className="skt-forest" style={{ "--maxrows": maxRows } as React.CSSProperties}>
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
                        <EvoCard
                          icon={b.state === "growing" && !s.baseSlot ? "lock" : b.evo.icon}
                          name={b.evo.name}
                          badge={BADGE[b.state]}
                          req={{ icon: b.req.icon, name: b.req.name, owned: b.reqOwned }}
                        />
                      </div>
                    ))}
                  </div>
                )}

                {/* 根から枝へ伸びる金の幹線(上向き) */}
                {s.branches.length > 0 && <div className="skt-link" aria-hidden />}

                {/* 中段: 節目だけの段階ラダー(最大Lvを上に=上へ伸びる)。高さは全系統で揃える。 */}
                <ol className="skt-stages">
                  {s.ladder.map((st) => (
                    <li
                      key={st.lv}
                      className={`skt-stage is-${st.status}${st.last ? " is-last" : ""}`}
                    >
                      <span className="skt-stage-lv">Lv{st.lv}</span>
                      <span className="skt-stage-badges">
                        {st.badges.map((bd, i) => (
                          <span key={i} className="skt-bdg">{bd.k}{bd.v}</span>
                        ))}
                        {st.last && <span className="skt-bdg gold">真化</span>}
                      </span>
                    </li>
                  ))}
                </ol>

                {/* 根: 基底武器(現在Lv ＋ 毎レベルの威力伸び) */}
                <div className="skt-root">
                  <span className="skt-medallion"><Sigil name={s.base.icon} /></span>
                  <span className="skt-node-body">
                    <span className="skt-name">{s.base.name}</span>
                    {s.baseSlot ? (
                      <Pips level={s.baseSlot.level} max={s.baseSlot.maxLevel} />
                    ) : (
                      <span className="skt-foot">満了</span>
                    )}
                  </span>
                  {s.dmgPerLv > 0 && (
                    <span className="skt-grow">力+{s.dmgPerLv}<i>/Lv</i></span>
                  )}
                </div>
              </div>
            ))}

            {/* 固有技(秘伝): 同形式の 1 列 */}
            {sig && (
              <div className="skt-system skt-signature" style={{ "--accent": skin?.scarf ?? "#c8a8ff" } as React.CSSProperties}>
                <div className="skt-branches">
                  <div className={`skt-branch${sigOwned ? " is-done" : " is-growing"}`}>
                    <EvoCard
                      icon={sigOwned ? sig.icon : "lock"}
                      name={sig.name}
                      badge={sigOwned ? "修得済" : "秘伝"}
                    />
                  </div>
                </div>

                <div className="skt-link" aria-hidden />

                <ol className="skt-stages" aria-hidden />

                <div className="skt-root">
                  <span className="skt-medallion"><Sigil name="moon" /></span>
                  <span className="skt-node-body">
                    <span className="skt-name">{skin?.name ?? "装い"}</span>
                    <span className="skt-foot">秘伝</span>
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
