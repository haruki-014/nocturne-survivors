// 〔層〕付属的な機能 / AUXILIARY ── レベルアップのカード選択(アルカナ)
//   役割: エンジンが "levelup" で渡した候補(choices)を3枚のカードで提示し、
//     選ばれた1枚を onPick で返すだけ。提示内容を作るのはエンジン側(makeChoices)。
//   挙動(ミクロ):
//     ・キーボード: A/D(←→)でカーソル移動、Enter/Space で決定、1〜3 で即決。
//       cursor state が選択位置、対応ボタンへ実フォーカスも移してマウスと整合。
//     ・開幕の間(OPEN_LOCK_MS): カード出現直後の僅かな間は「決定」入力を無視する。
//       回避(スペース)の押下が画面遷移直後に誤確定してスキップされるのを防ぐ。
//       さらに決定は押し始めの一回のみ受理(押しっぱなしの自動連射は無効)。
//     ・二重適用防止: pickedRef で「決定は1回だけ」を保証(連打/同時押し対策)。
//     ・見た目: 真化は金(is-evolution)、専用技は紫(is-signature)の格を与える。

import { useEffect, useRef, useState } from "react";
import type { HudState, UpgradeChoice } from "../game/types";
import { WEAPONS, PASSIVES, SCHOOLS } from "../game/data";
import { Sigil } from "./icons";
import SkillTree from "./SkillTree";

// 選択画面が出てから決定入力を受け付けるまでの間(ミリ秒)。誤確定の防止と「間」の演出。
const OPEN_LOCK_MS = 420;

const TAGS: Record<UpgradeChoice["kind"], string> = {
  weapon: "武 具",
  passive: "加 護",
  heal: "聖 餐",
};

const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

function maxLevelOf(c: UpgradeChoice): number {
  if (c.kind === "weapon" && c.id) return WEAPONS[c.id]?.maxLevel ?? 99;
  if (c.kind === "passive" && c.id) return PASSIVES[c.id]?.maxLevel ?? 99;
  return 99;
}

interface Props {
  choices: UpgradeChoice[];
  onPick: (c: UpgradeChoice) => void;
  hud: HudState | null; // 現在のビルド(系統樹に反映)
  skinId: string; // 現在の装い(固有技=秘伝の表示用)
}

