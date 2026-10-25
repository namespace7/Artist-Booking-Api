-- Task 3A: GET /artists/leaderboard
--
-- Returns the top 10 artists by average review score over the last 90
-- days, requiring at least 5 qualifying reviews in that period.
--
-- Interpretation note (see TASK3.md for full discussion): the 90-day
-- window is applied to which REVIEWS qualify for the average score and
-- review count, per the assignment's literal wording ("average review
-- score ... over the last 90 days"). Total completed booking count is
-- lifetime (not windowed), since the assignment scopes only the review
-- average/count to 90 days, not the booking count. This is an explicit
-- assumption, not a silent default.
--
-- Eligibility note: a review only counts once its booking is 'completed',
-- so the aggregation joins reviews to bookings and filters
-- b.status = 'completed'. This mirrors GET /artists/:id/reviews, which
-- applies the same completed-booking eligibility.
--
-- Relationship note: the reviews table stores only booking_id. The reviewed
-- artist is taken from b.artist_id via the join, not from a column on reviews.
-- bookings is the single source of truth for both the reviewed artist and
-- the reviewing client. See sql/schema.sql for the final table definition.
--
-- Design note: completed-booking counts are computed in a separate
-- subquery (bk) rather than joined directly against reviews, to avoid
-- row-multiplication. A direct 3-way join of users/reviews/bookings would
-- inflate both the review count and the booking count by the cross
-- product of matching rows on each side.
--
-- Design note: `WHERE u.role = 'artist'` is an explicit outer filter. In
-- valid data, bookings.artist_id only ever references artist-role users,
-- so this filter is defense-in-depth against any future data-integrity
-- drift rather than a correctness requirement for the current schema.
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

-- Index reasoning (see TASK3.md for the full answer):
--
-- 1. reviews(created_at, booking_id, score) -- the `agg` subquery range-
--    scans reviews on the 90-day `created_at` window and needs booking_id
--    (to join to bookings) and score (to average). With created_at leading,
--    this is a covering index: MySQL reads all three columns directly from
--    an index-only scan, then joins to bookings by primary key for artist_id
--    and status. This index is defined in sql/schema.sql.
--
-- 2. bookings(artist_id, status, event_start) -- supports the `bk`
--    subquery's WHERE status = 'completed' GROUP BY artist_id. Already
--    exists as idx_bookings_artist_status_start in the current schema
--    (sql/schema.sql); reused here rather than duplicated.
--
-- At very large scale (tens of millions of rows), running this query
-- live on every request to GET /artists/leaderboard would still require
-- scanning/aggregating a 90-day window of reviews per request, even with
-- the indexes above. The recommended approach is to NOT run this query on
-- every request: instead, precompute the leaderboard on a schedule (e.g.,
-- a background job every few minutes) into a small materialized
-- leaderboard_cache table (artist_id, average_score, total_reviews,
-- total_completed_bookings, computed_at), and have GET /artists/leaderboard
-- read from that cache table with a simple ORDER BY ... LIMIT 10 (or no
-- query at all, if cached in memory/Redis). This trades a few minutes of
-- staleness for near-constant-time reads, which is an acceptable trade-off
-- for a leaderboard (not a real-time balance or inventory count).



--- BREAKING THE LARGE QUERY INTO TABLE DEFINITIONS FOR CLARITY ---
-- 1.GET Each artist's average score and review count
-- SELECT 
--     b.artist_id, 
--     ROUND(AVG(r.score),2) AS average_score, 
--     COUNT(*) AS total_reviews 
-- FROM reviews r 
-- JOIN bookings b on b.id = r.booking_id 
-- WHERE r.created_at >= now() - INTERVAL 90 DAY 
--     AND b.status = 'complete' 
-- GROUP BY b.artist_id 
-- HAVING COUNT(*) >=5;

-- 2. Count each artist's completed bookings
-- SELECT
--     artist_id,
--     COUNT(*) as completed_count
-- FROM bookings
-- WHERE status= 'complete'
-- GROUP BY artist_id;

-- 3. Get artist name and category
-- SELECT id, name, category from users
-- WHERE role ='artist';