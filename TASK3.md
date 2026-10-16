# Task 3 — SQL & Database

---

## Task A — Leaderboard Query (`GET /artists/leaderboard`)

### Implemented SQL Query

This is the exact query from `sql/task3_leaderboard.sql`:

```sql
SELECT
    u.id AS artist_id,
    u.name AS artist_name,
    u.category AS category,
    agg.average_score,
    agg.total_reviews,
    COALESCE(bk.completed_count, 0) AS total_completed_bookings
FROM users u
JOIN (
    SELECT b.artist_id,
           ROUND(AVG(r.score), 2) AS average_score,
           COUNT(*) AS total_reviews
    FROM reviews r
    JOIN bookings b ON b.id = r.booking_id
    WHERE r.created_at >= NOW() - INTERVAL 90 DAY
      AND b.status = 'completed'
    GROUP BY b.artist_id
    HAVING COUNT(*) >= 5
) agg ON agg.artist_id = u.id
LEFT JOIN (
    SELECT artist_id, COUNT(*) AS completed_count
    FROM bookings
    WHERE status = 'completed'
    GROUP BY artist_id
) bk ON bk.artist_id = u.id
WHERE u.role = 'artist'
ORDER BY agg.average_score DESC, total_completed_bookings DESC
LIMIT 10;
```

### How the Query Works (Clause by Clause)

1. **`agg` subquery (90-day review stats):**
   - Joins `reviews` to `bookings` (`JOIN bookings b ON b.id = r.booking_id`) and filters to the last 90 days with `WHERE r.created_at >= NOW() - INTERVAL 90 DAY` **and** `b.status = 'completed'`, so only reviews on completed bookings qualify.
   - Groups by `b.artist_id` — the authoritative artist, taken from the booking — and calculates `ROUND(AVG(r.score), 2)` and `COUNT(*)`.
   - Uses `HAVING COUNT(*) >= 5` so artists with fewer than 5 qualifying reviews in the 90-day window are filtered out before joining.

2. **`bk` subquery (completed booking counts):**
   - Counts bookings with `status = 'completed'` per `artist_id` in a separate derived table.
   - **Why separate subqueries matter:** If we joined `users -> bookings -> reviews` in a single flat query, an artist with 20 completed bookings and 10 reviews would produce $20 \times 10 = 200$ joined rows, inflating `COUNT(*)` unless expensive `COUNT(DISTINCT ...)` scans were used. Aggregating `reviews` and `bookings` independently before joining to `users` guarantees exact counts and keeps each aggregation to one row per artist.

3. **Outer `JOIN`, `WHERE u.role = 'artist'`, and `ORDER BY ... LIMIT 10`:**
   - Inner-joins `agg` to `users` (since an artist must have at least 5 recent reviews to appear on the leaderboard) and left-joins `bk` with `COALESCE(..., 0)` for safety.
   - Explicitly filters `WHERE u.role = 'artist'` so client accounts can never appear even if bad data were ever inserted.
   - Orders by `agg.average_score DESC` first and uses `total_completed_bookings DESC` as the tiebreaker, returning the top 10 rows.

### Interpretation of the 90-Day Window

- **Reviews (`average_score` and `total_reviews`):** Filtered to the last 90 days (`created_at >= NOW() - INTERVAL 90 DAY`), matching the prompt requirement: *"top 10 artists by average review score over the last 90 days"* and *"at least 5 reviews in the period"*.
- **Completed bookings (`total_completed_bookings`):** Calculated as the artist's **lifetime** completed booking count. The specification only scopes the review average and 5-review minimum to the 90-day period; using lifetime completed bookings as the tiebreaker rewards overall artist track record when recent review averages are tied. (If a 90-day booking count were desired instead, `AND event_end >= NOW() - INTERVAL 90 DAY` would be added inside the `bk` subquery.)

### Index Strategy & Why Column Order Matters

1. **`idx_reviews_created_booking_score (created_at, booking_id, score)` on `reviews`**:
   - The `agg` subquery range-scans reviews on the 90-day `created_at` window, then needs `booking_id` (the join key to `bookings`) and `score` (the aggregated column). With `created_at` leading, all three columns are read directly from the index (an index-only scan) without touching table data pages; the join to `bookings` then resolves `b.artist_id` and `b.status = 'completed'` by primary key.
   - The `idx_reviews_created_booking_score` index is defined in `sql/schema.sql`. It supports filtering recent reviews and provides `booking_id` and `score` for the leaderboard aggregation.

2. **`idx_bookings_artist_status_start (artist_id, status, event_start)` on `bookings`**:
   - Already present in `sql/schema.sql`. Because the leftmost columns are `(artist_id, status)`, MySQL can satisfy `WHERE status = 'completed' GROUP BY artist_id` using an index scan without reading full booking rows.

### Avoiding Running This Query on Every Request at Scale (Tens of Millions of Rows)

At tens of millions of `reviews` and `bookings` rows, aggregating a 90-day window on every `GET /artists/leaderboard` request will waste CPU and I/O even with covering indexes, because the leaderboard is identical for every caller at any given moment.

**Recommended approach:**
1. **Precomputed Materialized Table + Cache:** Create a small `artist_leaderboard_snapshot` table (containing the 10–100 top rows) and cache the serialized JSON response in **Redis** (or in-process memory with a short TTL, e.g., 1–5 minutes).
2. **Scheduled Background Refresh:** Run a background worker / cron job every 5 minutes against a **read replica** to execute the aggregation query and atomically swap/upsert the snapshot and Redis key.
3. **Trade-off:** Leaderboard rankings can be up to 5 minutes stale, which is completely acceptable for a public top-artists page in exchange for sub-millisecond `O(1)` reads and near-zero load on the primary transactional database.

