#!/usr/bin/env bash

set -euo pipefail

# ============================================================
# CognoDB Multi-Platform Benchmark
# ============================================================

# ------------------------------------------------------------
# 1. Find project root
# ------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_ROOT"

echo "=========================================="
echo "   CognoDB Multi-Platform Benchmark"
echo "=========================================="
echo
echo "Project root: $PROJECT_ROOT"
echo


# ------------------------------------------------------------
# 2. Load .env
# ------------------------------------------------------------

ENV_FILE="$PROJECT_ROOT/.env"

if [ ! -f "$ENV_FILE" ]; then
    echo "ERROR: .env file not found!"
    echo
    echo "Expected:"
    echo "  $ENV_FILE"
    echo
    exit 1
fi

echo "== Loading environment variables =="

# Export variables loaded from .env
set -a

# POSIX-compatible source
. "$ENV_FILE"

set +a

echo "== Environment loaded successfully =="
echo


# ------------------------------------------------------------
# 3. Validate required environment variables
# ------------------------------------------------------------

echo "== Validating environment variables =="

REQUIRED_VARS=(
    "COGNODB_URI"
    "COGNODB_USER"
    "COGNODB_PASSWORD"

    "AURA_URI"
    "AURA_USER"
    "AURA_PASSWORD"
    "AURA_DATABASE"

    "MEMGRAPH_URI"
    "MEMGRAPH_DATABASE"

    "ARANGO_URL"
    "ARANGO_DB"
    "ARANGO_USER"
    "ARANGO_PASSWORD"

    "TIGERGRAPH_HOST"
    "TIGERGRAPH_USER"
    "TIGERGRAPH_PASSWORD"
    "TIGERGRAPH_GRAPH"
)

MISSING_VARS=0

for VAR in "${REQUIRED_VARS[@]}"; do

    if [ -z "${!VAR:-}" ]; then
        echo "ERROR: Missing environment variable: $VAR"
        MISSING_VARS=1
    fi

done

if [ "$MISSING_VARS" -ne 0 ]; then
    echo
    echo "Please check your .env file."
    exit 1
fi

echo "All required environment variables are present."
echo


# ------------------------------------------------------------
# 4. Check Node.js
# ------------------------------------------------------------

echo "== Checking Node.js =="

if ! command -v node >/dev/null 2>&1; then
    echo "ERROR: Node.js is not installed or not in PATH."
    exit 1
fi

echo "Node version: $(node --version)"
echo "NPM version:  $(npm --version)"
echo


# ------------------------------------------------------------
# 5. Check dataset
# ------------------------------------------------------------

echo "=========================================="
echo "== Preparing dataset =="
echo "=========================================="

if [ ! -f "$PROJECT_ROOT/data/nodes.csv" ]; then

    echo "nodes.csv not found."
    echo "Generating dataset..."

    node "$PROJECT_ROOT/data/prepare_dataset.js" \
        --source snap \
        --target-edges 200000

else

    echo "Dataset already exists."
    echo "Skipping dataset generation."

fi


if [ ! -f "$PROJECT_ROOT/data/edges.csv" ]; then

    echo
    echo "ERROR: data/edges.csv was not generated/found."
    exit 1

fi

echo "Dataset ready."
echo


# ============================================================
# 6. BOLT platforms
# ============================================================

BOLT_PLATFORMS=(
    cognodb
    aura
    memgraph
)

for PLATFORM in "${BOLT_PLATFORMS[@]}"; do

    echo
    echo "=========================================="
    echo "== $PLATFORM: schema =="
    echo "=========================================="

    node "$PROJECT_ROOT/loaders/bolt_platform.js" \
        --platform "$PLATFORM" \
        --mode schema


    echo
    echo "=========================================="
    echo "== $PLATFORM: load =="
    echo "=========================================="

    node "$PROJECT_ROOT/loaders/bolt_platform.js" \
        --platform "$PLATFORM" \
        --mode load


    echo
    echo "=========================================="
    echo "== $PLATFORM: benchmark =="
    echo "=========================================="

    node "$PROJECT_ROOT/loaders/bolt_platform.js" \
        --platform "$PLATFORM" \
        --mode benchmark \
        --iterations 100 \
        --concurrency 10 \
        --duration 30

done


# ============================================================
# 7. ArangoDB
# ============================================================

echo
echo "=========================================="
echo "== arangodb: schema =="
echo "=========================================="

node "$PROJECT_ROOT/loaders/arango_platform.js" \
    --mode schema


echo
echo "=========================================="
echo "== arangodb: load =="
echo "=========================================="

node "$PROJECT_ROOT/loaders/arango_platform.js" \
    --mode load


echo
echo "=========================================="
echo "== arangodb: benchmark =="
echo "=========================================="

node "$PROJECT_ROOT/loaders/arango_platform.js" \
    --mode benchmark \
    --iterations 100 \
    --concurrency 10 \
    --duration 30


# ============================================================
# 8. TigerGraph
# ============================================================

echo
echo "=========================================="
echo "== tigergraph: schema =="
echo "=========================================="

node "$PROJECT_ROOT/loaders/tigergraph_platform.js" \
    --mode schema

echo
echo "============================================================"
echo "TigerGraph schema has been generated."
echo "Paste the schema into TigerGraph GSQL console."
echo "============================================================"
echo

read -r -p "Press ENTER after the TigerGraph schema is created..."


echo
echo "=========================================="
echo "== tigergraph: load =="
echo "=========================================="

node "$PROJECT_ROOT/loaders/tigergraph_platform.js" \
    --mode load


echo
echo "=========================================="
echo "== tigergraph: benchmark =="
echo "=========================================="

node "$PROJECT_ROOT/loaders/tigergraph_platform.js" \
    --mode benchmark \
    --iterations 100 \
    --concurrency 10 \
    --duration 30


# ============================================================
# 9. Build report
# ============================================================

echo
echo "=========================================="
echo "== Building results tables =="
echo "=========================================="

node "$PROJECT_ROOT/scripts/build_report.js"


# ============================================================
# 10. Finished
# ============================================================

echo
echo "=========================================="
echo "          BENCHMARK COMPLETE
=========================================="

echo
echo "Results:"
echo "  $PROJECT_ROOT/results/"

echo
echo "README-ready table:"
echo "  $PROJECT_ROOT/results/results_table.md"

echo
echo "Done."