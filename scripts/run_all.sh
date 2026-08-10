#!/usr/bin/env bash
# One-command benchmark run across every platform.
# Requires .env populated (see .env.example) and data/nodes.csv + data/edges.csv present.
set -e

cd "$(dirname "$0")/.."

echo "== Preparing dataset (skip if already generated) =="
if [ ! -f data/nodes.csv ]; then
  node data/prepare_dataset.js --source snap --target-edges 200000
fi

BOLT_PLATFORMS=(cognodb aura memgraph)

for p in "${BOLT_PLATFORMS[@]}"; do
  echo "== $p: schema =="
  node loaders/bolt_platform.js --platform "$p" --mode schema
  echo "== $p: load =="
  node loaders/bolt_platform.js --platform "$p" --mode load
  echo "== $p: benchmark =="
  node loaders/bolt_platform.js --platform "$p" --mode benchmark --iterations 100 --concurrency 10 --duration 30
done

echo "== arangodb: schema =="
node loaders/arango_platform.js --mode schema
echo "== arangodb: load =="
node loaders/arango_platform.js --mode load
echo "== arangodb: benchmark =="
node loaders/arango_platform.js --mode benchmark --iterations 100 --concurrency 10 --duration 30

echo "== tigergraph: schema (manual GSQL step — see printed instructions) =="
node loaders/tigergraph_platform.js --mode schema
echo "Paste the schema above into TigerGraph's GSQL console, then press enter to continue..."
read -r
echo "== tigergraph: load =="
node loaders/tigergraph_platform.js --mode load
echo "== tigergraph: benchmark =="
node loaders/tigergraph_platform.js --mode benchmark --iterations 100 --concurrency 10 --duration 30

echo "== Building results tables =="
node scripts/build_report.js

echo "Done. See results/ for raw JSON and results/results_table.md for the README-ready tables."
