/**
 * Prepare a graph dataset for the benchmark, sized to fit every platform's free tier.
 *
 * Modes:
 *   --source snap        Downloads a real SNAP dataset (soc-Pokec by default) and
 *                         samples it down to --target-edges relationships.
 *   --source synthetic    Generates a scale-free-ish graph so you can test the harness
 *                         immediately, before your real dataset is ready.
 *
 * Output (in data/):
 *   nodes.csv           one column: node_id
 *   edges.csv           two columns: src,dst
 *   dataset_info.json   source, node count, edge count
 *
 * Usage:
 *   node data/prepare_dataset.js --source snap --target-edges 200000
 *   node data/prepare_dataset.js --source synthetic --target-edges 200000
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const https = require("https");

const OUT_DIR = __dirname;
const SNAP_URL = "https://snap.stanford.edu/data/soc-pokec-relationships.txt.gz";

function parseArgs() {
  const args = { source: "synthetic", targetEdges: 200000, seed: 42 };
  process.argv.slice(2).forEach((arg, i, arr) => {
    if (arg === "--source") args.source = arr[i + 1];
    if (arg === "--target-edges") args.targetEdges = parseInt(arr[i + 1], 10);
    if (arg === "--seed") args.seed = parseInt(arr[i + 1], 10);
  });
  return args;
}

// simple seeded RNG so runs are reproducible
function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    https
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return downloadFile(res.headers.location, destPath).then(resolve, reject);
        }
        res.pipe(file);
        file.on("finish", () => file.close(resolve));
      })
      .on("error", reject);
  });
}

async function downloadSnap(targetEdges, seed) {
  const rawPath = path.join(OUT_DIR, "raw_pokec.txt.gz");
  if (!fs.existsSync(rawPath)) {
    console.log(`Downloading ${SNAP_URL} ...`);
    await downloadFile(SNAP_URL, rawPath);
  } else {
    console.log("Using cached download at", rawPath);
  }

  console.log("Decompressing and reading edges...");
  const buf = zlib.gunzipSync(fs.readFileSync(rawPath));
  const lines = buf.toString("utf8").split("\n");

  const allEdges = [];
  for (const line of lines) {
    const parts = line.trim().split("\t");
    if (parts.length === 2) allEdges.push([parts[0], parts[1]]);
  }

  const rng = mulberry32(seed);
  let edges = allEdges;
  if (allEdges.length > targetEdges) {
    // reservoir-free simple sample: shuffle indices, take first N (fine at this scale)
    const idx = [...allEdges.keys()];
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    edges = idx.slice(0, targetEdges).map((i) => allEdges[i]);
  }

  const nodes = [...new Set(edges.flat())].sort();
  writeOutputs(nodes, edges, `SNAP soc-Pokec (sampled from ${SNAP_URL})`);
}

function generateSynthetic(targetEdges, seed) {
  console.log("Generating synthetic scale-free-ish graph for harness testing...");
  const rng = mulberry32(seed);
  const nNodes = Math.max(1000, Math.floor(targetEdges / 6));

  // Preferential-attachment-style generator (Barabasi-Albert-like), no external deps
  const edges = [];
  const degree = new Array(nNodes).fill(0);
  const m = Math.max(2, Math.floor(targetEdges / nNodes));

  // seed with a small clique
  for (let i = 0; i < Math.min(m + 1, nNodes); i++) {
    for (let j = i + 1; j < Math.min(m + 1, nNodes); j++) {
      edges.push([String(i), String(j)]);
      degree[i]++;
      degree[j]++;
    }
  }

  const targets = [];
  for (let i = 0; i < Math.min(m + 1, nNodes); i++) targets.push(i);

  for (let v = m + 1; v < nNodes; v++) {
    const chosen = new Set();
    while (chosen.size < Math.min(m, targets.length)) {
      const pick = targets[Math.floor(rng() * targets.length)];
      chosen.add(pick);
    }
    for (const u of chosen) {
      edges.push([String(v), String(u)]);
      degree[v]++;
      degree[u]++;
      targets.push(u);
    }
    for (let k = 0; k < degree[v]; k++) targets.push(v);
    if (edges.length >= targetEdges) break;
  }

  let finalEdges = edges;
  if (edges.length > targetEdges) {
    const idx = [...edges.keys()];
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    finalEdges = idx.slice(0, targetEdges).map((i) => edges[i]);
  }

  const nodes = [...new Set(finalEdges.flat())].sort((a, b) => parseInt(a) - parseInt(b));
  writeOutputs(nodes, finalEdges, "Synthetic preferential-attachment graph — TEST DATA, not for final submission");
}

function writeOutputs(nodes, edges, source) {
  const nodesPath = path.join(OUT_DIR, "nodes.csv");
  const edgesPath = path.join(OUT_DIR, "edges.csv");

  fs.writeFileSync(nodesPath, "node_id\n" + nodes.join("\n") + "\n");
  fs.writeFileSync(edgesPath, "src,dst\n" + edges.map(([s, d]) => `${s},${d}`).join("\n") + "\n");

  const info = { source, node_count: nodes.length, relationship_count: edges.length };
  fs.writeFileSync(path.join(OUT_DIR, "dataset_info.json"), JSON.stringify(info, null, 2));

  console.log(`Wrote ${nodes.length} nodes and ${edges.length} edges.`);
  console.log("Summary:", info);
  console.log("IMPORTANT: paste this node/edge count into your README's dataset section.");
}

(async () => {
  const args = parseArgs();
  if (args.source === "snap") {
    await downloadSnap(args.targetEdges, args.seed);
  } else {
    generateSynthetic(args.targetEdges, args.seed);
  }
})();
