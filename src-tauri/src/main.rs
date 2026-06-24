// ═══════════════════════════════════════════════════════════
//  〔層〕より外円な機能 / OUTER ── Tauri デスクトップ外殻(Rust)
//
//  Tauri を一言で: 「Web(このゲームのReact部分)をデスクトップアプリの窓に
//    入れて配布する」ための薄い殻。中身(画面・ゲーム)は dist/ の HTML/JS で、
//    この Rust は "ネイティブ窓を開いて、その中で Web を表示する" 役だけ。
//    ブラウザ無しで .app/.exe として配れるのが利点。Electron の軽量版に近い。
//
//  このファイルだけで完結する流れ(とても短い):
//    1) main() が Tauri アプリを起動する唯一の入口。
//    2) generate_context!() がビルド時に tauri.conf.json(窓のサイズや読み込む
//       URL 等)を読み取り、設定を埋め込む。
//    3) .run() で OS のネイティブ窓を開き、その中に WebView を載せて
//       開発時は localhost:1420、本番は同梱した dist/ を表示する。
//  ※ いまは Rust 側の独自処理(コマンド)は無く、純粋に「窓+Web表示」のみ。
//     JS から Rust 関数を呼びたくなったら、ここに #[tauri::command] を足して
//     .invoke_handler(...) に登録する(現状は不要なので空)。
// ═══════════════════════════════════════════════════════════

// 本番ビルドでは Windows で余計なコンソール窓が出ないようにする指定。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running Nocturne Survivors");
}
