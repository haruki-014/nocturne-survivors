// 〔層〕付属的な機能 / AUXILIARY ── ホームの飾り棚(遺物のディオラマ)
//   役割: 収集した遺物(curio)を、タイトル下部の「飾り棚」ゾーン内でドラッグして
//     自由に配置・カスタマイズできる小さな箱庭。位置は親(App)経由でプロファイルへ保存。
//   挙動(ミクロ): 各遺物は正規化座標(0..1)で配置。pointer capture でドラッグ中の
//     ポインタ移動を掴み、棚の矩形に対する相対位置を算出して即時に追従。指を離した
//     瞬間に onCurioMove(id, x, y) で確定保存する(ドラッグ中は保存しない=軽い)。

import { useRef, useState } from "react";
import type { Profile } from "../meta/profile";
import { CURIOS_BY_ID, TOTAL_CURIOS } from "../game/data";
import { Sigil } from "./icons";

interface Props {
  profile: Profile;
  onCurioMove: (id: string, x: number, y: number) => void;
}

const clamp = (v: number) => Math.max(0.05, Math.min(0.95, v));

export default function DioramaShelf({ profile, onCurioMove }: Props) {
  const shelfRef = useRef<HTMLDivElement>(null);
  // ドラッグ中だけ位置をローカルに持ち、離した時に親へ確定保存する
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null);

  const collected = profile.collectedCurios;
  const posOf = (id: string) =>
    drag && drag.id === id ? { x: drag.x, y: drag.y } : profile.curioLayout[id] ?? { x: 0.5, y: 0.5 };

  const onDown = (e: React.PointerEvent, id: string) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const p = posOf(id);
    setDrag({ id, x: p.x, y: p.y });
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const rect = shelfRef.current?.getBoundingClientRect();
    if (!rect) return;
    setDrag({
      id: drag.id,
      x: clamp((e.clientX - rect.left) / rect.width),
      y: clamp((e.clientY - rect.top) / rect.height),
    });
  };
  const onUp = () => {
    if (!drag) return;
    onCurioMove(drag.id, drag.x, drag.y);
    setDrag(null);
  };

  return (
    <div className="diorama" aria-label="飾り棚">
      <div className="diorama-head">
        飾 り 棚
        <span className="diorama-count">
          {collected.length}/{TOTAL_CURIOS}
        </span>
      </div>
      <div className="diorama-shelf" ref={shelfRef}>
        {collected.map((id) => {
          const c = CURIOS_BY_ID[id];
          if (!c) return null;
          const p = posOf(id);
          return (
            <button
              key={id}
              className={`curio-item${drag?.id === id ? " dragging" : ""}`}
              style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%`, "--accent": c.color } as React.CSSProperties}
              title={`${c.name} ── ${c.desc}`}
              aria-label={c.name}
              onPointerDown={(e) => onDown(e, id)}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
            >
              <Sigil name={c.icon} />
            </button>
          );
        })}
      </div>
      <div className="diorama-hint">ドラッグで自由に配置 ── 夜に落ちる遺物を集めて飾れ</div>
    </div>
  );
}