export default function LevelUpModal({ choices, onPick, hud, skinId }: Props) {
  // キー操作中の連打で同じ選択肢セットに二重適用しないようガード
  const pickedRef = useRef(false);
  // A/D で動かすカーソル位置。選択肢が入れ替わったら先頭へ戻す。
  const [cursor, setCursor] = useState(0);
  const cursorRef = useRef(0);
  cursorRef.current = cursor;
  // 系統樹オーバーレイの開閉(Tab/系統樹ボタン)。開いている間は閲覧専用。
  const [showTree, setShowTree] = useState(false);
  const showTreeRef = useRef(false);
  showTreeRef.current = showTree;
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);
  // この時刻まで「決定」入力を無視する(開幕の間)。choices が変わる度に張り直す。
  const lockUntilRef = useRef(0);

  useEffect(() => {
    pickedRef.current = false;
    setCursor(0);
    lockUntilRef.current = performance.now() + OPEN_LOCK_MS;
  }, [choices]);

  const pick = (c: UpgradeChoice) => {
    if (pickedRef.current) return;
    pickedRef.current = true;
    onPick(c);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (pickedRef.current) return;
      const n = choices.length;
      if (n === 0) return;

      // Tab / T で系統樹を開閉(焦点移動を抑止)。
      if (e.code === "Tab" || e.code === "KeyT") {
        e.preventDefault();
        setShowTree((v) => !v);
        return;
      }
      // 系統樹を開いている間は閲覧専用: Esc で閉じ、他の選択入力は無視する。
      if (showTreeRef.current) {
        if (e.code === "Escape") { e.preventDefault(); setShowTree(false); }
        return;
      }

      // カーソル移動(A/D・←→)は開幕の間でも常時受け付ける
      if (e.code === "KeyA" || e.code === "ArrowLeft") {
        e.preventDefault();
        setCursor((i) => (i - 1 + n) % n);
        return;
      }
      if (e.code === "KeyD" || e.code === "ArrowRight") {
        e.preventDefault();
        setCursor((i) => (i + 1) % n);
        return;
      }

      // 開幕の僅かな間は「決定」を無視(回避のスペース等での誤確定・スキップを防ぐ)
      if (performance.now() < lockUntilRef.current) return;

      // 直接ホットキー(1〜3)
      const digit = ["Digit1", "Digit2", "Digit3", "Numpad1", "Numpad2", "Numpad3"].indexOf(e.code);
      if (digit >= 0) {
        const c = choices[digit % 3];
        if (c) { e.preventDefault(); pick(c); }
        return;
      }

      // Enter/Space で決定(押し始めの一回のみ。押しっぱなしの自動連射は無効)
      if ((e.code === "Enter" || e.code === "NumpadEnter" || e.code === "Space") && !e.repeat) {
        e.preventDefault();
        const c = choices[cursorRef.current];
        if (c) pick(c);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // pick/onPick は安定参照ではないが、choices に依存して張り替われば十分
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choices, onPick]);

  // カーソル位置のカードへフォーカスを移す(キーボードとマウスの整合)
  useEffect(() => {
    btnRefs.current[cursor]?.focus();
  }, [cursor, choices]);

  return (
    <div className="overlay dim">
      <div className="levelup" role="dialog" aria-label="アルカナを選ぶ">
        <div className="levelup-title">月 詠 の 刻</div>
        <div className="levelup-sub">── 一枚のアルカナを引け ──</div>
        {/* choicesが入れ替わったらカードを再マウントしてドローアニメをやり直す */}
        <div className="cards" key={choices.map((c) => c.key).join("|")}>
          {choices.map((c, i) => {
            const isEvo = c.evolution === true;
            const isSig = c.signature === true;
            const isMastery = !isEvo && c.kind !== "heal" && c.level >= maxLevelOf(c);
            const rank = isEvo || isSig ? "✶" : c.kind === "heal" ? "✦" : ROMAN[c.level] ?? String(c.level);
            const cls = [
              "card",
              c.isNew ? "is-new" : "",
              isMastery ? "is-mastery" : "",
              isEvo ? "is-evolution" : "",
              isSig ? "is-signature" : "",
              i === cursor ? "is-selected" : "",
            ].filter(Boolean).join(" ");
            return (
              <button
                key={c.key}
                ref={(el) => { btnRefs.current[i] = el; }}
                className={cls}
                style={{ "--accent": c.color } as React.CSSProperties}
                onClick={() => pick(c)}
                onMouseEnter={() => setCursor(i)}
                aria-label={isEvo ? `真化 ${c.fromName} を ${c.name} へ` : `${c.name} ${c.kind === "heal" ? "" : `レベル${c.level}`}`}
              >
                <span className="card-frame" />
                <span className="card-corner tl" />
                <span className="card-corner tr" />
                <span className="card-corner bl" />
                <span className="card-corner br" />
                <span className="card-rank">{rank}</span>
                <span className="card-tag">
                  {isEvo
                    ? "真 化 · EVOLUTION"
                    : isSig
                      ? "秘 伝 · SIGNATURE"
                      : `${c.isNew ? "新たなる · " : ""}${TAGS[c.kind]}`}
                </span>
                {(c.school || c.archetype) && (
                  <span className="card-chips">
                    {c.school && (
                      <span
                        className="card-school"
                        style={{ "--sc": SCHOOLS[c.school].color } as React.CSSProperties}
                      >
                        <Sigil name={SCHOOLS[c.school].icon} className="chip-ico" /> {SCHOOLS[c.school].name}
                      </span>
                    )}
                    {c.archetype && <span className="card-arche">{c.archetype}</span>}
                  </span>
                )}
                <span className="card-icon"><Sigil name={c.icon} /></span>
                <span className="card-name">{c.name}</span>
                <span className="card-level">
                  {isEvo ? (
                    <span className="card-lineage">
                      {c.fromName} <span className="arrow">▶</span> {c.name}
                    </span>
                  ) : c.kind === "heal" ? (
                    "心の臓を満たす"
                  ) : isMastery ? (
                    "極 ── Lv.MAX"
                  ) : c.isNew ? (
                    "Lv.1 習得"
                  ) : (
                    `Lv.${c.level - 1} → Lv.${c.level}`
                  )}
                </span>
                {c.levelMax && c.kind !== "heal" && !isEvo && (
                  <span className="card-pips" aria-hidden="true">
                    {Array.from({ length: c.levelMax }, (_, k) => (
                      <i key={k} className={k < c.level ? "on" : ""} />
                    ))}
                  </span>
                )}
                {c.stats && c.stats.length > 0 && (
                  <span className="card-stats">
                    {c.stats.map((s, k) => (
                      <span key={k} className={`stat-badge${s.up ? " up" : ""}`}>
                        <i>{s.label}</i>
                        {s.value}
                      </span>
                    ))}
                  </span>
                )}
                <span className="card-desc">{c.desc}</span>
                <span className="card-hotkey">[{i + 1}]</span>
              </button>
            );
          })}
        </div>
        <button className="btn ghost levelup-tree-toggle" onClick={() => setShowTree(true)}>
          <Sigil name="star4" className="tree-toggle-ico" /> 系統樹を視る <kbd>Tab</kbd>
        </button>
        <div className="levelup-hint" aria-hidden="true">
          <kbd>A</kbd><kbd>D</kbd> 選ぶ　<kbd>Enter</kbd>/<kbd>Space</kbd> 決定　<kbd>1</kbd>–<kbd>3</kbd> 直接選択　<kbd>Tab</kbd> 系統樹
        </div>
      </div>

      {showTree && (
        <SkillTree
          weapons={hud?.weapons ?? []}
          passives={hud?.passives ?? []}
          skinId={skinId}
          onClose={() => setShowTree(false)}
        />
      )}
    </div>
  );
}
