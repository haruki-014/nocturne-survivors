import type { ChangeEvent } from "react";
import type { HudSchool, HudState, HudSlot, Settings } from "../game/types";
import { schoolBonusText } from "../game/data";
import { Sigil } from "./icons";

// ポーズメニュー。設定(柔軟なUI)・現在のビルド・流派(紋章)シナジーを表示する。

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <div className="setting-row">
      <span>{label}</span>
      <button
        className="toggle"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
      />
    </div>
  );
}

function BuildSlots({ items }: { items: HudSlot[] }) {
  return (
    <>
      {items.map((s) => (
        <div
          key={s.id}
          className="slot"
          title={`${s.name} Lv.${s.level}`}
          style={{ "--slot-color": s.color } as React.CSSProperties}
        >
          <span className="slot-icon"><Sigil name={s.icon} /></span>
          <span className="lv">{s.level}</span>
        </div>
      ))}
    </>
  );
}

function Crests({ schools }: { schools: HudSchool[] }) {
  if (schools.length === 0) return null;
  return (
    <div className="crest-panel">
      <div className="crest-title">紋 章 ── 流派の加護</div>
      <div className="crest-row">
        {schools.map((s) => (
          <div
            key={s.id}
            className={`crest tier-${s.tier}`}
            style={{ "--accent": s.color } as React.CSSProperties}
          >
            <span className="crest-glyph"><Sigil name={s.icon} /></span>
            <span className="crest-meta">
              <span className="crest-name">
                {s.name}
                <span className="crest-count">×{s.count}</span>
              </span>
              <span className="crest-bonus">
                {s.tier > 0 ? schoolBonusText(s.id, s.tier) : `あと ${3 - s.count} で発現`}
              </span>
            </span>
            <span className="crest-pips" aria-hidden="true">
              <i className={s.tier >= 1 ? "on" : ""} />
              <i className={s.tier >= 2 ? "on" : ""} />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

interface Props {
  hud: HudState | null;
  settings: Settings;
  onSettings: (s: Settings) => void;
  onResume: () => void;
  onQuit: () => void;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
}

export default function PauseMenu({ hud, settings, onSettings, onResume, onQuit, fullscreen, onToggleFullscreen }: Props) {
  return (
    <div className="overlay dim">
      <div className="panel" role="dialog" aria-label="休息">
        <h2 className="pause-title">休 息</h2>
        <p style={{ color: "var(--bone-dim)", fontSize: 12.5 }}>
          骸どもは月の下で待っている。
        </p>

        {hud && (hud.weapons.length > 0 || hud.passives.length > 0) && (
          <div className="build-row">
            <BuildSlots items={hud.weapons} />
            <BuildSlots items={hud.passives} />
          </div>
        )}

        {hud && <Crests schools={hud.schools} />}

        <div className="settings">
          <Toggle
            label="全画面(Esc は中断・F で切替)"
            checked={fullscreen}
            onChange={onToggleFullscreen}
          />
          <Toggle
            label="ダメージ数字を表示"
            checked={settings.damageNumbers}
            onChange={(v) => onSettings({ ...settings, damageNumbers: v })}
          />
          <Toggle
            label="画面シェイク"
            checked={settings.screenShake}
            onChange={(v) => onSettings({ ...settings, screenShake: v })}
          />
          <Toggle
            label="BGM(背景音楽)"
            checked={settings.bgm}
            onChange={(v) => onSettings({ ...settings, bgm: v })}
          />
          <Toggle
            label="効果音"
            checked={settings.sfx}
            onChange={(v) => onSettings({ ...settings, sfx: v })}
          />
          <div className="setting-row">
            <span>
              HUDの大きさ{" "}
              <span style={{ fontFamily: "var(--font-mono)", color: "var(--bone-dim)" }}>
                ×{settings.hudScale.toFixed(2)}
              </span>
            </span>
            <input
              type="range"
              min={0.8}
              max={1.4}
              step={0.05}
              value={settings.hudScale}
              aria-label="HUDの大きさ"
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                onSettings({ ...settings, hudScale: Number(e.target.value) })
              }
            />
          </div>
        </div>

        <div className="btn-col">
          <button className="btn" onClick={onResume} autoFocus>
            夜へ戻る
          </button>
          <button className="btn ghost btn-sm" onClick={onQuit}>
            この夜を諦める
          </button>
        </div>
      </div>
    </div>
  );
}
