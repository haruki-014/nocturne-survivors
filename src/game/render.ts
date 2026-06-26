// ═══════════════════════════════════════════════════════════
//  〔層〕主要機能 / CORE ── レンダラ(描画)
//
//  役割(マクロ): エンジンが持つ World(状態)を受け取り、Canvas2D に1フレーム
//    描く「目」の担当。状態は読むだけで書き換えない(ゲームを進めない)。
//    Renderer インターフェースを満たすので、将来 WebGL 等へ差し替え可能。
//  挙動(ミクロ): 重い図形(敵・道具・経験石)は一度だけオフスクリーン canvas に
//    焼いて spriteCache に保持し、毎フレームは drawImage で貼るだけ(数百体でも
//    60fps)。座標は wx()/wy() でワールド→画面に変換し、カメラはプレイヤー追従
//    +画面揺れ。発光体(魔弾/宝珠/雷/呪弾)は加算合成(lighter)で滲ませる。
//
//  描く順序(奥→手前): 背景/霧 → 地表装飾 → 聖域境界 → 薫香 → 経験石・道具 →
//    敵 → 自機 → 投射物 → 敵弾 → 雷 → 粒子 → ダメージ数字 →〔光と闇の層〕
//    ランタン光/血月/微塵/被弾フラッシュ → 画面外マーカー → ミニマップ → 構え表示。
//  UI への提供: enemyPortrait()/skinPortrait() は図鑑や祭壇用に実スプライトを
//    PNG 化して返す(ゲーム画面と図鑑で見た目が完全一致する)。
// ═══════════════════════════════════════════════════════════

import type { Enemy, EnemyKind, EnemyVariant, Renderer, Settings, World } from "./types";
import { ARENA_RADIUS, BOSSES, BOSSES_BY_ID, CURIOS_BY_ID, DEFAULT_SKIN, ENEMIES, RECOLOR_PALETTE, SKINS_BY_ID, type BossArt, type SkinDef } from "./data";

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
 * Canvas 2D による既定レンダラ。Renderer インターフェースを満たし、
 * キャンバスの確保・DPR 対応・1 フレーム描画(renderWorld への委譲)を担う。
 */
export class Canvas2DRenderer implements Renderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  vw = 0;
  vh = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D コンテキストを取得できませんでした");
    this.ctx = ctx;
    this.resize();
  }

  resize(): void {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.vw = this.canvas.clientWidth || window.innerWidth;
    this.vh = this.canvas.clientHeight || window.innerHeight;
    this.canvas.width = Math.round(this.vw * this.dpr);
    this.canvas.height = Math.round(this.vh * this.dpr);
  }

  render(world: World, settings: Settings): void {
    renderWorld(this.ctx, this.vw, this.vh, world, settings, this.dpr);
  }

  dispose(): void {
    /* Canvas2D は破棄処理不要 */
  }
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

// 漂う霧(ワールド空間、視差 0.55 でゆっくり流れる)
const MIST = Array.from({ length: 8 }, (_, i) => ({
  bx: hash2(i * 13 + 1, 7) * 2600,
  by: hash2(3, i * 17 + 5) * 1800,
  r: 220 + hash2(i, 91) * 220,
  drift: 4 + hash2(i, 41) * 8,
  hue: i % 3 === 0 ? "92,30,44" : i % 3 === 1 ? "58,42,85" : "40,60,80", // 血月の緋を一部に混ぜる
}));

// 漂う鬼火(ワールド空間の幽かな霊光。墓地に生気を添える)
const WISPS = Array.from({ length: 7 }, (_, i) => ({
  bx: hash2(i * 7 + 2, 19) * 2200,
  by: hash2(11, i * 23 + 3) * 1700,
  drift: 9 + hash2(i, 53) * 10,
  amp: 26 + hash2(i, 71) * 40,
  hue: i % 2 === 0 ? "150,224,170" : "138,180,255",
}));

// ---------- メイン描画 ----------

/**
 * 描画パスが共有するカメラ文脈。renderWorld が毎フレーム1つ組み立て、各 drawXxx へ渡す。
 * camX/camY = 自機中心のカメラ左上(画面シェイク込み)。wx/wy = ワールド座標→画面座標。
 */
interface View {
  ctx: CanvasRenderingContext2D;
  vw: number;
  vh: number;
  world: World;
  camX: number;
  camY: number;
  wx: (x: number) => number;
  wy: (y: number) => number;
}

