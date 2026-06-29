// ═══════════════════════════════════════════════════════════
//  〔層〕付属的な機能 / AUXILIARY ── 手続き的オーディオ(Web Audio)
//
//  役割(マクロ): ゲームの「耳」。AudioSink を実装し、エンジン/UI が要求する
//    効果音(cue)と BGM(setScene)を Web Audio API で“その場で合成”して鳴らす。
//    このゲームがスプライトを手続き生成するのと同じ流儀で、音源ファイル(mp3/wav)を
//    一切持たず、オシレータ＋ノイズ＋包絡で全ての音を生成する(オフライン・軽量)。
//  音作りの方針(テーマ=「血月の夜想曲」): 短調(イ短調)・ゆったり・残響多めの
//    ゴシックなノクターン。SFX は短く控えめ(高頻度の発射音が耳障りにならないよう
//    低音量＋レート制限)。被弾だけは少し強めにして危険を伝える。
//  構成(信号の流れ):
//    各音 → sfxBus / musicBus → master → 出力
//                 └→ reverb(畳み込み) → master   (両バスから残響を送る)
//  自動再生制限: ブラウザはユーザー操作前に音を出せない。App が最初の操作で
//    resume() を呼び、ここで AudioContext を生成/再開して BGM を開始する。
// ═══════════════════════════════════════════════════════════

import type { AudioScene, AudioSink, SfxCue } from "../game/types";

// MIDI ノート番号 → 周波数(Hz)。A4(69)=440Hz。
const mtof = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

// BGM の和音進行(イ短調系)。E メジャーで緊張を作り Am へ解決する循環。
//   Am(A C E) → F(F A C) → C(C E G) → E(E G# B)
const PROGRESSION: number[][] = [
  [57, 60, 64], // Am
  [53, 57, 60], // F
  [60, 64, 67], // C
  [52, 56, 59], // E (G#=56 で導音)
];

const STEP_DUR = 0.46; // 8分音符の長さ(秒)。約65BPM のゆったりした拍
const STEPS_PER_BAR = 8; // 4/4 を 8分で刻む
const LOOKAHEAD = 0.12; // 先読みスケジュール窓(秒)
const TIMER_MS = 50; // スケジューラのタイマー間隔

// 効果音の最短再生間隔(秒)。高頻度の cue が音割れ/うるささにならないよう間引く。
const SFX_MIN_GAP: Record<SfxCue, number> = {
  atkBolt: 0.05, atkKnife: 0.04, atkBoomerang: 0.09, atkLightning: 0.1,
  atkFrost: 0.08, atkRoyal: 0.12, atkGold: 0.06, atkVoid: 0.06, atkPlague: 0.06, atkCrimson: 0.09,
  hit: 0.08, kill: 0.05, pickup: 0.05, dodge: 0.18,
  boss: 0.5, levelup: 0.2, gameover: 0.5, victory: 0.5, select: 0.05,
};

export class WebAudioPlayer implements AudioSink {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  private reverb!: ConvolverNode;
  private noiseBuf!: AudioBuffer;

  private bgmOn = true;
  private sfxOn = true;
  private scene: AudioScene = "silent";

  private timer: number | null = null;
  private nextNoteTime = 0;
  private step = 0;
  private lastCueAt: Partial<Record<SfxCue, number>> = {};

  // ---------- 解錠・グラフ構築 ----------

  /** ユーザー操作で呼ぶ。AudioContext を生成/再開し、必要なら BGM を始める。 */
  resume(): void {
    if (!this.ctx) this.build();
    const ctx = this.ctx!;
    if (ctx.state === "suspended") void ctx.resume();
    this.ensureScheduler();
  }

  private build(): void {
    const Ctor: typeof AudioContext =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctor();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(ctx.destination);

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 0.7;
    this.sfxBus.connect(this.master);

    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = this.bgmOn ? 0.5 : 0;
    this.musicBus.connect(this.master);

    // 残響(畳み込み): 減衰ノイズの即席インパルス応答で「夜の広間」の空気を作る
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.makeImpulse(1.8, 2.6);
    const wet = ctx.createGain();
    wet.gain.value = 0.5;
    this.reverb.connect(wet);
    wet.connect(this.master);
    this.sfxBus.connect(this.reverb);
    this.musicBus.connect(this.reverb);

    // 効果音のノイズ素材(白色ノイズ 1 秒)を一度だけ生成して使い回す
    this.noiseBuf = this.makeNoise(1);
  }

