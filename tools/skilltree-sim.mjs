// ============================================================
// スキルツリー多様性シミュレータ
// 「最終案を決める前に、複数システム × 複数方針で多数の試行を重ねる」ための実験台。
// 候補システム:
//   A: フラット   (現行。進化なし・シナジーなし)
//   B: 進化       (武器最大Lv + 指定パッシブで真化)
//   C: 進化+紋章  (真化に分岐 + 4 流派のセットボーナスが意味を持つ)
// プレイ方針:
//   random / weapon (武器偏重) / archetype (流派偏重)
// 指標: 固有ビルド数, エントロピー(bits), 真化到達率, 平均真化数, 固有アイデンティティ数
// ============================================================

// ---- コンテンツ定義(ゲーム本体と整合する簡略モデル) ----
const WEAPONS = {
  grimoire: { max: 8, school: "spirit" },
  knife:    { max: 8, school: "steel" },
  orbs:     { max: 8, school: "spirit" },
  censer:   { max: 8, school: "moon" },
  lightning:{ max: 8, school: "moon" },
  axe:      { max: 8, school: "steel" },
};
const PASSIVES = {
  boots:     { max: 5, school: "steel" },
  heart:     { max: 5, school: "blood" },
  might:     { max: 5, school: "blood" },
  tome:      { max: 5, school: "spirit" },
  candle:    { max: 5, school: "moon" },
  magnet:    { max: 5, school: "spirit" },
  regen:     { max: 5, school: "blood" },
  duplicator:{ max: 2, school: "steel" },
};
// 真化: 武器 → [{ req: パッシブ, lv, evo: 進化先名 }]  (分岐を含む)
// 反復2: 15分相当の試行で機構が機能するよう、条件は「対パッシブを所持(lv1)」に緩和。
const EVOLUTIONS = {
  grimoire: [ { req: "tome", lv: 1, evo: "grimoire_codex" }, { req: "might", lv: 1, evo: "grimoire_blasphemy" } ],
  knife:    [ { req: "boots", lv: 1, evo: "knife_galewall" } ],
  orbs:     [ { req: "candle", lv: 1, evo: "orbs_halo" } ],
  censer:   [ { req: "heart", lv: 1, evo: "censer_sanctuary" } ],
  lightning:[ { req: "might", lv: 1, evo: "lightning_chain" }, { req: "candle", lv: 1, evo: "lightning_storm" } ],
  axe:      [ { req: "magnet", lv: 1, evo: "axe_comet" } ],
};

const WKEYS = Object.keys(WEAPONS);
const PKEYS = Object.keys(PASSIVES);
const rnd = (n) => Math.floor(Math.random() * n);
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };

function schoolCounts(run) {
  const c = { steel: 0, spirit: 0, moon: 0, blood: 0 };
  for (const id of Object.keys(run.weapons)) c[(WEAPONS[id] || { school: run.evoSchool[id] }).school ?? run.evoSchool[id]]++;
  for (const id of Object.keys(run.passives)) c[PASSIVES[id].school]++;
  return c;
}
function dominantSchool(run) {
  const c = schoolCounts(run);
  return Object.entries(c).sort((a, b) => b[1] - a[1])[0][0];
}

function buildPool(run, system) {
  const pool = [];
  for (const [id, lv] of Object.entries(run.weapons)) {
    const def = WEAPONS[id];
    if (def && lv < def.max) pool.push({ t: "wup", id, school: def.school });
    // 進化先はそれ自身も成長させられる(簡略では成長スロットだけ確保)
  }
  for (const [id, lv] of Object.entries(run.passives)) {
    if (lv < PASSIVES[id].max) pool.push({ t: "pup", id, school: PASSIVES[id].school });
  }
  if (Object.keys(run.weapons).length < 6) {
    for (const id of WKEYS) if (!(id in run.weapons)) pool.push({ t: "wnew", id, school: WEAPONS[id].school });
  }
  if (Object.keys(run.passives).length < 6) {
    for (const id of PKEYS) if (!(id in run.passives)) pool.push({ t: "pnew", id, school: PASSIVES[id].school });
  }
  // 真化カード
  if (system !== "A") {
    for (const [id, lv] of Object.entries(run.weapons)) {
      if (!WEAPONS[id] || lv < WEAPONS[id].max) continue;
      const branches = EVOLUTIONS[id] || [];
      const usable = branches.filter((b) => (run.passives[b.req] || 0) >= b.lv);
      // システムB: 最初に条件を満たした分岐のみ。システムC: 満たした分岐すべて(分岐選択の多様性)
      const offer = system === "C" ? usable : usable.slice(0, 1);
      for (const b of offer) pool.push({ t: "evo", id, evo: b.evo, school: WEAPONS[id].school });
    }
  }
  return pool;
}

function choose(cards, policy, run) {
  // 真化は常に最優先(VS流。プレイヤーは普通これを取る)
  const evo = cards.find((c) => c.t === "evo");
  if (evo && policy !== "random") return evo;
  if (evo && Math.random() < 0.85) return evo;
  if (policy === "weapon") {
    return cards.find((c) => c.t === "wnew") || cards.find((c) => c.t === "wup") || cards[rnd(cards.length)];
  }
  if (policy === "evohunter") {
    // 1 つの武器を最大化し、その対パッシブを確保して真化を狙う最善手
    const owned = Object.entries(run.weapons).filter(([id]) => WEAPONS[id]).sort((a, b) => b[1] - a[1]);
    const target = owned.length ? owned[0][0] : null;
    if (target) {
      const up = cards.find((c) => c.t === "wup" && c.id === target);
      if (up) return up;
      const reqs = (EVOLUTIONS[target] || []).map((b) => b.req);
      const rp = cards.find((c) => (c.t === "pnew" || c.t === "pup") && reqs.includes(c.id));
      if (rp) return rp;
    }
    return cards[rnd(cards.length)];
  }
  if (policy === "archetype") {
    const dom = dominantSchool(run);
    const match = cards.filter((c) => c.school === dom);
    if (match.length) return match[rnd(match.length)];
    return cards[rnd(cards.length)];
  }
  return cards[rnd(cards.length)];
}

