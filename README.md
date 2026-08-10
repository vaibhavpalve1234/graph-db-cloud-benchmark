# CognoDB Cloud Graph Database Benchmark (Node.js)

A reproducible benchmark comparing [CognoDB Cloud](https://cognodb.com) against four other
managed graph database platforms on identical hardware tiers, the same dataset, and the same
logical query workloads.

**TL;DR result:** _fill in one sentence once you have numbers — do not editorialize beyond what the data shows._

## Platforms compared

| Platform | Tier | vCPU | RAM | Disk | Query language | Node driver |
|---|---|---|---|---|---|---|
| CognoDB Cloud | Free (c0) | 0.5 (burstable) | 256 MB | 1 GB | Cypher (Bolt) | `neo4j-driver` |
| Neo4j AuraDB | Free | _fill in_ | _fill in_ | _fill in_ | Cypher (Bolt) | `neo4j-driver` |
| Memgraph Cloud | Free | _fill in_ | _fill in_ | _fill in_ | Cypher (Bolt) | `neo4j-driver` |
| ArangoDB Oasis | Free trial | _fill in_ | _fill in_ | _fill in_ | AQL | `arangojs` |
| TigerGraph Cloud | Free | _fill in_ | _fill in_ | _fill in_ | GSQL | REST via `axios` |

> Fairness note: every platform above must be sized to match CognoDB's free tier (0.5 vCPU /
> 256 MB / 1 GB) as closely as its free/entry tier allows. Where a platform's free tier is
> larger, say so explicitly here rather than hiding the mismatch — that's a caveat, not a failure.

## Dataset

- **Source:** _fill in — e.g. SNAP soc-Pokec, sampled_
- **Nodes:** _fill in (from data/dataset_info.json)_
- **Relationships:** _fill in_
- **Sampling method:** random edge sample to fit the smallest tier's 1 GB disk limit (see `data/prepare_dataset.js`)

## Methodology

- All platforms load the identical `data/nodes.csv` / `data/edges.csv` files.
- All Bolt-protocol platforms (CognoDB, Aura, Memgraph) run the *exact same* Cypher (`workloads/queries_cypher.js`).
  ArangoDB and TigerGraph run logically equivalent queries in AQL / GSQL respectively — see `loaders/`.
- Each read workload runs 10 warm-up iterations, then 100 measured iterations; p50/p95 are reported.
- Mixed workload: configurable concurrency (default 10 clients), 80/20 read/write mix, 30-second duration.
- Client machine: _fill in — same machine/region for every platform run_
- All runs are automated via `scripts/run_all.sh` — no manual query execution (except the one-time
  TigerGraph GSQL schema paste, which is a platform requirement, not a methodology shortcut).

## How to reproduce

```bash
npm install
cp .env.example .env   # fill in your own free-tier credentials for each platform
node data/prepare_dataset.js --source snap --target-edges 200000
bash scripts/run_all.sh
```

Requires Node 18+. Results land as JSON in `results/`, and `scripts/build_report.js` compiles
them into `results/results_table.md` — paste that directly into the section below.

## Results

_Paste the generated contents of `results/results_table.md` here after a full run._

### Data loading

_table_

### Traversals, lookups, aggregation (p50 / p95 ms)

_table_

### Mixed read/write throughput

_table_

### Footprint

| Platform | Stored data size | Memory (if observable) | Notes |
|---|---|---|---|
| CognoDB | _fill in or "not observable"_ | _fill in_ | |
| Aura | | | |
| Memgraph | | | |
| ArangoDB | | | |
| TigerGraph | | | |

## Analysis

_Write 3-5 paragraphs once you have real numbers:_
- Which platform was fastest/slowest per category, and by how much?
- Root-cause reasoning: in-memory (Memgraph) vs disk-backed, native graph storage vs
  document-graph hybrid (ArangoDB), MPP architecture (TigerGraph), free-tier CPU throttling, etc.
- Where results were noisy or inconsistent across repeated runs.

## Caveats

- _List every free-tier throttling incident, timeout, failed run, network variance, or
  query-language limitation you hit. Honest caveats are scored positively — do not omit them._
- Note: TigerGraph's Node ecosystem lacks an official maintained SDK, so this benchmark talks to
  its REST++ API directly via `axios` — mention this as a methodology note, since it adds a thin
  HTTP layer that Bolt/AQL clients don't have.

## Repository structure

```
data/            dataset generation + the dataset itself
loaders/         one loader/benchmark script per platform family, plus shared util.js
workloads/       shared Cypher query definitions
scripts/         orchestration (run_all.sh) and report generation
results/         raw JSON results + generated markdown tables
```
