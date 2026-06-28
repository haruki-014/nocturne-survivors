// ═══════════════════════════════════════════════════════════
//  〔層〕主要機能 / CORE ── スプライト生成(オフスクリーン焼き込み)
//
//  役割(マクロ): 敵・自機・経験石・道具・地形装飾など「重い図形」を一度だけ
//    オフスクリーン canvas に手続き的に描いて spriteCache に保持する工房。
//    render.ts(描画パス)は毎フレーム、ここで焼いた canvas を drawImage で貼るだけ。
//    状態(World)には触れず、定義データ(data.ts)の配色のみを参照する純生成層。
//  挙動(ミクロ): makeSprite(key, size, draw) が key 単位でキャッシュし、未生成なら
//    原点中心の ctx を渡して draw を一度走らせる。enemyPortrait()/skinPortrait() は
//    図鑑・祭壇・宝物庫向けに、同じスプライトを PNG 化して返す(画面と図鑑が一致)。
// ═══════════════════════════════════════════════════════════

import type { Enemy, EnemyKind, EnemyVariant } from "./types";
import { BOSSES, BOSSES_BY_ID, DEFAULT_SKIN, ENEMIES, RECOLOR_PALETTE, SKINS_BY_ID, type BossArt, type SkinDef } from "./data";

const TAU = Math.PI * 2;

