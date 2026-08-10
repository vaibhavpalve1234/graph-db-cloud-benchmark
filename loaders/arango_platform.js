
const { setGlobalDispatcher, Agent } = require("undici");
setGlobalDispatcher(new Agent({ connect: { family: 4 } }));

require("dotenv").config();
const { Database, aql } = require("arangojs");
const { loadNodeIds, loadEdges, percentile, saveResult, chunk, randomChoice, randomSampleTwo } = require("./util");

const BATCH_SIZE = 1000;

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

function getDb() {
  const db = new Database({
    url: process.env.ARANGO_URL,
    databaseName: "cognodb",
    auth: { username: process.env.ARANGO_USER, password: process.env.ARANGO_PASSWORD },
  });
  return db;
}

function round2(x) {
  return Math.round(x * 100) / 100;
}
function round1(x) {
  return Math.round(x * 10) / 10;
}

async function runSchema(db) {
  const people = db.collection("people");
  const follows = db.collection("FOLLOWS");
  if (!(await people.exists())) await people.create();
  if (!(await follows.exists())) await follows.create({ type: 3 }); // edge collection
  await people.ensureIndex({ type: "persistent", fields: ["degree_bucket"] });
  console.log("Collections and index created.");
}

async function loadData(db) {
  const nodes = loadNodeIds();
  const edges = loadEdges();
  const people = db.collection("people");
  const follows = db.collection("FOLLOWS");

  console.log(`Loading ${nodes.length} nodes and ${edges.length} relationships into arangodb...`);

  const t0 = process.hrtime.bigint();
  for (const batch of chunk(nodes, BATCH_SIZE)) {
    const docs = batch.map((n) => ({ _key: n, degree_bucket: parseInt(n, 10) % 20 }));
    await people.saveAll(docs, { overwriteMode: "replace" });
  }
  const tNodes = process.hrtime.bigint();

  for (const batch of chunk(edges, BATCH_SIZE)) {
    const docs = batch.map(([s, d]) => ({ _from: `people/${s}`, _to: `people/${d}` }));
    await follows.saveAll(docs, { overwriteMode: "replace" });
  }
  const tEdges = process.hrtime.bigint();

  const nodeTime = Number(tNodes - t0) / 1e9;
  const edgeTime = Number(tEdges - tNodes) / 1e9;

  const result = {
    platform: "arangodb",
    node_count: nodes.length,
    relationship_count: edges.length,
    node_load_seconds: round2(nodeTime),
    relationship_load_seconds: round2(edgeTime),
    total_load_seconds: round2(Number(tEdges - t0) / 1e9),
    nodes_per_second: nodeTime > 0 ? round1(nodes.length / nodeTime) : null,
    relationships_per_second: edgeTime > 0 ? round1(edges.length / edgeTime) : null,
  };
  saveResult("arangodb", "load", result);
  console.log(JSON.stringify(result, null, 2));
}

async function timedQuery(db, queryFn, iterations, warmup = 10) {
  for (let i = 0; i < warmup; i++) {
    const cursor = await db.query(queryFn());
    await cursor.all();
  }
  const latencies = [];
  for (let i = 0; i < iterations; i++) {
    const t0 = process.hrtime.bigint();
    const cursor = await db.query(queryFn());
    await cursor.all();
    const t1 = process.hrtime.bigint();
    latencies.push(Number(t1 - t0) / 1e6);
  }
  return { p50_ms: round2(percentile(latencies, 50)), p95_ms: round2(percentile(latencies, 95)), iterations };
}

async function runReadBenchmarks(db, iterations = 100) {
  const nodeIds = loadNodeIds();

  return {
    "1hop": await timedQuery(
      db,
      () => aql`FOR v IN 1..1 OUTBOUND ${`people/${randomChoice(nodeIds)}`} FOLLOWS COLLECT WITH COUNT INTO n RETURN n`,
      iterations
    ),
    "2hop": await timedQuery(
      db,
      () => aql`FOR v IN 2..2 OUTBOUND ${`people/${randomChoice(nodeIds)}`} FOLLOWS COLLECT WITH COUNT INTO n RETURN n`,
      iterations
    ),
    "3hop": await timedQuery(
      db,
      () => aql`FOR v IN 3..3 OUTBOUND ${`people/${randomChoice(nodeIds)}`} FOLLOWS COLLECT WITH COUNT INTO n RETURN n`,
      iterations
    ),
    point_lookup: await timedQuery(db, () => aql`RETURN DOCUMENT('people', ${randomChoice(nodeIds)})`, iterations),
    filtered_lookup: await timedQuery(
      db,
      () => aql`FOR p IN people FILTER p.degree_bucket == ${Math.floor(Math.random() * 20)} LIMIT 50 RETURN p._key`,
      iterations
    ),
    aggregation: await timedQuery(
      db,
      () =>
        aql`FOR e IN FOLLOWS COLLECT bucket = DOCUMENT(e._from).degree_bucket WITH COUNT INTO edge_count SORT edge_count DESC RETURN {bucket, edge_count}`,
      Math.min(iterations, 30)
    ),
  };
}

async function runMixedWorkload(db, concurrency = 10, durationS = 30, readRatio = 0.8) {
  const nodeIds = loadNodeIds();
  const stopTime = Date.now() + durationS * 1000;
  const counters = { reads: 0, writes: 0, errors: 0 };

  async function worker() {
    while (Date.now() < stopTime) {
      try {
        if (Math.random() < readRatio) {
          const cursor = await db.query(
            aql`FOR v IN 1..1 OUTBOUND ${`people/${randomChoice(nodeIds)}`} FOLLOWS COLLECT WITH COUNT INTO n RETURN n`
          );
          await cursor.all();
          counters.reads++;
        } else {
          const [a, b] = randomSampleTwo(nodeIds);
          await db.query(aql`INSERT { _from: ${`people/${a}`}, _to: ${`people/${b}`} } INTO FOLLOWS`);
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
    console.error("Usage: node arango_platform.js --mode <schema|load|benchmark>");
    process.exit(1);
  }

  const db = getDb();
  if (args.mode === "schema") {
    await runSchema(db);
  } else if (args.mode === "load") {
    await loadData(db);
  } else if (args.mode === "benchmark") {
    const reads = await runReadBenchmarks(db, args.iterations);
    const mixed = await runMixedWorkload(db, args.concurrency, args.duration);
    const result = { reads, mixed_workload: mixed };
    saveResult("arangodb", "benchmark", result);
    console.log(JSON.stringify(result, null, 2));
  }
})();
