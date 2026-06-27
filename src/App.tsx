// ═══════════════════════════════════════════════════════════
//  〔層〕付属的な機能 / AUXILIARY ── アプリ統合(司令塔)
//
//  役割(マクロ): エンジン(主要)と各画面UI(付属)を束ねる中枢。「いま何の画面か」
//    を screen state で管理し(title/modeselect/altar/codex/playing/levelup/
//    paused/gameover/victory)、その値で表示する画面を切り替える。
//  挙動(ミクロ):
//    ・生成: canvas に Engine を1度だけ作る。エンジンの emit(イベント)を受けて
//      hud 表示更新・カード提示・勝敗時の記録保存(recordRun)を行う。
//    ・橋渡し: ボタン押下→engine.start()/applyChoice()/setPaused() を呼ぶ。
//      設定や恒久強化(computeMetaBonus)・装いの変更を engine へ反映する。
//    ・永続化: 設定は localStorage、戦績/解放はプロファイル(meta/profile)へ。
//  ※ React は「状態が変わったら描き直す」係。実ゲームの計算はエンジン側にある。
// ═══════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from "react";
import { Engine } from "./game/engine";
import type {
  EngineEvent,
  GameMode,
  HudState,
  RunStats,
  Settings,
  UpgradeChoice,
} from "./game/types";
import { DEFAULT_MODE } from "./game/data";
import TitleScreen from "./ui/TitleScreen";
import HUD from "./ui/HUD";
import LevelUpModal from "./ui/LevelUpModal";
import PauseMenu from "./ui/PauseMenu";
import EndScreen from "./ui/EndScreen";
import CodexScreen from "./ui/CodexScreen";
import ModeSelect from "./ui/ModeSelect";
import AltarScreen from "./ui/AltarScreen";
import TreasuryScreen from "./ui/TreasuryScreen";
import {
  collectCurio,
  loadProfile,
  recordRun,
  resetProfile,
  selectSkin,
  setCurioPosition,
  type Achievement,
  type GearSlot,
  type Profile,
} from "./meta/profile";
import { buyUpgrade, computeMetaBonus } from "./meta/altar";
import { addLoot, equipItem, sellItem, syncHero, unequipItem } from "./meta/hero";

type Screen = "title" | "modeselect" | "codex" | "altar" | "treasury" | "playing" | "levelup" | "paused" | "gameover" | "victory";

const SETTINGS_KEY = "nocturne.settings.v1";