/** 背景: 夜の大地のグラデーション、血月の緋い帯、奥に漂う霧。 */
function drawBackdrop(v: View): void {
  const { ctx, vw, vh, world, camX, camY } = v;
  // --- 背景(夜の大地:中心がわずかに温かいグラデーション) ---
  const bg = ctx.createRadialGradient(vw / 2, vh / 2, 40, vw / 2, vh / 2, Math.max(vw, vh) * 0.82);
  bg.addColorStop(0, "#140d22");
  bg.addColorStop(0.55, "#0c0816");
  bg.addColorStop(1, "#06030e");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, vw, vh);

  // 血月の光が大地へ零れる緋い帯(月のある右上から差す)
  ctx.globalCompositeOperation = "lighter";
  const moonWash = ctx.createRadialGradient(vw - 124, 112, 20, vw - 124, 112, Math.max(vw, vh) * 0.72);
  moonWash.addColorStop(0, "rgba(150,28,42,0.12)");
  moonWash.addColorStop(0.5, "rgba(120,22,36,0.05)");
  moonWash.addColorStop(1, "rgba(120,22,36,0)");
  ctx.fillStyle = moonWash;
  ctx.fillRect(0, 0, vw, vh);
  ctx.globalCompositeOperation = "source-over";

  // --- 漂う霧(地表より手前、エンティティより奥) ---
  ctx.globalCompositeOperation = "lighter";
  for (const m of MIST) {
    const spanX = vw + m.r * 2;
    const spanY = vh + m.r * 2;
    const mx = (((m.bx - camX * 0.55 + world.t * m.drift) % spanX) + spanX) % spanX - m.r;
    const my = (((m.by - camY * 0.55) % spanY) + spanY) % spanY - m.r;
    const g = ctx.createRadialGradient(mx, my, 1, mx, my, m.r);
    g.addColorStop(0, `rgba(${m.hue},0.06)`);
    g.addColorStop(1, `rgba(${m.hue},0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(mx, my, m.r, 0, TAU);
    ctx.fill();
  }
  ctx.globalCompositeOperation = "source-over";
}

/** 地表: 大型ランドマーク(枯木/霊廟/崩れ門)・墓地の小物・漂う鬼火。カメラ追従で決定的に散布。 */
function drawTerrain(v: View): void {
  const { ctx, vw, vh, world, camX, camY } = v;
  // 大型ランドマーク(粗いグリッドで疎らに。枯れ木/霊廟/崩れ門。影を落として地に立たせる)
  const LCELL = 384;
  const lx0 = Math.floor(camX / LCELL) - 1;
  const ly0 = Math.floor(camY / LCELL) - 1;
  const lx1 = Math.floor((camX + vw) / LCELL) + 1;
  const ly1 = Math.floor((camY + vh) / LCELL) + 1;
  for (let cy = ly0; cy <= ly1; cy++) {
    for (let cx = lx0; cx <= lx1; cx++) {
      const h = hash2(cx * 31 + 5, cy * 17 + 9);
      if (h >= 0.34) continue; // 約3分の1のセルにだけ立てる
      const ox = (hash2(cx + 7, cy + 3) - 0.5) * LCELL * 0.6;
      const oy = (hash2(cx + 3, cy + 7) - 0.5) * LCELL * 0.6;
      const gx = cx * LCELL - camX + LCELL / 2 + ox;
      const gy = cy * LCELL - camY + LCELL / 2 + oy;
      const kind = h < 0.13 ? 0 : h < 0.24 ? 1 : 2;
      // 地に落ちる柔らかな影
      ctx.fillStyle = "rgba(0,0,0,0.34)";
      ctx.beginPath();
      ctx.ellipse(gx, gy + 40, 42, 13, 0, 0, TAU);
      ctx.fill();
      const spr = landmarkSprite(kind);
      ctx.drawImage(spr, gx - spr.width / 2, gy - spr.height / 2);
    }
  }

  // 地表の小物(カメラ追従、セル単位で決定的に散布。種類を増やして墓地らしく)
  const CELL = 128;
  const x0 = Math.floor(camX / CELL) - 1;
  const y0 = Math.floor(camY / CELL) - 1;
  const x1 = Math.floor((camX + vw) / CELL) + 1;
  const y1 = Math.floor((camY + vh) / CELL) + 1;
  for (let cy = y0; cy <= y1; cy++) {
    for (let cx = x0; cx <= x1; cx++) {
      const px = cx * CELL - camX;
      const py = cy * CELL - camY;
      const h = hash2(cx, cy);
      if (h < 0.5) {
        // 0墓石 1枯草 2骨 3十字架 4瓦礫 5灯火(灯火は稀)
        const kind = h < 0.12 ? 0 : h < 0.24 ? 3 : h < 0.34 ? 1 : h < 0.44 ? 2 : h < 0.485 ? 4 : 5;
        const ox = (hash2(cx + 999, cy) - 0.5) * CELL * 0.7;
        const oy = (hash2(cx, cy + 999) - 0.5) * CELL * 0.7;
        const spr = decoSprite(kind);
        ctx.drawImage(spr, px + ox + CELL / 2 - spr.width / 2, py + oy + CELL / 2 - spr.height / 2);
      }
    }
  }

  // 漂う鬼火(地表より手前・加算で淡く灯る)
  ctx.globalCompositeOperation = "lighter";
  for (const wsp of WISPS) {
    const spanX = 2600;
    const spanY = 2000;
    const baseX = (((wsp.bx - camX + world.t * wsp.drift) % spanX) + spanX) % spanX - spanX / 2 + vw / 2;
    const baseY = (((wsp.by - camY) % spanY) + spanY) % spanY - spanY / 2 + vh / 2;
    const wxp = baseX + Math.sin(world.t * 0.7 + wsp.bx) * wsp.amp;
    const wyp = baseY + Math.cos(world.t * 0.5 + wsp.by) * wsp.amp * 0.6;
    const tw = 0.5 + 0.5 * Math.sin(world.t * 1.6 + wsp.bx);
    const wr = 5 + tw * 4;
    const g = ctx.createRadialGradient(wxp, wyp, 0.5, wxp, wyp, wr * 3);
    g.addColorStop(0, `rgba(${wsp.hue},${0.14 + 0.12 * tw})`);
    g.addColorStop(1, `rgba(${wsp.hue},0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(wxp, wyp, wr * 3, 0, TAU);
    ctx.fill();
  }
  ctx.globalCompositeOperation = "source-over";
}

/** 聖域の境界: 円外を一段深い闇に沈め、緋く脈打つ結界リングを描く。 */
function drawArena(v: View): void {
  const { ctx, vw, vh, world, wx, wy } = v;
  const bx = wx(0);
  const by = wy(0);
  // 境界の外は一段深い闇に沈める
  ctx.save();
  ctx.beginPath();
  ctx.arc(bx, by, ARENA_RADIUS, 0, TAU);
  ctx.rect(vw + 400, -400, -(vw + 800), vh + 800); // 偶奇規則で「円の外側」を塗る
  ctx.fillStyle = "rgba(3,1,7,0.55)";
  ctx.fill("evenodd");
  ctx.restore();
  // 緋く脈打つ結界のリング
  const pulse = 0.6 + 0.4 * Math.sin(world.t * 1.6);
  ctx.lineWidth = 3;
  ctx.strokeStyle = `rgba(200,50,62,${0.3 + 0.2 * pulse})`;
  ctx.beginPath();
  ctx.arc(bx, by, ARENA_RADIUS, 0, TAU);
  ctx.stroke();
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(217,164,65,0.22)";
  ctx.beginPath();
  ctx.arc(bx, by, ARENA_RADIUS - 6, 0, TAU);
  ctx.stroke();
}

/**
 * 雰囲気レイヤー(光と闇)。ここから上は「世界」、下は「夜気」。
 * 自機のランタンを光源とする闇(夜啼きで visionScale<1 なら灯が狭まる)・芯の暖光・血月・
 * 舞う微塵・四隅の沈み・瘴気デバフの緑・被弾の緋いフラッシュを重ねて没入を作る。
 */
function drawAtmosphere(v: View): void {
  const { ctx, vw, vh, world, camX, camY, wx, wy } = v;
  const p = world.player;
  // --- プレイヤーのランタンを光源とする闇 ---
  //   visionScale<1 のとき(夜啼く女王の夜啼き)は灯が狭まり、周縁がより深い闇に沈む。
  const lx = wx(p.x);
  const ly = wy(p.y);
  const flicker = 1 + Math.sin(world.t * 9) * 0.015 + Math.sin(world.t * 23) * 0.008;
  const vis = world.visionScale ?? 1;
  const lightR = Math.min(vw, vh) * 0.66 * flicker * vis;
  const constrict = 1 - vis; // 0=通常 〜 0.42=最大制限
  const dark = ctx.createRadialGradient(lx, ly, lightR * 0.34, lx, ly, lightR);
  dark.addColorStop(0, "rgba(4,2,9,0)");
  dark.addColorStop(0.7, `rgba(4,2,9,${0.32 + constrict * 0.5})`);
  dark.addColorStop(1, `rgba(2,1,5,${0.62 + constrict * 0.85})`);
  ctx.fillStyle = dark;
  ctx.fillRect(0, 0, vw, vh);

  // 温かいランタンの芯光(加算)
  ctx.globalCompositeOperation = "lighter";
  const warm = ctx.createRadialGradient(lx, ly, 2, lx, ly, 140 * flicker);
  warm.addColorStop(0, "rgba(255,214,140,0.16)");
  warm.addColorStop(0.5, "rgba(217,164,65,0.06)");
  warm.addColorStop(1, "rgba(217,164,65,0)");
  ctx.fillStyle = warm;
  ctx.beginPath();
  ctx.arc(lx, ly, 140 * flicker, 0, TAU);
  ctx.fill();
  ctx.globalCompositeOperation = "source-over";

  // --- 血月(天体・固定位置・コロナ付き) ---
  {
    const mx = vw - 124;
    const my = 112;
    const pulse = 1 + Math.sin(world.t * 0.7) * 0.04;
    // コロナ
    ctx.globalCompositeOperation = "lighter";
    const corona = ctx.createRadialGradient(mx, my, 8, mx, my, 240 * pulse);
    corona.addColorStop(0, "rgba(200,50,62,0.20)");
    corona.addColorStop(0.35, "rgba(170,40,55,0.07)");
    corona.addColorStop(1, "rgba(170,40,55,0)");
    ctx.fillStyle = corona;
    ctx.beginPath();
    ctx.arc(mx, my, 240 * pulse, 0, TAU);
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";
    // 月本体
    const disc = ctx.createRadialGradient(mx - 10, my - 10, 4, mx, my, 42);
    disc.addColorStop(0, "#e87681");
    disc.addColorStop(0.6, "#c8323e");
    disc.addColorStop(1, "#8f2230");
    ctx.fillStyle = disc;
    ctx.beginPath();
    ctx.arc(mx, my, 40, 0, TAU);
    ctx.fill();
    // 海(模様)
    ctx.fillStyle = "rgba(90,20,30,0.4)";
    ctx.beginPath();
    ctx.arc(mx - 12, my - 6, 8, 0, TAU);
    ctx.arc(mx + 10, my + 9, 11, 0, TAU);
    ctx.arc(mx + 4, my - 14, 5, 0, TAU);
    ctx.fill();
    // 欠け(三日月の影)
    ctx.fillStyle = "#070410";
    ctx.beginPath();
    ctx.arc(mx - 17, my - 13, 36, 0, TAU);
    ctx.fill();
  }

  // --- 周縁の微塵(ランタンに舞う塵・加算) ---
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < 40; i++) {
    const seedx = hash2(i + 1, 5);
    const seedy = hash2(7, i + 3);
    const speed = 6 + seedx * 10;
    const dx = ((seedx * vw - camX * 0.2) % vw + vw) % vw;
    const dy = (((seedy * vh - world.t * speed) % vh) + vh) % vh;
    const tw = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(world.t * 2 + i));
    // 光源に近いほど明るい
    const dist = Math.hypot(dx - lx, dy - ly);
    const near = Math.max(0, 1 - dist / (lightR * 0.9));
    const a = 0.05 + 0.18 * tw * near;
    ctx.fillStyle = i % 3 === 0 ? `rgba(217,164,65,${a})` : `rgba(232,220,195,${a})`;
    ctx.beginPath();
    ctx.arc(dx, dy, 0.7 + tw * 1.1, 0, TAU);
    ctx.fill();
  }
  ctx.globalCompositeOperation = "source-over";

  // --- 縁の重さ(画面四隅をわずかに沈める) ---
  const edge = ctx.createRadialGradient(vw / 2, vh / 2, Math.min(vw, vh) * 0.55, vw / 2, vh / 2, Math.max(vw, vh) * 0.78);
  edge.addColorStop(0, "rgba(7,4,16,0)");
  edge.addColorStop(1, "rgba(3,1,7,0.5)");
  ctx.fillStyle = edge;
  ctx.fillRect(0, 0, vw, vh);

  // --- 瘴気の鈍足デバフ(画面四隅に毒の緑が滲む) ---
  if ((world.playerSlow ?? 0) > 0) {
    const a = Math.min(1, world.playerSlow / 0.5);
    const poison = ctx.createRadialGradient(vw / 2, vh / 2, Math.min(vw, vh) * 0.4, vw / 2, vh / 2, Math.max(vw, vh) * 0.72);
    poison.addColorStop(0, "rgba(90,140,50,0)");
    poison.addColorStop(1, `rgba(110,170,60,${a * 0.32})`);
    ctx.fillStyle = poison;
    ctx.fillRect(0, 0, vw, vh);
  }

  // --- 被弾フラッシュ(緋い明滅・最前面) ---
  if (world.flash > 0) {
    ctx.globalCompositeOperation = "lighter";
    const f = ctx.createRadialGradient(lx, ly, 40, lx, ly, Math.max(vw, vh) * 0.7);
    f.addColorStop(0, `rgba(200,50,62,${world.flash * 0.1})`);
    f.addColorStop(1, `rgba(255,60,75,${world.flash * 0.5})`);
    ctx.fillStyle = f;
    ctx.fillRect(0, 0, vw, vh);
    ctx.globalCompositeOperation = "source-over";
  }
}

