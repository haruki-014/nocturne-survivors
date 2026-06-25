// 〔層〕付属的な機能 / AUXILIARY ── タスクバーヒーロー(ホームの自動戦闘の窓)
//   役割: 本編で操作しているキャラ自身(選択中の装い)が、ランで拾った装備で強化され、
//     ホーム画面の「タスクバー」状の帯で、ウェーブで押し寄せる敵と自動戦闘する様子を描く。
//     ボタン等の裏側に敷く背景レイヤー。
//   挙動: 戦闘の中身は meta/heroSim.ts(純ロジック)が持つ。ここはその状態を
//     ①requestAnimationFrame で 1 フレームずつ進め(stepSim)、②現在の状態を DOM へ
//     描き、③進行(撃破/XP/深度)を定期的に親(App)の onHeroSync へ渡して保存させる、
//     という「駆動＋描画」だけを担う(engine と UI の関係に倣った分離)。

import { useEffect, useRef, useState } from "react";
import type { Profile } from "../meta/profile";
import { heroView, levelFromXp, RARITY_COLORS, RARITY_NAMES } from "../meta/hero";
import { BOLT_TIME, HERO_X, VW, createSim, liveStats, stepSim, type HeroSim } from "../meta/heroSim";
import { enemyPortrait, skinPortrait } from "../game/render";

interface Props {
  profile: Profile;
  onHeroSync: (live: { kills: number; xp: number; depth: number }) => void;
}

const xpct = (x: number) => `${(x / VW) * 100}%`; // 仮想座標 x → 帯幅に対する %

export default function TaskbarHero({ profile, onHeroSync }: Props) {
  const heroImg = skinPortrait(profile.selectedSkin);

  // rAF が状態を進めるたびに再描画させるための“鼓動”
  const [, force] = useState(0);

  // 最新 profile を毎フレーム参照(装備の反映用)
  const profileRef = useRef(profile);
  profileRef.current = profile;

  // 戦闘状態。マウント時に一度だけ離席ぶんを精算して種にする(以後はここが正本)。
  const simRef = useRef<HeroSim | null>(null);
  if (simRef.current === null) simRef.current = createSim(profile, Date.now());
  const sim = simRef.current;

  // 進行の定期保存(6 秒ごと + アンマウント時)。保存は絶対値(syncHero 側で max 合成)。
  useEffect(() => {
    const save = () => onHeroSync({ ...simRef.current!.live });
    const id = window.setInterval(save, 6000);
    return () => { window.clearInterval(id); save(); };
  }, [onHeroSync]);

  // 駆動ループ: dt を上限クランプして stepSim を回し、毎フレーム再描画する。
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      stepSim(simRef.current!, profileRef.current, dt);
      force((n) => (n + 1) % 1e6);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ---- 描画用の導出値 ----
  const stats = liveStats(sim, profileRef.current);
  const level = levelFromXp(sim.live.xp);
  const hpFrac = Math.max(0, Math.min(1, sim.hp / Math.max(1, stats.maxHp)));
  const gear = heroView(profileRef.current).equipped;

  return (
    <div className="taskbar-hero" aria-hidden="true">
      <div className="tbh-ground" />
      <div className="tbh-stage">
        {/* 敵(縦列に整列。dying>0 は消滅アニメ中) */}
        {sim.foes.map((f) => (
          <span key={f.id} className="tbh-foe-wrap" style={{ left: xpct(f.x), opacity: f.dying > 0 ? Math.max(0, f.dying / 0.4) : 1 }}>
            {f.dying === 0 && (
              <span className="tbh-foehp"><i style={{ width: `${Math.max(0, (f.hp / f.maxHp) * 100)}%` }} /></span>
            )}
            <img className={`tbh-foe${f.hitFlash > 0 ? " hit" : ""}`} src={enemyPortrait(f.kind)} alt="" style={{ transform: `scale(${f.dying > 0 ? 0.7 + f.dying : 1})` }} />
          </span>
        ))}
        {/* 飛翔中の魔弾(ヒーロー→敵。寿命の進度で位置を補間) */}
        {sim.bolts.map((b) => {
          const bx = b.fromX + (b.toX - b.fromX) * (1 - b.life / BOLT_TIME);
          return <span key={b.id} className={`tbh-bolt${b.crit ? " crit" : ""}`} style={{ left: xpct(bx) }} />;
        })}
        {/* 魔弾の着弾(炸裂) */}
        {sim.strikes.map((s) => (
          <span key={s.id} className={`tbh-strike${s.crit ? " crit" : ""}`} style={{ left: xpct(s.x), opacity: Math.min(1, s.life / 0.28), transform: `translate(-50%,-50%) scale(${0.6 + (1 - s.life / 0.28) * 1.1})` }}>
            <svg viewBox="0 0 32 32" width="32" height="32" aria-hidden="true">
              <circle cx="16" cy="16" r="5" fill="currentColor" opacity="0.9" />
              <path d="M16 1 V9 M16 23 V31 M1 16 H9 M23 16 H31 M5 5 L10 10 M22 22 L27 27 M27 5 L22 10 M10 22 L5 27" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </span>
        ))}
        {/* ヒーロー(本編のキャラ・装い) */}
        <span className="tbh-hero-wrap" style={{ left: xpct(HERO_X), opacity: sim.heroAlpha }}>
          <span className="tbh-hp"><i style={{ width: `${hpFrac * 100}%` }} /></span>
          <img
            className={`tbh-hero${sim.heroFlash > 0.4 ? " hit" : ""}`}
            src={heroImg}
            alt=""
            style={{ transform: `translateX(${sim.lunge * 9}px)` }}
          />
          {/* 詠唱の閃光(魔法を放つ瞬間、掌に灯る) */}
          {sim.cast > 0.05 && (
            <span className="tbh-cast" style={{ opacity: sim.cast, transform: `scale(${0.7 + sim.cast * 0.7})` }} />
          )}
        </span>
        {/* ポップ(撃破/会心/被弾/立て直し/第N波) */}
        {sim.pops.map((p) => (
          <span key={p.id} className={`tbh-pop ${p.kind}`} style={{ left: xpct(p.x), bottom: `${24 + p.y}px`, opacity: Math.min(1, p.life) }}>
            {p.text}
          </span>
        ))}
      </div>

      {/* 左肩のステータス(レベル・深度・撃破数・装備) */}
      <div className="tbh-readout">
        <span className="tbh-lv">Lv.{level}</span>
        <span className="tbh-depth">深度 {sim.live.depth}</span>
        <span className="tbh-kills">撃破 {Math.floor(sim.live.kills).toLocaleString()}</span>
        <span className="tbh-gear">
          {gear.map((g) => (
            <i
              key={g.slot}
              title={g.item ? `${g.label}: ${g.item.name}` : `${g.label}: 未装備`}
              style={{ "--rar": g.item ? RARITY_COLORS[g.item.rarity] : "#3a3550" } as React.CSSProperties}
            >
              {g.item ? RARITY_NAMES[g.item.rarity][0] : "・"}
            </i>
          ))}
        </span>
      </div>
    </div>
  );
}
