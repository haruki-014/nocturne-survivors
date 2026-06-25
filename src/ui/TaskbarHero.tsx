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
const FRONT_X = HERO_X + 46; // 先頭の敵が止まる位置(交戦距離)
const FOE_SPACING = 38; // 後続の敵はこの間隔で縦列に並ぶ(重なり防止)
const BOLT_TIME = 0.14; // 魔弾がヒーローから敵へ届くまでの時間

// ---- ウェーブのテンポ(ゆったりした波で、湧きが速すぎないように) ----
const REST_SEC = 3.4; // ウェーブ間の小休止(明確な波の切れ目・回復の間)
const WAVE_GAP = 1.0; // ウェーブ内の1体ずつの湧き間隔
const MAX_ON_SCREEN = 3; // 同時に画面へ出す敵数の上限

// 攻撃は本編の主人公に倣い「魔法(魔弾)」。色は魔弾の書の紫。
const MAGIC = "#b9a0ff";

// 深度が上がるほど手強い種が混じる
const FOES: EnemyKind[] = ["bat", "zombie", "skeleton", "wraith", "warlock", "brute"];

type Phase = "rest" | "spawning" | "fighting" | "defeat";
interface Foe { id: number; kind: EnemyKind; x: number; hp: number; maxHp: number; atkCd: number; dying: number; hitFlash: number; }
interface Pop { id: number; x: number; y: number; text: string; life: number; kind: "kill" | "crit" | "reset" | "hurt" | "wave"; }
interface Strike { id: number; x: number; life: number; crit: boolean; } // 魔弾の着弾(炸裂)エフェクト
interface Bolt { id: number; fromX: number; toX: number; life: number; crit: boolean; } // ヒーローが放つ魔弾

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
  const boltsRef = useRef<Bolt[]>([]); // 飛翔中の魔弾
  const castRef = useRef(0); // 詠唱の閃光(1→0 に減衰)
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
      castRef.current = Math.max(0, castRef.current - dt * 6); // 詠唱閃光の減衰
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

        // 敵の前進(縦列に整列して重ならない)・先頭だけが交戦して攻撃する
        const enemySpd = Math.min(118, 56 + live.depth * 2);
        const queue = foes.filter((f) => f.dying === 0).sort((a, b) => a.x - b.x); // 先頭=自機に近い
        for (let i = 0; i < queue.length; i++) {
          const f = queue[i];
          f.hitFlash = Math.max(0, f.hitFlash - dt);
          const stopX = FRONT_X + i * FOE_SPACING; // 並ぶ位置(重なり防止)
          if (f.x > stopX) {
            f.x = Math.max(stopX, f.x - enemySpd * dt);
          } else if (i === 0) {
            // 先頭の一体だけが自機を攻撃する
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
          castRef.current = 1; // 詠唱の閃光
          const crit = Math.random() < 0.16;
          const dmg = stats.atk * (crit ? 1.8 : 1);
          const target = alive[0];
          target.hp -= dmg;
          target.hitFlash = 0.16; // 被弾で白く光る
          target.x = Math.min(VW, target.x + (crit ? 9 : 5)); // のけぞり(ノックバック)
          // ヒーローから標的へ魔弾を放つ(着弾の炸裂は弾の寿命切れで出す)
          boltsRef.current.push({ id: idRef.current++, fromX: HERO_X + 12, toX: target.x, life: BOLT_TIME, crit });
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

      // 魔弾の飛翔: 寿命が尽きたら着弾の炸裂を生む
      for (const b of boltsRef.current) {
        b.life -= dt;
        if (b.life <= 0) strikesRef.current.push({ id: idRef.current++, x: b.toX, life: 0.28, crit: b.crit });
      }
      boltsRef.current = boltsRef.current.filter((b) => b.life > 0);

      // ポップ・炸裂の寿命
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
  const bolts = boltsRef.current;
  const cast = castRef.current;

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
        {/* 飛翔中の魔弾(ヒーロー→敵) */}
        {bolts.map((b) => {
          const prog = 1 - b.life / BOLT_TIME;
          const bx = b.fromX + (b.toX - b.fromX) * prog;
          return <span key={b.id} className={`tbh-bolt${b.crit ? " crit" : ""}`} style={{ left: `${(bx / VW) * 100}%` }} />;
        })}
        {/* 魔弾の着弾(炸裂) */}
        {strikes.map((s) => (
          <span key={s.id} className={`tbh-strike${s.crit ? " crit" : ""}`} style={{ left: `${(s.x / VW) * 100}%`, opacity: Math.min(1, s.life / 0.28), transform: `translate(-50%,-50%) scale(${0.6 + (1 - s.life / 0.28) * 1.1})` }}>
            <svg viewBox="0 0 32 32" width="32" height="32" aria-hidden="true">
              <circle cx="16" cy="16" r="5" fill="currentColor" opacity="0.9" />
              <path d="M16 1 V9 M16 23 V31 M1 16 H9 M23 16 H31 M5 5 L10 10 M22 22 L27 27 M27 5 L22 10 M10 22 L5 27" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
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
          {/* 詠唱の閃光(魔法を放つ瞬間、掌に灯る) */}
          {cast > 0.05 && (
            <span className="tbh-cast" style={{ opacity: cast, transform: `scale(${0.7 + cast * 0.7})` }} />
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
