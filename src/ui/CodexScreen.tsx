import { useState } from "react";
import type { EnemyKind, WeaponId } from "../game/types";
import { ENEMIES, WEAPONS, PASSIVES, EVOLUTIONS, SCHOOLS, BOSSES, CURIOS, TOTAL_CURIOS } from "../game/data";
import { enemyPortrait } from "../game/render";
import { Sigil } from "./icons";
import { RiteHeader } from "./ornaments";
import {
  ACHIEVEMENTS,
  TOTAL_EVOLUTIONS,
  type Profile,
} from "../meta/profile";

// 〔層〕付属的な機能 / AUXILIARY ── 記録の間(コレクション図鑑)
//   役割: プロファイルに溜まった蓄積(累計/最高記録・敵図鑑・武具と真化・称号)を
//     4タブで閲覧する読み取り専用画面。記録の消去だけ親(onReset)へ依頼する。
//   挙動: data の定義(ENEMIES/WEAPONS/PASSIVES…)を全件並べ、profile の
//     discovered* 集合に含まれるものだけ正体を出し、未発見は「？？？」で伏せる。
//     敵の絵は enemyPortrait() で実スプライトを使うため図鑑とゲームの姿が一致する。

type Tab = "records" | "bestiary" | "armory" | "relics" | "honors";

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "records", label: "記録", icon: "candle" },
  { id: "bestiary", label: "図鑑", icon: "bat" },
  { id: "armory", label: "武具", icon: "blades" },
  { id: "relics", label: "遺物", icon: "starburst" },
  { id: "honors", label: "称号", icon: "shield" },
];

function fmtTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
function fmtLong(t: number): string {
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  return h > 0 ? `${h}時間${m}分` : `${m}分`;
}

// 敵の一言(図鑑のフレーバー)
const ENEMY_LORE: Record<EnemyKind, string> = {
  bat: "血の匂いに群れる宵闇の眷属。数で圧す。",
  zombie: "緩慢だが執拗。腐臭を引きずって迫る。",
  skeleton: "硬い骨格。砕くには相応の一撃が要る。",
  wraith: "疾く宙を滑る怨念。距離を一瞬で詰める。",
  brute: "巨躯の壁。生半な火力では止まらない。",
  warlock: "間合いを取り呪弾を放つ術者。逃げに徹する者を罰する。",
  elite: "黄金を戴く強敵。倒せば宝を遺す。",
  boss: "夜の主たち。出現の度に異なる強者が玉座より降りてくる。",
};

function StatCard({ k, v }: { k: string; v: string }) {
  return (
    <div className="codex-stat">
      <span className="k">{k}</span>
      <span className="v">{v}</span>
    </div>
  );
}

function Records({ p, onReset }: { p: Profile; onReset: () => void }) {
  return (
    <div className="codex-records">
      <div className="codex-section-title">累 計</div>
      <div className="codex-stat-grid">
        <StatCard k="夜の数" v={`${p.runs}`} />
        <StatCard k="勝利" v={`${p.victories}`} />
        <StatCard k="総討伐" v={p.totalKills.toLocaleString()} />
        <StatCard k="総生存" v={fmtLong(p.totalTime)} />
        <StatCard k="総ダメージ" v={Math.round(p.totalDamage).toLocaleString()} />
        <StatCard k="ボス撃破" v={`${p.bossKills}`} />
      </div>
      <div className="codex-section-title">最 高 記 録</div>
      <div className="codex-stat-grid">
        <StatCard k="最長生存" v={fmtTime(p.best.time)} />
        <StatCard k="最多討伐" v={`${p.best.kills}`} />
        <StatCard k="最高Lv" v={`${p.best.level}`} />
        <StatCard k="最大ダメージ" v={p.best.damage.toLocaleString()} />
      </div>
      {p.lastRun && (
        <p className="codex-note">
          直近の夜：{p.lastRun.victory ? "夜明け" : "緋に沈む"} ／ {fmtTime(p.lastRun.time)} ／ {p.lastRun.kills} 討伐 ／ Lv.{p.lastRun.level}
        </p>
      )}
      <button
        className="codex-reset"
        onClick={() => {
          if (window.confirm("すべての記録・発見・称号を消去します。よろしいですか？")) onReset();
        }}
      >
        記録を消去する
      </button>
    </div>
  );
}

