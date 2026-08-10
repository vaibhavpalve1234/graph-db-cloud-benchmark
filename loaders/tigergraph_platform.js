/**
 * Loader + benchmark runner for TigerGraph Cloud, using axios against
 * TigerGraph's REST++ API (there's no official maintained TigerGraph SDK
 * for Node, so we talk REST directly).
 *
 * TigerGraph needs a schema and installed GSQL queries (not ad-hoc query
 * strings like Cypher/AQL). Run --mode schema first — it prints the GSQL
 * to paste into the TigerGraph GraphStudio / GSQL console once.
 *
 * Usage:
 *   node loaders/tigergraph_platform.js --mode schema     # prints setup GSQL
 *   node loaders/tigergraph_platform.js --mode load
 *   node loaders/tigergraph_platform.js --mode benchmark --concurrency 10
 */

const { setGlobalDispatcher, Agent } = require("undici");
setGlobalDispatcher(new Agent({ connect: { family: 4 } }));

require("dotenv").config();
const axios = require("axios");
const { loadNodeIds, loadEdges, percentile, saveResult, chunk, randomChoice, randomSampleTwo } = require("./util");

const BATCH_SIZE = 1000;

const GSQL_SCHEMA = `
CREATE VERTEX Person (PRIMARY_ID id STRING, degree_bucket INT)
CREATE DIRECTED EDGE FOLLOWS (FROM Person, TO Person)
CREATE GRAPH benchmark (Person, FOLLOWS)

USE GRAPH benchmark

CREATE QUERY hop_count(VERTEX<Person> start_id, INT depth) FOR GRAPH benchmark {
  SetAccum<VERTEX> @@seen;
  Start = {start_id};
  FROM_SET = Start;
  WHILE depth > 0 DO
    FROM_SET = SELECT t FROM FROM_SET:s -(FOLLOWS:e)-> Person:t
                ACCUM @@seen += t;
    depth = depth - 1;
  END;
  PRINT @@seen.size() AS n;
}

CREATE QUERY point_lookup(VERTEX<Person> start_id) FOR GRAPH benchmark {
  Start = {start_id};
  PRINT Start;
}

CREATE QUERY filtered_lookup(INT bucket) FOR GRAPH benchmark {
  Result = SELECT p FROM Person:p WHERE p.degree_bucket == bucket LIMIT 50;
  PRINT Result;
}

CREATE QUERY aggregation() FOR GRAPH benchmark {
  Result = SELECT p FROM Person:p
           ACCUM @@bucket_count.groupBy(p.degree_bucket) += 1;
  PRINT Result;
}

INSTALL QUERY hop_count, point_lookup, filtered_lookup, aggregation
`;

function parseArgs() {
  const args = { mode: null, iterations: 100, concurrency: 10, duration: 30 };
  process.argv.slice(2).forEach((arg, i, arr) => {
    if (arg === "--mode") args.mode = arr[i + 1];
    if (arg === "--iterations") args.iterations = parseInt(arr[i + 1], 10);
    if (arg === "--concurrency") args.concurrency = parseInt(arr[i + 1], 10);
    if (arg === "--duration") args.duration = parseInt(arr[i + 1], 10);
  });
  return args;
}

function round2(x) {
  return Math.round(x * 100) / 100;
}
function round1(x) {
  return Math.round(x * 10) / 10;
}

async function getToken() {
  const host = process.env.TIGERGRAPH_HOST;
  const graph = process.env.TIGERGRAPH_GRAPH;
  // TigerGraph Cloud REST++ auth: POST /requesttoken with a secret you generate
  // in GraphStudio once (Admin Portal > Users > generate secret) and store as
  // TIGERGRAPH_PASSWORD, or use basic auth directly depending on your plan.
  const res = await axios.post(`${host}:9000/requesttoken`, {
    secret: process.env.TIGERGRAPH_PASSWORD,
    graph,
  });
  return res.data.token;
}

function print_schema() {
  console.log("Paste the following into TigerGraph GraphStudio / GSQL shell once:\n");
  console.log(GSQL_SCHEMA);
}