function loadSettings(): Settings {
  const def: Settings = { damageNumbers: true, screenShake: true, hudScale: 1 };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return def;
    const p = JSON.parse(raw) as Partial<Settings>;
    return {
      damageNumbers: typeof p.damageNumbers === "boolean" ? p.damageNumbers : def.damageNumbers,
      screenShake: typeof p.screenShake === "boolean" ? p.screenShake : def.screenShake,
      hudScale: typeof p.hudScale === "number" ? Math.min(1.4, Math.max(0.8, p.hudScale)) : 1,
    };
  } catch {
    return def;
  }
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null);

  const [screen, setScreen] = useState<Screen>("title");
  const [hud, setHud] = useState<HudState | null>(null);
  const [choices, setChoices] = useState<UpgradeChoice[]>([]);
  const [stats, setStats] = useState<RunStats | null>(null);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [profile, setProfile] = useState<Profile>(loadProfile);
  const [unlocked, setUnlocked] = useState<Achievement[]>([]);
  const [unlockedSkins, setUnlockedSkins] = useState<string[]>([]);
  const [soulsEarned, setSoulsEarned] = useState(0);
  const [currentMode, setCurrentMode] = useState<GameMode>(DEFAULT_MODE);

  // screen の最新値をイベントハンドラから参照するための ref
  const screenRef = useRef(screen);
  screenRef.current = screen;

  // ---- エンジン生成(canvas 常設マウント、生成は一度きり) ----
  useEffect(() => {
    if (!canvasRef.current) return;
    const engine = new Engine(
      canvasRef.current,
      (e: EngineEvent) => {
        switch (e.type) {
          case "hud":
            setHud(e.hud);
            break;
          case "levelup":
            setChoices(e.choices);
            setScreen("levelup");
            break;
          case "curio":
            // ステージで拾った遺物を収集に加えて保存(ホーム飾り棚に並ぶ)
            setProfile((prev) => collectCurio(prev, e.id));
            break;
          case "loot":
            // 拾った戦利品(装備)をホームのヒーローへ。ベストなら自動装着・劣れば売却。
            setProfile((prev) => addLoot(prev, e.tier));
            break;
          case "gameover":
          case "victory":
            setStats(e.stats);
            setScreen(e.type === "victory" ? "victory" : "gameover");
            setProfile((prev) => {
              const { profile: next, unlocked: got, unlockedSkins: skins, soulsEarned: souls } = recordRun(prev, e.stats);
              setUnlocked(got);
              setUnlockedSkins(skins);
              setSoulsEarned(souls);
              return next;
            });
            break;
        }
      },
      loadSettings()
    );
    engineRef.current = engine;
    return () => {
      engine.destroy();
      engineRef.current = null;
    };
  }, []);

  // ---- 設定の反映: エンジン / CSS変数 / localStorage ----
  useEffect(() => {
    const engine = engineRef.current;
    if (engine) engine.settings = settings;
    document.documentElement.style.setProperty("--hud-scale", String(settings.hudScale));
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      /* 保存不可でも続行 */
    }
  }, [settings]);

  // ---- 恒久強化・装い・収集済み遺物をエンジンへ反映(装い変更はタイトル背景にも即時反映) ----
  //   ※ ヒーローの装備強化は「ミニゲーム内だけ」効くため、本編の MetaBonus には混ぜない。
  useEffect(() => {
    engineRef.current?.setMeta(computeMetaBonus(profile), profile.selectedSkin, profile.collectedCurios);
  }, [profile]);

  // ---- 自動戦闘の進行を保存(ホームのオートバトラーが到達値を絶対値で渡してくる) ----
  //   離席中の精算(offlineProgress)とライブ戦闘はコンポーネント側が担い、ここは保存だけ。
  const onHeroSync = useCallback((live: { kills: number; xp: number; depth: number }) => {
    setProfile((prev) => syncHero(prev, live));
  }, []);

  // ---- Esc でポーズのトグル ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Escape" && e.code !== "KeyP") return;
      const s = screenRef.current;
      const engine = engineRef.current;
      if (!engine) return;
      if (s === "playing") {
        engine.setPaused(true);
        setScreen("paused");
      } else if (s === "paused") {
        engine.setPaused(false);
        setScreen("playing");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ---- 操作ハンドラ ----
  const startRun = useCallback(() => {
    engineRef.current?.start(currentMode);
    setStats(null);
    setScreen("playing");
  }, [currentMode]);

  const startMode = useCallback((mode: GameMode) => {
    setCurrentMode(mode);
    engineRef.current?.start(mode);
    setStats(null);
    setScreen("playing");
  }, []);

  const pickChoice = useCallback((c: UpgradeChoice) => {
    const engine = engineRef.current;
    if (!engine) return;
    const next = engine.applyChoice(c);
    if (next) {
      setChoices(next); // 保留中のレベルアップが残っている → 次のカードへ
    } else {
      setScreen("playing");
    }
  }, []);

  const onBuyUpgrade = useCallback((id: string) => {
    setProfile((prev) => buyUpgrade(prev, id) ?? prev);
  }, []);

  const onSelectSkin = useCallback((id: string) => {
    setProfile((prev) => selectSkin(prev, id));
  }, []);

  // 宝物庫: 装備の装着 / 取り外し / 売却(いずれも hero.ts が保存まで担う)
  const onEquipGear = useCallback((gearId: string) => {
    setProfile((prev) => equipItem(prev, gearId));
  }, []);
  const onUnequipGear = useCallback((slot: GearSlot) => {
    setProfile((prev) => unequipItem(prev, slot));
  }, []);
  const onSellGear = useCallback((gearId: string) => {
    setProfile((prev) => sellItem(prev, gearId));
  }, []);

  // 飾り棚での遺物の移動(0..1 正規化座標)を保存する
  const onCurioMove = useCallback((id: string, x: number, y: number) => {
    setProfile((prev) => setCurioPosition(prev, id, x, y));
  }, []);


  const resume = useCallback(() => {
    engineRef.current?.setPaused(false);
    setScreen("playing");
  }, []);

  const quitToTitle = useCallback(() => {
    // ラン放棄。エンジンは ended のまま静止画を映す。
    setScreen("title");
    setHud(null);
  }, []);

  return (
    <div className="stage">
      <canvas ref={canvasRef} />

      {screen !== "title" && screen !== "codex" && screen !== "modeselect" && hud && <HUD hud={hud} />}

      {screen === "title" && (
        <TitleScreen
          onStart={() => setScreen("modeselect")}
          onCodex={() => setScreen("codex")}
          onAltar={() => setScreen("altar")}
          onTreasury={() => setScreen("treasury")}
          profile={profile}
          onCurioMove={onCurioMove}
          onHeroSync={onHeroSync}
        />
      )}

      {screen === "modeselect" && (
        <ModeSelect profile={profile} onPick={startMode} onBack={() => setScreen("title")} />
      )}

      {screen === "altar" && (
        <AltarScreen
          profile={profile}
          onBuy={onBuyUpgrade}
          onSelectSkin={onSelectSkin}
          onBack={() => setScreen("title")}
        />
      )}

      {screen === "treasury" && (
        <TreasuryScreen
          profile={profile}
          onEquip={onEquipGear}
          onUnequip={onUnequipGear}
          onSell={onSellGear}
          onBack={() => setScreen("title")}
        />
      )}

      {screen === "codex" && (
        <CodexScreen
          profile={profile}
          onBack={() => setScreen("title")}
          onReset={() => setProfile(resetProfile())}
        />
      )}

      {screen === "levelup" && <LevelUpModal choices={choices} onPick={pickChoice} />}

      {screen === "paused" && (
        <PauseMenu
          hud={hud}
          settings={settings}
          onSettings={setSettings}
          onResume={resume}
          onQuit={quitToTitle}
        />
      )}

      {(screen === "gameover" || screen === "victory") && stats && (
        <EndScreen
          victory={screen === "victory"}
          stats={stats}
          unlocked={unlocked}
          unlockedSkins={unlockedSkins}
          soulsEarned={soulsEarned}
          onRetry={startRun}
          onTitle={() => setScreen("title")}
          onCodex={() => setScreen("codex")}
          onAltar={() => setScreen("altar")}
        />
      )}
    </div>
  );
}
