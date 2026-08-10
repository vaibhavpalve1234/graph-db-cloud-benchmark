/**
 * Reads every results/*_load.json and results/*_benchmark.json file and
 * builds a single markdown results matrix, written to results/results_table.md.
 * Run this after all platforms have been loaded and benchmarked.
 */
const fs = require("fs");
const path = require("path");

const RESULTS_DIR = path.join(__dirname, "..", "results");
const PLATFORMS = ["cognodb", "aura", "memgraph", "arangodb", "tigergraph"];

function loadJson(p) {
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function main() {
  const lines = ["# Results Matrix\n"];

  lines.push("## Data Loading\n");
  lines.push("| Platform | Nodes | Relationships | Load Time (s) | Nodes/s | Rels/s |");
  lines.push("|---|---|---|---|---|---|");
  for (const p of PLATFORMS) {
    const d = loadJson(path.join(RESULTS_DIR, `${p}_load.json`));
    if (!d) {
      lines.push(`| ${p} | - | - | - | - | not run |`);
      continue;
    }
    lines.push(
      `| ${p} | ${d.node_count} | ${d.relationship_count} | ${d.total_load_seconds} | ${d.nodes_per_second} | ${d.relationships_per_second} |`
    );
  }

  lines.push("\n## Traversals, Lookups, Aggregation (p50 / p95 ms)\n");
  const metrics = ["1hop", "2hop", "3hop", "point_lookup", "filtered_lookup", "aggregation"];
  lines.push("| Platform | " + metrics.map((m) => `${m} p50/p95`).join(" | ") + " |");
  lines.push("|" + "---|".repeat(metrics.length + 1));
  for (const p of PLATFORMS) {
    const d = loadJson(path.join(RESULTS_DIR, `${p}_benchmark.json`));
    if (!d) {
      lines.push(`| ${p} |` + " not run |".repeat(metrics.length));
      continue;
    }
    const row = [p];
    for (const m of metrics) {
      const r = d.reads[m] || {};
      row.push(`${r.p50_ms ?? "-"} / ${r.p95_ms ?? "-"}`);
    }
    lines.push("| " + row.join(" | ") + " |");
  }

  lines.push("\n## Mixed Read/Write Workload\n");
  lines.push("| Platform | Concurrency | Duration (s) | Reads | Writes | Errors | Throughput (qps) |");
  lines.push("|---|---|---|---|---|---|---|");
  for (const p of PLATFORMS) {
    const d = loadJson(path.join(RESULTS_DIR, `${p}_benchmark.json`));
    if (!d) continue;
    const m = d.mixed_workload;
    lines.push(
      `| ${p} | ${m.concurrency} | ${m.duration_seconds} | ${m.reads} | ${m.writes} | ${m.errors} | ${m.throughput_qps} |`
    );
  }

  if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const outPath = path.join(RESULTS_DIR, "results_table.md");
  fs.writeFileSync(outPath, lines.join("\n") + "\n");
  console.log(`Wrote ${outPath}`);
}

main();