async function loadData(host, token, graph) {
  const nodes = loadNodeIds();
  const edges = loadEdges();

  console.log(`Loading ${nodes.length} nodes and ${edges.length} relationships into tigergraph...`);

  const headers = { Authorization: `Bearer ${token}` };
  const t0 = process.hrtime.bigint();

  for (const batch of chunk(nodes, BATCH_SIZE)) {
    const vertices = {};
    batch.forEach((n) => {
      vertices[n] = { degree_bucket: { value: parseInt(n, 10) % 20 } };
    });
    await axios.post(`${host}:9000/graph/${graph}`, { vertices: { Person: vertices } }, { headers });
  }
  const tNodes = process.hrtime.bigint();

  for (const batch of chunk(edges, BATCH_SIZE)) {
    const followsEdges = {};
    batch.forEach(([s, d]) => {
      followsEdges[s] = followsEdges[s] || {};
      followsEdges[s][d] = followsEdges[s][d] || {};
      followsEdges[s][d] = { ...followsEdges[s][d] };
    });
    await axios.post(
      `${host}:9000/graph/${graph}`,
      { edges: { Person: followsEdges && { FOLLOWS: { Person: followsEdges } } } },
      { headers }
    );
  }
  const tEdges = process.hrtime.bigint();

  const nodeTime = Number(tNodes - t0) / 1e9;
  const edgeTime = Number(tEdges - tNodes) / 1e9;

  const result = {
    platform: "tigergraph",
    node_count: nodes.length,
    relationship_count: edges.length,
    node_load_seconds: round2(nodeTime),
    relationship_load_seconds: round2(edgeTime),
    total_load_seconds: round2(Number(tEdges - t0) / 1e9),
    nodes_per_second: nodeTime > 0 ? round1(nodes.length / nodeTime) : null,
    relationships_per_second: edgeTime > 0 ? round1(edges.length / edgeTime) : null,
  };
  saveResult("tigergraph", "load", result);
  console.log(JSON.stringify(result, null, 2));
}

async function timedCall(fn, iterations, warmup = 10) {
  for (let i = 0; i < warmup; i++) await fn();
  const latencies = [];
  for (let i = 0; i < iterations; i++) {
    const t0 = process.hrtime.bigint();
    await fn();
    const t1 = process.hrtime.bigint();
    latencies.push(Number(t1 - t0) / 1e6);
  }
  return { p50_ms: round2(percentile(latencies, 50)), p95_ms: round2(percentile(latencies, 95)), iterations };
}

async function runReadBenchmarks(host, token, graph, iterations = 100) {
  const nodeIds = loadNodeIds();
  const headers = { Authorization: `Bearer ${token}` };
  const runQuery = (name, params) => axios.get(`${host}:9000/query/${graph}/${name}`, { headers, params });

  return {
    "1hop": await timedCall(() => runQuery("hop_count", { start_id: randomChoice(nodeIds), depth: 1 }), iterations),
    "2hop": await timedCall(() => runQuery("hop_count", { start_id: randomChoice(nodeIds), depth: 2 }), iterations),
    "3hop": await timedCall(() => runQuery("hop_count", { start_id: randomChoice(nodeIds), depth: 3 }), iterations),
    point_lookup: await timedCall(() => runQuery("point_lookup", { start_id: randomChoice(nodeIds) }), iterations),
    filtered_lookup: await timedCall(
      () => runQuery("filtered_lookup", { bucket: Math.floor(Math.random() * 20) }),
      iterations
    ),
    aggregation: await timedCall(() => runQuery("aggregation", {}), Math.min(iterations, 30)),
  };
}

async function runMixedWorkload(host, token, graph, concurrency = 10, durationS = 30, readRatio = 0.8) {
  const nodeIds = loadNodeIds();
  const headers = { Authorization: `Bearer ${token}` };
  const stopTime = Date.now() + durationS * 1000;
  const counters = { reads: 0, writes: 0, errors: 0 };

  async function worker() {
    while (Date.now() < stopTime) {
      try {
        if (Math.random() < readRatio) {
          await axios.get(`${host}:9000/query/${graph}/hop_count`, {
            headers,
            params: { start_id: randomChoice(nodeIds), depth: 1 },
          });
          counters.reads++;
        } else {
          const [a, b] = randomSampleTwo(nodeIds);
          await axios.post(
            `${host}:9000/graph/${graph}`,
            { edges: { Person: { [a]: { FOLLOWS: { Person: { [b]: {} } } } } } },
            { headers }
          );
          counters.writes++;
        }
      } catch (e) {
        counters.errors++;
      }
    }
  }

  const t0 = process.hrtime.bigint();
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  const elapsed = Number(process.hrtime.bigint() - t0) / 1e9;

  const totalOps = counters.reads + counters.writes;
  return {
    concurrency,
    duration_seconds: round1(elapsed),
    reads: counters.reads,
    writes: counters.writes,
    errors: counters.errors,
    throughput_qps: round1(totalOps / elapsed),
  };
}

(async () => {
  const args = parseArgs();
  if (!args.mode) {
    console.error("Usage: node tigergraph_platform.js --mode <schema|load|benchmark>");
    process.exit(1);
  }

  if (args.mode === "schema") {
    print_schema();
    return;
  }

  const host = process.env.TIGERGRAPH_HOST;
  const graph = process.env.TIGERGRAPH_GRAPH;
  const token = await getToken();

  if (args.mode === "load") {
    await loadData(host, token, graph);
  } else if (args.mode === "benchmark") {
    const reads = await runReadBenchmarks(host, token, graph, args.iterations);
    const mixed = await runMixedWorkload(host, token, graph, args.concurrency, args.duration);
    const result = { reads, mixed_workload: mixed };
    saveResult("tigergraph", "benchmark", result);
    console.log(JSON.stringify(result, null, 2));
  }
})();
