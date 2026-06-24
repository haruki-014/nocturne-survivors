// 〔層〕付属的な機能 / AUXILIARY ── タスクバーヒーロー(ホームの自動戦闘の窓)
//   役割: 本編で操作しているキャラ自身(選択中の装い)が、ランで拾った装備で強化され、
//     ホーム画面の「タスクバー」状の帯で、ウェーブで押し寄せる敵と自動戦闘する様子を描く。
//     ボタン等の裏側に敷く背景レイヤー。
//   挙動: ウェーブ制(敵は塊で湧き、間に小休止)。敵も攻撃してくるので、装備が弱いと
//     押し負けて HP が尽き、フェードアウトして深度を下げて立て直す(戦闘リセット)。
//     進行(撃破/XP/深度)はここが正本。離席ぶんは offlineProgress で精算し、到達値を
//     親(App)の onHeroSync で絶対値保存する。

import { useEffect, useRef, useState } from "react";
import type { EnemyKind } from "../game/types";
import type { Profile } from "../meta/profile";
import {
  ENEMY_MELEE_CD,
  enemyAtkAt,
  enemyHpAt,
  heroStats,
  heroView,
  levelFromXp,
  offlineProgress,
  RARITY_COLORS,
  RARITY_NAMES,
  waveCount,
  xpPerKillAt,
} from "../meta/hero";
import { enemyPortrait, skinPortrait } from "../game/render";

interface Props {
  profile: Profile;
  onHeroSync: (live: { kills: number; xp: number; depth: number }) => void;
}

const VW = 560; // 仮想座標幅(CSS 側で 100% に伸縮)
const HERO_X = 92; // ヒーローの定位置(仮想座標)
const MELEE_X = HERO_X + 30; // 敵がここまで来たら接敵

// ---- ウェーブのテンポ(ゆったりした波で、湧きが速すぎないように) ----
const REST_SEC = 3.4; // ウェーブ間の小休止(明確な波の切れ目・回復の間)
const WAVE_GAP = 1.0; // ウェーブ内の1体ずつの湧き間隔
const MAX_ON_SCREEN = 3; // 同時に画面へ出す敵数の上限

// 深度が上がるほど手強い種が混じる
const FOES: EnemyKind[] = ["bat", "zombie", "skeleton", "wraith", "warlock", "brute"];

type Phase = "rest" | "spawning" | "fighting" | "defeat";
interface Foe { id: number; kind: EnemyKind; x: number; hp: number; maxHp: number; atkCd: number; dying: number; hitFlash: number; }
interface Pop { id: number; x: number; y: number; text: string; life: number; kind: "kill" | "crit" | "reset" | "hurt" | "wave"; }
interface Strike { id: number; x: number; life: number; crit: boolean; } // ヒーローの斬撃の着弾エフェクト

