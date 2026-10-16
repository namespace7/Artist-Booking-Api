# Task 4 — System Design (`GET /artists/search` Scaling)

### 1. Two Most Likely Causes & First Diagnostic Checks
1. Unindexed search filters and live aggregations: At 50,000 users, `GET /artists/search` is likely running full table scans `LIKE '%term%'`, or joining `bookings` and `reviews` on every search request to compute ratings, driving MySQL CPU to 90%.
2. connection-pool queuing: Returning unpaginated rows or running slow queries holds MySQL connections open, saturating the Node.js pool (`connectionLimit`) and causing request timeouts.

What to check first: Inspect the MySQL slow query log, run `EXPLAIN ANALYZE` on the search query to verify examined row counts and missing indexes, and check `SHOW PROCESSLIST` alongside Node.js connection-pool wait latency metrics.

### 2. 48-Hour Zero-Downtime Fix
We start with query plans, measured indexing, connection-pool metrics, and bounded results before adding new infrastructure:
1. Add online composite indexes and bound pagination: Use `ALTER TABLE ... ADD INDEX ..., ALGORITHM=INPLACE, LOCK=NONE` on the exact filter/sort columns confirmed by `EXPLAIN`, and enforce a strict `LIMIT` (e.g., 20 results per page) with only summary fields selected.
2. ache hot search queries and pre-aggregate ratings: Cache common search filter combinations in Redis (or in-memory with a 60–120s TTL) and read precomputed rating summaries instead of joining `reviews` live on every search.

### 3. Long-Term Architectural Fix & Trade-Off
Move search and discovery (`GET /artists/search`) to a dedicated search index (Elasticsearch / Typesense)

Trade-off accepted: Eventual consistency and operational complexity: —newly updated artist profiles, ratings, or availability slots may take a few seconds to appear in search results, and we must monitor indexing pipelines.
