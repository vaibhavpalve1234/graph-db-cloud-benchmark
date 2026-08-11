require("dotenv").config();
const neo4j = require("neo4j-driver");
const {
  TRAVERSAL_1HOP,
  TRAVERSAL_2HOP,
  TRAVERSAL_3HOP,
  POINT_LOOKUP,
  FILTERED_LOOKUP,
  AGGREGATION,
  WRITE_SAMPLE,
  SCHEMA_SETUP,
} = require("../workloads/queries_cypher");
const { loadNodeIds, loadEdges, percentile, saveResult, chunk, randomChoice, randomSampleTwo } = require("./util");

const BATCH_SIZE = 1000;

function parseArgs() {
  const args = { platform: null, mode: null, iterations: 100, concurrency: 10, duration: 30 };
  process.argv.slice(2).forEach((arg, i, arr) => {
    if (arg === "--platform") args.platform = arr[i + 1];
    if (arg === "--mode") args.mode = arr[i + 1];
    if (arg === "--iterations") args.iterations = parseInt(arr[i + 1], 10);
    if (arg === "--concurrency") args.concurrency = parseInt(arr[i + 1], 10);
    if (arg === "--duration") args.duration = parseInt(arr[i + 1], 10);
  });
  return args;
}

function getDriver(platform) {
  const prefix = platform.toUpperCase();
  const uri = process.env[`${prefix}_URI`];
  const user = process.env[`${prefix}_USER`];
  const password = process.env[`${prefix}_PASSWORD`];
  return neo4j.driver(uri, neo4j.auth.basic(user, password));
}

async function runSchema(driver) {
  const session = driver.session();
  try {
    for (const stmt of SCHEMA_SETUP) {
      await session.run(stmt);
    }
    console.log("Schema/constraints applied.");
  } finally {
    await session.close();
  }
}

async function loadData(driver, platform) {
  const nodes = loadNodeIds();
  const edges = loadEdges();

  console.log(`Loading ${nodes.length} nodes and ${edges.length} relationships into ${platform}...`);

  const session = driver.session();
  const t0 = process.hrtime.bigint();
  try {
    for (const batch of chunk(nodes, BATCH_SIZE)) {
      await session.run(
        `UNWIND $batch AS row
         MERGE (p:Person {id: row})
         SET p.degree_bucket = toInteger(row) % 20`,
        { batch }
      );
    }
    const tNodes = process.hrtime.bigint();

    for (const batch of chunk(edges, BATCH_SIZE)) {
      const rows = batch.map(([src, dst]) => ({ src, dst }));
      await session.run(
        `UNWIND $batch AS row
         MATCH (a:Person {id: row.src}), (b:Person {id: row.dst})
         MERGE (a)-[:FOLLOWS]->(b)`,
        { batch: rows }
      );
    }
    const tEdges = process.hrtime.bigint();

    const nodeTime = Number(tNodes - t0) / 1e9;
    const edgeTime = Number(tEdges - tNodes) / 1e9;
    const totalTime = Number(tEdges - t0) / 1e9;

    const result = {
      platform,
      node_count: nodes.length,
      relationship_count: edges.length,
      node_load_seconds: round2(nodeTime),
      relationship_load_seconds: round2(edgeTime),
      total_load_seconds: round2(totalTime),
      nodes_per_second: nodeTime > 0 ? round1(nodes.length / nodeTime) : null,
      relationships_per_second: edgeTime > 0 ? round1(edges.length / edgeTime) : null,
    };
    saveResult(platform, "load", result);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await session.close();
  }
}

function round2(x) {
  return Math.round(x * 100) / 100;
}
function round1(x) {
  return Math.round(x * 10) / 10;
}

async function timedQuery(driver, query, paramsFn, iterations, warmup = 10) {
  const session = driver.session();
  try {
    for (let i = 0; i < warmup; i++) {
      await session.run(query, paramsFn());
    }
    const latencies = [];
    for (let i = 0; i < iterations; i++) {
      const params = paramsFn();
      const t0 = process.hrtime.bigint();
      await session.run(query, params);
      const t1 = process.hrtime.bigint();
      latencies.push(Number(t1 - t0) / 1e6); // ms
    }
    return {
      p50_ms: round2(percentile(latencies, 50)),
      p95_ms: round2(percentile(latencies, 95)),
      iterations,
    };
  } finally {
    await session.close();
  }
}

async function runReadBenchmarks(driver, iterations = 100) {
  const nodeIds = loadNodeIds();

  const randId = () => ({ start_id: randomChoice(nodeIds) });
  const randBucket = () => ({ bucket: Math.floor(Math.random() * 20) });
  const noParams = () => ({});

  return {
    "1hop": await timedQuery(driver, TRAVERSAL_1HOP, randId, iterations),
    "2hop": await timedQuery(driver, TRAVERSAL_2HOP, randId, iterations),
    "3hop": await timedQuery(driver, TRAVERSAL_3HOP, randId, iterations),
    point_lookup: await timedQuery(driver, POINT_LOOKUP, randId, iterations),
    filtered_lookup: await timedQuery(driver, FILTERED_LOOKUP, randBucket, iterations),
    aggregation: await timedQuery(driver, AGGREGATION, noParams, Math.min(iterations, 30)),
  };
}

async function runMixedWorkload(driver, concurrency = 10, durationS = 30, readRatio = 0.8) {
  const nodeIds = loadNodeIds();
  const stopTime = Date.now() + durationS * 1000;
  const counters = { reads: 0, writes: 0, errors: 0 };

  async function worker() {
    const session = driver.session();
    try {
      while (Date.now() < stopTime) {
        try {
          if (Math.random() < readRatio) {
            await session.run(TRAVERSAL_1HOP, { start_id: randomChoice(nodeIds) });
            counters.reads++;
          } else {
            const [a, b] = randomSampleTwo(nodeIds);
            await session.run(WRITE_SAMPLE, { start_id: a, target_id: b });
            counters.writes++;
          }
        } catch (e) {
          counters.errors++;
        }
      }
    } finally {
      await session.close();
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
  if (!args.platform || !args.mode) {
    console.error("Usage: node bolt_platform.js --platform <cognodb|aura|memgraph> --mode <schema|load|benchmark>");
    process.exit(1);
  }

  const driver = getDriver(args.platform);
  try {
    if (args.mode === "schema") {
      await runSchema(driver);
    } else if (args.mode === "load") {
      await loadData(driver, args.platform);
    } else if (args.mode === "benchmark") {
      const reads = await runReadBenchmarks(driver, args.iterations);
      const mixed = await runMixedWorkload(driver, args.concurrency, args.duration);
      const result = { reads, mixed_workload: mixed };
      saveResult(args.platform, "benchmark", result);
      console.log(JSON.stringify(result, null, 2));
    }
  } finally {
    await driver.close();
  }
})();
