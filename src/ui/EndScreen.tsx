// 〔層〕付属的な機能 / AUXILIARY ── リザルト画面(勝利/敗北)
//   役割: ラン終了時の成績(RunStats)と、このランで新たに得た称号・装い・魂を
//     見せ、次の行動(もう一夜/祭壇/記録/タイトル)へ導く。集計済みの値を映すだけ。
//   挙動: victory と mode により題と言い回しを変える。獲得した魂(soulsEarned)・
//     解放した称号(unlocked)/装い(unlockedSkins)は親から受け取って並べるだけ。
//   背景: 終了後も裏で静止しているステージ(常設 canvas)を見せないよう、勝敗に応じた
//     専用の背景(勝利=夜明け / 敗北=緋の沈降)で全面を覆う。

import type { RunStats } from "../game/types";
import { MODES, SKINS_BY_ID, CURIOS_BY_ID } from "../game/data";
import { Sigil } from "./icons";
import type { Achievement, GearItem } from "../meta/profile";
import { RARITY_COLORS, RARITY_NAMES, slotLabel } from "../meta/hero";

const LOOT_CHIP_CAP = 10; // 戦利品チップの表示上限(超過は「他 N 点」)

function fmtTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

interface Props {
  victory: boolean;
  stats: RunStats;
  unlocked: Achievement[];
  unlockedSkins: string[];
  soulsEarned: number;
  runLoot: GearItem[]; // この夜に拾った戦利品(装備)
  runCurios: string[]; // この夜に拾った遺物のid
  onRetry: () => void;
  onTitle: () => void;
  onCodex: () => void;
  onAltar: () => void;
}