function Bestiary({ p }: { p: Profile }) {
  // ボスは専用セクションに分けるため、通常の眷属グリッドからは除く
  const kinds = (Object.keys(ENEMIES) as EnemyKind[]).filter((k) => k !== "boss");
  const seen = new Set(p.discoveredEnemies);
  const bseen = new Set(p.discoveredBosses ?? []);
  return (
    <>
      <div className="codex-section-title">眷 属</div>
      <div className="codex-grid">
        {kinds.map((k) => {
          const def = ENEMIES[k];
          const known = seen.has(k);
          return (
            <div key={k} className={`codex-cell${known ? "" : " locked"}`} style={{ "--accent": def.color } as React.CSSProperties}>
              <span className="codex-portrait-wrap">
                <img
                  className={`codex-portrait${known ? "" : " silhouette"}`}
                  src={enemyPortrait(k)}
                  alt=""
                  draggable={false}
                />
              </span>
              <span className="codex-cell-name">{known ? def.name : "？ ？ ？"}</span>
              {known ? (
                <>
                  <span className="codex-cell-desc">{ENEMY_LORE[k]}</span>
                  <span className="codex-cell-stat">HP {def.hp} ／ 接触 {def.damage}</span>
                </>
              ) : (
                <span className="codex-cell-desc">まだ見ぬ夜の住人</span>
              )}
            </div>
          );
        })}
      </div>

      <div className="codex-section-title">
        夜 の 主 <span className="codex-progress">{bseen.size} / {BOSSES.length}</span>
      </div>
      <div className="codex-grid">
        {BOSSES.map((b) => {
          const known = bseen.has(b.id);
          return (
            <div key={b.id} className={`codex-cell${known ? "" : " locked"}`} style={{ "--accent": b.color } as React.CSSProperties}>
              <span className="codex-portrait-wrap">
                <img
                  className={`codex-portrait${known ? "" : " silhouette"}`}
                  src={enemyPortrait("boss", "normal", b.id)}
                  alt=""
                  draggable={false}
                />
              </span>
              <span className="codex-cell-name">{known ? b.name : "？ ？ ？"}</span>
              {known ? (
                <>
                  <span className="codex-cell-desc">{b.title}</span>
                  <span className="codex-cell-stat">{b.trait}</span>
                </>
              ) : (
                <span className="codex-cell-desc">まだ見ぬ夜の主</span>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

function Armory({ p }: { p: Profile }) {
  const wseen = new Set(p.discoveredWeapons);
  const pseen = new Set(p.discoveredPassives);
  const eseen = new Set(p.discoveredEvolutions);
  const baseWeapons = Object.values(WEAPONS).filter((w) => !w.evolved);

  return (
    <div className="codex-armory">
      <div className="codex-section-title">武 具</div>
      <div className="codex-grid small">
        {baseWeapons.map((w) => {
          const known = wseen.has(w.id);
          return (
            <div key={w.id} className={`codex-cell${known ? "" : " locked"}`} style={{ "--accent": w.color } as React.CSSProperties}>
              <span className="codex-cell-glyph">{known ? <Sigil name={w.icon} /> : <Sigil name="lock" />}</span>
              <span className="codex-cell-name">{known ? w.name : "？ ？ ？"}</span>
              <span className="codex-cell-desc">{known ? w.desc : "未だ手にせず"}</span>
              <span className="codex-school-tag" style={{ "--accent": SCHOOLS[w.school].color } as React.CSSProperties}>
                <Sigil name={SCHOOLS[w.school].icon} className="tag-ico" /> {SCHOOLS[w.school].name}
              </span>
            </div>
          );
        })}
      </div>

      <div className="codex-section-title">
        真 化 <span className="codex-progress">{eseen.size} / {TOTAL_EVOLUTIONS}</span>
      </div>
      <div className="codex-evos">
        {(Object.keys(EVOLUTIONS) as WeaponId[]).flatMap((baseId) =>
          (EVOLUTIONS[baseId] ?? []).map((branch) => {
            const base = WEAPONS[baseId];
            const evo = WEAPONS[branch.evo];
            const req = PASSIVES[branch.req];
            const known = eseen.has(branch.evo);
            return (
              <div key={branch.evo} className={`codex-evo${known ? " unlocked" : ""}`} style={{ "--accent": evo.color } as React.CSSProperties}>
                <span className="evo-from">
                  <b><Sigil name={base.icon} /></b>
                  <span className="evo-plus">＋</span>
                  <b className="req"><Sigil name={req.icon} /></b>
                </span>
                <span className="evo-arrow">▶</span>
                <span className="evo-to">
                  <b>{known ? <Sigil name={evo.icon} /> : <Sigil name="star4" />}</b>
                  <span className="evo-name">{known ? evo.name : "？ ？ ？"}</span>
                  <span className="evo-recipe">{base.name} ＋ {req.name}</span>
                </span>
              </div>
            );
          }),
        )}
      </div>

      <div className="codex-section-title">加 護</div>
      <div className="codex-grid small">
        {Object.values(PASSIVES).map((pa) => {
          const known = pseen.has(pa.id);
          return (
            <div key={pa.id} className={`codex-cell${known ? "" : " locked"}`} style={{ "--accent": pa.color } as React.CSSProperties}>
              <span className="codex-cell-glyph">{known ? <Sigil name={pa.icon} /> : <Sigil name="lock" />}</span>
              <span className="codex-cell-name">{known ? pa.name : "？ ？ ？"}</span>
              <span className="codex-cell-desc">{known ? pa.desc : "未だ知らず"}</span>
              <span className="codex-school-tag" style={{ "--accent": SCHOOLS[pa.school].color } as React.CSSProperties}>
                <Sigil name={SCHOOLS[pa.school].icon} className="tag-ico" /> {SCHOOLS[pa.school].name}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Honors({ p }: { p: Profile }) {
  const got = new Set(p.achievements);
  return (
    <>
      <div className="codex-section-title">
        称 号 <span className="codex-progress">{got.size} / {ACHIEVEMENTS.length}</span>
      </div>
      <div className="codex-honors">
        {ACHIEVEMENTS.map((a) => {
          const known = got.has(a.id);
          return (
            <div key={a.id} className={`codex-honor${known ? " unlocked" : ""}`}>
              <span className="honor-glyph">
                <Sigil name={known ? a.icon : "lock"} />
              </span>
              <span className="honor-meta">
                <span className="honor-name">{known ? a.name : "？ ？ ？"}</span>
                <span className="honor-desc">{a.desc}</span>
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
}

// 遺物: 全件をグリッドで並べ、収集済みは効果文＋有効/無効トグル、未収集はシルエット。
function Relics({ p, onToggle }: { p: Profile; onToggle: (id: string) => void }) {
  const collected = new Set(p.collectedCurios);
  const disabled = new Set(p.disabledCurios);
  return (
    <>
      <div className="codex-section-title">
        遺 物 <span className="codex-count">{collected.size}/{TOTAL_CURIOS}</span>
      </div>
      <p className="relic-lead">夜に稀に落ちる遺物。集めると常時発動する恩恵となる。要らぬ効果は個別に切れる。</p>
      <div className="codex-grid">
        {CURIOS.map((c) => {
          const known = collected.has(c.id);
          const off = disabled.has(c.id);
          return (
            <div
              key={c.id}
              className={`codex-cell relic-cell${known ? "" : " locked"}${known && off ? " off" : ""}`}
              style={{ "--accent": c.color } as React.CSSProperties}
            >
              <span className={`relic-glyph${known ? "" : " silhouette"}`}>
                <Sigil name={known ? c.icon : "lock"} />
              </span>
              <span className="codex-cell-name">{known ? c.name : "？ ？ ？"}</span>
              <span className="relic-effect">{known ? c.effectText : "夜に落ちる遺物"}</span>
              {known && (
                <button
                  className={`relic-toggle${off ? "" : " on"}`}
                  onClick={() => onToggle(c.id)}
                  aria-pressed={!off}
                >
                  {off ? "無効" : "有効"}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

interface Props {
  profile: Profile;
  onBack: () => void;
  onReset: () => void;
  onToggleCurio: (id: string) => void;
}

export default function CodexScreen({ profile, onBack, onReset, onToggleCurio }: Props) {
  const [tab, setTab] = useState<Tab>("records");
  return (
    <div className="overlay dim">
      <div
        className="panel codex rite-panel"
        role="dialog"
        aria-label="記録の間"
        style={{ "--rite-tint": "#b078ff" } as React.CSSProperties}
      >
        <RiteHeader title="記 録 の 間" icon="tome" />
        <div className="codex-tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`codex-tab${tab === t.id ? " active" : ""}`}
              onClick={() => setTab(t.id)}
            >
              <Sigil name={t.icon} className="tab-ico" />
              {t.label}
            </button>
          ))}
        </div>
        {/* key=tab で切替時に中身を再マウントし、顕現(fade-up)をやり直す */}
        <div className="codex-body" key={tab}>
          {tab === "records" && <Records p={profile} onReset={onReset} />}
          {tab === "bestiary" && <Bestiary p={profile} />}
          {tab === "armory" && <Armory p={profile} />}
          {tab === "relics" && <Relics p={profile} onToggle={onToggleCurio} />}
          {tab === "honors" && <Honors p={profile} />}
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
