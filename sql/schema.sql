
CREATE DATABASE IF NOT EXISTS artist_booking;

USE artist_booking;

CREATE TABLE IF NOT EXISTS users (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
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
        (client_id, created_at)
);