export default function EndScreen({ victory, stats, unlocked, unlockedSkins, soulsEarned, runLoot, runCurios, onRetry, onTitle, onCodex, onAltar }: Props) {
  const endless = stats.mode === "endless";
  const modeName = MODES[stats.mode].name;
  const title = victory ? "夜 明 け" : endless ? "夜 は 明 け ぬ" : "緋 に 沈 む";
  const lead = victory
    ? stats.bossDefeated
      ? "夜の主は塵となり、東の空が白み始める。"
      : "骸の波濤を凌ぎきり、東の空が白み始める。"
    : endless
      ? "果てなき夜に呑まれた。だが、ここまで来た。"
      : "灯は消え、骸の群れが静かに閉じてゆく。";

  // この夜の戦利品: レアリティ別の点数と、希少度→価値で並べた表示チップ(上限あり)。
  const rarityCounts = [0, 0, 0, 0, 0];
  for (const g of runLoot) rarityCounts[g.rarity]++;
  const chips = [...runLoot].sort((a, b) => b.rarity - a.rarity || b.power - a.power);
  const shownChips = chips.slice(0, LOOT_CHIP_CAP);
  const extraChips = chips.length - shownChips.length;
  const hasLoot = runLoot.length > 0 || runCurios.length > 0;

  return (
    <div className={`overlay end-screen ${victory ? "victory" : "defeat"}`}>
      <div className="end-backdrop" aria-hidden="true" />
      <div className="panel" role="dialog" aria-label={victory ? "勝利" : "敗北"}>
        <h2 className={`end-title ${victory ? "victory" : "defeat"}`}>{title}</h2>
        <p style={{ color: "var(--bone-dim)", fontSize: 12.5 }}>
          <span style={{ color: "var(--gold)", letterSpacing: "0.12em" }}>［{modeName}］</span> {lead}
        </p>

        <div className="stat-grid">
          <span className="k">生存時間</span>
          <span className="v">{fmtTime(stats.time)}</span>
          <span className="k">討伐数</span>
          <span className="v">{stats.kills}</span>
          <span className="k">到達レベル</span>
          <span className="v">{stats.level}</span>
          {stats.bossKills > 0 ? (
            <>
              <span className="k">ボス撃破</span>
              <span className="v">{stats.bossKills}</span>
            </>
          ) : (
            <>
              <span className="k">総ダメージ</span>
              <span className="v">{Math.round(stats.damageDealt).toLocaleString()}</span>
            </>
          )}
        </div>

        <div className="souls-earned" aria-label="獲得した魂">
          <Sigil name="skull" className="souls-ico" />
          <span>魂を <b>{soulsEarned.toLocaleString()}</b> 集めた</span>
        </div>

        {/* ── この夜の戦利品(装備・遺物) ── */}
        <div className="end-loot" aria-label="この夜の戦利品">
          <div className="end-loot-head">
            <span className="end-loot-title">この夜の戦利品</span>
            {hasLoot && (
              <span className="end-loot-count">
                装備 {runLoot.length}
                {runCurios.length > 0 && ` ・ 遺物 ${runCurios.length}`}
              </span>
            )}
          </div>
          {!hasLoot ? (
            <p className="end-loot-empty">骸は何も遺さなかった。</p>
          ) : (
            <>
              {runLoot.length > 0 && (
                <div className="end-loot-rarities">
                  {rarityCounts.map((n, r) =>
                    n > 0 ? (
                      <span key={r} className="end-rar-badge" style={{ "--rc": RARITY_COLORS[r] } as React.CSSProperties}>
                        <i />
                        {RARITY_NAMES[r]} <b>{n}</b>
                      </span>
                    ) : null,
                  )}
                </div>
              )}
              {runLoot.length > 0 && (
                <div className="end-loot-chips">
                  {shownChips.map((g) => (
                    <span key={g.id} className="end-loot-chip" style={{ "--rc": RARITY_COLORS[g.rarity] } as React.CSSProperties}>
                      <span className="chip-slot">{slotLabel(g.slot)}</span>
                      <span className="chip-name">{g.name}</span>
                      {g.trait && <span className="chip-trait" title="特性あり">◆</span>}
                    </span>
                  ))}
                  {extraChips > 0 && <span className="end-loot-chip more">他 {extraChips} 点</span>}
                </div>
              )}
              {runCurios.length > 0 && (
                <div className="end-loot-curios">
                  {runCurios.map((id, i) => {
                    const c = CURIOS_BY_ID[id];
                    return (
                      <span key={id + i} className="end-curio" style={{ "--rc": c?.color ?? "#ffe28a" } as React.CSSProperties}>
                        <Sigil name={c?.icon ?? "skull"} className="end-curio-ico" />
                        {c?.name ?? "遺物"}
                      </span>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>

        {unlocked.length > 0 && (
          <div className="end-unlocks">
            <div className="end-unlocks-title">称号を獲得</div>
            {unlocked.map((a) => (
              <div key={a.id} className="end-unlock">
                <span className="glyph"><Sigil name={a.icon} /></span>
                <span className="meta">
                  <span className="name">{a.name}</span>
                  <span className="desc">{a.desc}</span>
                </span>
              </div>
            ))}
          </div>
        )}

        {unlockedSkins.length > 0 && (
          <div className="end-unlocks">
            <div className="end-unlocks-title">装いを解放</div>
            {unlockedSkins.map((id) => (
              <div key={id} className="end-unlock">
                <span className="glyph"><Sigil name="star4" /></span>
                <span className="meta">
                  <span className="name">{SKINS_BY_ID[id]?.name ?? id}</span>
                  <span className="desc">{SKINS_BY_ID[id]?.desc ?? ""}</span>
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="btn-col">
          <button className="btn" onClick={onRetry} autoFocus>
            もう一夜
          </button>
          <button className="btn ghost" onClick={onAltar}>
            祭壇へ ── 魂を捧げる
          </button>
          <button className="btn ghost" onClick={onCodex}>
            記録の間
          </button>
          <button className="btn ghost" onClick={onTitle}>
            タイトルへ
          </button>
        </div>
      </div>
    </div>
  );
}
