-- Reproducible, idempotent seed data for the Artist Booking API.
--
-- Prerequisite:
--   Create the database and tables using sql/schema.sql before seeding.
--
-- Demo account credentials (no secret is stored in this file):
--   The password for all 4 seeded users is supplied at runtime. Set a
--   local-only DEMO_SEED_PASSWORD in your .env (never commit it), then run
--   the wrapper `node sql/seed/mysql.seed.js`. That wrapper bcrypt-hashes the
--   value (cost 10) and substitutes it for the __DEMO_SEED_PASSWORD_HASH__
--   placeholder used below. Running this file directly with the mysql client
--   without first substituting that placeholder is unsupported.
--
-- Idempotence & safety guarantees:
--   - Uses deterministic seed emails (seed.artist.* / seed.client.*) that
--     never collide with existing fixture users (e.g. repository-test@example.com).
--   - Resolves auto-increment user and booking IDs dynamically via email and
--     deterministic seed note tags ([SEED:...]), rather than hardcoding IDs.
--   - Rerunning this file updates existing seed rows in place and inserts
--     missing ones without creating duplicate users, bookings, or reviews.
--   - Never deletes or modifies unrelated rows.

-- 1. Seed Users (2 artists with name & category, 2 clients with NULL name/category)
INSERT INTO users (email, name, category, password_hash, role)
VALUES
  (
    'seed.artist.maya@example.com',
    'Maya Lin',
    'Jazz Vocalist',
    '__DEMO_SEED_PASSWORD_HASH__',
    'artist'
  ),
  (
    'seed.artist.liam@example.com',
    'Liam Ortega',
    'Acoustic Guitarist',
    '__DEMO_SEED_PASSWORD_HASH__',
    'artist'
  ),
  (
    'seed.client.ava@example.com',
    NULL,
    NULL,
    '__DEMO_SEED_PASSWORD_HASH__',
    'client'
  ),
  (
    'seed.client.noah@example.com',
    NULL,
    NULL,
    '__DEMO_SEED_PASSWORD_HASH__',
    'client'
  )
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  category = VALUES(category),
  password_hash = VALUES(password_hash),
  role = VALUES(role);

-- Resolve seeded user IDs dynamically
SET @artist_maya_id = (SELECT id FROM users WHERE email = 'seed.artist.maya@example.com' LIMIT 1);
SET @artist_liam_id = (SELECT id FROM users WHERE email = 'seed.artist.liam@example.com' LIMIT 1);
SET @client_ava_id  = (SELECT id FROM users WHERE email = 'seed.client.ava@example.com' LIMIT 1);
SET @client_noah_id = (SELECT id FROM users WHERE email = 'seed.client.noah@example.com' LIMIT 1);

-- 2. Seed Completed Bookings (all in the past, event_end > event_start)
--    6 completed bookings for Maya (5 reviewed within last 90 days + 1 reviewed >90 days ago)
--    3 completed bookings for Liam (3 reviewed within last 90 days -> below 5-review leaderboard threshold)

INSERT INTO bookings (artist_id, client_id, event_start, event_end, notes, status, amount)
SELECT
  @artist_maya_id,
  @client_ava_id,
  DATE_SUB(UTC_TIMESTAMP(), INTERVAL 40 DAY),
  DATE_ADD(DATE_SUB(UTC_TIMESTAMP(), INTERVAL 40 DAY), INTERVAL 2 HOUR),
  '[SEED:MAYA_BOOKING_1] Evening jazz quartet reception',
  'completed',
  650.00
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM bookings
  WHERE artist_id = @artist_maya_id
    AND notes = '[SEED:MAYA_BOOKING_1] Evening jazz quartet reception'
);

INSERT INTO bookings (artist_id, client_id, event_start, event_end, notes, status, amount)
SELECT
  @artist_maya_id,
  @client_noah_id,
  DATE_SUB(UTC_TIMESTAMP(), INTERVAL 32 DAY),
  DATE_ADD(DATE_SUB(UTC_TIMESTAMP(), INTERVAL 32 DAY), INTERVAL 3 HOUR),
  '[SEED:MAYA_BOOKING_2] Corporate gala vocal set',
  'completed',
  900.00
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM bookings
  WHERE artist_id = @artist_maya_id
    AND notes = '[SEED:MAYA_BOOKING_2] Corporate gala vocal set'
);