/** 構えの間: 再開前のカウントダウン(暗幕＋細るリング＋「構えよ」)。 */
function drawGrace(v: View): void {
  const { ctx, vw, vh, world } = v;
  if (!(world.grace > 0 && world.graceMax > 0)) return;
  ctx.fillStyle = "rgba(6,3,12,0.45)";
  ctx.fillRect(0, 0, vw, vh);
  const cxp = vw / 2;
  const cyp = vh / 2;
  const n = Math.ceil(world.grace);
  const frac = world.grace / world.graceMax;
  // 細るリング
  ctx.lineWidth = 4;
  ctx.strokeStyle = "rgba(232,220,195,0.18)";
  ctx.beginPath();
  ctx.arc(cxp, cyp - 6, 54, 0, TAU);
  ctx.stroke();
  ctx.strokeStyle = "rgba(200,50,62,0.9)";
  ctx.beginPath();
  ctx.arc(cxp, cyp - 6, 54, -Math.PI / 2, -Math.PI / 2 + TAU * frac);
  ctx.stroke();
  ctx.fillStyle = "#e8dcc3";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = '600 52px "IBM Plex Mono", monospace';
  ctx.fillText(String(n), cxp, cyp - 4);
  ctx.font = '600 15px "Shippori Mincho", serif';
  ctx.fillStyle = "rgba(232,220,195,0.7)";
  ctx.fillText("構 え よ", cxp, cyp + 54);
}

