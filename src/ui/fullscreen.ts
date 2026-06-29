// 〔層〕付属的な機能 / AUXILIARY ── 全画面ヘルパ(Fullscreen API ＋ Keyboard Lock)
//   役割: ゲームを全画面で遊ぶための薄いラッパ。普通に全画面(Fullscreen API)へ入ると
//     ブラウザは Esc を「全画面解除」に予約し、preventDefault でも止められない。そこで
//     全画面入場時に Keyboard Lock API で Esc をページ側に捕捉させ、Esc を「中断(ポーズ)」
//     にだけ使えるようにする(長押し Esc は安全のため依然として解除に働く)。
//   対応: Keyboard Lock は Chromium 系(Chrome/Edge, Tauri の WebView2)で有効。非対応の
//     ブラウザでは Esc で全画面が解除されるが、その場合も App 側の keydown ハンドラが
//     同時にポーズするので「中断」自体は必ず行われる(機能の劣化のみで破綻しない)。

interface KeyboardLockApi {
  lock?: (keys?: string[]) => Promise<void>;
  unlock?: () => void;
}
const keyboardApi = (): KeyboardLockApi | undefined =>
  (navigator as unknown as { keyboard?: KeyboardLockApi }).keyboard;

export const isFullscreen = (): boolean => !!document.fullscreenElement;

/** 全画面に入り、可能なら Esc をページに捕捉させる(全画面解除を抑止)。 */
export async function enterFullscreen(): Promise<void> {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
  } catch {
    /* 全画面非対応/拒否でも続行 */
  }
  await lockEscape();
}

/** 全画面中なら Esc 捕捉を有効化する(fullscreenchange からの再ロックにも使う)。 */
export async function lockEscape(): Promise<void> {
  if (!document.fullscreenElement) return;
  try {
    await keyboardApi()?.lock?.(["Escape"]);
  } catch {
    /* Keyboard Lock 非対応でも続行(Esc は App 側でポーズに使われる) */
  }
}

/** 全画面を抜ける(Esc 捕捉も解除)。 */
export async function exitFullscreen(): Promise<void> {
  try {
    keyboardApi()?.unlock?.();
  } catch {
    /* noop */
  }
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
  } catch {
    /* noop */
  }
}

/** 全画面のオン/オフを切り替える。 */
export function toggleFullscreen(): Promise<void> {
  return isFullscreen() ? exitFullscreen() : enterFullscreen();
}
