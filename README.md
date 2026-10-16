# Artist Booking API

A Node.js and Express backend for an artist booking platform using MySQL for relational transactions and MongoDB for flexible artist profile documents.

## Overview & Endpoints

All endpoints return a consistent JSON envelope:

```json
{
  "success": true,
  "data": {},
  "error": null
}
```

### Required Endpoints

1. **`POST /auth/login`**
   - Authenticates a user with `email` and `password` using `bcrypt`.
   - Returns a signed JWT containing `userId`, `role` (`artist` or `client`), and standard `iat`/`exp` claims (`1h` expiry).
   - Returns `401` with `"Invalid email or password"` on any credential failure without disclosing whether the email or password was wrong.

2. **`POST /bookings`** *(Client JWT required)*
   - Required body fields: `artist_id`, `event_start`, `event_end`, `notes`.
   - Rejects non-client callers (`403`), past start times (`422`), invalid time ranges where `event_end <= event_start` (`422`), and requests that overlap an existing `confirmed` booking for the same artist (`409`).
   - Creates the booking with initial status `pending` (`201`).

3. **`PATCH /bookings/:id/status`** *(Artist or Client JWT required)*
   - Enforces the booking state machine:
     - `pending -> confirmed` (assigned artist only)
     - `pending -> cancelled` (assigned artist or client)
     - `confirmed -> in_progress` (assigned artist only)
     - `confirmed -> cancelled` (assigned artist or client)
     - `in_progress -> completed` (assigned artist only)
   - Returns `422` for any invalid transition and `403` if a user attempts an action outside their role or ownership.
   - Re-checks for overlapping `confirmed` bookings under an artist-level row lock before allowing `pending -> confirmed` (`409` on conflict).

4. **`GET /artists/:id/reviews`**
   - Returns paginated reviews (`page`, `limit`, sorted newest first) and a summary (`averageScore` rounded to 2 decimal places, `totalReviews`, and `distribution` of scores `1` through `5`).
   - Includes only reviews attached to bookings whose status is `completed`.

A `GET /health` endpoint is also included for basic liveness checks.

---

## Prerequisites

- **Node.js** v18+
- **MySQL** 8.0.16+ (tested on MySQL 8.4; `CHECK` constraints are enforced natively)
- **MongoDB** 6+ running locally

## Environment Configuration

Copy `.env.example` to `.env` and configure your local credentials:

```bash
cp .env.example .env
```

Update the values in `.env`:

```dotenv
PORT=3000

MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=replace_with_your_local_password
MYSQL_DATABASE=artist_booking

JWT_SECRET=replace_with_a_long_random_secret

MONGO_URI=mongodb://root:PASSWORD@localhost:27017/artist_booking?authSource=admin

DEMO_SEED_PASSWORD=replace_with_a_local_demo_password
```

Use values appropriate for your local MySQL and MongoDB installations.

**Security note:** Never commit `.env` or any file containing real passwords, connection strings, or JWT secrets. `.gitignore` excludes `.env` and `.env.*` while keeping `.env.example`. `DEMO_SEED_PASSWORD` is a local-only value used by the MySQL seed wrapper. Neither the plaintext demo password nor a fixed password hash is stored in the repository.

---

## Database Setup

### 1. Create the database and tables

Make sure MySQL is running, then execute:

```bash
mysql -u root -p < sql/schema.sql
```

This creates the `artist_booking` database and the following tables:

- `users`
- `bookings`
- `reviews`
- `payments`

The schema represents the final database structure and is intended for a fresh database. It does not upgrade existing tables. Back up existing data before changing your database structure.

### 2. Seed MySQL data

Ensure your local `.env` contains `DEMO_SEED_PASSWORD` and `MYSQL_DATABASE`, then run:

```bash
node sql/seed/mysql.seed.js
```

This seeds four demo users, nine completed bookings, and nine reviews. The wrapper generates the bcrypt password hash at runtime.

The seed operation is designed to be repeatable without duplicating the designated seed records.

### 3. Seed MongoDB artist profiles

Ensure `MONGO_URI` is configured in your local `.env`, then run:

```bash
node sql/seed/artist_profiles.seed.js
```

This creates or updates the MongoDB artist profiles associated with the two seeded artist accounts in MySQL.

### 4. Start the application and run tests

Follow the commands in the Installation, Startup, and Tests section below.

---

## Installation, Startup, and Tests

Install dependencies:

```bash
npm install
```

Verify MySQL connectivity:

```bash
node src/config/check-mysql.js
```

Start the server:

```bash
npm start
```

For development with file watching:

```bash
npm run dev
```

Run the test suite:

```bash
npm test
```

---

## Data Model & Storage Architecture

### MySQL (Relational Core)

