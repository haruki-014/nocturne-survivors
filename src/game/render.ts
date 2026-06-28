// ═══════════════════════════════════════════════════════════
//  〔層〕主要機能 / CORE ── レンダラ(描画)
//
//  役割(マクロ): エンジンが持つ World(状態)を受け取り、Canvas2D に1フレーム
//    描く「目」の担当。状態は読むだけで書き換えない(ゲームを進めない)。
//    Renderer インターフェースを満たすので、将来 WebGL 等へ差し替え可能。
//  二層構成: 重い図形(敵・道具・地形)の“焼き込み”は [sprites.ts] に分離した。
//    ここ(render.ts)は毎フレームの「描画パス」に専念し、sprites.ts が焼いて
//    キャッシュした canvas を drawImage で貼るだけ(数百体でも 60fps)。
//  挙動(ミクロ): 各描画パスは共有の View(ctx/カメラ/座標変換 wx,wy)を1つ受け取る
//    drawXxx(v) 群。座標は wx()/wy() でワールド→画面へ。カメラはプレイヤー追従
//    +画面揺れ。発光体(魔弾/宝珠/雷/呪弾)は加算合成(lighter)で滲ませる。
//
//  描く順序(奥→手前): 背景/霧 → 地表装飾 → 聖域境界 → 薫香 → 経験石・道具 →
//    ボス予兆/衝波 → 敵 → 自機 → 投射物 → 敵弾 → 雷 → 粒子 → ダメージ数字 →
//    〔光と闇の層〕ランタン光/血月/微塵/被弾フラッシュ → 画面外マーカー →
//    ミニマップ → 構え表示。
//  UI への提供: 図鑑/祭壇/宝物庫が使う enemyPortrait()/skinPortrait() は sprites.ts
//    の実装をここから再エクスポートする(既存 import 元の窓口を不変に保つ)。
// ═══════════════════════════════════════════════════════════

import type { Renderer, Settings, World } from "./types";
import { ARENA_RADIUS, BOSSES_BY_ID, BOSS_WINDUP, CURIOS_BY_ID, DEFAULT_SKIN, ENEMIES, SKINS_BY_ID } from "./data";
import {
  TAU, shade, withAlpha, hash2, makeSprite,
  enemySprite, playerSprite, gemSprite, pickupSprite, decoSprite, landmarkSprite,
} from "./sprites";

// UI(図鑑/祭壇/宝物庫)向けのポートレートはスプライト生成層から再公開する。
export { enemyPortrait, skinPortrait } from "./sprites";

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
/**
 * ボス能力の予備動作(チャージ)。windup>0 の間、能力別の溜め演出をボス色で描く。
 * 進捗 prog = 1 - windup/BOSS_WINDUP(0:溜め始め → 1:発動直前)。状態は読むだけ。
 */
