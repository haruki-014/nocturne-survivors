// 〔層〕付属的な機能 / AUXILIARY ── タイトル画面(ホーム)
//   役割: 起動時の入口。「夜に踏み出す(モード選択へ)」「祭壇」「記録の間」への
//     分岐ボタンと、戦績の要約・所持魂を見せる。背景は常設 canvas のエンジン描画。
//   挙動: 押下を親(App)のコールバック(onStart/onAltar/onCodex)へ流すだけ。
//     残り火や月の意匠は CSS/SVG の装飾で、ゲーム状態には触れない。

import { TOTAL_EVOLUTIONS, ACHIEVEMENTS, type Profile } from "../meta/profile";
import { Sigil } from "./icons";
import { EmberField, MoonMark } from "./ornaments";
import TaskbarHero from "./TaskbarHero";

interface Props {
  onStart: () => void;
  onCodex: () => void;
  onAltar: () => void;
  onTreasury: () => void;
  profile: Profile;
  onHeroSync: (live: { kills: number; xp: number; depth: number }) => void;
}

function fmtTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function TitleScreen({ onStart, onCodex, onAltar, onTreasury, profile, onHeroSync }: Props) {
  const played = profile.runs > 0;
  return (
    <div className="overlay dim title-overlay">
      <TaskbarHero profile={profile} onHeroSync={onHeroSync} />
      <EmberField count={16} />

      <div className="title-scene">
        <div className="title-brand">
          <h1 className="title-logo-en">
            <span className="glyph-lead">N</span>OCTURNE
          </h1>
          <div className="title-logo-jp">血 月 の 夜 想 曲</div>

          <div className="ornament" aria-hidden="true">
            <span className="rule" />
            <MoonMark />
            <span className="rule right" />
          </div>

          <p className="title-tagline">
            月が緋く染まる夜、骸の群れが目を覚ます。
            <br />
            灯を掲げ、夜明けまで ── 生き延びよ。
          </p>

          {played && (
            <div className="home-stats" aria-label="戦績の要約">
              <span>
                <Sigil name="candle" className="hs-icon" />
                <i>夜の数</i>
                {profile.runs}
              </span>
              <span>
                <Sigil name="moon" className="hs-icon" />
                <i>最長</i>
                {fmtTime(profile.best.time)}
              </span>
              <span>
                <Sigil name="star4" className="hs-icon" />
                <i>真化</i>
                {profile.discoveredEvolutions.length}/{TOTAL_EVOLUTIONS}
              </span>
              <span>
                <Sigil name="shield" className="hs-icon" />
                <i>称号</i>
                {profile.achievements.length}/{ACHIEVEMENTS.length}
              </span>
            </div>
          )}
        </div>

        <div className="btn-col">
          <button className="btn" onClick={onStart} autoFocus>
            夜に踏み出す
          </button>
          <button className="btn ghost" onClick={onAltar}>
            祭壇 ── 魂を捧げる
            {profile.souls > 0 && <span className="btn-tag">{profile.souls.toLocaleString()} 魂</span>}
          </button>
          <button className="btn ghost" onClick={onTreasury}>
            宝物庫 ── 装備
          </button>
          <button className="btn ghost" onClick={onCodex}>
            記録の間
          </button>
        </div>

        <div className="controls-hint">
            <span>
              <kbd>WASD</kbd> / <kbd>←↑↓→</kbd> 移動
            </span>
            <span>
              <kbd>A</kbd><kbd>D</kbd> <kbd>Enter</kbd> アルカナ選択
            </span>
            <span>
              <kbd>Space</kbd> 回避
            </span>
            <span>
              <kbd>E</kbd> 奥義
            </span>
            <span>
              <kbd>Esc</kbd> 休息
            </span>
            <span>
              <kbd>F</kbd> 全画面
            </span>
        </div>
      </div>
    </div>
  );
}
