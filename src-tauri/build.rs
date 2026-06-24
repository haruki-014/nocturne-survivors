// 〔層〕より外円な機能 / OUTER ── Tauri のビルド前処理(Rust)
//   役割: cargo がコンパイルする「前」に一度だけ走る準備スクリプト。
//     tauri.conf.json や capabilities/ を読んで、権限スキーマやアイコン等の
//     生成物を用意する。開発者が直接いじることはほぼ無い定型ファイル。
fn main() {
    tauri_build::build()
}