export default function TaskbarHero({ profile, onHeroSync }: Props) {
  const heroImg = skinPortrait(profile.selectedSkin);

  const [, force] = useState(0);

  // 最新 profile を毎フレーム参照(装備の反映用)
  const profileRef = useRef(profile);
  profileRef.current = profile;

  // ライブ進行(正本)。マウント時に離席ぶんを精算して種にする。
  const liveRef = useRef<{ kills: number; xp: number; depth: number }>({ kills: 0, xp: 0, depth: 1 });
  const phaseRef = useRef<Phase>("rest");
  const hpRef = useRef(1);
  const foesRef = useRef<Foe[]>([]);
  const popsRef = useRef<Pop[]>([]);
  const strikesRef = useRef<Strike[]>([]);
  const swingRef = useRef(0); // 武器を振るモーション(1→0 に減衰)
  const queueRef = useRef(0); // このウェーブで残り湧かせる数
  const spawnTimerRef = useRef(0);
  const restTimerRef = useRef(1.0);
  const defeatTimerRef = useRef(0);
  const heroAtkCdRef = useRef(0);
  const lungeRef = useRef(0);
  const heroFlashRef = useRef(0);
  const heroAlphaRef = useRef(1);
  const idRef = useRef(1);
  const seededRef = useRef(false);

  // 生きた xp を反映した一時 profile から戦闘ステータスを得る
  const liveStats = () => {
    const p = profileRef.current;
    return heroStats({ ...p, hero: { ...p.hero, xp: liveRef.current.xp, depth: liveRef.current.depth } });
  };

  // マウント時に離席ぶんを精算して種にする
  if (!seededRef.current) {
    const seed = offlineProgress(profile, Date.now());
    liveRef.current = { kills: seed.kills, xp: seed.xp, depth: seed.depth };
    hpRef.current = heroStats({ ...profile, hero: { ...profile.hero, xp: seed.xp } }).maxHp;
    seededRef.current = true;
  }

  // 定期保存(6 秒ごと + アンマウント時)
  useEffect(() => {
    const sync = () => onHeroSync({ ...liveRef.current });
    const id = window.setInterval(sync, 6000);
    return () => { window.clearInterval(id); sync(); };
  }, [onHeroSync]);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const enemyPool = (depth: number) => FOES.slice(0, Math.min(FOES.length, 1 + Math.ceil(depth / 3)));

    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const live = liveRef.current;
      const stats = liveStats();
      const maxHp = stats.maxHp;
      if (hpRef.current > maxHp) hpRef.current = maxHp; // 装備変更でHP上限が縮んだ時の調整
      const foes = foesRef.current;
      const pops = popsRef.current;
      lungeRef.current = Math.max(0, lungeRef.current - dt * 4);
      swingRef.current = Math.max(0, swingRef.current - dt * 7); // 斬撃モーションの減衰(速い)
      heroFlashRef.current = Math.max(0, heroFlashRef.current - dt * 5);

      if (phaseRef.current === "rest") {
        hpRef.current = Math.min(maxHp, hpRef.current + maxHp * 0.6 * dt); // 小休止で回復
        restTimerRef.current -= dt;
        if (restTimerRef.current <= 0) {
          phaseRef.current = "spawning";
          queueRef.current = waveCount(live.depth);
          spawnTimerRef.current = 0.4; // 波の頭に小さな“間”
          foesRef.current.length = 0;
          pops.push({ id: idRef.current++, x: VW * 0.5, y: 16, text: `第 ${live.depth} 波`, life: 1.6, kind: "wave" });
        }
      } else if (phaseRef.current === "defeat") {
        heroAlphaRef.current = Math.max(0, heroAlphaRef.current - dt / 0.6);
        defeatTimerRef.current -= dt;
        if (defeatTimerRef.current <= 0) {
          live.depth = Math.max(1, live.depth - 3); // 立て直し: 深度を下げる
          hpRef.current = maxHp;
          heroAlphaRef.current = 1;
          foesRef.current.length = 0;
          phaseRef.current = "rest";
          restTimerRef.current = 1.0;
        }
      } else {
        // spawning / fighting
        spawnTimerRef.current -= dt;
        const aliveOnScreen = foes.filter((f) => f.dying === 0).length;
        if (queueRef.current > 0 && spawnTimerRef.current <= 0 && aliveOnScreen < MAX_ON_SCREEN) {
          const pool = enemyPool(live.depth);
          const kind = pool[Math.floor(Math.random() * pool.length)];
          const hp = enemyHpAt(live.depth);
          foes.push({ id: idRef.current++, kind, x: VW + 24 + Math.random() * 40, hp, maxHp: hp, atkCd: 0.4 + Math.random() * 0.5, dying: 0, hitFlash: 0 });
          queueRef.current--;
          spawnTimerRef.current = WAVE_GAP; // ウェーブ内の湧き間隔(ゆったり)
        }

        // 敵の前進・接敵・攻撃(落ち着いた歩み)
        const enemySpd = Math.min(118, 56 + live.depth * 2);
        for (const f of foes) {
          if (f.dying > 0) { f.dying -= dt; continue; }
          f.hitFlash = Math.max(0, f.hitFlash - dt);
          if (f.x > MELEE_X) {
            f.x -= enemySpd * dt;
          } else {
            f.x = MELEE_X;
            f.atkCd -= dt;
            if (f.atkCd <= 0) {
              f.atkCd = ENEMY_MELEE_CD;
              hpRef.current -= enemyAtkAt(live.depth);
              heroFlashRef.current = 1;
              pops.push({ id: idRef.current++, x: HERO_X, y: 4 + Math.random() * 4, text: `-${Math.round(enemyAtkAt(live.depth))}`, life: 0.7, kind: "hurt" });
            }
          }
        }

        // ヒーローの攻撃(最前の敵へ)
        heroAtkCdRef.current -= dt;
        const alive = foes.filter((f) => f.dying === 0).sort((a, b) => a.x - b.x);
        if (heroAtkCdRef.current <= 0 && alive.length > 0) {
          heroAtkCdRef.current = 1 / stats.atkSpeed;
          lungeRef.current = 1;
          swingRef.current = 1; // 武器を振るモーション
          const crit = Math.random() < 0.16;
          const dmg = stats.atk * (crit ? 1.8 : 1);
          const target = alive[0];
          target.hp -= dmg;
          target.hitFlash = 0.16; // 斬られた敵が白く光る
          target.x = Math.min(VW, target.x + (crit ? 9 : 5)); // のけぞり(ノックバック)
          strikesRef.current.push({ id: idRef.current++, x: target.x, life: 0.26, crit }); // 着弾の斬閃
          if (target.hp <= 0) {
            target.dying = 0.32;
            live.kills += 1;
            live.xp += xpPerKillAt(live.depth);
            pops.push({ id: idRef.current++, x: target.x, y: 8 + Math.random() * 6, text: crit ? "会心!" : "撃破", life: 0.8, kind: crit ? "crit" : "kill" });
          }
        }

        // 微回復
        hpRef.current = Math.min(maxHp, hpRef.current + maxHp * 0.03 * dt);

        // 後始末(撃破して完全に消えた敵を除く。生存=dying0、消滅中=dying>0、消滅=dying<0)
        foesRef.current = foes.filter((f) => f.dying >= 0);

        // 敗北判定 → フェードアウトして立て直し
        if (hpRef.current <= 0) {
          phaseRef.current = "defeat";
          defeatTimerRef.current = 0.95;
          pops.push({ id: idRef.current++, x: HERO_X, y: 18, text: "態勢を立て直す", life: 1.4, kind: "reset" });
        } else if (queueRef.current === 0 && foesRef.current.filter((f) => f.dying === 0).length === 0) {
          // ウェーブ撃破 → 小休止して次の深度へ
          live.depth += 1;
          foesRef.current.length = 0;
          phaseRef.current = "rest";
          restTimerRef.current = REST_SEC;
        }
      }

      // ポップ・斬閃の寿命
      for (const p of pops) { p.life -= dt; p.y += dt * 16; }
      popsRef.current = pops.filter((p) => p.life > 0);
      for (const s of strikesRef.current) s.life -= dt;
      strikesRef.current = strikesRef.current.filter((s) => s.life > 0);

      force((n) => (n + 1) % 1e6);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ---- 表示 ----
  const live = liveRef.current;
  const stats = liveStats();
  const level = levelFromXp(live.xp);
  const hpFrac = Math.max(0, Math.min(1, hpRef.current / Math.max(1, stats.maxHp)));
  const gear = heroView(profileRef.current).equipped;
  const foes = foesRef.current;
  const pops = popsRef.current;
  const strikes = strikesRef.current;
  const swing = swingRef.current;

  return (
    <div className="taskbar-hero" aria-hidden="true">
      <div className="tbh-ground" />
      <div className="tbh-stage">
        {/* 敵 */}
        {foes.map((f) => (
          <span key={f.id} className="tbh-foe-wrap" style={{ left: `${(f.x / VW) * 100}%`, opacity: f.dying > 0 ? Math.max(0, f.dying / 0.4) : 1 }}>
            {f.dying === 0 && (
              <span className="tbh-foehp"><i style={{ width: `${Math.max(0, (f.hp / f.maxHp) * 100)}%` }} /></span>
            )}
            <img className={`tbh-foe${f.hitFlash > 0 ? " hit" : ""}`} src={enemyPortrait(f.kind)} alt="" style={{ transform: `scale(${f.dying > 0 ? 0.7 + f.dying : 1})` }} />
          </span>
        ))}
        {/* 斬撃の着弾(斬閃) */}
        {strikes.map((s) => (
          <span key={s.id} className={`tbh-strike${s.crit ? " crit" : ""}`} style={{ left: `${(s.x / VW) * 100}%`, opacity: Math.min(1, s.life / 0.26), transform: `translate(-50%,-50%) scale(${0.7 + (1 - s.life / 0.26) * 0.9})` }}>
            <svg viewBox="0 0 30 30" width="30" height="30" aria-hidden="true">
              <path d="M4 9 L25 21 M24 8 L7 22" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" fill="none" />
              <circle cx="15" cy="15" r="2" fill="currentColor" />
            </svg>
          </span>
        ))}
        {/* ヒーロー(本編のキャラ・装い) */}
        <span className="tbh-hero-wrap" style={{ left: `${(HERO_X / VW) * 100}%`, opacity: heroAlphaRef.current }}>
          <span className="tbh-hp"><i style={{ width: `${hpFrac * 100}%` }} /></span>
          <img
            className={`tbh-hero${heroFlashRef.current > 0.4 ? " hit" : ""}`}
            src={heroImg}
            alt=""
            style={{ transform: `translateX(${lungeRef.current * 9}px)` }}
          />
          {/* 武器を振る斬撃モーション(前方へ薙ぐ弧) */}
          {swing > 0.05 && (
            <span className="tbh-swing" style={{ opacity: swing, transform: `rotate(${-40 + (1 - swing) * 70}deg) scale(${0.8 + swing * 0.4})` }}>
              <svg viewBox="0 0 44 44" width="44" height="44" aria-hidden="true">
                <path d="M6 34 Q34 30 38 7" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" fill="none" />
              </svg>
            </span>
          )}
        </span>
        {/* ポップ */}
        {pops.map((p) => (
          <span key={p.id} className={`tbh-pop ${p.kind}`} style={{ left: `${(p.x / VW) * 100}%`, bottom: `${24 + p.y}px`, opacity: Math.min(1, p.life) }}>
            {p.text}
          </span>
        ))}
      </div>

      {/* 左肩のステータス */}
      <div className="tbh-readout">
        <span className="tbh-lv">Lv.{level}</span>
        <span className="tbh-depth">深度 {live.depth}</span>
        <span className="tbh-kills">撃破 {Math.floor(live.kills).toLocaleString()}</span>
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
