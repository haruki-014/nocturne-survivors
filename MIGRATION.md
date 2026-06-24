# three.js 移行の検討

> 結論：**全面移行は現時点で妥当ではない。** Canvas 2D を既定のまま維持する。
> ただし将来の選択肢を確保するため、**レンダラを抽象化（差し替え可能に）する低リスクな実行**だけ行った。
> 「数千体規模の弾幕」や「シェーダによる本格的なライティング／被写界効果」を本気で求める段になったら、その抽象境界の裏に three.js レンダラを実装すればよい。

## なぜ全面移行しないのか

本作は **2D トップダウン**のヴァンパイアサバイバー系で、敵は最大 300 体、投射物も数十〜百程度。描画は「オフスクリーン canvas に焼いたスプライトを `drawImage`」＋「加算合成によるグロー・ランタン光・霧・血月」で構成され、60fps を安定して出している。この特性に照らすと：

- **性能**：現状ボトルネックは無い。Canvas 2D の `drawImage`（キャッシュ済みスプライト）は数百体なら余裕。three.js の真価は数千〜万体を `InstancedMesh`/点群で捌く領域で、本作の設計上限（`MAX_ENEMIES=300`）では恩恵が出ない。
- **見た目**：ランタンを光源とする闇・霧・微塵・ブルーム・血月は、すでに加算合成と放射グラデーションで説得力をもって表現済み。WebGL の `UnrealBloomPass` 等はより本格的だが「劇的な改善」ではなく、むしろ手で詰めたゴシックの質感を作り直す過程で**退行する危険**が大きい。
- **複雑さ**：正射影カメラ、スプライトのテクスチャ化、インスタンシング、ポストプロセス、テキスト描画（ダメージ数字）の扱い、ミニマップ・結界・カウントダウン等のスクリーン空間 UI の再実装と再調整――工数とリスクが大きい。
- **検証可能性**：この制作環境はオフライン（`npm install` 不可）で、ヘッドレスでの WebGL 実行確認が困難。これまで Canvas 2D はスクリーンショットで一画面ずつ検証してきたが、three.js レンダラは同じ品質保証ができず、**未検証の描画コードを載せること自体がリスク**になる。

総じて、シニアエンジニアの判断としては「動いている 2D を壊さない。three.js は要件が出てから、境界の裏で差し替える」。

## three.js が“妥当になる”条件

次のいずれかが要件化したら、移行（または WebGL レンダラの追加実装）を推奨する。

- 同時表示を **数千体以上**に増やしたい（真の bullet-heaven 化）。
- **シェーダ前提の表現**（屈折する本物のガラス、法線ライティング、ヒートヘイズ、リッチなブルーム/トーンマッピング）を中心に据えたい。
- **3D 要素**（高さ・視差カメラ・3D モデル）を導入したい。
- WebGL 前提の **パイプライン最適化**（GPU パーティクル等）で CPU を空けたい。

## 実行したこと（低リスクな“妥当な範囲”）

エンジンを描画バックエンド非依存にした。`src/game/types.ts` に `Renderer` インターフェースを定義し、既存の Canvas 2D 描画を `Canvas2DRenderer`（`src/game/render.ts`）として実装。エンジンは `Renderer` だけに依存し、`draw()` は `renderer.render(world, settings)`、リサイズは `renderer.resize()` に委譲する。

```ts
export interface Renderer {
  readonly vw: number;
  readonly vh: number;
  resize(): void;
  render(world: World, settings: Settings): void;
  dispose(): void;
}
```

コンストラクタはレンダラ生成関数を任意で受け取り、既定は Canvas 2D：

```ts
new Engine(canvas, emit, settings);                       // 既定: Canvas2DRenderer
new Engine(canvas, emit, settings, c => new ThreeRenderer(c)); // 将来: WebGL を注入
```

この変更は **挙動を一切変えず**（同じ `renderWorld` を呼ぶ）、型チェックも通過済み。これで three.js の“オプション価値”だけを、リスクなしで確保した。

## 将来 three.js を入れるときの設計

`Renderer` を実装する `ThreeRenderer` を追加し、上記の注入で差し替える。要点：

1. **依存追加**：`npm i three @types/three`、必要なら `three/examples/jsm/postprocessing/*`（EffectComposer, RenderPass, UnrealBloomPass）。
2. **カメラ**：`OrthographicCamera`。ワールド 1px = 1unit でカメラをプレイヤー追従。シェイクはカメラオフセットで再現。
3. **スプライト資産の流用**：`render.ts` の手続き的スプライト生成（オフスクリーン canvas 描画）を **そのまま `CanvasTexture` 化**できる。アートを作り直さずに移行できるのが大きい。敵・投射物は種類ごとにテクスチャ化し、種類別 `InstancedMesh`（quad）で一括描画。
4. **発光・雰囲気**：加算ブレンドのスプライトはそのまま `AdditiveBlending` のマテリアルへ。ランタンの闇・血月・霧・微塵は全画面シェーダ（`ShaderMaterial` のフルスクリーンクワッド）かスプライト合成で再現。ブルームは `UnrealBloomPass`。
5. **テキスト/UI**：ダメージ数字は `CanvasTexture` のスプライト、または DOM オーバーレイへ。HUD・カード・記録の間・ポーズは**現状の React/リキッドグラスのまま**（描画層と無関係）。ミニマップ・結界・再開カウントダウンは小さな 2D オーバーレイ canvas に逃がすのが安全。
6. **検証**：オンライン環境で `npm run dev`／`tauri dev` を実行し、各画面をスクリーンショットで現行 2D と突き合わせて回帰確認する。

工数の目安：レンダラ単体で 1〜2 日相当（資産流用前提）。エンジン・UI・データには一切手を入れない。

## 推奨

現状維持（Canvas 2D）。上記「妥当になる条件」が出てきたら、確保済みの `Renderer` 境界の裏に `ThreeRenderer` を実装して切り替える。