---

## Task B — Schema Audit

Below is the exact sample schema supplied on pages 5–6 of the assignment:

```sql
CREATE TABLE artists (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(255),
    category VARCHAR(255),
    hourly_rate FLOAT,
    created_at DATETIME
);
CREATE TABLE bookings (
    id INT PRIMARY KEY AUTO_INCREMENT,
    artist_id INT,
    client_id INT,
    status VARCHAR(50),
    amount FLOAT,
    event_start DATETIME,
    event_end DATETIME,
    created_at DATETIME
);
CREATE TABLE reviews (
    id INT PRIMARY KEY AUTO_INCREMENT,
    booking_id INT,
    artist_id INT,
    score INT,
    comment TEXT,
    created_at DATETIME
);
```

### 5 Problems in the Supplied Schema

### Problem 1: `FLOAT` Used for Monetary Columns (`artists.hourly_rate`, `bookings.amount`)

- problem
Both `artists.hourly_rate` and `bookings.amount` use `FLOAT`, which is a base-2 floating-point approximation.
- Why it matters: Base-2 floats cannot represent common decimal fractions like `0.10` or `19.99` exactly. Summing booking amounts, calculating payouts, or comparing rates causes silent rounding discrepancies (e.g., `19.990000000000002`). Financial figures must use exact fixed-point storage.

- SQL to fix it"
  ```sql
  ALTER TABLE artists
    MODIFY COLUMN hourly_rate DECIMAL(10, 2) NOT NULL;

  ALTER TABLE bookings
    MODIFY COLUMN amount DECIMAL(10, 2) NULL;
  ```

#### Problem 2: Missing Foreign Key Constraints and `NOT NULL` on Relationship Columns
- problem is: `bookings.artist_id`, `bookings.client_id`, `reviews.booking_id`, and `reviews.artist_id` are nullable plain `INT` columns with no `FOREIGN KEY` constraints.
- Why it matters: Without `NOT NULL` and foreign keys, the database permits bookings with `NULL` or non-existent `artist_id`/`client_id` values, and orphaned reviews pointing to deleted or non-existent bookings and artists. This corrupts joins and aggregate reports.
- **SQL to fix it:**
  ```sql
  ALTER TABLE bookings
    MODIFY COLUMN artist_id INT NOT NULL,
    MODIFY COLUMN client_id INT NOT NULL,
    ADD CONSTRAINT fk_bookings_artist
      FOREIGN KEY (artist_id) REFERENCES artists(id);

  ALTER TABLE reviews
    MODIFY COLUMN booking_id INT NOT NULL,
    MODIFY COLUMN artist_id INT NOT NULL,
    ADD CONSTRAINT fk_reviews_booking
      FOREIGN KEY (booking_id) REFERENCES bookings(id),
    ADD CONSTRAINT fk_reviews_artist
      FOREIGN KEY (artist_id) REFERENCES artists(id);
  ```

#### Problem 3: Unconstrained `bookings.status` (`VARCHAR(50) NULL`)
- problem: `bookings.status` is a nullable free-text `VARCHAR(50)` with no default value or allowed-value constraint.
- Why it matters: Application bugs or manual queries can insert typos (`'confrimed'`, `'COMPLETED'`, `''`, or `NULL`), silently bypassing the booking state machine and breaking status-filtered queries such as `WHERE status = 'completed'`.
- **SQL to fix it:**
  ```sql
  ALTER TABLE bookings
    MODIFY COLUMN status ENUM(
      'pending',
      'confirmed',
      'in_progress',
      'completed',
      'cancelled'
    ) NOT NULL DEFAULT 'pending';
  ```

#### Problem 4: No Validation or Non-Null Constraint on Booking Time Windows (`event_start`, `event_end`)
- problem: `event_start` and `event_end` are nullable `DATETIME` columns with no check ensuring the event ends after it starts, and no index supporting time-overlap or artist-status lookups.
- matters: A booking with `NULL` timestamps or `event_end <= event_start` breaks overlap detection (`event_start < ? AND event_end > ?`) and corrupts calendar scheduling. Additionally, without an index on `(artist_id, status, event_start)`, every overlap check performs a full table scan of `bookings`.
- **SQL to fix it:**
  ```sql
  ALTER TABLE bookings
    MODIFY COLUMN event_start DATETIME NOT NULL,
    MODIFY COLUMN event_end DATETIME NOT NULL,
    ADD CONSTRAINT chk_booking_event_time
      CHECK (event_end > event_start),
    ADD INDEX idx_bookings_artist_status_start (artist_id, status, event_start);
  ```

#### Problem 5: Unconstrained `reviews.score` and No Uniqueness on `reviews.booking_id`
- problem: `reviews.score` accepts any signed 32-bit integer (including `0`, `-10`, or `999`) or `NULL`, and `reviews.booking_id` has no `UNIQUE` constraint.
- Why it matters: A single out-of-range score (e.g., `500`) or multiple duplicate reviews submitted for the same booking lets a user artificially inflate or tank an artist's average rating on the leaderboard.
- **SQL to fix it:**
  ```sql
  ALTER TABLE reviews
    MODIFY COLUMN score TINYINT UNSIGNED NOT NULL,
    ADD CONSTRAINT chk_reviews_score
      CHECK (score BETWEEN 1 AND 5),
    ADD CONSTRAINT uq_reviews_booking
      UNIQUE (booking_id),
    ADD INDEX idx_reviews_artist_created (artist_id, created_at);
  ```
