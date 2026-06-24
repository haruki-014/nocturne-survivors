// 〔層〕付属的な機能 / AUXILIARY ── モード選択画面
//   役割: 3つの遊び方(標準/長征/無限)を提示し、選んだ GameMode を
//     onPick で親へ返す。各カードにモード別ベスト記録(profile.modeBest)を添える。
//   挙動: data の MODES(定義)と profile(記録)を読んで並べるだけの選択メニュー。

import type { GameMode } from "../game/types";
import { MODES } from "../game/data";
import type { Profile } from "../meta/profile";

const ORDER: GameMode[] = ["standard", "long", "endless"];

const ACCENT: Record<GameMode, string> = {
  standard: "#d9a441",
  long: "#7be0c4",
  endless: "#b078ff",
};

function fmtTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

interface Props {
  profile: Profile;
  onPick: (mode: GameMode) => void;
  onBack: () => void;
}

export default function ModeSelect({ profile, onPick, onBack }: Props) {
  return (
    <div className="overlay dim">
      <div className="panel modeselect" role="dialog" aria-label="モード選択">
        <h2 className="ms-title">夜 を 選 べ</h2>
        <div className="ms-grid">
          {ORDER.map((id) => {
            const m = MODES[id];
            const best = profile.modeBest[id];
            return (
              <button
                key={id}
                className="ms-card"
                style={{ "--accent": ACCENT[id] } as React.CSSProperties}
                onClick={() => onPick(id)}
              >
                <span className="ms-card-head">
                  <span className="ms-name">{m.name}</span>
                  <span className="ms-tag">{m.tag}</span>
                </span>
                <span className="ms-desc">{m.desc}</span>
                <span className="ms-best">
                  {best ? (
                    <>
                      <span>
                        <i>最長</i>
                        {fmtTime(best.time)}
                      </span>
                      <span>
                        <i>最多討伐</i>
                        {best.kills}
                      </span>
                      {best.cleared && <span className="ms-clear">踏破済</span>}
                    </>
                  ) : (
                    <span className="ms-none">記録なし ── 未踏の夜</span>
                  )}
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