/** 薫香オーラ: 自機を囲む緑の放射グラデ＋破線リング。 */
function drawAura(v: View): void {
  const { ctx, world, wx, wy } = v;
  const p = world.player;
  if (world.auraR > 0) {
    const ar = world.auraR;
    const g = ctx.createRadialGradient(wx(p.x), wy(p.y), ar * 0.4, wx(p.x), wy(p.y), ar);
    g.addColorStop(0, "rgba(123,224,138,0.04)");
    g.addColorStop(0.85, "rgba(123,224,138,0.12)");
    g.addColorStop(1, "rgba(123,224,138,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(wx(p.x), wy(p.y), ar, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = "rgba(123,224,138,0.28)";
    ctx.setLineDash([6, 8]);
    ctx.lineDashOffset = -world.t * 24;
    ctx.beginPath();
    ctx.arc(wx(p.x), wy(p.y), ar, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

/** 経験石・ピックアップ(石は加算合成で淡く灯る)。 */
function drawGemsAndPickups(v: View): void {
  const { ctx, world, wx, wy } = v;
  ctx.globalCompositeOperation = "lighter";
  for (const g of world.gems) {
    const spr = gemSprite(g.big);
    const bob = Math.sin(world.t * 5 + g.x * 0.05) * 2;
    ctx.drawImage(spr, wx(g.x) - spr.width / 2, wy(g.y) - spr.height / 2 + bob);
  }
  ctx.globalCompositeOperation = "source-over";
  for (const pk of world.pickups) {
    const bob = Math.sin(world.t * 4 + pk.x * 0.03) * 3;
    if (pk.kind === "curio") {
      // 遺物: 種ごとの色で脈打つ光輪+菱の核。稀少さが伝わるよう少し豪奢に。
      const col = CURIOS_BY_ID[pk.curioId ?? ""]?.color ?? "#ffe28a";
      const cx2 = wx(pk.x);
      const cy2 = wy(pk.y) + bob;
      const pulse = 0.7 + 0.3 * Math.sin(world.t * 3 + pk.x * 0.05);
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const halo = ctx.createRadialGradient(cx2, cy2, 1, cx2, cy2, 26 * pulse);
      halo.addColorStop(0, "rgba(255,255,255,0.5)");
      halo.addColorStop(0.4, col);
      halo.addColorStop(1, "rgba(0,0,0,0)");
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(cx2, cy2, 26 * pulse, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      // 菱の核
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.moveTo(cx2, cy2 - 8);
      ctx.lineTo(cx2 + 6, cy2);
      ctx.lineTo(cx2, cy2 + 8);
      ctx.lineTo(cx2 - 6, cy2);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
      continue;
    }
    const spr = pickupSprite(pk.kind);
    ctx.drawImage(spr, wx(pk.x) - spr.width / 2, wy(pk.y) - spr.height / 2 + bob);
  }
}

/** ボス固有能力のオーラ(敵スプライトの下に敷く)。 */
function drawBossAuras(v: View): void {
  const { ctx, world, wx, wy } = v;
  if (world.boss) {
    const b = world.boss;
    const bdef = BOSSES_BY_ID[b.bossType ?? ""];
    const bx = wx(b.x);
    const by = wy(b.y);
    if (bdef?.ability === "miasma") {
      // 瘴気の雲(engine の miasmaR = radius+160 と一致): 圏内で鈍足+継続ダメージ
      const mr = b.radius + 160;
      ctx.globalCompositeOperation = "lighter";
      const pulse = 0.08 + 0.04 * Math.sin(world.t * 2);
      const cloud = ctx.createRadialGradient(bx, by, mr * 0.2, bx, by, mr);
      cloud.addColorStop(0, `rgba(120,180,70,${pulse + 0.05})`);
      cloud.addColorStop(0.7, `rgba(100,150,60,${pulse})`);
      cloud.addColorStop(1, "rgba(80,120,50,0)");
      ctx.fillStyle = cloud;
      ctx.beginPath();
      ctx.arc(bx, by, mr, 0, TAU);
      ctx.fill();
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = `rgba(150,200,90,${0.28 + 0.15 * Math.sin(world.t * 3)})`;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 8]);
      ctx.lineDashOffset = -world.t * 14;
      ctx.beginPath();
      ctx.arc(bx, by, mr * 0.96, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
    } else if (bdef?.ability === "rally" && world.bossRally) {
      // 鼓舞の輪(engine の RALLY_RADIUS = 340 と一致): 圏内の雑魚を加速させる
      const rr = 340;
      ctx.globalCompositeOperation = "lighter";
      const g = ctx.createRadialGradient(bx, by, rr * 0.55, bx, by, rr);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(1, `rgba(255,130,55,${0.05 + 0.03 * Math.sin(world.t * 5)})`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(bx, by, rr, 0, TAU);
      ctx.fill();
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = `rgba(255,140,60,${0.3 + 0.18 * Math.sin(world.t * 5)})`;
      ctx.lineWidth = 2;
      ctx.setLineDash([10, 10]);
      ctx.lineDashOffset = world.t * 26;
      ctx.beginPath();
      ctx.arc(bx, by, rr, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}

/** 敵スプライト: 影だまり・変種オーラ・本体・HPリング。 */
function drawEnemies(v: View): void {
  const { ctx, vw, vh, world, wx, wy } = v;
  const p = world.player;
  for (const e of world.enemies) {
    const ex = wx(e.x);
    const ey = wy(e.y);
    if (ex < -80 || ex > vw + 80 || ey < -80 || ey > vh + 80) continue;
    const spr = enemySprite(e.kind, e.variant, e.bossType);
    const bob = Math.sin(world.t * 7 + e.wobble) * (e.kind === "bat" || e.kind === "wraith" ? 3.2 : 1.2);
    // 影だまり
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath();
    ctx.ellipse(ex, ey + e.radius * 0.9, e.radius * 0.85, e.radius * 0.32, 0, 0, TAU);
    ctx.fill();

    // 変種(大型/色違い)の徽章リング ── 大型=琥珀(加速), 色違い=紫(硬化)
    if (e.variant !== "normal") {
      const auraColor = e.variant === "large" ? "rgba(255,196,90," : "rgba(176,120,255,";
      ctx.globalCompositeOperation = "lighter";
      const ring = ctx.createRadialGradient(ex, ey, e.radius * 0.6, ex, ey, e.radius * 1.5);
      ring.addColorStop(0, "rgba(0,0,0,0)");
      ring.addColorStop(0.7, `${auraColor}${0.05 + 0.05 * Math.sin(world.t * 4 + e.wobble)})`);
      ring.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = ring;
      ctx.beginPath();
      ctx.arc(ex, ey, e.radius * 1.5, 0, TAU);
      ctx.fill();
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = `${auraColor}${0.45 + 0.2 * Math.sin(world.t * 4 + e.wobble)})`;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 5]);
      ctx.lineDashOffset = -world.t * 18;
      ctx.beginPath();
      ctx.arc(ex, ey, e.radius * 1.32, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    const flip = e.x > p.x ? -1 : 1;
    ctx.save();
    ctx.translate(ex, ey + bob);
    ctx.scale(flip, 1);
    if (e.hitFlash > 0) {
      ctx.globalAlpha = 1;
      ctx.filter = "brightness(2.6) saturate(0.3)";
    }
    ctx.drawImage(spr, -spr.width / 2, -spr.height / 2);
    ctx.filter = "none";
    ctx.restore();

    // 変種・エリート・ボスのHPリング(ボスは個体の主色)
    if (e.kind === "elite" || e.kind === "boss" || e.variant !== "normal") {
      ctx.strokeStyle =
        e.kind === "boss" ? BOSSES_BY_ID[e.bossType ?? ""]?.color ?? "#ff3d54"
          : e.kind === "elite" ? "#ffe28a" : e.variant === "large" ? "#ffc45a" : "#b078ff";
      ctx.lineWidth = e.kind === "boss" || e.kind === "elite" ? 3 : 2;
      ctx.beginPath();
      ctx.arc(ex, ey, e.radius + 7, -Math.PI / 2, -Math.PI / 2 + TAU * (e.hp / e.maxHp));
      ctx.stroke();
    }
  }
}

/** 自機スプライト: 影・本体(点滅)・足元HPバー。 */
function drawPlayer(v: View): void {
  const { ctx, world, wx, wy } = v;
  const p = world.player;
  const skin = SKINS_BY_ID[world.skinId] ?? SKINS_BY_ID[DEFAULT_SKIN];
  const spr = playerSprite(skin);
  const bob = p.moving ? Math.abs(Math.sin(p.anim * 11)) * 3 : Math.sin(world.t * 2.4) * 1.2;
  const flip = p.dirX < 0 ? -1 : 1;
  // 影
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.beginPath();
  ctx.ellipse(wx(p.x), wy(p.y) + 18, 13, 5, 0, 0, TAU);
  ctx.fill();
  ctx.save();
  ctx.translate(wx(p.x), wy(p.y) - bob);
  ctx.scale(flip, 1);
  if (p.invuln > 0 && Math.floor(world.t * 18) % 2 === 0) ctx.globalAlpha = 0.4;
  ctx.drawImage(spr, -spr.width / 2, -spr.height / 2);
  ctx.restore();
  // 足元のHPバー
  const bw = 34;
  const ratio = Math.max(0, p.hp / p.maxHp);
  ctx.fillStyle = "rgba(10,6,18,0.8)";
  ctx.fillRect(wx(p.x) - bw / 2, wy(p.y) + 24, bw, 5);
  ctx.fillStyle = ratio > 0.35 ? "#c8323e" : "#ff4d5a";
  ctx.fillRect(wx(p.x) - bw / 2 + 1, wy(p.y) + 25, (bw - 2) * ratio, 3);
}

/** 投射物(発光体は加算合成 + 滲み)と宝珠の鎖。 */
function drawProjectiles(v: View): void {
  const { ctx, world, wx, wy } = v;
  const p = world.player;
  for (const pr of world.projectiles) {
    const px = wx(pr.x);
    const py = wy(pr.y);
    ctx.save();
    ctx.translate(px, py);
    switch (pr.kind) {
      case "bolt": {
        ctx.rotate(pr.angle);
        ctx.globalCompositeOperation = "lighter";
        const g = ctx.createRadialGradient(0, 0, 1, 0, 0, 13);
        g.addColorStop(0, "#efe7ff");
        g.addColorStop(0.4, "#9d7bff");
        g.addColorStop(1, "rgba(157,123,255,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, 0, 13, 0, TAU);
        ctx.fill();
        ctx.fillStyle = "rgba(205,188,255,0.9)";
        ctx.beginPath();
        ctx.ellipse(-7, 0, 11, 3, 0, 0, TAU); // 尾
        ctx.fill();
        break;
      }
      case "knife": {
        ctx.rotate(pr.angle);
        ctx.fillStyle = "#cfd8e6";
        ctx.beginPath();
        ctx.moveTo(9, 0);
        ctx.lineTo(-5, -2.6);
        ctx.lineTo(-7, 0);
        ctx.lineTo(-5, 2.6);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "#6b5a8c";
        ctx.fillRect(-9, -1.4, 4, 2.8);
        ctx.globalCompositeOperation = "lighter"; // 刃の煌めき
        ctx.fillStyle = "rgba(220,230,255,0.5)";
        ctx.beginPath();
        ctx.arc(4, 0, 3, 0, TAU);
        ctx.fill();
        break;
      }
      case "boomerang": {
        // 飛行方向(楕円の接線方向)を向くよう回転させる。
        // 位相 angle から接線角: dx/dθ = -boomA*sin(θ), dy/dθ = boomB*cos(θ)
        const ba = pr.boomA ?? 120;
        const bb = pr.boomB ?? 200;
        const tx = -ba * Math.sin(pr.angle);
        const ty = bb * Math.cos(pr.angle);
        ctx.rotate(Math.atan2(ty, tx));
        // 本体: 弓なりの帰刃(ブーメラン型)
        ctx.globalCompositeOperation = "lighter";
        const glow = ctx.createRadialGradient(0, 0, 1, 0, 0, pr.radius + 8);
        glow.addColorStop(0, "rgba(255,220,140,0.6)");
        glow.addColorStop(1, "rgba(255,180,80,0)");
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(0, 0, pr.radius + 8, 0, TAU);
        ctx.fill();
        ctx.globalCompositeOperation = "source-over";
        // 帰刃の翼形(左右対称の三日月)
        ctx.fillStyle = "#c8903a";
        ctx.beginPath();
        ctx.moveTo(pr.radius, 0);
        ctx.quadraticCurveTo(0, -pr.radius * 0.7, -pr.radius, 0);
        ctx.quadraticCurveTo(0, pr.radius * 0.35, pr.radius, 0);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "rgba(255,230,160,0.85)";
        ctx.beginPath();
        ctx.moveTo(pr.radius * 0.7, 0);
        ctx.quadraticCurveTo(0, -pr.radius * 0.4, -pr.radius * 0.7, 0);
        ctx.quadraticCurveTo(0, pr.radius * 0.18, pr.radius * 0.7, 0);
        ctx.closePath();
        ctx.fill();
        break;
      }
      case "orb": {
        ctx.globalCompositeOperation = "lighter";
        const g = ctx.createRadialGradient(0, 0, 1, 0, 0, pr.radius + 6);
        g.addColorStop(0, "#eafaff");
        g.addColorStop(0.45, "#6fd3ff");
        g.addColorStop(1, "rgba(111,211,255,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, 0, pr.radius + 6, 0, TAU);
        ctx.fill();
        break;
      }
    }
    ctx.restore();
  }
  ctx.globalCompositeOperation = "source-over";

  // 宝珠の鎖(プレイヤーと結ぶ薄い線)
  for (const pr of world.projectiles) {
    if (pr.kind !== "orb") continue;
    ctx.strokeStyle = "rgba(111,211,255,0.16)";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(wx(p.x), wy(p.y));
    ctx.lineTo(wx(pr.x), wy(pr.y));
    ctx.stroke();
  }
}

/** 敵の呪弾(紫の凶弾・加算合成で禍々しく灯す)。 */
function drawEnemyShots(v: View): void {
  const { ctx, world, wx, wy } = v;
  ctx.globalCompositeOperation = "lighter";
  for (const s of world.enemyShots) {
    const sx2 = wx(s.x);
    const sy2 = wy(s.y);
    // 尾
    const tlen = 16;
    const tn = Math.hypot(s.vx, s.vy) || 1;
    const tg = ctx.createLinearGradient(sx2, sy2, sx2 - (s.vx / tn) * tlen, sy2 - (s.vy / tn) * tlen);
    tg.addColorStop(0, "rgba(192,138,255,0.55)");
    tg.addColorStop(1, "rgba(192,138,255,0)");
    ctx.strokeStyle = tg;
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(sx2, sy2);
    ctx.lineTo(sx2 - (s.vx / tn) * tlen, sy2 - (s.vy / tn) * tlen);
    ctx.stroke();
    // 弾芯の滲み
    const g = ctx.createRadialGradient(sx2, sy2, 1, sx2, sy2, s.radius + 7);
    g.addColorStop(0, "#f3e9ff");
    g.addColorStop(0.4, "#b06be0");
    g.addColorStop(1, "rgba(176,107,224,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(sx2, sy2, s.radius + 7, 0, TAU);
    ctx.fill();
  }
  ctx.globalCompositeOperation = "source-over";
}

/** 雷(加算合成で白熱): 柱・グロー・着弾閃光。 */
function drawBolts(v: View): void {
  const { ctx, world, wx, wy } = v;
  ctx.globalCompositeOperation = "lighter";
  for (const b of world.bolts) {
    const bx = wx(b.x);
    const by = wy(b.y);
    const alpha = Math.min(1, b.life * 5);
    // 落雷の柱
    const pts: Array<[number, number]> = [[bx + Math.sin(b.seed) * 40, by - 320]];
    for (let i = 1; i <= 6; i++) {
      const t = i / 6;
      pts.push([bx + (1 - t) * Math.sin(b.seed + i * 7.3) * 34, by - 320 + 320 * t]);
    }
    // 外側のグロー
    ctx.strokeStyle = `rgba(255,217,94,${alpha * 0.4})`;
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.stroke();
    // 芯
    ctx.strokeStyle = `rgba(255,247,214,${alpha})`;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.stroke();
    // 着弾の閃光
    const fg = ctx.createRadialGradient(bx, by, 1, bx, by, 22 * (1 - b.life) + 8);
    fg.addColorStop(0, `rgba(255,247,214,${alpha * 0.9})`);
    fg.addColorStop(1, "rgba(255,217,94,0)");
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.arc(bx, by, 22 * (1 - b.life) + 8, 0, TAU);
    ctx.fill();
  }
  ctx.globalCompositeOperation = "source-over";
}

/** パーティクル(加算合成で発光)。 */
function drawParticles(v: View): void {
  const { ctx, world, wx, wy } = v;
  ctx.globalCompositeOperation = "lighter";
  for (const pa of world.particles) {
    const a = pa.life / pa.maxLife;
    ctx.globalAlpha = a;
    ctx.fillStyle = pa.color;
    ctx.beginPath();
    ctx.arc(wx(pa.x), wy(pa.y), pa.size * (0.4 + a * 0.6), 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
}

/** ダメージ数字(settings.damageNumbers が有効な場合のみ描画)。 */
function drawTexts(v: View, settings: Settings): void {
  const { ctx, world, wx, wy } = v;
  if (settings.damageNumbers) {
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const tx of world.texts) {
      const a = Math.min(1, tx.life * 3);
      ctx.globalAlpha = a;
      ctx.font = `600 ${tx.size}px "IBM Plex Mono", monospace`;
      ctx.fillStyle = "rgba(10,6,18,0.9)";
      ctx.fillText(tx.text, wx(tx.x) + 1.5, wy(tx.y) + 1.5);
      ctx.fillStyle = tx.color;
      ctx.fillText(tx.text, wx(tx.x), wy(tx.y));
    }
    ctx.globalAlpha = 1;
  }
}

/**
 * World を読んで 1 フレームを Canvas2D に描く中心関数(状態は読むだけ・変更しない)。
 * カメラは自機中心(camX/camY)。描く順序は奥→手前:
 *   背景/血月の帯 → 地形装飾・ランドマーク → 聖域境界 → 薫香オーラ → 経験石・道具 →
 *   ボス能力オーラ → 敵 → 自機 → 投射物 → 敵弾 → 雷 → 粒子 → ダメージ数字 →
 *   〔光と闇〕ランタン光/血月/微塵/被弾フラッシュ → 画面外マーカー → ミニマップ → 構え表示。
 * 重い図形は makeSprite でキャッシュ済みのものを drawImage する。
 */
export function renderWorld(
  ctx: CanvasRenderingContext2D,
  vw: number,
  vh: number,
  world: World,
  settings: Settings,
  dpr: number,
): void {
  const p = world.player;
  ctx.save();
  ctx.scale(dpr, dpr);

  // 画面シェイク
  let sx = 0;
  let sy = 0;
  if (settings.screenShake && world.shake > 0) {
    sx = (Math.random() - 0.5) * world.shake * 14;
    sy = (Math.random() - 0.5) * world.shake * 14;
  }
  const camX = p.x - vw / 2 + sx;
  const camY = p.y - vh / 2 + sy;
  const wx = (x: number) => x - camX;
  const wy = (y: number) => y - camY;
  const v: View = { ctx, vw, vh, world, camX, camY, wx, wy };

  drawBackdrop(v); // 背景・血月の帯・霧
  drawTerrain(v); // ランドマーク・地表の小物・鬼火
  drawArena(v); // 聖域の境界(結界リング)

  drawAura(v);           // 薫香オーラ
  drawGemsAndPickups(v); // 経験石・ピックアップ
  drawBossAuras(v);      // ボス固有能力のオーラ
  drawEnemies(v);        // 敵スプライト
  drawPlayer(v);         // 自機
  drawProjectiles(v);    // 投射物
  drawEnemyShots(v);     // 敵の呪弾
  drawBolts(v);          // 雷
  drawParticles(v);      // パーティクル
  drawTexts(v, settings); // ダメージ数字

  // --- 雰囲気(光と闇): ランタン光・血月・微塵・縁・瘴気・被弾フラッシュ ---
  drawAtmosphere(v);

  // --- 特異種の画面外マーカー(視界外にいる間も存在を知らせる) ---
  drawVariantMarkers(ctx, vw, vh, world, camX, camY);

  // --- ミニマップ(聖域内の自分と敵の位置) ---
  drawMinimap(ctx, vw, vh, world);

  // --- 再開カウントダウン(構えの間) ---
  drawGrace(v);

  ctx.restore();
}

// 特異種(大型/色違い)が視界の外にいる間、画面の縁に矢羽根を出して位置と接近を知らせる。
// 大型=琥珀(加速オーラ), 色違い=紫(硬化オーラ)で、本体のオーラリングと色を揃える。
function drawVariantMarkers(
  ctx: CanvasRenderingContext2D,
  vw: number,
  vh: number,
  world: World,
  camX: number,
  camY: number,
): void {
  const cx = vw / 2;
  const cy = vh / 2;
  const inset = 48; // 画面端からの差し込み量
  const halfW = vw / 2 - inset;
  const halfH = vh / 2 - inset;

  for (const e of world.enemies) {
    if (e.variant === "normal") continue;
    const ex = e.x - camX;
    const ey = e.y - camY;
    // 画面内にいるときは本体のオーラリングが知らせるので、ここでは出さない
    const margin = e.radius + 8;
    if (ex >= -margin && ex <= vw + margin && ey >= -margin && ey <= vh + margin) continue;

    let dx = ex - cx;
    let dy = ey - cy;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    // 中心から伸ばした方向を、内側の矩形の縁に交差させてマーカー位置にする
    const scale = Math.min(halfW / (Math.abs(dx) || 1e-6), halfH / (Math.abs(dy) || 1e-6));
    const mx = cx + dx * scale;
    const my = cy + dy * scale;
    const col = e.variant === "large" ? "255,196,90" : "176,120,255";
    const pulse = 0.6 + 0.4 * Math.sin(world.t * 6 + e.wobble);

    ctx.save();
    ctx.translate(mx, my);
    // にじむグロー
    ctx.globalCompositeOperation = "lighter";
    const g = ctx.createRadialGradient(0, 0, 1, 0, 0, 24);
    g.addColorStop(0, `rgba(${col},${0.22 * pulse})`);
    g.addColorStop(1, `rgba(${col},0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, 24, 0, TAU);
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";
    // 外向きの矢羽根
    ctx.rotate(Math.atan2(dy, dx));
    ctx.fillStyle = `rgba(${col},${0.7 + 0.25 * pulse})`;
    ctx.strokeStyle = "rgba(8,5,16,0.7)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(14, 0);
    ctx.lineTo(0, -8);
    ctx.lineTo(0, 8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

// ミニマップ: 画面右下に聖域全体を俯瞰し、自機・敵・エリート・ボス・道具を点で示す。
function drawMinimap(ctx: CanvasRenderingContext2D, vw: number, vh: number, world: World): void {
  const R = 76; // 半径(px)
  const pad = 18;
  const cx = vw - R - pad;
  const cy = vh - R - pad;
  const scale = R / ARENA_RADIUS;

  ctx.save();
  // ガラス調の円盤
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, TAU);
  ctx.fillStyle = "rgba(18,12,30,0.62)";
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "rgba(232,220,195,0.22)";
  ctx.stroke();
  // 上辺の鏡面ハイライト
  ctx.strokeStyle = "rgba(255,255,255,0.16)";
  ctx.beginPath();
  ctx.arc(cx, cy, R - 1, -Math.PI * 0.95, -Math.PI * 0.2);
  ctx.stroke();

  // 以降は円内にクリップ
  ctx.beginPath();
  ctx.arc(cx, cy, R - 2, 0, TAU);
  ctx.clip();

  const mapX = (x: number) => cx + x * scale;
  const mapY = (y: number) => cy + y * scale;

  // 敵(種別で色分け、小さく)
  for (const e of world.enemies) {
    if (e.kind === "boss" || e.kind === "elite" || e.variant !== "normal") continue; // 後で強調描画
    ctx.fillStyle = ENEMIES[e.kind].color;
    ctx.globalAlpha = 0.8;
    ctx.fillRect(mapX(e.x) - 1, mapY(e.y) - 1, 2, 2);
  }
  ctx.globalAlpha = 1;

  // 特異種(大型/色違い)は脈打つ色付きの点で強調する
  for (const e of world.enemies) {
    if (e.variant === "normal") continue;
    const col = e.variant === "large" ? "#ffc45a" : "#b078ff";
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(mapX(e.x), mapY(e.y), 2.6, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = col;
    ctx.globalAlpha = 0.5 + 0.3 * Math.sin(world.t * 5 + e.wobble);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(mapX(e.x), mapY(e.y), 4.6 + Math.sin(world.t * 5 + e.wobble) * 1.2, 0, TAU);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // 道具(遺物は金色で大きめに脈打たせ、見つけやすくする)
  for (const pk of world.pickups) {
    if (pk.kind === "curio") {
      const col = CURIOS_BY_ID[pk.curioId ?? ""]?.color ?? "#ffe28a";
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(mapX(pk.x), mapY(pk.y), 3, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = col;
      ctx.globalAlpha = 0.5 + 0.4 * Math.sin(world.t * 5);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(mapX(pk.x), mapY(pk.y), 5.5 + Math.sin(world.t * 5) * 1.5, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 1;
      continue;
    }
    ctx.fillStyle = pk.kind === "potion" ? "#5ee08a" : pk.kind === "loot" ? "#ffce6b" : "#9ad8ff";
    ctx.beginPath();
    ctx.arc(mapX(pk.x), mapY(pk.y), 2, 0, TAU);
    ctx.fill();
  }

  // エリート・ボスは強調
  for (const e of world.enemies) {
    if (e.kind === "elite") {
      ctx.fillStyle = "#ffe28a";
      ctx.beginPath();
      ctx.arc(mapX(e.x), mapY(e.y), 3, 0, TAU);
      ctx.fill();
    } else if (e.kind === "boss") {
      const bcol = BOSSES_BY_ID[e.bossType ?? ""]?.color ?? "#ff3d54";
      ctx.fillStyle = bcol;
      ctx.beginPath();
      ctx.arc(mapX(e.x), mapY(e.y), 4.5, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = bcol;
      ctx.globalAlpha = 0.6;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(mapX(e.x), mapY(e.y), 7 + Math.sin(world.t * 5) * 1.5, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  // 自機(月金の菱・脈動リング)
  const px = mapX(world.player.x);
  const py = mapY(world.player.y);
  ctx.strokeStyle = "rgba(217,164,65,0.5)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(px, py, 5 + Math.sin(world.t * 4) * 1.2, 0, TAU);
  ctx.stroke();
  ctx.fillStyle = "#ffe6a0";
  ctx.beginPath();
  ctx.moveTo(px, py - 4);
  ctx.lineTo(px + 3.4, py);
  ctx.lineTo(px, py + 4);
  ctx.lineTo(px - 3.4, py);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}