INSERT INTO bookings (artist_id, client_id, event_start, event_end, notes, status, amount)
SELECT
  @artist_maya_id,
  @client_ava_id,
  DATE_SUB(UTC_TIMESTAMP(), INTERVAL 25 DAY),
  DATE_ADD(DATE_SUB(UTC_TIMESTAMP(), INTERVAL 25 DAY), INTERVAL 2 HOUR),
  '[SEED:MAYA_BOOKING_3] Anniversary dinner performance',
  'completed',
  600.00
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM bookings
  WHERE artist_id = @artist_maya_id
    AND notes = '[SEED:MAYA_BOOKING_3] Anniversary dinner performance'
);

INSERT INTO bookings (artist_id, client_id, event_start, event_end, notes, status, amount)
SELECT
  @artist_maya_id,
  @client_noah_id,
  DATE_SUB(UTC_TIMESTAMP(), INTERVAL 18 DAY),
  DATE_ADD(DATE_SUB(UTC_TIMESTAMP(), INTERVAL 18 DAY), INTERVAL 2 HOUR),
  '[SEED:MAYA_BOOKING_4] Rooftop lounge jazz session',
  'completed',
  700.00
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM bookings
  WHERE artist_id = @artist_maya_id
    AND notes = '[SEED:MAYA_BOOKING_4] Rooftop lounge jazz session'
);

INSERT INTO bookings (artist_id, client_id, event_start, event_end, notes, status, amount)
SELECT
  @artist_maya_id,
  @client_ava_id,
  DATE_SUB(UTC_TIMESTAMP(), INTERVAL 10 DAY),
  DATE_ADD(DATE_SUB(UTC_TIMESTAMP(), INTERVAL 10 DAY), INTERVAL 2 HOUR),
  '[SEED:MAYA_BOOKING_5] Private gallery opening',
  'completed',
  750.00
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM bookings
  WHERE artist_id = @artist_maya_id
    AND notes = '[SEED:MAYA_BOOKING_5] Private gallery opening'
);

INSERT INTO bookings (artist_id, client_id, event_start, event_end, notes, status, amount)
SELECT
  @artist_maya_id,
  @client_noah_id,
  DATE_SUB(UTC_TIMESTAMP(), INTERVAL 130 DAY),
  DATE_ADD(DATE_SUB(UTC_TIMESTAMP(), INTERVAL 130 DAY), INTERVAL 2 HOUR),
  '[SEED:MAYA_BOOKING_6_OLD] Summer solstice jazz night',
  'completed',
  550.00
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM bookings
  WHERE artist_id = @artist_maya_id
    AND notes = '[SEED:MAYA_BOOKING_6_OLD] Summer solstice jazz night'
);

INSERT INTO bookings (artist_id, client_id, event_start, event_end, notes, status, amount)
SELECT
  @artist_liam_id,
  @client_ava_id,
  DATE_SUB(UTC_TIMESTAMP(), INTERVAL 28 DAY),
  DATE_ADD(DATE_SUB(UTC_TIMESTAMP(), INTERVAL 28 DAY), INTERVAL 2 HOUR),
  '[SEED:LIAM_BOOKING_1] Wedding cocktail hour acoustic set',
  'completed',
  500.00
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM bookings
  WHERE artist_id = @artist_liam_id
    AND notes = '[SEED:LIAM_BOOKING_1] Wedding cocktail hour acoustic set'
);

INSERT INTO bookings (artist_id, client_id, event_start, event_end, notes, status, amount)
SELECT
  @artist_liam_id,
  @client_noah_id,
  DATE_SUB(UTC_TIMESTAMP(), INTERVAL 15 DAY),
  DATE_ADD(DATE_SUB(UTC_TIMESTAMP(), INTERVAL 15 DAY), INTERVAL 2 HOUR),
  '[SEED:LIAM_BOOKING_2] Backyard birthday acoustic session',
  'completed',
  450.00
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM bookings
  WHERE artist_id = @artist_liam_id
    AND notes = '[SEED:LIAM_BOOKING_2] Backyard birthday acoustic session'
);

INSERT INTO bookings (artist_id, client_id, event_start, event_end, notes, status, amount)
SELECT
  @artist_liam_id,
  @client_ava_id,
  DATE_SUB(UTC_TIMESTAMP(), INTERVAL 7 DAY),
  DATE_ADD(DATE_SUB(UTC_TIMESTAMP(), INTERVAL 7 DAY), INTERVAL 2 HOUR),
  '[SEED:LIAM_BOOKING_3] Minggu brunch solo guitar',
  'completed',
  400.00
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM bookings
  WHERE artist_id = @artist_liam_id
    AND notes = '[SEED:LIAM_BOOKING_3] Minggu brunch solo guitar'
);

