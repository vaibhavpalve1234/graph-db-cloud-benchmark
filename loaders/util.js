const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const RESULTS_DIR = path.join(__dirname, "..", "results");

function readCsv(filePath) {
  const text = fs.readFileSync(filePath, "utf8").trim();
  const [headerLine, ...rows] = text.split("\n");
  const headers = headerLine.split(",");
  return rows.map((row) => {
    const values = row.split(",");
    const obj = {};
    headers.forEach((h, i) => (obj[h] = values[i]));
    return obj;
  });
}

function loadNodeIds() {
  return readCsv(path.join(DATA_DIR, "nodes.csv")).map((r) => r.node_id);
}

function loadEdges() {
  return readCsv(path.join(DATA_DIR, "edges.csv")).map((r) => [r.src, r.dst]);
}

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  const k = (sorted.length - 1) * (p / 100);
  const f = Math.floor(k);
  const c = Math.min(f + 1, sorted.length - 1);
  if (f === c) return sorted[f];
  return sorted[f] + (sorted[c] - sorted[f]) * (k - f);
}

function saveResult(platform, label, data) {
  if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const outPath = path.join(RESULTS_DIR, `${platform}_${label}.json`);
  fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
  console.log(`Saved -> ${outPath}`);
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomSampleTwo(arr) {
  const a = randomChoice(arr);
  let b = randomChoice(arr);
  while (b === a) b = randomChoice(arr);
  return [a, b];
}

module.exports = {
  DATA_DIR,
  RESULTS_DIR,
  readCsv,
  loadNodeIds,
  loadEdges,
  percentile,
  saveResult,
  chunk,
  randomChoice,
  randomSampleTwo,
};