  /** 減衰ノイズの簡易インパルス応答(残響用)。 */
  private makeImpulse(seconds: number, decay: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  private makeNoise(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  // ---------- 設定 ----------

  setEnabled(bgm: boolean, sfx: boolean): void {
    this.bgmOn = bgm;
    this.sfxOn = sfx;
    if (this.ctx) this.musicBus.gain.value = bgm ? 0.5 : 0;
    this.ensureScheduler();
  }

  dispose(): void {
    this.stopScheduler();
    this.ctx?.close().catch(() => {});
    this.ctx = null;
  }

  // ---------- 効果音 ----------

  cue(name: SfxCue): void {
    if (!this.sfxOn || !this.ctx || this.ctx.state !== "running") return;
    const t = this.ctx.currentTime;
    const last = this.lastCueAt[name] ?? -1;
    if (t - last < SFX_MIN_GAP[name]) return; // レート制限
    this.lastCueAt[name] = t;
    switch (name) {
      case "atkBolt": this.sfxBolt(t); break;
      case "atkKnife": this.sfxKnife(t); break;
      case "atkBoomerang": this.sfxBoomerang(t); break;
      case "atkLightning": this.sfxLightning(t); break;
      case "atkFrost": this.sfxFrost(t); break;
      case "atkRoyal": this.sfxRoyal(t); break;
      case "atkGold": this.sfxGold(t); break;
      case "atkVoid": this.sfxVoid(t); break;
      case "atkPlague": this.sfxPlague(t); break;
      case "atkCrimson": this.sfxCrimson(t); break;
      case "hit": this.sfxHit(t); break;
      case "kill": this.sfxKill(t); break;
      case "pickup": this.sfxPickup(t); break;
      case "dodge": this.sfxDodge(t); break;
      case "boss": this.sfxBoss(t); break;
      case "levelup": this.arp(t, [57, 60, 64, 69], 0.09, "triangle", 0.10); break; // 上行 Am
      case "gameover": this.arp(t, [64, 60, 57, 52], 0.22, "sine", 0.12); break; // 下行で沈む
      case "victory": this.arp(t, [57, 64, 69, 72], 0.14, "triangle", 0.12); break; // 上行で晴れる
      case "select": this.tone(t, { freq: mtof(72), type: "triangle", dur: 0.07, peak: 0.05 }); break;
    }
  }

  /** オシレータ1音(包絡つき)。任意で終端周波数 slideTo へ滑らせる。 */
  private tone(
    t: number,
    o: { freq: number; type: OscillatorType; dur: number; peak: number; slideTo?: number; attack?: number; bus?: GainNode },
  ): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = o.type;
    osc.frequency.setValueAtTime(o.freq, t);
    if (o.slideTo !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.slideTo), t + o.dur);
    const atk = o.attack ?? 0.005;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.peak, t + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    osc.connect(g);
    g.connect(o.bus ?? this.sfxBus);
    osc.start(t);
    osc.stop(t + o.dur + 0.02);
  }

