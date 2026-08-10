/**
 * Cypher query definitions shared by every Bolt-protocol platform
 * (CognoDB, Neo4j Aura, Memgraph). Keeping these in one file guarantees
 * every platform runs the exact same logical query.
 */

const TRAVERSAL_1HOP = `
MATCH (a:Person {id: $start_id})-[:FOLLOWS]->(b:Person)
RETURN count(b) AS n
`;

const TRAVERSAL_2HOP = `
MATCH (a:Person {id: $start_id})-[:FOLLOWS]->()-[:FOLLOWS]->(b:Person)
RETURN count(DISTINCT b) AS n
`;

const TRAVERSAL_3HOP = `
MATCH (a:Person {id: $start_id})-[:FOLLOWS]->()-[:FOLLOWS]->()-[:FOLLOWS]->(b:Person)
RETURN count(DISTINCT b) AS n
`;

// Point lookup on the primary key (always indexed via uniqueness constraint)
const POINT_LOOKUP = `
MATCH (a:Person {id: $start_id})
RETURN a.id AS id
`;

// Filtered lookup on a secondary indexed property — create the index in
// schema setup below before benchmarking, and note it in the README.
const FILTERED_LOOKUP = `
MATCH (a:Person)
WHERE a.degree_bucket = $bucket
RETURN a.id AS id
LIMIT 50
`;

const AGGREGATION = `
MATCH (a:Person)-[r:FOLLOWS]->()
RETURN a.degree_bucket AS bucket, count(r) AS edge_count
ORDER BY edge_count DESC
`;

const WRITE_SAMPLE = `
MATCH (a:Person {id: $start_id}), (b:Person {id: $target_id})
MERGE (a)-[:FOLLOWS]->(b)
`;

// Run once per platform before loading data
const SCHEMA_SETUP = [
  "CREATE CONSTRAINT person_id_unique IF NOT EXISTS FOR (p:Person) REQUIRE p.id IS UNIQUE",
  "CREATE INDEX person_degree_bucket IF NOT EXISTS FOR (p:Person) ON (p.degree_bucket)",
];

module.exports = {
  TRAVERSAL_1HOP,
  TRAVERSAL_2HOP,
  TRAVERSAL_3HOP,
  POINT_LOOKUP,
  FILTERED_LOOKUP,
  AGGREGATION,
  WRITE_SAMPLE,
  SCHEMA_SETUP,
};
