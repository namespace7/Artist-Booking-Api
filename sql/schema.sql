
CREATE DATABASE IF NOT EXISTS artist_booking;

USE artist_booking;

CREATE TABLE IF NOT EXISTS users (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    -- name/category are nullable: existing rows have no value to backfill,
    -- and client-role users are not expected to have a category.
    -- Nullable because client accounts may not need a name or category.
    name VARCHAR(255) NULL,
    category VARCHAR(100) NULL,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('artist', 'client') NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bookings (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    artist_id INT UNSIGNED NOT NULL,
    client_id INT UNSIGNED NOT NULL,
    event_start DATETIME NOT NULL,
    event_end DATETIME NOT NULL,
    notes TEXT NOT NULL,
    idempotency_key VARCHAR(128) NULL,
    idempotency_request_hash CHAR(64) NULL,
    idempotency_response JSON NULL,
    status ENUM(
        'pending',
        'confirmed',
        'in_progress',
        'completed',
        'cancelled'
    ) NOT NULL DEFAULT 'pending',
    amount DECIMAL(10, 2) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_bookings_artist
        FOREIGN KEY (artist_id) REFERENCES users(id),

    CONSTRAINT fk_bookings_client
        FOREIGN KEY (client_id) REFERENCES users(id),

    CONSTRAINT chk_booking_event_time
        CHECK (event_end > event_start),

    INDEX idx_bookings_artist_status_start
        (artist_id, status, event_start),

    INDEX idx_bookings_client_created
        (client_id, created_at),

    UNIQUE INDEX uq_bookings_client_idempotency_key
    (client_id, idempotency_key)
);

-- Reviews are stored in MySQL to support the relational queries required
-- by the leaderboard task. See TASK3.md and README.md for the rationale.
--
-- Reviews store only booking_id for their booking relationship. The reviewed
-- artist and the reviewing client are derived from bookings.artist_id and
-- bookings.client_id. This avoids duplicating relationships and keeps
-- bookings as the single source of truth.
CREATE TABLE IF NOT EXISTS reviews (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    booking_id INT UNSIGNED NOT NULL,
    score TINYINT UNSIGNED NOT NULL,
    comment TEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_reviews_booking
        FOREIGN KEY (booking_id) REFERENCES bookings(id),

    CONSTRAINT uq_reviews_booking
        UNIQUE (booking_id),

    CONSTRAINT chk_reviews_score
        CHECK (score BETWEEN 1 AND 5),

    INDEX idx_reviews_created_booking_score
        (created_at, booking_id, score)
);

-- Included for schema completeness because the assignment lists payments
-- among the data stored in MySQL. Payment-processing endpoints are outside
-- the scope of the required API endpoints.
CREATE TABLE IF NOT EXISTS payments (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    booking_id INT UNSIGNED NOT NULL,
    amount DECIMAL(10, 2) NOT NULL,
    status ENUM('pending', 'completed', 'failed', 'refunded') NOT NULL DEFAULT 'pending',
    paid_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_payments_booking
        FOREIGN KEY (booking_id) REFERENCES bookings(id),

    INDEX idx_payments_booking (booking_id)
);
