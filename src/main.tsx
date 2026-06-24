// 〔層〕より外円な機能 / OUTER ── React の起動点(ブートストラップ)
//   役割: index.html の <div id="root"> を見つけ、そこに最上位コンポーネント
//     <App/> を描き始めるだけの「点火スイッチ」。ゲームのロジックは一切無い。
//   挙動: StrictMode は開発時だけ副作用を二重実行して不具合を炙り出す保険
//     (本番では無効)。ここから App → Engine の順に世界が立ち上がる。

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
