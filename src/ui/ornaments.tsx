// 〔層〕付属的な機能 / AUXILIARY ── 儀式の意匠(画面共通の装飾部品)
//   役割: タイトル画面で培った演出語彙(漂う残り火・月の意匠・飾り罫)を、
//     モード選択/祭壇/宝物庫/記録の間/レベルアップの各画面へ配る共有部品。
//   挙動: いずれも純粋な装飾で、ゲーム状態には触れない(全て aria-hidden)。
//     色や粒数は props で画面ごとに変えるが、粒の散らばりは決定的ハッシュで
//     生成するため、同じ引数なら毎回同じ配置になる(規則性は感じさせない)。

import type { ReactNode } from "react";
import { Sigil } from "./icons";

/** アルカナ風の月の意匠(飾り罫の中央に置く小さなSVG)。 */
export function MoonMark() {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
      <circle cx="13" cy="13" r="7.5" fill="none" stroke="currentColor" strokeWidth="1" />
      <path d="M16 7.5 a7.5 7.5 0 1 0 0 11 a5.6 5.6 0 1 1 0 -11 Z" fill="currentColor" opacity="0.9" />
      <circle cx="13" cy="1.5" r="1.1" fill="currentColor" />
      <circle cx="13" cy="24.5" r="1.1" fill="currentColor" />
    </svg>
  );
}

interface EmberProps {
  /** 粒の数。画面の情報密度に応じて 8〜16 程度。 */
  count?: number;
  /** 粒の色(既定はタイトルと同じ火の粉色)。 */
  tint?: string;
  /** 散らばりの種。0 はタイトルと同一配置(回帰互換)。 */
  seed?: number;
}

/** 漂う残り火(環境演出)。決定的にばらけた値で、規則性を感じさせない漂い方にする。 */
export function EmberField({ count = 12, tint, seed = 0 }: EmberProps) {
  const embers = Array.from({ length: count }, (_, i) => {
    const r = (n: number) => {
      const x = Math.sin((i + 1) * (n * 12.9898) + seed * 78.233) * 43758.5453;
      return x - Math.floor(x);
    };
    return {
      left: `${r(1) * 100}%`,
      size: `${2 + r(2) * 3}px`,
      dur: `${7 + r(3) * 7}s`,
      delay: `${r(4) * 9}s`,
      drift: `${(r(5) - 0.5) * 80}px`,
      alpha: 0.4 + r(6) * 0.45,
    };
  });
  return (
    <div className="embers" aria-hidden="true">
      {embers.map((e, i) => (
        <span
          key={i}
          className="ember"
          style={
            {
              left: e.left,
              "--ember-size": e.size,
              "--ember-dur": e.dur,
              "--ember-delay": e.delay,
              "--ember-drift": e.drift,
              "--ember-a": e.alpha,
              ...(tint ? { "--ember-color": tint } : null),
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}

interface RiteHeaderProps {
  /** 全角空白で分かち書きした見出し(例: "祭 壇")。 */
  title: string;
  /** 飾り罫の中央に置くシジル名。省略時は月の意匠。 */
  icon?: string;
  /** 見出しの下に添える一言。 */
  sub?: string;
  /** 見出し群の下に置く付帯スロット(魂バッジ・ステータス帯など)。 */
  aside?: ReactNode;
}

/** 儀式の見出し: 題字 + 飾り罫(月 or シジル) + 一言 + 付帯スロット。 */
export function RiteHeader({ title, icon, sub, aside }: RiteHeaderProps) {
  return (
    <header className="rite-head">
      <h2 className="rite-title">{title}</h2>
      <div className="ornament rite-ornament" aria-hidden="true">
        <span className="rule" />
        {icon ? (
          <span className="rite-head-sigil"><Sigil name={icon} /></span>
        ) : (
          <MoonMark />
        )}
        <span className="rule right" />
      </div>
      {sub && <p className="rite-sub">{sub}</p>}
      {aside && <div className="rite-aside">{aside}</div>}
    </header>
  );
}

/** パネル四隅のフィリグリー(L字の細枠)。置き先は position:relative であること。 */
export function Corners() {
  return (
    <>
      <span className="rite-corner tl" aria-hidden="true" />
      <span className="rite-corner tr" aria-hidden="true" />
      <span className="rite-corner bl" aria-hidden="true" />
      <span className="rite-corner br" aria-hidden="true" />
    </>
  );
}