function drawBossTelegraph(v: View): void {
  const { ctx, world, wx, wy } = v;
  const b = world.boss;
  if (!b || b.windup <= 0) return;
  const def = BOSSES_BY_ID[b.bossType ?? ""];
  if (!def) return;
  const prog = Math.max(0, Math.min(1, 1 - b.windup / BOSS_WINDUP));
  const bx = wx(b.x);
  const by = wy(b.y);
  const col = def.color;
  const eye = def.eye;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";

  if (def.ability === "raise") {
    // 骸の王: プレイヤーを囲う6点(発動地点)に骨の警告マーカーを灯す
    const p = world.player;
    const n = 6;
    for (let i = 0; i < n; i++) {
      const ang = b.windAng + (i / n) * TAU;
      const mx = wx(p.x + Math.cos(ang) * 230);
      const my = wy(p.y + Math.sin(ang) * 230);
      const rr = 6 + prog * 16;
      ctx.strokeStyle = withAlpha(eye, 0.35 + 0.5 * prog);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(mx, my, rr, 0, TAU);
      ctx.stroke();
      // 十字の亀裂(蘇生の予兆)
      ctx.beginPath();
      ctx.moveTo(mx - rr, my); ctx.lineTo(mx + rr, my);
      ctx.moveTo(mx, my - rr); ctx.lineTo(mx, my + rr);
      ctx.stroke();
    }
    ctx.restore();
    return;
  }

  // ボス中心の溜め(swarm/miasma/wail/rally 共通の核 + 能力別の差し色)
  const coreCol = def.ability === "swarm" ? col : def.ability === "miasma" ? col : def.ability === "wail" ? eye : col;
  // 内核の発光(発動に向けて強まる)
  const coreR = b.radius * (0.6 + prog * 0.7);
  const cg = ctx.createRadialGradient(bx, by, 1, bx, by, coreR);
  cg.addColorStop(0, withAlpha(coreCol, 0.5 * prog + 0.1));
  cg.addColorStop(1, withAlpha(coreCol, 0));
  ctx.fillStyle = cg;
  ctx.beginPath();
  ctx.arc(bx, by, coreR, 0, TAU);
  ctx.fill();

  if (def.ability === "swarm" || def.ability === "wail") {
    // 吸血卿/女王: 外周から内へ収束する筋(血霧/紫光が集まる)
    const n = 10;
    const inR = b.radius * 1.1;
    const outR = b.radius * (3.2 - prog * 1.8); // 進行で内へ詰まる
    ctx.strokeStyle = withAlpha(coreCol, 0.25 + 0.5 * prog);
    ctx.lineWidth = 2;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + world.t * 1.5;
      ctx.beginPath();
      ctx.moveTo(bx + Math.cos(a) * outR, by + Math.sin(a) * outR);
      ctx.lineTo(bx + Math.cos(a) * inR, by + Math.sin(a) * inR);
      ctx.stroke();
    }
  } else if (def.ability === "miasma" || def.ability === "rally") {
    // 巨躯/使者: 発動半径を予告する膨張リング(踏み出して避ける合図)
    const ringR = b.radius * (1.2 + prog * 2.4);
    ctx.strokeStyle = withAlpha(coreCol, 0.3 + 0.45 * prog);
    ctx.lineWidth = 2 + prog * 2;
    ctx.setLineDash([8, 10]);
    ctx.lineDashOffset = -world.t * 20;
    ctx.beginPath();
    ctx.arc(bx, by, ringR, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();
}

/** ボスの衝波(拡大リング)。色付きの輪＋淡い内側グラデ。damage 有無に依らず同じ意匠。 */
function drawShockwaves(v: View): void {
  const { ctx, world, wx, wy } = v;
  for (const s of world.shockwaves) {
    const cx = wx(s.x);
    const cy = wy(s.y);
    const fade = s.r >= s.maxR ? Math.max(0, s.life / 0.45) : 1; // 終端後はフェード
    const grow = Math.min(1, s.r / Math.max(1, s.maxR));
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    // 環の前縁(明るい筋)
    ctx.strokeStyle = withAlpha(s.color, 0.5 * fade);
    ctx.lineWidth = s.width * (1.1 - 0.5 * grow);
    ctx.beginPath();
    ctx.arc(cx, cy, s.r, 0, TAU);
    ctx.stroke();
    // 内側へ向かう淡いグラデ(衝波の厚み)
    const g = ctx.createRadialGradient(cx, cy, Math.max(1, s.r - s.width * 2), cx, cy, s.r);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, withAlpha(s.color, 0.18 * fade));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, s.r, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
}

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
  // 秘伝の担い手: 装いの専用技を所持中なら、足元に主色の脈打つ光環を敷く(特別感)
  if (world.sigWield) {
    const sc = world.sigColor;
    const pulse = 0.5 + 0.5 * Math.sin(world.t * 3);
    const rr = 26 + pulse * 4;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const halo = ctx.createRadialGradient(wx(p.x), wy(p.y) + 6, 2, wx(p.x), wy(p.y) + 6, rr);
    halo.addColorStop(0, withAlpha(sc, 0.22 + 0.12 * pulse));
    halo.addColorStop(1, withAlpha(sc, 0));
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.ellipse(wx(p.x), wy(p.y) + 8, rr, rr * 0.5, 0, 0, TAU);
    ctx.fill();
    // 主色の薄い輪(秘伝の刻印)
    ctx.strokeStyle = withAlpha(sc, 0.3 + 0.2 * pulse);
    ctx.lineWidth = 1.4;
    ctx.setLineDash([5, 7]);
    ctx.lineDashOffset = -world.t * 16;
    ctx.beginPath();
    ctx.ellipse(wx(p.x), wy(p.y) + 8, rr * 0.78, rr * 0.4, 0, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }
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
        // 固有技(黄金の聖句)は主色で、基底は紫の魔弾で灯す
        const core = pr.color ? shade(pr.color, 0.7) : "#efe7ff";
        const mid = pr.color ?? "#9d7bff";
        const g = ctx.createRadialGradient(0, 0, 1, 0, 0, 13);
        g.addColorStop(0, core);
        g.addColorStop(0.4, mid);
        g.addColorStop(1, withAlpha(mid, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, 0, 13, 0, TAU);
        ctx.fill();
        ctx.fillStyle = pr.color ? withAlpha(shade(pr.color, 0.5), 0.9) : "rgba(205,188,255,0.9)";
        ctx.beginPath();
        ctx.ellipse(-7, 0, 11, 3, 0, 0, TAU); // 尾
        ctx.fill();
        if (pr.fx === "gold") {
          // 聖句の四芒グリフ
          ctx.strokeStyle = withAlpha(shade(pr.color ?? "#ffd66a", 0.6), 0.85);
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.moveTo(-9, 0); ctx.lineTo(9, 0);
          ctx.moveTo(0, -7); ctx.lineTo(0, 7);
          ctx.stroke();
        }
        break;
      }
      case "knife": {
        ctx.rotate(pr.angle);
        const blade = pr.color ?? "#cfd8e6";
        ctx.fillStyle = blade;
        ctx.beginPath();
        ctx.moveTo(9, 0);
        ctx.lineTo(-5, -2.6);
        ctx.lineTo(-7, 0);
        ctx.lineTo(-5, 2.6);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = pr.color ? shade(pr.color, -0.45) : "#6b5a8c";
        ctx.fillRect(-9, -1.4, 4, 2.8);
        ctx.globalCompositeOperation = "lighter"; // 刃の煌めき
        ctx.fillStyle = pr.color ? withAlpha(shade(pr.color, 0.6), 0.6) : "rgba(220,230,255,0.5)";
        ctx.beginPath();
        ctx.arc(4, 0, 3, 0, TAU);
        ctx.fill();
        if (pr.fx === "void") {
          // 虚無の鎖環: 刃を囲む紫の小ルーン環
          ctx.strokeStyle = withAlpha(pr.color ?? "#b078ff", 0.6);
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.arc(0, 0, 7, 0, TAU);
          ctx.stroke();
        } else if (pr.fx === "plague") {
          // 疫癘: 刃尾に滴る毒の雫
          ctx.fillStyle = withAlpha(pr.color ?? "#b6d27a", 0.7);
          ctx.beginPath();
          ctx.arc(-7, 0, 2.4, 0, TAU);
          ctx.fill();
        }
        break;
      }
      case "boomerang": {
        const r = pr.radius;
        const ba = pr.boomA ?? 120;
        const bb = pr.boomB ?? 200;
        // 接線方向(投擲方向 boomDir の回転込み) + 自軸スピン(楕円1周で4自転)
        const tx = -ba * Math.sin(pr.angle);
        const ty = bb * Math.cos(pr.angle);
        ctx.rotate(Math.atan2(ty, tx) + (pr.boomDir ?? 0) + pr.angle * 4);
        // グロー(基底は冷たい月光、固有技=緋月の戦鎌は主色)
        const wing = pr.color ?? "#aed0e8";
        const glow = pr.color ?? "#9bc8e4";
        ctx.globalCompositeOperation = "lighter";
        const g = ctx.createRadialGradient(0, 0, 1, 0, 0, r + 12);
        g.addColorStop(0, withAlpha(shade(glow, 0.5), 0.52));
        g.addColorStop(0.55, withAlpha(glow, 0.16));
        g.addColorStop(1, withAlpha(glow, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, 0, r + 12, 0, TAU);
        ctx.fill();
        ctx.globalCompositeOperation = "source-over";
        // 左右対称の曲刃翼(±1 でミラー)
        for (const s of [1, -1]) {
          ctx.save();
          ctx.scale(s, s);
          ctx.fillStyle = wing;
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.bezierCurveTo(r * 0.22, -r * 0.6, r * 0.72, -r * 0.65, r, 0);
          ctx.bezierCurveTo(r * 0.72, r * 0.26, r * 0.22, r * 0.26, 0, 0);
          ctx.closePath();
          ctx.fill();
          // 刃の縁光筋(エッジハイライト)
          ctx.strokeStyle = withAlpha(shade(wing, 0.6), 0.72);
          ctx.lineWidth = 1.1;
          ctx.beginPath();
          ctx.moveTo(r * 0.07, -r * 0.05);
          ctx.bezierCurveTo(r * 0.32, -r * 0.46, r * 0.68, -r * 0.48, r * 0.9, -r * 0.03);
          ctx.stroke();
          ctx.restore();
        }
        // 中心鋲
        ctx.fillStyle = shade(wing, 0.5);
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.22, 0, TAU);
        ctx.fill();
        break;
      }
      case "orb": {
        ctx.globalCompositeOperation = "lighter";
        // 基底は聖鎖の宝珠(青)、固有技=業火の輪舞は主色(焔)
        const mid = pr.color ?? "#6fd3ff";
        const core = pr.color ? shade(pr.color, 0.65) : "#eafaff";
        const g = ctx.createRadialGradient(0, 0, 1, 0, 0, pr.radius + 6);
        g.addColorStop(0, core);
        g.addColorStop(0.45, mid);
        g.addColorStop(1, withAlpha(mid, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, 0, pr.radius + 6, 0, TAU);
        ctx.fill();
        if (pr.fx === "ember") {
          // 焔の舌(主色で外周に揺らめく)
          ctx.fillStyle = withAlpha(shade(mid, 0.3), 0.5);
          for (let k = 0; k < 3; k++) {
            const a = world.t * 6 + (k / 3) * TAU + pr.x * 0.05;
            const er = pr.radius + 4;
            ctx.beginPath();
            ctx.arc(Math.cos(a) * er, Math.sin(a) * er, 2.4, 0, TAU);
            ctx.fill();
          }
        }
        break;
      }
    }
    ctx.restore();
  }
  ctx.globalCompositeOperation = "source-over";

  // 宝珠の鎖(プレイヤーと結ぶ薄い線。固有技なら主色)
  for (const pr of world.projectiles) {
    if (pr.kind !== "orb") continue;
    ctx.strokeStyle = withAlpha(pr.color ?? "#6fd3ff", 0.16);
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
    // 雷色(基底=黄白の裁き、固有技=氷牙の氷青/王権の紫紺)。芯は主色を白寄りに。
    const glow = b.color ?? "#ffd95e";
    const core = b.color ? shade(b.color, 0.65) : "#fff7d6";
    // 落雷の柱
    const pts: Array<[number, number]> = [[bx + Math.sin(b.seed) * 40, by - 320]];
    for (let i = 1; i <= 6; i++) {
      const t = i / 6;
      pts.push([bx + (1 - t) * Math.sin(b.seed + i * 7.3) * 34, by - 320 + 320 * t]);
    }
    // 外側のグロー
    ctx.strokeStyle = withAlpha(glow, alpha * 0.4);
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.stroke();
    // 芯
    ctx.strokeStyle = withAlpha(core, alpha);
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.stroke();
    // 着弾の閃光
    const fg = ctx.createRadialGradient(bx, by, 1, bx, by, 22 * (1 - b.life) + 8);
    fg.addColorStop(0, withAlpha(core, alpha * 0.9));
    fg.addColorStop(1, withAlpha(glow, 0));
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.arc(bx, by, 22 * (1 - b.life) + 8, 0, TAU);
    ctx.fill();
    if (b.fx === "frost") {
      // 氷牙: 着弾点に氷片(主色の小三角)
      ctx.fillStyle = withAlpha(core, alpha);
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * TAU + b.seed;
        const er = (22 * (1 - b.life) + 8) * 0.7;
        ctx.beginPath();
        ctx.arc(bx + Math.cos(a) * er, by + Math.sin(a) * er, 2, 0, TAU);
        ctx.fill();
      }
    }
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
  drawBossTelegraph(v);  // ボス能力の予備動作(チャージ)
  drawEnemies(v);        // 敵スプライト
  drawShockwaves(v);     // ボスの衝波(ハザードの拡大リング)
  drawPlayer(v);         // 自機
  drawProjectiles(v);    // 投射物
  drawEnemyShots(v);     // 敵の呪弾
  drawBolts(v);          // 雷
  drawParticles(v);      // パーティクル
  drawTexts(v, settings); // ダメージ数字

  // --- 雰囲気(光と闇): ランタン光・血月・微塵・縁・瘴気・被弾フラッシュ ---
  drawAtmosphere(v);

  // --- 特異種の画面外マーカー(視界外にいる間も存在を知らせる) ---
  drawVariantMarkers(v);

  // --- ミニマップ(聖域内の自分と敵の位置) ---
  drawMinimap(v);

  // --- 再開カウントダウン(構えの間) ---
  drawGrace(v);

  ctx.restore();
}

// 特異種(大型/色違い)が視界の外にいる間、画面の縁に矢羽根を出して位置と接近を知らせる。
// 大型=琥珀(加速オーラ), 色違い=紫(硬化オーラ)で、本体のオーラリングと色を揃える。
function drawVariantMarkers(v: View): void {
  const { ctx, vw, vh, world, camX, camY } = v;
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
function drawMinimap(v: View): void {
  const { ctx, vw, vh, world } = v;
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