- **`users`**: A single table for both `artist` and `client` accounts, distinguished by `role ENUM('artist', 'client')`. Nullable `name` and `category` columns allow artist names and categories to be queried directly for the leaderboard.
- **`bookings`**: Links `artist_id` and `client_id` (both foreign keys to `users.id`) and stores `event_start`, `event_end`, `notes`, `status`, and nullable `amount`. Enforces `CHECK (event_end > event_start)`.
- **`reviews`**: Stores `booking_id` (a unique foreign key to `bookings.id`), `score`, `comment`, and `created_at`. The score constraint enforces a value between 1 and 5. The reviewed artist and reviewing client are derived from the associated booking instead of duplicating their IDs.
- **`payments`**: Stores `booking_id` (foreign key to `bookings.id`), `amount DECIMAL(10, 2)`, `status`, `paid_at`, and `created_at`. Included for schema completeness per the assignment tech stack; payment-processing endpoints are outside the four required endpoints.

### MongoDB (Document Store)

- **`artist_profiles`** (`src/models/artist_profile.model.js`): Stores `userId` (a unique number referencing `users.id` in MySQL at the application level), `bio`, `portfolio`, `socialLinks`, timestamps, and flexible profile attributes such as genres, gear lists, and press kits.
- Profile CRUD endpoints are outside the four required endpoints.

---

## Concurrency & Double-Booking Protection

Multiple clients may submit overlapping `pending` requests for an artist, but **at most one overlapping booking may be `confirmed`**.

Both `POST /bookings` (`createBooking`) and `PATCH /bookings/:id/status` (`updateStatus`) follow the same MySQL row-locking protocol under `REPEATABLE READ`:

1. When updating status, look up the booking's `artist_id` outside the transaction first.
2. Begin the transaction and acquire an exclusive row lock on the artist row in `users`:

   ```sql
   SELECT id FROM users WHERE id = ? FOR UPDATE;
   ```

3. In `updateStatus`, re-read and lock the target booking row with `SELECT ... FOR UPDATE` after acquiring the artist lock, then verify that the booking's artist has not changed.
4. Perform role and ownership authorization checks and validate the state transition.
5. When creating a booking or transitioning from `pending` to `confirmed`, check for an existing confirmed overlap:

   ```sql
   SELECT id
   FROM bookings
   WHERE artist_id = ?
     AND status = 'confirmed'
     AND event_start < ?
     AND event_end > ?
   LIMIT 1;
   ```

   The artist lock serializes competing booking creations and confirmations for the same artist. The overlap check rejects conflicting requests with `409`.

Using the same artist-first locking order in both code paths helps prevent race conditions and lock-order deadlocks during concurrent booking creation and confirmation.

---

## Design Decisions & Trade-Offs

### 1. Resolving the Reviews Storage Conflict (MySQL vs. MongoDB)

The assignment contains an apparent conflict:

- Section 01 (Tech Stack) assigns artist profiles and reviews to MongoDB.
- Section 03 (SQL & Database) supplies a relational reviews schema and asks for a SQL leaderboard query involving reviews and completed bookings.

**Decision:** Active review storage is implemented in MySQL, while MongoDB stores `artist_profiles`.

Reviews are relational: each review belongs to a booking, must be associated with its artist and client, has a score restricted to 1–5, and must be filtered by booking status for both review retrieval and leaderboard calculations. MySQL supports these joins and database-enforced relationships directly. Keeping reviews in MongoDB would require application-side joins across the two databases.

The former Mongoose review model has been removed because active review queries use MySQL. The pre-existing MongoDB `reviews` collection has not been dropped or modified.

### 2. Single `users` Table vs. Separate `artists` Table

Authentication and JWT middleware treat artists and clients uniformly through their `role`. Keeping both in `users` avoids duplicating authentication logic and credential tables. Nullable `name` and `category` columns support the SQL leaderboard requirements.

### 3. Normalized Review Relationship

The `reviews` table stores only `booking_id` for its booking relationship. The artist and client are derived through `bookings.artist_id` and `bookings.client_id`.

Storing those IDs again in `reviews` would duplicate existing relationships and allow the values to disagree. The unique constraint on `booking_id` enforces at most one review per booking, while the foreign key preserves referential integrity.

---

## Performance & Scaling Considerations

- **Targeted composite indexes:**
  - `idx_bookings_artist_status_start (artist_id, status, event_start)` supports the confirmed-booking overlap lookup and helps queries filtering bookings by artist and status.
  - `idx_reviews_created_booking_score (created_at, booking_id, score)` supports scanning reviews within the leaderboard's 90-day window while providing the booking join key and score from the index.
- **SQL joins instead of in-memory ID lists:** `GET /artists/:id/reviews` joins reviews and bookings in MySQL and uses `LIMIT` and `OFFSET`, instead of loading all completed booking IDs into Node.js memory.
- **Future scaling:** At high read volumes, artist review summaries (`averageScore`, `totalReviews`, `distribution`) and the 90-day leaderboard could be precomputed asynchronously or cached in Redis or a summary table, rather than recalculated for every request. See `TASK3.md` and `TASK4.md` for further analysis.
