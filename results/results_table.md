# Results Matrix

## Data Loading

| Platform | Nodes | Relationships | Load Time (s) | Nodes/s | Rels/s |
|---|---|---|---|---|---|
| cognodb | 33333 | 199977 | 75.31 | 2808.5 | 3152 |
| aura | 33333 | 199977 | 41.95 | 4782.1 | 5717.6 |
| memgraph | - | - | - | - | not run |
| arangodb | 33333 | 199977 | 281.76 | 731.4 | 846.7 |
| tigergraph | - | - | - | - | not run |

## Traversals, Lookups, Aggregation (p50 / p95 ms)

| Platform | 1hop p50/p95 | 2hop p50/p95 | 3hop p50/p95 | point_lookup p50/p95 | filtered_lookup p50/p95 | aggregation p50/p95 |
|---|---|---|---|---|---|---|
| cognodb | 260.84 / 307.18 | 268.23 / 308.06 | 268.69 / 316.1 | 267.89 / 315.64 | 280.19 / 319.87 | 575.78 / 615.66 |
| aura | 102.4 / 233.35 | 102.39 / 172.26 | 82.56 / 132.62 | 97.69 / 185.03 | 102.15 / 135.33 | 106.67 / 160.18 |
| memgraph | not run | not run | not run | not run | not run | not run |
| arangodb | not run | not run | not run | not run | not run | not run |
| tigergraph | not run | not run | not run | not run | not run | not run |

## Mixed Read/Write Workload

| Platform | Concurrency | Duration (s) | Reads | Writes | Errors | Throughput (qps) |
|---|---|---|---|---|---|---|
| cognodb | 10 | 30.3 | 895 | 244 | 0 | 37.6 |
| aura | 10 | 30 | 2274 | 521 | 0 | 93.2 |
