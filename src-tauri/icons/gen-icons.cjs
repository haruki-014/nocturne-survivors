// アイコン一式を生成する。SVG を sharp でラスタライズし、
// PNG 各サイズ・ICO・ICNS を出力する(tauri.conf.json の icon 配列に対応)。
// ICO / ICNS はどちらも PNG 埋め込み形式で自前パックする。
const fs = require("fs");
const path = require("path");
const sharp = require("/home/claude/.npm-global/lib/node_modules/sharp");

const DIR = path.resolve("/home/claude/nocturne/src-tauri/icons");
const svg = fs.readFileSync(path.join(DIR, "icon.svg"));

async function pngBuf(size) {
  return await sharp(svg, { density: 384 }).resize(size, size, { fit: "cover" }).png().toBuffer();
}

function packIco(entries) {
  // entries: [{size, buf}]
  const count = entries.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(count, 4);
  const dir = Buffer.alloc(16 * count);
  let offset = 6 + 16 * count;
  const datas = [];
  entries.forEach((e, i) => {
    const b = i * 16;
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, b + 0); // width (0=256)
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, b + 1); // height
    dir.writeUInt8(0, b + 2); // palette
    dir.writeUInt8(0, b + 3); // reserved
    dir.writeUInt16LE(1, b + 4); // planes
    dir.writeUInt16LE(32, b + 6); // bpp
    dir.writeUInt32LE(e.buf.length, b + 8); // size of data
    dir.writeUInt32LE(offset, b + 12); // offset
    offset += e.buf.length;
    datas.push(e.buf);
  });
  return Buffer.concat([header, dir, ...datas]);
}

function packIcns(entries) {
  // entries: [{type:'ic07', buf}]
  const chunks = [];
  for (const e of entries) {
    const head = Buffer.alloc(8);
    head.write(e.type, 0, "ascii");
    head.writeUInt32BE(8 + e.buf.length, 4); // length incl header (big-endian)
    chunks.push(head, e.buf);
  }
  const body = Buffer.concat(chunks);
  const head = Buffer.alloc(8);
  head.write("icns", 0, "ascii");
  head.writeUInt32BE(8 + body.length, 4);
  return Buffer.concat([head, body]);
}

(async () => {
  // --- PNG 群(tauri 標準名) ---
  const pngs = {
    "32x32.png": 32,
    "128x128.png": 128,
    "128x128@2x.png": 256,
    "icon.png": 512,
    "Square150x150Logo.png": 150,
    "Square310x310Logo.png": 310,
    "StoreLogo.png": 256,
  };
  for (const [name, size] of Object.entries(pngs)) {
    fs.writeFileSync(path.join(DIR, name), await pngBuf(size));
  }

  // --- ICO(Windows) ---
  const icoSizes = [16, 32, 48, 64, 128, 256];
  const icoEntries = [];
  for (const s of icoSizes) icoEntries.push({ size: s, buf: await pngBuf(s) });
  fs.writeFileSync(path.join(DIR, "icon.ico"), packIco(icoEntries));

  // --- ICNS(macOS) PNG 埋め込み ---
  const icnsMap = [
    ["icp5", 32],
    ["ic07", 128],
    ["ic08", 256],
    ["ic09", 512],
    ["ic10", 1024],
  ];
  const icnsEntries = [];
  for (const [type, size] of icnsMap) icnsEntries.push({ type, buf: await pngBuf(size) });
  fs.writeFileSync(path.join(DIR, "icon.icns"), packIcns(icnsEntries));

  console.log("generated:", fs.readdirSync(DIR).sort().join(", "));
})();