/** 16進カラーを明暗調整する(amt: -1..1)。スプライトの陰影に使う。 */
function shade(hex: string, amt: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  let r = (n >> 16) & 255;
  let g = (n >> 8) & 255;
  let b = n & 255;
  if (amt >= 0) {
    r += (255 - r) * amt;
    g += (255 - g) * amt;
    b += (255 - b) * amt;
  } else {
    r *= 1 + amt;
    g *= 1 + amt;
    b *= 1 + amt;
  }
  const h = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** #rrggbb を rgba(r,g,b,a) へ。未知の形式はそのまま返す(既に rgba 等の場合)。 */
function withAlpha(hex: string, a: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// ---------- スプライトキャッシュ ----------

const spriteCache = new Map<string, HTMLCanvasElement>();

/**
 * 図鑑などの UI 用に、敵スプライトを PNG データ URL として返す(キャッシュ付き)。
 * これにより図鑑のモンスターは「実際のゲーム内の姿」で表示され、世界観が統一される。
 */
const portraitCache = new Map<string, string>();
export function enemyPortrait(kind: EnemyKind, variant: EnemyVariant = "normal", bossType?: string): string {
  const key = `${kind}:${variant}:${bossType ?? ""}`;
  const hit = portraitCache.get(key);
  if (hit) return hit;
  const spr = enemySprite(kind, variant, bossType);
  const url = spr.toDataURL("image/png");
  portraitCache.set(key, url);
  return url;
}

/** スキン選択 UI 用に、プレイヤーの実スプライトを PNG データ URL で返す(キャッシュ付き)。 */
const skinPortraitCache = new Map<string, string>();
export function skinPortrait(skinId: string): string {
  const hit = skinPortraitCache.get(skinId);
  if (hit) return hit;
  const skin = SKINS_BY_ID[skinId] ?? SKINS_BY_ID[DEFAULT_SKIN];
  const url = playerSprite(skin).toDataURL("image/png");
  skinPortraitCache.set(skinId, url);
  return url;
}

/**
 * スプライトのオフスクリーン・キャッシュ。key ごとに一度だけ size×size の canvas へ
 * draw() で焼き、以後は使い回す(毎フレームの再描画を避け、数百体でも軽い)。
 * draw には原点を中心に移した ctx と一辺 size が渡される。
 */
function makeSprite(
  key: string,
  size: number,
  draw: (ctx: CanvasRenderingContext2D, s: number) => void,
): HTMLCanvasElement {
  const cached = spriteCache.get(key);
  if (cached) return cached; // 同じ key は再生成しない
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d")!;
  ctx.translate(size / 2, size / 2); // 以降の描画は中心原点
  draw(ctx, size);
  spriteCache.set(key, c);
  return c;
}

// プレイヤー(灯を掲げる者)のスプライト。装い(SkinDef)の配色で外套・縁取り・
// 襟巻・面立ち・燈火を描き分ける。スキンごとにキャッシュされる。
function playerSprite(skin: SkinDef): HTMLCanvasElement {
  return makeSprite(`player:${skin.id}`, 60, (ctx) => {
    // 外套のシルエット
    ctx.fillStyle = skin.cloak;
    ctx.beginPath();
    ctx.moveTo(0, -16);
    ctx.quadraticCurveTo(15, -8, 13, 16);
    ctx.quadraticCurveTo(0, 21, -13, 16);
    ctx.quadraticCurveTo(-15, -8, 0, -16);
    ctx.fill();
    // 外套の縁に月光のリム
    ctx.strokeStyle = skin.rim;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.strokeStyle = "rgba(217,164,65,0.25)";
    ctx.lineWidth = 1;
    ctx.stroke();
    // マフラー
    ctx.fillStyle = skin.scarf;
    ctx.beginPath();
    ctx.ellipse(0, -5, 9, 4, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = shade(skin.scarf, 0.4);
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    ctx.ellipse(-2, -6, 4, 1.6, 0, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
    // 顔
    ctx.fillStyle = skin.face;
    ctx.beginPath();
    ctx.arc(0, -11, 6.5, 0, TAU);
    ctx.fill();
    // 目
    ctx.fillStyle = "#1a1424";
    ctx.fillRect(-3.5, -12.5, 2, 3);
    ctx.fillRect(1.5, -12.5, 2, 3);
    // ランタン(右手・芯)
    ctx.fillStyle = shade(skin.lantern, 0.55);
    ctx.beginPath();
    ctx.arc(12, 4, 3.2, 0, TAU);
    ctx.fill();
    ctx.fillStyle = skin.lantern;
    ctx.beginPath();
    ctx.arc(12, 4, 4.6, 0, TAU);
    ctx.globalAlpha = 0.4;
    ctx.fill();
    ctx.globalAlpha = 1;
  });
}

// 発光する眼(加算で滲ませる)
function glowEye(ctx: CanvasRenderingContext2D, x: number, y: number, rad: number, color: string): void {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const g = ctx.createRadialGradient(x, y, 0.5, x, y, rad * 2.4);
  g.addColorStop(0, "#ffffff");
  g.addColorStop(0.4, color);
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, rad * 2.4, 0, TAU);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(x, y, rad * 0.55, 0, TAU);
  ctx.fill();
}

// ボスの絵柄。art ごとに全く違うシルエットで描き分ける。base=主色, eye=双眸。
function drawBossArt(ctx: CanvasRenderingContext2D, art: BossArt, r: number, base: string, eye: string): void {
  const dark = shade(base, -0.55);
  const lite = shade(base, 0.4);
  const outline = "rgba(8,5,16,0.92)";
  ctx.lineJoin = "round";

  switch (art) {
    case "count": {
      // 吸血卿: 翻る外套・高い襟・蒼白い顔・緋い瞳・牙
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.quadraticCurveTo(r * 1.4, -r * 0.5, r * 1.15, r * 0.95);
      ctx.lineTo(r * 0.7, r * 0.6); ctx.lineTo(r * 0.5, r * 1.0); ctx.lineTo(r * 0.2, r * 0.6);
      ctx.lineTo(0, r * 1.05);
      ctx.lineTo(-r * 0.2, r * 0.6); ctx.lineTo(-r * 0.5, r * 1.0); ctx.lineTo(-r * 0.7, r * 0.6);
      ctx.lineTo(-r * 1.15, r * 0.95);
      ctx.quadraticCurveTo(-r * 1.4, -r * 0.5, 0, -r);
      ctx.closePath();
      const cg = ctx.createLinearGradient(0, -r, 0, r);
      cg.addColorStop(0, shade(base, -0.65)); cg.addColorStop(1, "#180610");
      ctx.fillStyle = cg; ctx.fill();
      ctx.strokeStyle = base; ctx.lineWidth = 2.2; ctx.stroke();
      ctx.fillStyle = "#2a0a14";
      ctx.beginPath();
      ctx.moveTo(-r * 0.5, -r * 0.5); ctx.lineTo(-r * 0.7, -r * 1.05); ctx.lineTo(0, -r * 0.6);
      ctx.lineTo(r * 0.7, -r * 1.05); ctx.lineTo(r * 0.5, -r * 0.5); ctx.closePath();
      ctx.fill(); ctx.strokeStyle = base; ctx.lineWidth = 1.4; ctx.stroke();
      const fg = ctx.createRadialGradient(-r * 0.1, -r * 0.55, 1, 0, -r * 0.45, r * 0.45);
      fg.addColorStop(0, "#f0e6d2"); fg.addColorStop(1, "#b9a98f");
      ctx.fillStyle = fg;
      ctx.beginPath(); ctx.arc(0, -r * 0.45, r * 0.4, 0, TAU); ctx.fill();
      glowEye(ctx, -r * 0.16, -r * 0.5, 2.6, eye);
      glowEye(ctx, r * 0.16, -r * 0.5, 2.6, eye);
      ctx.fillStyle = "#f3ead8";
      ctx.beginPath();
      ctx.moveTo(-r * 0.08, -r * 0.22); ctx.lineTo(-r * 0.04, -r * 0.1); ctx.lineTo(0, -r * 0.2);
      ctx.lineTo(r * 0.04, -r * 0.1); ctx.lineTo(r * 0.08, -r * 0.22); ctx.fill();
      break;
    }
    case "boneKing": {
      // 亡王: 巨大な肋骨の胴・背骨、頭蓋に棘の王冠
      const bg = ctx.createLinearGradient(0, -r * 0.2, 0, r);
      bg.addColorStop(0, lite); bg.addColorStop(1, shade(base, -0.35));
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.moveTo(-r * 0.7, -r * 0.05);
      ctx.quadraticCurveTo(0, r * 0.15, r * 0.7, -r * 0.05);
      ctx.lineTo(r * 0.5, r * 1.05);
      ctx.quadraticCurveTo(0, r * 1.2, -r * 0.5, r * 1.05);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = outline; ctx.lineWidth = 2; ctx.stroke();
      // 背骨と肋骨
      ctx.strokeStyle = shade(base, -0.45); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, r * 0.05); ctx.lineTo(0, r * 1.0); ctx.stroke();
      ctx.lineWidth = 1.6;
      for (let i = 0; i < 4; i++) {
        const yy = r * (0.2 + i * 0.21);
        ctx.beginPath(); ctx.moveTo(-r * 0.5, yy); ctx.quadraticCurveTo(0, yy + r * 0.14, r * 0.5, yy); ctx.stroke();
      }
      // 肩
      ctx.fillStyle = shade(base, 0.1);
      ctx.beginPath(); ctx.ellipse(-r * 0.66, 0, r * 0.34, r * 0.24, 0.4, 0, TAU);
      ctx.ellipse(r * 0.66, 0, r * 0.34, r * 0.24, -0.4, 0, TAU); ctx.fill();
      // 頭蓋
      const sg = ctx.createRadialGradient(-r * 0.12, -r * 0.7, 1, 0, -r * 0.55, r * 0.55);
      sg.addColorStop(0, "#fbf6e6"); sg.addColorStop(1, shade(base, -0.1));
      ctx.fillStyle = sg;
      ctx.beginPath(); ctx.arc(0, -r * 0.55, r * 0.5, 0, TAU); ctx.fill();
      ctx.strokeStyle = outline; ctx.lineWidth = 1.6; ctx.stroke();
      glowEye(ctx, -r * 0.2, -r * 0.58, 2.8, eye);
      glowEye(ctx, r * 0.2, -r * 0.58, 2.8, eye);
      ctx.fillStyle = "#1a1622";
      ctx.beginPath(); ctx.moveTo(0, -r * 0.42); ctx.lineTo(-r * 0.07, -r * 0.28); ctx.lineTo(r * 0.07, -r * 0.28); ctx.fill();
      ctx.strokeStyle = "#1a1622"; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(-r * 0.22, -r * 0.2); ctx.lineTo(r * 0.22, -r * 0.2); ctx.stroke();
      // 棘の王冠
      ctx.fillStyle = "#ffe28a"; ctx.strokeStyle = "#a9791f"; ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(-r * 0.5, -r * 0.95);
      for (let i = 0; i <= 4; i++) { const x = -r * 0.5 + (i / 4) * r; ctx.lineTo(x, -r * (i % 2 ? 1.5 : 1.1)); }
      ctx.lineTo(r * 0.5, -r * 0.95); ctx.closePath(); ctx.fill(); ctx.stroke();
      break;
    }
    case "plagueTitan": {
      // 疫病の巨躯: 前傾の肉塊・腫れ物・裂けた口
      const bg = ctx.createLinearGradient(0, -r, 0, r);
      bg.addColorStop(0, lite); bg.addColorStop(1, dark);
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.moveTo(-r * 1.05, -r * 0.1);
      ctx.quadraticCurveTo(-r * 1.1, -r * 0.95, -r * 0.4, -r * 0.9);
      ctx.quadraticCurveTo(0, -r * 1.1, r * 0.5, -r * 0.85);
      ctx.quadraticCurveTo(r * 1.15, -r * 0.85, r * 1.05, -r * 0.05);
      ctx.lineTo(r * 0.85, r * 1.0);
      ctx.quadraticCurveTo(0, r * 1.18, -r * 0.85, r * 1.0);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = outline; ctx.lineWidth = 2.2; ctx.stroke();
      // 腫れ物
      ctx.fillStyle = shade(base, 0.25);
      for (const [bx, by, br] of [[-0.5, 0.2, 0.16], [0.45, 0.05, 0.2], [0.1, 0.5, 0.17], [-0.2, -0.4, 0.12]] as const) {
        ctx.beginPath(); ctx.arc(bx * r, by * r, br * r, 0, TAU); ctx.fill();
        ctx.fillStyle = shade(base, -0.4);
        ctx.beginPath(); ctx.arc(bx * r + br * r * 0.3, by * r - br * r * 0.3, br * r * 0.4, 0, TAU); ctx.fill();
        ctx.fillStyle = shade(base, 0.25);
      }
      // 双眸(沈んだ小さな目)
      glowEye(ctx, -r * 0.3, -r * 0.5, 2.0, eye);
      glowEye(ctx, r * 0.22, -r * 0.52, 2.0, eye);
      // 裂けた口と歯
      ctx.fillStyle = "#160f0a";
      ctx.beginPath(); ctx.ellipse(0, -r * 0.12, r * 0.42, r * 0.2, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = "#e9e2cf";
      for (let i = -3; i <= 3; i++) {
        ctx.beginPath();
        ctx.moveTo(i * r * 0.12, -r * 0.28); ctx.lineTo(i * r * 0.12 + r * 0.05, -r * 0.02); ctx.lineTo(i * r * 0.12 - r * 0.05, -r * 0.02);
        ctx.fill();
      }
      break;
    }
    case "wraithQueen": {
      // 亡き女王: 半透明の霊体・尖頭の冠・裂けた裾・虚ろなフード
      const aura = ctx.createRadialGradient(0, -r * 0.1, 1, 0, 0, r * 1.5);
      aura.addColorStop(0, shade(base, 0.35)); aura.addColorStop(0.5, base); aura.addColorStop(1, "rgba(0,0,0,0)");
      ctx.globalAlpha = 0.55; ctx.fillStyle = aura;
      ctx.beginPath(); ctx.arc(0, 0, r * 1.45, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
      ctx.fillStyle = shade(base, -0.5);
      ctx.beginPath();
      ctx.moveTo(0, -r * 1.05);
      ctx.quadraticCurveTo(r * 0.95, -r * 0.6, r * 0.78, r * 0.2);
      ctx.lineTo(r * 0.56, r * 0.95); ctx.lineTo(r * 0.38, r * 0.4); ctx.lineTo(r * 0.18, r * 1.05);
      ctx.lineTo(0, r * 0.5);
      ctx.lineTo(-r * 0.18, r * 1.05); ctx.lineTo(-r * 0.38, r * 0.4); ctx.lineTo(-r * 0.56, r * 0.95);
      ctx.lineTo(-r * 0.78, r * 0.2);
      ctx.quadraticCurveTo(-r * 0.95, -r * 0.6, 0, -r * 1.05);
      ctx.closePath();
      ctx.globalAlpha = 0.9; ctx.fill(); ctx.globalAlpha = 1;
      ctx.strokeStyle = shade(base, 0.2); ctx.lineWidth = 1.2; ctx.stroke();
      // フード内の闇
      ctx.fillStyle = "rgba(4,4,10,0.92)";
      ctx.beginPath(); ctx.ellipse(0, -r * 0.5, r * 0.36, r * 0.46, 0, 0, TAU); ctx.fill();
      glowEye(ctx, -r * 0.15, -r * 0.5, 2.4, eye);
      glowEye(ctx, r * 0.15, -r * 0.5, 2.4, eye);
      // 尖頭の冠
      ctx.fillStyle = shade(base, 0.5); ctx.strokeStyle = shade(base, -0.2); ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-r * 0.4, -r * 0.86);
      ctx.lineTo(-r * 0.28, -r * 1.2); ctx.lineTo(-r * 0.1, -r * 0.95); ctx.lineTo(0, -r * 1.35);
      ctx.lineTo(r * 0.1, -r * 0.95); ctx.lineTo(r * 0.28, -r * 1.2); ctx.lineTo(r * 0.4, -r * 0.86);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      break;
    }
    case "ashHerald": {
      // 灰燼の使者: 焔の双翼・光輪・燃える胴
      const drawWing = (s: number) => {
        const wg = ctx.createLinearGradient(0, -r, s * r * 1.6, r * 0.3);
        wg.addColorStop(0, shade(base, 0.4)); wg.addColorStop(0.6, base); wg.addColorStop(1, shade(base, -0.5));
        ctx.fillStyle = wg;
        ctx.beginPath();
        ctx.moveTo(0, -r * 0.3);
        ctx.quadraticCurveTo(s * r * 1.2, -r * 1.0, s * r * 1.55, -r * 0.1);
        ctx.quadraticCurveTo(s * r * 1.2, -r * 0.05, s * r * 1.25, r * 0.3);
        ctx.quadraticCurveTo(s * r * 0.85, r * 0.1, s * r * 0.8, r * 0.5);
        ctx.quadraticCurveTo(s * r * 0.5, r * 0.2, 0, r * 0.4);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = shade(base, 0.55); ctx.lineWidth = 1;
        for (let i = 1; i <= 3; i++) {
          ctx.beginPath(); ctx.moveTo(s * r * 0.1, 0); ctx.lineTo(s * r * (0.5 + i * 0.32), -r * 0.4 + i * r * 0.24); ctx.stroke();
        }
      };
      drawWing(-1); drawWing(1);
      // 光輪
      ctx.strokeStyle = shade(base, 0.55); ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.arc(0, -r * 0.72, r * 0.3, 0, TAU); ctx.stroke();
      // 燃える胴(フード)
      const bg = ctx.createLinearGradient(0, -r * 0.5, 0, r);
      bg.addColorStop(0, lite); bg.addColorStop(1, dark);
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.55);
      ctx.quadraticCurveTo(r * 0.55, -r * 0.2, r * 0.5, r * 0.95);
      ctx.lineTo(0, r * 0.7); ctx.lineTo(-r * 0.5, r * 0.95);
      ctx.quadraticCurveTo(-r * 0.55, -r * 0.2, 0, -r * 0.55);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = outline; ctx.lineWidth = 1.6; ctx.stroke();
      ctx.fillStyle = "rgba(6,4,10,0.85)";
      ctx.beginPath(); ctx.ellipse(0, -r * 0.28, r * 0.26, r * 0.34, 0, 0, TAU); ctx.fill();
      glowEye(ctx, -r * 0.11, -r * 0.3, 2.2, eye);
      glowEye(ctx, r * 0.11, -r * 0.3, 2.2, eye);
      break;
    }
  }
}

// 敵スプライト。種ごとに作り込み、変種(大型/色違い)はサイズと配色で差別化する。
// ボスは bossType により絵柄(art)・配色・大きさ(半径倍率)を切り替える。
function enemySprite(kind: Enemy["kind"], variant: Enemy["variant"] = "normal", bossType?: string): HTMLCanvasElement {
  const def = ENEMIES[kind];
  const boss = kind === "boss" ? BOSSES_BY_ID[bossType ?? "count"] ?? BOSSES[0] : undefined;
  const mul = variant === "large" ? 1.7 : variant === "recolor" ? 1.15 : 1;
  const r = def.radius * mul * (boss?.radiusMul ?? 1);
  const base = boss ? boss.color : variant === "recolor" ? RECOLOR_PALETTE[kind] : def.color;
  const eye = boss ? boss.eye : variant === "recolor" ? "#fff0a6" : "#ff5566";
  const size = Math.ceil(r * 3) + 16;
  return makeSprite(`enemy:${kind}:${variant}:${bossType ?? ""}`, size, (ctx) => {
    const dark = shade(base, -0.55);
    const lite = shade(base, 0.35);
    const outline = "rgba(8,5,16,0.92)";
    ctx.lineJoin = "round";

    switch (kind) {
      case "bat": {
        // 膜翼(骨の筋入り)
        const drawWing = (s: number) => {
          ctx.beginPath();
          ctx.moveTo(0, -r * 0.1);
          ctx.quadraticCurveTo(s * r * 1.0, -r * 1.05, s * r * 1.85, -r * 0.25);
          ctx.quadraticCurveTo(s * r * 1.45, -r * 0.05, s * r * 1.6, r * 0.35);
          ctx.quadraticCurveTo(s * r * 1.1, r * 0.18, s * r * 0.95, r * 0.5);
          ctx.quadraticCurveTo(s * r * 0.7, r * 0.2, s * r * 0.55, r * 0.55);
          ctx.quadraticCurveTo(s * r * 0.35, r * 0.2, 0, r * 0.45);
          ctx.closePath();
          const g = ctx.createLinearGradient(0, -r, 0, r);
          g.addColorStop(0, base);
          g.addColorStop(1, dark);
          ctx.fillStyle = g;
          ctx.fill();
          ctx.strokeStyle = outline;
          ctx.lineWidth = 1.4;
          ctx.stroke();
          // 骨の筋
          ctx.strokeStyle = shade(base, 0.5);
          ctx.lineWidth = 1;
          for (let i = 1; i <= 3; i++) {
            ctx.beginPath();
            ctx.moveTo(s * r * 0.1, r * 0.1);
            ctx.lineTo(s * r * (0.5 + i * 0.4), -r * 0.5 + i * r * 0.28);
            ctx.stroke();
          }
        };
        drawWing(-1);
        drawWing(1);
        // 胴
        const bg = ctx.createRadialGradient(-r * 0.2, -r * 0.25, 1, 0, 0, r * 0.8);
        bg.addColorStop(0, lite);
        bg.addColorStop(1, dark);
        ctx.fillStyle = bg;
        ctx.beginPath();
        ctx.ellipse(0, r * 0.02, r * 0.5, r * 0.62, 0, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = outline;
        ctx.lineWidth = 1.4;
        ctx.stroke();
        // 耳
        ctx.fillStyle = dark;
        ctx.beginPath();
        ctx.moveTo(-r * 0.34, -r * 0.5);
        ctx.lineTo(-r * 0.5, -r * 0.95);
        ctx.lineTo(-r * 0.12, -r * 0.55);
        ctx.moveTo(r * 0.34, -r * 0.5);
        ctx.lineTo(r * 0.5, -r * 0.95);
        ctx.lineTo(r * 0.12, -r * 0.55);
        ctx.fill();
        glowEye(ctx, -r * 0.2, -r * 0.12, 2.0 * mul, eye);
        glowEye(ctx, r * 0.2, -r * 0.12, 2.0 * mul, eye);
        // 牙
        ctx.fillStyle = "#f3ead8";
        ctx.beginPath();
        ctx.moveTo(-r * 0.12, r * 0.28);
        ctx.lineTo(-r * 0.04, r * 0.46);
        ctx.lineTo(0, r * 0.3);
        ctx.lineTo(r * 0.04, r * 0.46);
        ctx.lineTo(r * 0.12, r * 0.28);
        ctx.fill();
        break;
      }
      case "zombie": {
        // 前かがみの胴(ぼろ布)
        ctx.beginPath();
        ctx.moveTo(-r * 0.7, r);
        ctx.lineTo(-r * 0.85, -r * 0.35);
        ctx.quadraticCurveTo(-r * 0.5, -r * 0.95, 0, -r * 0.92);
        ctx.quadraticCurveTo(r * 0.55, -r * 0.95, r * 0.8, -r * 0.3);
        ctx.lineTo(r * 0.66, r);
        // ぼろの裾
        ctx.lineTo(r * 0.4, r * 0.82);
        ctx.lineTo(r * 0.18, r);
        ctx.lineTo(-r * 0.04, r * 0.82);
        ctx.lineTo(-r * 0.28, r);
        ctx.lineTo(-r * 0.5, r * 0.82);
        ctx.closePath();
        const bg = ctx.createLinearGradient(0, -r, 0, r);
        bg.addColorStop(0, lite);
        bg.addColorStop(1, dark);
        ctx.fillStyle = bg;
        ctx.fill();
        ctx.strokeStyle = outline;
        ctx.lineWidth = 1.6;
        ctx.stroke();
        // 斑点(腐敗)
        ctx.fillStyle = shade(base, -0.3);
        for (const [sx, sy, sr] of [[-0.3, 0.1, 0.13], [0.28, 0.32, 0.1], [0.05, -0.3, 0.09]] as const) {
          ctx.beginPath();
          ctx.arc(sx * r, sy * r, sr * r, 0, TAU);
          ctx.fill();
        }
        // 傾いた頭
        ctx.save();
        ctx.translate(-r * 0.08, -r * 0.72);
        ctx.rotate(-0.2);
        ctx.fillStyle = lite;
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.42, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = outline;
        ctx.lineWidth = 1.4;
        ctx.stroke();
        glowEye(ctx, -r * 0.12, -r * 0.05, 1.7 * mul, eye);
        // うつろな片目
        ctx.fillStyle = "#10160f";
        ctx.beginPath();
        ctx.arc(r * 0.16, -r * 0.02, r * 0.08, 0, TAU);
        ctx.fill();
        // 顎
        ctx.strokeStyle = "#10160f";
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(-r * 0.18, r * 0.22);
        ctx.lineTo(r * 0.2, r * 0.24);
        ctx.stroke();
        ctx.restore();
        break;
      }
      case "skeleton": {
        // 胴(肋骨)
        const bg = ctx.createLinearGradient(0, -r, 0, r);
        bg.addColorStop(0, lite);
        bg.addColorStop(1, shade(base, -0.25));
        ctx.fillStyle = bg;
        ctx.beginPath();
        ctx.moveTo(-r * 0.42, r * 0.05);
        ctx.quadraticCurveTo(0, r * 0.2, r * 0.42, r * 0.05);
        ctx.lineTo(r * 0.3, r * 0.95);
        ctx.quadraticCurveTo(0, r * 1.05, -r * 0.3, r * 0.95);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = outline;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        // 背骨と肋骨
        ctx.strokeStyle = shade(base, -0.4);
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(0, r * 0.12);
        ctx.lineTo(0, r * 0.9);
        ctx.stroke();
        ctx.lineWidth = 1.1;
        for (let i = 0; i < 3; i++) {
          const yy = r * (0.28 + i * 0.22);
          ctx.beginPath();
          ctx.moveTo(-r * 0.3, yy);
          ctx.quadraticCurveTo(0, yy + r * 0.1, r * 0.3, yy);
          ctx.stroke();
        }
        // 頭蓋
        const sg = ctx.createRadialGradient(-r * 0.15, -r * 0.55, 1, 0, -r * 0.4, r * 0.6);
        sg.addColorStop(0, "#fbf3df");
        sg.addColorStop(1, shade(base, -0.1));
        ctx.fillStyle = sg;
        ctx.beginPath();
        ctx.arc(0, -r * 0.42, r * 0.5, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = outline;
        ctx.lineWidth = 1.4;
        ctx.stroke();
        // 眼窩(発光)
        glowEye(ctx, -r * 0.2, -r * 0.45, 1.9 * mul, eye);
        glowEye(ctx, r * 0.2, -r * 0.45, 1.9 * mul, eye);
        // 鼻腔・歯
        ctx.fillStyle = "#23202a";
        ctx.beginPath();
        ctx.moveTo(0, -r * 0.3);
        ctx.lineTo(-r * 0.06, -r * 0.18);
        ctx.lineTo(r * 0.06, -r * 0.18);
        ctx.fill();
        ctx.strokeStyle = "#23202a";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(-r * 0.18, -r * 0.1);
        ctx.lineTo(r * 0.18, -r * 0.1);
        ctx.stroke();
        break;
      }
      case "wraith": {
        // 霊体のにじみ
        const aura = ctx.createRadialGradient(0, -r * 0.1, 1, 0, 0, r * 1.5);
        aura.addColorStop(0, shade(base, 0.3));
        aura.addColorStop(0.5, base);
        aura.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = aura;
        ctx.beginPath();
        ctx.arc(0, -r * 0.1, r * 1.45, 0, TAU);
        ctx.fill();
        // フード+裂けた裾
        ctx.fillStyle = shade(base, -0.55);
        ctx.beginPath();
        ctx.moveTo(0, -r * 1.05);
        ctx.quadraticCurveTo(r * 0.85, -r * 0.7, r * 0.7, r * 0.1);
        // ぎざぎざの裾
        ctx.lineTo(r * 0.5, r * 0.7);
        ctx.lineTo(r * 0.34, r * 0.3);
        ctx.lineTo(r * 0.16, r * 0.85);
        ctx.lineTo(0, r * 0.45);
        ctx.lineTo(-r * 0.16, r * 0.85);
        ctx.lineTo(-r * 0.34, r * 0.3);
        ctx.lineTo(-r * 0.5, r * 0.7);
        ctx.lineTo(-r * 0.7, r * 0.1);
        ctx.quadraticCurveTo(-r * 0.85, -r * 0.7, 0, -r * 1.05);
        ctx.closePath();
        ctx.globalAlpha = 0.85;
        ctx.fill();
        ctx.globalAlpha = 1;
        // フード内の闇
        ctx.fillStyle = "rgba(4,8,12,0.9)";
        ctx.beginPath();
        ctx.ellipse(0, -r * 0.45, r * 0.4, r * 0.5, 0, 0, TAU);
        ctx.fill();
        glowEye(ctx, -r * 0.17, -r * 0.5, 2.1 * mul, eye);
        glowEye(ctx, r * 0.17, -r * 0.5, 2.1 * mul, eye);
        break;
      }
      case "brute":
      case "elite": {
        // 重厚な体躯
        const bg = ctx.createLinearGradient(0, -r, 0, r);
        bg.addColorStop(0, lite);
        bg.addColorStop(1, dark);
        ctx.fillStyle = bg;
        ctx.beginPath();
        ctx.moveTo(-r * 1.0, -r * 0.2);
        ctx.quadraticCurveTo(-r * 1.05, -r * 0.95, -r * 0.5, -r * 0.95);
        ctx.quadraticCurveTo(0, -r * 1.1, r * 0.5, -r * 0.95);
        ctx.quadraticCurveTo(r * 1.05, -r * 0.95, r * 1.0, -r * 0.2);
        ctx.lineTo(r * 0.8, r * 0.95);
        ctx.quadraticCurveTo(0, r * 1.05, -r * 0.8, r * 0.95);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = outline;
        ctx.lineWidth = 2;
        ctx.stroke();
        // 肩当て
        ctx.fillStyle = shade(base, kind === "elite" ? 0.2 : -0.15);
        ctx.beginPath();
        ctx.ellipse(-r * 0.8, -r * 0.55, r * 0.4, r * 0.3, 0.3, 0, TAU);
        ctx.ellipse(r * 0.8, -r * 0.55, r * 0.4, r * 0.3, -0.3, 0, TAU);
        ctx.fill();
        // 装甲の割れ
        ctx.strokeStyle = shade(base, -0.5);
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(-r * 0.3, -r * 0.2);
        ctx.lineTo(-r * 0.1, r * 0.3);
        ctx.lineTo(-r * 0.25, r * 0.7);
        ctx.stroke();
        glowEye(ctx, -r * 0.28, -r * 0.42, 2.2 * mul, eye);
        glowEye(ctx, r * 0.28, -r * 0.42, 2.2 * mul, eye);
        if (kind === "elite") {
          // 王冠
          ctx.fillStyle = "#ffe28a";
          ctx.strokeStyle = "#a9791f";
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(-r * 0.62, -r * 0.92);
          ctx.lineTo(-r * 0.62, -r * 1.35);
          ctx.lineTo(-r * 0.26, -r * 1.0);
          ctx.lineTo(0, -r * 1.5);
          ctx.lineTo(r * 0.26, -r * 1.0);
          ctx.lineTo(r * 0.62, -r * 1.35);
          ctx.lineTo(r * 0.62, -r * 0.92);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = "#ff5566";
          ctx.beginPath();
          ctx.arc(0, -r * 1.12, r * 0.1, 0, TAU);
          ctx.fill();
        }
        break;
      }
      case "warlock": {
        // 漂う呪気
        const aura = ctx.createRadialGradient(0, 0, 1, 0, 0, r * 1.5);
        aura.addColorStop(0, shade(base, 0.25));
        aura.addColorStop(0.55, base);
        aura.addColorStop(1, "rgba(0,0,0,0)");
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = aura;
        ctx.beginPath();
        ctx.arc(0, 0, r * 1.45, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 1;
        // 裾広がりの法衣
        const bg = ctx.createLinearGradient(0, -r, 0, r);
        bg.addColorStop(0, lite);
        bg.addColorStop(1, dark);
        ctx.fillStyle = bg;
        ctx.beginPath();
        ctx.moveTo(0, -r * 0.95);
        ctx.quadraticCurveTo(r * 0.7, -r * 0.6, r * 0.85, r * 0.95);
        ctx.lineTo(r * 0.4, r * 0.7);
        ctx.lineTo(r * 0.2, r);
        ctx.lineTo(0, r * 0.72);
        ctx.lineTo(-r * 0.2, r);
        ctx.lineTo(-r * 0.4, r * 0.7);
        ctx.lineTo(-r * 0.85, r * 0.95);
        ctx.quadraticCurveTo(-r * 0.7, -r * 0.6, 0, -r * 0.95);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = outline;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        // 尖頭のフード
        ctx.fillStyle = shade(base, -0.4);
        ctx.beginPath();
        ctx.moveTo(0, -r * 1.15);
        ctx.quadraticCurveTo(r * 0.5, -r * 0.55, r * 0.42, -r * 0.2);
        ctx.quadraticCurveTo(0, -r * 0.42, -r * 0.42, -r * 0.2);
        ctx.quadraticCurveTo(-r * 0.5, -r * 0.55, 0, -r * 1.15);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = outline;
        ctx.lineWidth = 1.3;
        ctx.stroke();
        // フード内の闇と双眸
        ctx.fillStyle = "rgba(4,6,12,0.9)";
        ctx.beginPath();
        ctx.ellipse(0, -r * 0.5, r * 0.32, r * 0.4, 0, 0, TAU);
        ctx.fill();
        glowEye(ctx, -r * 0.13, -r * 0.5, 1.7 * mul, eye);
        glowEye(ctx, r * 0.13, -r * 0.5, 1.7 * mul, eye);
        // 掲げた手の呪珠
        const orb = ctx.createRadialGradient(r * 0.6, r * 0.05, 0.5, r * 0.6, r * 0.05, r * 0.5);
        orb.addColorStop(0, "#ffffff");
        orb.addColorStop(0.4, shade(base, 0.35));
        orb.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = orb;
        ctx.beginPath();
        ctx.arc(r * 0.6, r * 0.05, r * 0.5, 0, TAU);
        ctx.fill();
        break;
      }
      case "boss": {
        drawBossArt(ctx, boss?.art ?? "count", r, base, eye);
        break;
      }
    }
  });
}

// 経験石は発光を焼き込んでおく(毎フレームの shadowBlur を避ける)
//   色は鮮烈な蒼玉(アズール)。敵(紫・緑・橙・骨色)や緑の秘薬と被らず、
//   白く輝く核で暗い戦場でもひと目で「拾うもの」と分かるようにしている。
function gemSprite(big: boolean): HTMLCanvasElement {
  return makeSprite(`gem:${big}`, big ? 34 : 26, (ctx, s) => {
    const r = s * (big ? 0.26 : 0.24);
    const glow = ctx.createRadialGradient(0, 0, 1, 0, 0, s * 0.5);
    glow.addColorStop(0, big ? "rgba(120,196,255,0.55)" : "rgba(74,150,255,0.46)");
    glow.addColorStop(1, "rgba(74,150,255,0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.5, 0, TAU);
    ctx.fill();
    ctx.fillStyle = big ? "#78c4ff" : "#4a96ff";
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.lineTo(r * 0.8, 0);
    ctx.lineTo(0, r);
    ctx.lineTo(-r * 0.8, 0);
    ctx.closePath();
    ctx.fill();
    // 白く輝く核(高輝度で暗所でも視認性を上げる)
    ctx.fillStyle = "rgba(245,251,255,0.92)";
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.lineTo(r * 0.4, -r * 0.18);
    ctx.lineTo(0, r * 0.28);
    ctx.lineTo(-r * 0.3, -r * 0.14);
    ctx.closePath();
    ctx.fill();
  });
}

// 道具(ポーション・磁石・戦利品)を絵文字でなくベクターで描く。発光を焼き込んでおく。
function pickupSprite(kind: "potion" | "magnet" | "loot"): HTMLCanvasElement {
  return makeSprite(`pickup:${kind}`, 34, (ctx) => {
    // 共通の淡い発光(秘薬=回復の緑、磁石=赤の馬蹄、戦利品=黄金の宝箱)
    const glowCol = kind === "potion" ? "94,224,138" : kind === "loot" ? "255,206,107" : "255,90,90";
    const g = ctx.createRadialGradient(0, 0, 1, 0, 0, 15);
    g.addColorStop(0, `rgba(${glowCol},0.45)`);
    g.addColorStop(1, `rgba(${glowCol},0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, 15, 0, TAU);
    ctx.fill();
    ctx.lineJoin = "round";

    if (kind === "potion") {
      // 丸瓶のガラス
      ctx.fillStyle = "rgba(232,240,255,0.16)";
      ctx.beginPath();
      ctx.arc(0, 3, 6.2, 0, TAU);
      ctx.fill();
      // 首
      ctx.fillRect(-2, -7, 4, 9);
      // 中身(癒しの緑の秘薬)
      ctx.save();
      ctx.beginPath();
      ctx.arc(0, 3, 5.4, 0, TAU);
      ctx.clip();
      ctx.fillStyle = "#3fbf6a";
      ctx.fillRect(-7, 1.4, 14, 10);
      ctx.fillStyle = "rgba(178,240,196,0.75)";
      ctx.fillRect(-7, 1.4, 14, 1.3);
      ctx.restore();
      // 輪郭
      ctx.strokeStyle = "#dfe7f2";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(0, 3, 6.2, 0, TAU);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-2, 1.5);
      ctx.lineTo(-2, -7);
      ctx.moveTo(2, 1.5);
      ctx.lineTo(2, -7);
      ctx.stroke();
      // コルク
      ctx.fillStyle = "#caa46a";
      ctx.fillRect(-2.7, -9.6, 5.4, 2.7);
      // 反射
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.beginPath();
      ctx.ellipse(-2.2, 1.4, 1.2, 2.3, -0.5, 0, TAU);
      ctx.fill();
    } else if (kind === "loot") {
      // 戦利品: 黄金の小箱。蓋・錠前・きらめき。中身は本編では伏せ、ホームで開く。
      ctx.lineJoin = "round";
      // 箱本体
      ctx.fillStyle = "#7a5a26";
      ctx.beginPath();
      ctx.moveTo(-7, -1); ctx.lineTo(7, -1); ctx.lineTo(7, 7); ctx.lineTo(-7, 7); ctx.closePath();
      ctx.fill();
      // 蓋(かまぼこ)
      const lid = ctx.createLinearGradient(0, -8, 0, -1);
      lid.addColorStop(0, "#ffd877"); lid.addColorStop(1, "#caa046");
      ctx.fillStyle = lid;
      ctx.beginPath();
      ctx.moveTo(-7, -1); ctx.lineTo(-7, -4);
      ctx.quadraticCurveTo(0, -10, 7, -4); ctx.lineTo(7, -1); ctx.closePath();
      ctx.fill();
      // 箱の面ハイライト
      const body = ctx.createLinearGradient(0, -1, 0, 7);
      body.addColorStop(0, "#a87f3a"); body.addColorStop(1, "#6a4d20");
      ctx.fillStyle = body;
      ctx.fillRect(-7, -1, 14, 8);
      // 帯と錠前
      ctx.fillStyle = "#e9c061";
      ctx.fillRect(-1.6, -8, 3.2, 15);
      ctx.fillStyle = "#fff0c0";
      ctx.beginPath(); ctx.arc(0, 0.5, 1.8, 0, TAU); ctx.fill();
      // 縁取り
      ctx.strokeStyle = "#fbe3a0"; ctx.lineWidth = 1;
      ctx.strokeRect(-7, -1, 14, 8);
      // きらめき
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.beginPath(); ctx.arc(6, -6, 1.1, 0, TAU); ctx.fill();
    } else {
      // 馬蹄形の磁石(開口は下向き)
      ctx.lineCap = "butt";
      ctx.strokeStyle = "#cf3a3a";
      ctx.lineWidth = 4.2;
      ctx.beginPath();
      ctx.moveTo(-5, 7);
      ctx.lineTo(-5, 0);
      ctx.arc(0, 0, 5, Math.PI, 0, false);
      ctx.lineTo(5, 7);
      ctx.stroke();
      // 銀の極
      ctx.strokeStyle = "#e6edf6";
      ctx.lineWidth = 4.2;
      ctx.beginPath();
      ctx.moveTo(-5, 7);
      ctx.lineTo(-5, 4.2);
      ctx.moveTo(5, 7);
      ctx.lineTo(5, 4.2);
      ctx.stroke();
      // 上辺ハイライト
      ctx.strokeStyle = "rgba(255,255,255,0.45)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(0, 0, 6.6, Math.PI, 0, false);
      ctx.stroke();
    }
  });
}

// 地表の小物。墓地のテーマに沿って種類を増やした(墓石/枯草/骨/十字架/瓦礫/灯火)。
function decoSprite(kind: number): HTMLCanvasElement {
  return makeSprite(`deco:${kind}`, 46, (ctx) => {
    if (kind === 0) {
      // 墓石(傾き)
      ctx.save();
      ctx.rotate(-0.06);
      ctx.fillStyle = "#241b38";
      ctx.beginPath();
      ctx.roundRect(-9, -10, 18, 22, [9, 9, 2, 2]);
      ctx.fill();
      ctx.strokeStyle = "#352a52";
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.fillStyle = "rgba(60,80,70,0.18)"; // 苔
      ctx.beginPath();
      ctx.ellipse(-4, 7, 5, 3, 0, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = "#3d2f5e";
      ctx.beginPath();
      ctx.moveTo(0, -5);
      ctx.lineTo(0, 3);
      ctx.moveTo(-4, -2);
      ctx.lineTo(4, -2);
      ctx.stroke();
      ctx.restore();
    } else if (kind === 1) {
      // 枯れ草
      ctx.strokeStyle = "#2c2347";
      ctx.lineWidth = 1.6;
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(i * 3, 10);
        ctx.quadraticCurveTo(i * 5, -2, i * 6, -9 + Math.abs(i) * 2);
        ctx.stroke();
      }
    } else if (kind === 2) {
      // 骨
      ctx.fillStyle = "#3a3152";
      ctx.beginPath();
      ctx.ellipse(0, 0, 9, 3.2, 0.6, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(-7, -4, 3, 0, TAU);
      ctx.arc(8, 5, 3, 0, TAU);
      ctx.fill();
    } else if (kind === 3) {
      // 傾いた十字架
      ctx.save();
      ctx.rotate(0.12);
      ctx.strokeStyle = "#2a2342";
      ctx.lineCap = "round";
      ctx.lineWidth = 3.4;
      ctx.beginPath();
      ctx.moveTo(0, -12);
      ctx.lineTo(0, 12);
      ctx.moveTo(-7, -5);
      ctx.lineTo(7, -5);
      ctx.stroke();
      ctx.strokeStyle = "#3a2f58";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(-1.4, -11);
      ctx.lineTo(-1.4, 11);
      ctx.stroke();
      ctx.restore();
    } else if (kind === 4) {
      // 瓦礫(石塊)
      ctx.fillStyle = "#241d36";
      ctx.strokeStyle = "#332a4c";
      ctx.lineWidth = 1;
      for (const [bx, by, bw, bh] of [[-5, 3, 8, 6], [3, 1, 7, 7], [-1, -4, 6, 5]] as const) {
        ctx.beginPath();
        ctx.roundRect(bx, by - bh, bw, bh, 2);
        ctx.fill();
        ctx.stroke();
      }
    } else {
      // 灯火(墓前の蝋燭・小さな温かい灯)
      ctx.fillStyle = "#2a2440";
      ctx.fillRect(-2, -2, 4, 9);
      const g = ctx.createRadialGradient(0, -6, 0.5, 0, -6, 9);
      g.addColorStop(0, "rgba(255,206,120,0.5)");
      g.addColorStop(1, "rgba(255,170,70,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, -6, 9, 0, TAU);
      ctx.fill();
      ctx.fillStyle = "#ffe6b0";
      ctx.beginPath();
      ctx.ellipse(0, -6, 1.5, 3, 0, 0, TAU);
      ctx.fill();
    }
  });
}

// 大型のランドマーク(疎らに配置して墓地に奥行きを与える): 枯れ木 / 霊廟 / 崩れた門。
function landmarkSprite(kind: number): HTMLCanvasElement {
  return makeSprite(`landmark:${kind}`, 150, (ctx) => {
    if (kind === 0) {
      // 枯れ木
      ctx.strokeStyle = "#1c1730";
      ctx.lineCap = "round";
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.moveTo(0, 46);
      ctx.lineTo(-2, -6);
      ctx.stroke();
      const branch = (x: number, y: number, ang: number, len: number, w: number) => {
        ctx.lineWidth = w;
        const ex = x + Math.cos(ang) * len;
        const ey = y + Math.sin(ang) * len;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo((x + ex) / 2 - 4, (y + ey) / 2, ex, ey);
        ctx.stroke();
        if (w > 1.5) {
          branch(ex, ey, ang - 0.5, len * 0.6, w * 0.6);
          branch(ex, ey, ang + 0.4, len * 0.6, w * 0.6);
        }
      };
      branch(-2, 0, -1.9, 26, 4.5);
      branch(-2, 6, -1.2, 24, 4.5);
      branch(-2, 10, -2.3, 22, 4);
    } else if (kind === 1) {
      // 霊廟(小さな石造りの墓堂)
      ctx.fillStyle = "#1f1838";
      ctx.strokeStyle = "#352a52";
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.roundRect(-26, -14, 52, 52, 3);
      ctx.fill();
      ctx.stroke();
      // 切妻屋根
      ctx.fillStyle = "#191430";
      ctx.beginPath();
      ctx.moveTo(-32, -14);
      ctx.lineTo(0, -40);
      ctx.lineTo(32, -14);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // 扉(闇)
      ctx.fillStyle = "#0a0714";
      ctx.beginPath();
      ctx.roundRect(-9, 6, 18, 32, [9, 9, 0, 0]);
      ctx.fill();
      // 屋根の十字
      ctx.strokeStyle = "#3a2f58";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, -48);
      ctx.lineTo(0, -36);
      ctx.moveTo(-5, -44);
      ctx.lineTo(5, -44);
      ctx.stroke();
    } else {
      // 崩れた石門(アーチ)
      ctx.strokeStyle = "#211a3a";
      ctx.lineWidth = 9;
      ctx.beginPath();
      ctx.moveTo(-22, 40);
      ctx.lineTo(-22, -8);
      ctx.quadraticCurveTo(-22, -34, 4, -34);
      ctx.stroke();
      ctx.lineWidth = 9;
      ctx.beginPath();
      ctx.moveTo(22, 40);
      ctx.lineTo(22, -2); // 崩れて低い
      ctx.stroke();
      ctx.fillStyle = "#1a1430";
      ctx.beginPath();
      ctx.roundRect(16, -6, 14, 10, 2); // 崩落片
      ctx.fill();
    }
  });
}

// ---------- 雰囲気の補助データ ----------

/** 整数ハッシュ(地形/微塵の決定的散布に使用) */
function hash2(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >> 13)) | 0;
  h = (h * 1274126177) | 0;
  return ((h ^ (h >> 16)) >>> 0) / 4294967295;
}


// render.ts(描画パス)が貼り付け・テーマ用に使う生成物とヘルパを公開する。
// enemyPortrait/skinPortrait は宣言時に既に export 済み(UI からも参照される)。
export {
  TAU, shade, withAlpha, hash2, makeSprite,
  playerSprite, enemySprite, gemSprite, pickupSprite, decoSprite, landmarkSprite,
};