function apply(run, card) {
  switch (card.t) {
    case "wnew": run.weapons[card.id] = 1; break;
    case "pnew": run.passives[card.id] = 1; break;
    case "wup": run.weapons[card.id]++; break;
    case "pup": run.passives[card.id]++; break;
    case "evo": {
      delete run.weapons[card.id];
      run.weapons[card.evo] = 1;       // 真化後も成長可
      run.evoSchool[card.evo] = WEAPONS[card.id].school;
      run.evos.push(card.evo);
      break;
    }
  }
}

function signature(run) {
  const w = Object.keys(run.weapons).sort().join("+");
  const p = Object.keys(run.passives).sort().join("+");
  return w + "|" + p;
}
// 流派が 3 / 5 個でそれぞれ第1・第2段のセットボーナスが灯る
function setTiers(run) {
  const c = schoolCounts(run);
  return Object.keys(c).sort().map((k) => `${k}${c[k] >= 5 ? 2 : c[k] >= 3 ? 1 : 0}`).join(",");
}
function identity(run, system) {
  const evo = run.evos.slice().sort().join("+");
  // 紋章システムでは「点灯中のセット段位」もアイデンティティの一部
  const synergy = system === "C" ? "#" + setTiers(run) : "";
  return evo + "@" + dominantSchool(run) + synergy;
}

function runOnce(system, policy, levelUps) {
  const run = { weapons: {}, passives: {}, evoSchool: {}, evos: [] };
  // 開始武器を1つ無作為に付与(本体仕様)
  run.weapons[WKEYS[rnd(WKEYS.length)]] = 1;
  for (let i = 0; i < levelUps; i++) {
    const pool = buildPool(run, system);
    if (pool.length === 0) break;
    const cards = shuffle(pool.slice()).slice(0, 3);
    apply(run, choose(cards, policy, run));
  }
  return run;
}

function entropy(counts) {
  const total = counts.reduce((a, b) => a + b, 0);
  let h = 0;
  for (const c of counts) { if (c > 0) { const p = c / total; h -= p * Math.log2(p); } }
  return h;
}

function evaluate(system, policy, N, levelUps) {
  const sigCount = new Map();
  const idCount = new Map();
  let evoRuns = 0, evoTotal = 0;
  for (let i = 0; i < N; i++) {
    const run = runOnce(system, policy, levelUps);
    const s = signature(run); sigCount.set(s, (sigCount.get(s) || 0) + 1);
    const id = identity(run, system); idCount.set(id, (idCount.get(id) || 0) + 1);
    if (run.evos.length) evoRuns++;
    evoTotal += run.evos.length;
  }
  return {
    distinctBuilds: sigCount.size,
    buildEntropy: entropy([...sigCount.values()]),
    distinctIdentities: idCount.size,
    idEntropy: entropy([...idCount.values()]),
    evoRate: evoRuns / N,
    avgEvos: evoTotal / N,
  };
}

// ---- 実験を走らせる ----
const N = 4000;          // 各セルの試行回数
const LEVELUPS = 36;     // 1ラン当たりの平均レベルアップ数(集中ビルドの15分相当)
const systems = ["A", "B", "C"];
const policies = ["random", "weapon", "archetype", "evohunter"];
const SNAME = { A: "フラット   ", B: "進化       ", C: "進化+紋章  " };
const PNAME = { random: "random   ", weapon: "weapon   ", archetype: "archetype", evohunter: "evohunter" };

console.log(`# スキルツリー多様性シミュレーション`);
console.log(`# 試行: ${N} runs/cell × ${systems.length} systems × ${policies.length} policies = ${(N*systems.length*policies.length).toLocaleString()} runs, 各 ${LEVELUPS} レベルアップ\n`);
console.log(`system      policy     |  固有ビルド  ビルドH(bit)  固有ID    ID-H(bit)  真化率   平均真化`);
console.log(`-`.repeat(96));
const agg = {};
for (const s of systems) {
  agg[s] = { db: 0, di: 0, idh: 0 };
  for (const p of policies) {
    const r = evaluate(s, p, N, LEVELUPS);
    agg[s].db += r.distinctBuilds; agg[s].di += r.distinctIdentities; agg[s].idh += r.idEntropy;
    console.log(
      `${SNAME[s]} ${PNAME[p]}  |  ` +
      `${String(r.distinctBuilds).padStart(8)}    ${r.buildEntropy.toFixed(2).padStart(8)}    ` +
      `${String(r.distinctIdentities).padStart(6)}    ${r.idEntropy.toFixed(2).padStart(7)}   ` +
      `${(r.evoRate*100).toFixed(1).padStart(5)}%   ${r.avgEvos.toFixed(2).padStart(6)}`
    );
  }
  console.log(`-`.repeat(96));
}
console.log(`\n# 集計(4方針平均)`);
for (const s of systems) {
  console.log(`  ${SNAME[s].trim().padEnd(10)} 固有ビルド≈${Math.round(agg[s].db/4)}  固有アイデンティティ≈${Math.round(agg[s].di/4)}  ID多様性(H)≈${(agg[s].idh/4).toFixed(2)} bit`);
}
