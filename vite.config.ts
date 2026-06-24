// 〔層〕より外円な機能 / OUTER ── Vite(開発サーバ&ビルド)の設定
//   役割: 開発中は即時リロードのサーバを立て、本番は TS/JSX をブラウザ用に
//     束ねて dist/ へ出力する道具立て。ゲーム挙動には関与しない。
//   挙動: react() プラグインで JSX を変換。下の Tauri 連携用の固定設定:
//     ・port:1420 + strictPort:true … Tauri はこの URL を window に読み込むため
//       ポートを固定し、空いていなければ自動でズラさず失敗させる(取り違え防止)。
//     ・clearScreen:false … Tauri 側のログを消さないよう端末クリアを抑止。
//     ・envPrefix … VITE_ / TAURI_ で始まる環境変数だけをフロントに露出。
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: "es2021",
    minify: "esbuild",
    sourcemap: false,
  },
});