  /** フィルタ付きノイズ1発(打撃・摩擦音用)。 */
  private noise(
    t: number,
    o: { dur: number; peak: number; type: BiquadFilterType; freq: number; q?: number; sweepTo?: number; bus?: GainNode },
  ): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const filt = ctx.createBiquadFilter();
    filt.type = o.type;
    filt.frequency.setValueAtTime(o.freq, t);
    if (o.sweepTo !== undefined) filt.frequency.exponentialRampToValueAtTime(Math.max(20, o.sweepTo), t + o.dur);
    filt.Q.value = o.q ?? 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.peak, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    src.connect(filt);
    filt.connect(g);
    g.connect(o.bus ?? this.sfxBus);
    src.start(t);
    src.stop(t + o.dur + 0.02);
  }

  /** 連音(レベルアップ/勝敗の小フレーズ)。 */
  private arp(t: number, notes: number[], gap: number, type: OscillatorType, peak: number): void {
    notes.forEach((m, i) => this.tone(t + i * gap, { freq: mtof(m), type, dur: gap * 2.2, peak, attack: 0.01 }));
  }

  // ── 攻撃音(武器ごとに固有) ──
  // 魔弾(基底/魔法): 鈴のように澄んだ「きらめき」。基音＋オクターブ上＋第5倍音を
  //   薄く重ね、上方向へ滑らせて残響に乗せる → 詠唱を放つ魔法らしさ。被弾(低い濁り)と対極。
  private sfxBolt(t: number): void {
    this.tone(t, { freq: mtof(88), type: "sine", dur: 0.17, peak: 0.05, slideTo: mtof(95), attack: 0.004 });
    this.tone(t, { freq: mtof(100), type: "triangle", dur: 0.13, peak: 0.025, slideTo: mtof(107), attack: 0.004 });
    this.tone(t + 0.03, { freq: mtof(92) * 1.5, type: "sine", dur: 0.1, peak: 0.018, attack: 0.005 });
  }
  // 銀のナイフ: 高い刃鳴り＋微かなチッ
  private sfxKnife(t: number): void {
    this.tone(t, { freq: mtof(101), type: "triangle", dur: 0.08, peak: 0.04, slideTo: mtof(96), attack: 0.002 });
    this.noise(t, { dur: 0.05, peak: 0.035, type: "highpass", freq: 5200 });
  }
  // 帰刃: 弧を描く風切り＋軽い回転音
  private sfxBoomerang(t: number): void {
    this.noise(t, { dur: 0.2, peak: 0.06, type: "bandpass", freq: 600, q: 0.6, sweepTo: 1500 });
    this.tone(t, { freq: mtof(72), type: "triangle", dur: 0.12, peak: 0.03, slideTo: mtof(67) });
  }
  // 裁きの雷: 鋭い破裂＋落雷のザップ＋低い轟き
  private sfxLightning(t: number): void {
    this.noise(t, { dur: 0.14, peak: 0.14, type: "highpass", freq: 2600, sweepTo: 5200 });
    this.tone(t, { freq: 1200, type: "sawtooth", dur: 0.1, peak: 0.06, slideTo: 220 });
    this.tone(t + 0.02, { freq: 90, type: "sine", dur: 0.24, peak: 0.07, slideTo: 48 });
  }
  // 氷牙の連弾(固有): ガラスの鈴(微デチューンで結晶感)＋氷の擦過
  private sfxFrost(t: number): void {
    this.tone(t, { freq: mtof(103), type: "sine", dur: 0.2, peak: 0.045, slideTo: mtof(108), attack: 0.003 });
    this.tone(t, { freq: mtof(110) * 1.006, type: "sine", dur: 0.17, peak: 0.025, attack: 0.003 });
    this.noise(t, { dur: 0.1, peak: 0.05, type: "bandpass", freq: 6200, q: 3, sweepTo: 8200 });
  }
  // 王権の雷霆(固有): 荘厳な雷。低い五度の唸り＋鋭い破裂＋深い轟き
  private sfxRoyal(t: number): void {
    this.noise(t, { dur: 0.16, peak: 0.12, type: "highpass", freq: 1800, sweepTo: 3600 });
    this.tone(t, { freq: mtof(60), type: "sawtooth", dur: 0.3, peak: 0.08, slideTo: mtof(48) });
    this.tone(t, { freq: mtof(67), type: "sawtooth", dur: 0.28, peak: 0.05, slideTo: mtof(55) });
    this.tone(t + 0.02, { freq: 55, type: "sine", dur: 0.34, peak: 0.08, slideTo: 40 });
  }
  // 黄金の聖句(固有): 上行する長三和音の聖なる鐘
  private sfxGold(t: number): void {
    this.tone(t, { freq: mtof(76), type: "triangle", dur: 0.26, peak: 0.04, attack: 0.004 });
    this.tone(t + 0.02, { freq: mtof(80), type: "triangle", dur: 0.24, peak: 0.034, attack: 0.004 });
    this.tone(t + 0.04, { freq: mtof(83), type: "sine", dur: 0.3, peak: 0.028, attack: 0.004 });
  }
  // 虚無の鎖環(固有): 暗い斬撃＋不穏なデチューンの低音
  private sfxVoid(t: number): void {
    this.noise(t, { dur: 0.16, peak: 0.07, type: "bandpass", freq: 1200, q: 0.8, sweepTo: 320 });
    this.tone(t, { freq: mtof(58), type: "sawtooth", dur: 0.18, peak: 0.06, slideTo: mtof(50) });
    this.tone(t, { freq: mtof(58) * 1.06, type: "sawtooth", dur: 0.16, peak: 0.03 });
  }
  // 疫癘の散弾(固有): 毒の噴霧(濁ったノイズ)＋揺らぐ濁音
  private sfxPlague(t: number): void {
    this.noise(t, { dur: 0.2, peak: 0.07, type: "bandpass", freq: 1800, q: 1.5, sweepTo: 900 });
    this.tone(t, { freq: mtof(70), type: "sawtooth", dur: 0.16, peak: 0.03, slideTo: mtof(66) });
  }
  // 緋月の戦鎌(固有): 薙ぐ血の一閃(風切り)＋重い低音
  private sfxCrimson(t: number): void {
    this.noise(t, { dur: 0.22, peak: 0.09, type: "bandpass", freq: 700, q: 0.7, sweepTo: 1800 });
    this.tone(t, { freq: mtof(50), type: "sawtooth", dur: 0.2, peak: 0.05, slideTo: mtof(43) });
  }
  // 被弾: 低くざらつく重い衝撃(下降)。攻撃音と被らないよう音域・音色・動きを真逆に。
  //   低音域・sawtooth の唸り＋深いサイン＋低ノイズ・やや長め・下方向 → 「喰らった」感。
  private sfxHit(t: number): void {
    this.noise(t, { dur: 0.26, peak: 0.17, type: "lowpass", freq: 640, q: 0.7, sweepTo: 110 });
    this.tone(t, { freq: 210, type: "sawtooth", dur: 0.26, peak: 0.13, slideTo: 52 }); // ざらつく呻り
    this.tone(t + 0.01, { freq: 95, type: "sine", dur: 0.22, peak: 0.12, slideTo: 44 }); // 深い芯
  }
  // 撃破: 乾いた弾けと小さな低音の落ち
  private sfxKill(t: number): void {
    this.noise(t, { dur: 0.1, peak: 0.09, type: "bandpass", freq: 1600, q: 1.2, sweepTo: 600 });
    this.tone(t, { freq: 320, type: "triangle", dur: 0.09, peak: 0.05, slideTo: 160 });
  }
  // 取得: 明るい小さな blip(上行)
  private sfxPickup(t: number): void {
    this.tone(t, { freq: mtof(81), type: "sine", dur: 0.1, peak: 0.06, slideTo: mtof(88), attack: 0.004 });
  }
  // 回避: ノイズの翻し(バンドパスのスイープ)
  private sfxDodge(t: number): void {
    this.noise(t, { dur: 0.2, peak: 0.06, type: "bandpass", freq: 500, q: 0.8, sweepTo: 1500 });
  }
  // ボス到来: 低い唸りの膨らみ＋鐘
  private sfxBoss(t: number): void {
    this.tone(t, { freq: 55, type: "sawtooth", dur: 1.1, peak: 0.10, attack: 0.25 });
    this.tone(t + 0.05, { freq: mtof(64), type: "sine", dur: 1.2, peak: 0.07, attack: 0.01 }); // 鐘
    this.tone(t + 0.05, { freq: mtof(64) * 2.01, type: "sine", dur: 0.9, peak: 0.03, attack: 0.01 }); // 倍音で金属感
  }

  // ---------- BGM(場面別レイヤー) ----------

  setScene(scene: AudioScene): void {
    if (scene === this.scene) return;
    this.scene = scene;
    this.ensureScheduler();
  }

  private ensureScheduler(): void {
    const active = !!this.ctx && this.ctx.state === "running" && this.bgmOn && this.scene !== "silent";
    if (active && this.timer === null) {
      this.nextNoteTime = this.ctx!.currentTime + 0.08;
      this.timer = window.setInterval(() => this.schedule(), TIMER_MS);
    } else if (!active && this.timer !== null) {
      this.stopScheduler();
    }
  }

  private stopScheduler(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** 先読み窓のぶんだけ音符を前もって予約する(タイマー揺れに強い定番手法)。 */
  private schedule(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "running") { this.stopScheduler(); return; }
    while (this.nextNoteTime < ctx.currentTime + LOOKAHEAD) {
      this.playStep(this.step, this.nextNoteTime);
      this.step++;
      this.nextNoteTime += STEP_DUR;
    }
  }

  /** 1ステップ(8分音符)を、現在の場面に応じたレイヤーで鳴らす。 */
  private playStep(step: number, t: number): void {
    const bar = Math.floor(step / STEPS_PER_BAR) % PROGRESSION.length;
    const s = step % STEPS_PER_BAR;
    const chord = PROGRESSION[bar];
    const root = chord[0];
    const m = this.musicBus;

    // パッド(和音): 小節頭で長く柔らかく鳴らす。残響と相まって夜想の土台に。
    if (s === 0) {
      for (const n of chord) {
        this.tone(t, { freq: mtof(n + 12), type: "sine", dur: STEP_DUR * 7, peak: 0.05, attack: 0.4, bus: m });
      }
    }

    // アルペジオ: 和音構成音を順に爪弾く。戦闘ではより密に。
    const arpSteps = this.scene === "menu" ? [0, 2, 4, 6] : [0, 2, 3, 4, 6, 7];
    if (arpSteps.includes(s)) {
      const n = chord[(s * 2) % chord.length] + 24;
      this.tone(t, { freq: mtof(n), type: "triangle", dur: STEP_DUR * 1.4, peak: 0.035, attack: 0.01, bus: m });
    }

    // 戦闘/ボス: 拍頭にベース(根音)を置いて推進力を出す
    if (this.scene !== "menu" && (s === 0 || s === 4)) {
      this.tone(t, { freq: mtof(root - 12), type: "sawtooth", dur: STEP_DUR * 1.2, peak: 0.06, attack: 0.01, bus: m });
    }

    // ボス: 低いドローンと「鼓動」を重ねて圧をかける
    if (this.scene === "boss") {
      if (s === 0) this.tone(t, { freq: mtof(root - 24), type: "sawtooth", dur: STEP_DUR * 8, peak: 0.05, attack: 0.6, bus: m });
      if (s === 0 || s === 3) this.tone(t, { freq: 60, type: "sine", dur: 0.18, peak: 0.10, slideTo: 40, bus: m }); // 鼓動
    }
  }
}