-- Resolve seeded booking IDs
SET @maya_b1 = (SELECT id FROM bookings WHERE artist_id = @artist_maya_id AND notes = '[SEED:MAYA_BOOKING_1] Evening jazz quartet reception' LIMIT 1);
SET @maya_b2 = (SELECT id FROM bookings WHERE artist_id = @artist_maya_id AND notes = '[SEED:MAYA_BOOKING_2] Corporate gala vocal set' LIMIT 1);
SET @maya_b3 = (SELECT id FROM bookings WHERE artist_id = @artist_maya_id AND notes = '[SEED:MAYA_BOOKING_3] Anniversary dinner performance' LIMIT 1);
SET @maya_b4 = (SELECT id FROM bookings WHERE artist_id = @artist_maya_id AND notes = '[SEED:MAYA_BOOKING_4] Rooftop lounge jazz session' LIMIT 1);
SET @maya_b5 = (SELECT id FROM bookings WHERE artist_id = @artist_maya_id AND notes = '[SEED:MAYA_BOOKING_5] Private gallery opening' LIMIT 1);
SET @maya_b6 = (SELECT id FROM bookings WHERE artist_id = @artist_maya_id AND notes = '[SEED:MAYA_BOOKING_6_OLD] Summer solstice jazz night' LIMIT 1);

SET @liam_b1 = (SELECT id FROM bookings WHERE artist_id = @artist_liam_id AND notes = '[SEED:LIAM_BOOKING_1] Wedding cocktail hour acoustic set' LIMIT 1);
SET @liam_b2 = (SELECT id FROM bookings WHERE artist_id = @artist_liam_id AND notes = '[SEED:LIAM_BOOKING_2] Backyard birthday acoustic session' LIMIT 1);
SET @liam_b3 = (SELECT id FROM bookings WHERE artist_id = @artist_liam_id AND notes = '[SEED:LIAM_BOOKING_3] Minggu brunch solo guitar' LIMIT 1);

-- 3. Seed Reviews
--    Maya: 5 reviews inside the last 90 days (scores 5, 5, 4, 5, 4 -> 90-day avg 4.60, qualifies for leaderboard)
--          + 1 review 120 days ago (score 2 -> excluded from 90-day leaderboard, included in lifetime review summary)
--    Liam: 3 reviews inside the last 90 days (scores 5, 4, 5 -> excluded from leaderboard because count < 5)
--    Reviews store only booking_id: each review's artist and reviewer are
--    derived from the referenced booking (bookings.artist_id / bookings.client_id),
--    so the redundant artist_id/client_id columns are not populated.
--    Idempotent via uq_reviews_booking (UNIQUE on booking_id).
INSERT INTO reviews (booking_id, score, comment, created_at)
VALUES
  (@maya_b1, 5, 'Phenomenal jazz vocals and effortless crowd rapport.', DATE_SUB(UTC_TIMESTAMP(), INTERVAL 38 DAY)),
  (@maya_b2, 5, 'Punctual, professional, and elevated our entire gala.', DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY)),
  (@maya_b3, 4, 'Warm tone and great song selection for our anniversary.', DATE_SUB(UTC_TIMESTAMP(), INTERVAL 23 DAY)),
  (@maya_b4, 5, 'Guests asked for her contact info all evening.', DATE_SUB(UTC_TIMESTAMP(), INTERVAL 16 DAY)),
  (@maya_b5, 4, 'Fit the gallery atmosphere wonderfully.', DATE_SUB(UTC_TIMESTAMP(), INTERVAL 8 DAY)),
  (@maya_b6, 2, 'Venue sound check ran late (older review outside 90-day window).', DATE_SUB(UTC_TIMESTAMP(), INTERVAL 120 DAY)),
  (@liam_b1, 5, 'Beautiful fingerstyle arrangements during cocktail hour.', DATE_SUB(UTC_TIMESTAMP(), INTERVAL 26 DAY)),
  (@liam_b2, 4, 'Great acoustic setlist and easy setup.', DATE_SUB(UTC_TIMESTAMP(), INTERVAL 13 DAY)),
  (@liam_b3, 5, 'Relaxed Sunday brunch vibe, highly recommended.', DATE_SUB(UTC_TIMESTAMP(), INTERVAL 5 DAY))
ON DUPLICATE KEY UPDATE
  score = VALUES(score),
  comment = VALUES(comment),
  created_at = VALUES(created_at);
