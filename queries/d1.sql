-- Rad.FM ops queries — D1 (RAD_USERS, id 073f767d-2eda-4d81-ac96-61f0e55f4a4f)
--
-- Every query below was RUN against live production D1 on 5 August 2026 and returned the annotated
-- result. They are known-good starting points, not sketches.
--
-- Run one:
--   bunx wrangler d1 execute RAD_USERS --remote --command "<sql>"
-- Or over REST:
--   POST /accounts/{acct}/d1/database/073f767d-2eda-4d81-ac96-61f0e55f4a4f/query
--
-- ┌─ READ THIS FIRST ────────────────────────────────────────────────────────────────────────────┐
-- │ 1. past_plays.played_at is NULL on all 34,870 rows. USE created_at. Any query that filters or │
-- │    orders on played_at silently returns nothing. See FINDINGS.md §1.                          │
-- │ 2. past_plays holds CURRENT STATE, not history — the primary key collapses to (user_id, song) │
-- │    and re-plays overwrite. Do not build "listening hours" or "top played" on it.              │
-- │ 3. D1 fails with SQLITE_ERROR 7500 "too many terms in compound SELECT" if you stack ~10       │
-- │    UNION ALL counts. Run separately or use d1.batch().                                        │
-- │ 4. All timestamps are TEXT in 'YYYY-MM-DD HH:MM:SS'. datetime('now','-N day') compares fine.  │
-- │    premium_meta.premium_since is ISO-8601 with a Z suffix — a DIFFERENT format. Do not join   │
-- │    or compare the two without normalising.                                                    │
-- └──────────────────────────────────────────────────────────────────────────────────────────────┘


-- ============================================================================================
-- HEADLINE COUNTERS  (run individually — see caveat 3)
-- ============================================================================================

SELECT COUNT(*) AS users FROM users;                                    -- 631
SELECT COUNT(*) AS premium FROM premium_users;                          -- 18  (2.9% of registered)
SELECT COUNT(*) AS stations, SUM(is_user_generated) AS ugc FROM stations; -- 341 / 341
SELECT COUNT(*) AS liked FROM liked_songs;                              -- 4,507
SELECT COUNT(*) AS play_rows FROM past_plays;                           -- 34,870


-- ============================================================================================
-- GROWTH
-- ============================================================================================

-- Signups per day. Returned 1,2,2,4,2 for 4th→31st — single digits daily, so a spike is meaningful.
SELECT date(created_at) AS day, COUNT(*) AS signups
FROM users
WHERE created_at > datetime('now', '-30 day')
GROUP BY day
ORDER BY day DESC;

-- New users in the last 7 days.  -- 13
SELECT COUNT(*) AS n FROM users WHERE created_at > datetime('now', '-7 day');


-- ============================================================================================
-- ENGAGEMENT
--
-- Label these honestly in the UI. Because past_plays is current-state, an "active user" is one who
-- played a song they had not played before, or replayed one — NOT "a user who listened". A heavy
-- listener replaying their favourites can look inactive. Call the panel "users with play activity",
-- not "DAU", until real play events land in Analytics Engine.
-- ============================================================================================

SELECT COUNT(DISTINCT user_id) AS active_24h FROM past_plays
WHERE created_at > datetime('now', '-1 day');    -- 15

SELECT COUNT(DISTINCT user_id) AS active_7d FROM past_plays
WHERE created_at > datetime('now', '-7 day');    -- 44

SELECT COUNT(DISTINCT user_id) AS active_30d, COUNT(*) AS rows_touched FROM past_plays
WHERE created_at > datetime('now', '-30 day');   -- 65 active / 3,112 rows

-- Activity by day, for a sparkline.
SELECT date(created_at) AS day,
       COUNT(DISTINCT user_id) AS users,
       COUNT(*)                AS plays
FROM past_plays
WHERE created_at > datetime('now', '-30 day')
GROUP BY day
ORDER BY day DESC;

-- Registered but never played — onboarding drop-off.
SELECT COUNT(*) AS never_played
FROM users u
WHERE NOT EXISTS (SELECT 1 FROM past_plays p WHERE p.user_id = u.id);


-- ============================================================================================
-- ENTITLEMENT  — the panel that would have caught the stale-cache incident
--
-- premium_users is a CACHE of RevenueCat, not a source of truth. A row that has not been written in
-- months is exactly how live subscribers got their paid segments stripped. Always show the local
-- row NEXT TO the live RevenueCat answer; never present this table alone as "who is premium".
-- ============================================================================================

SELECT p.user_id,
       u.email,
       p.created_at        AS granted_at,
       m.last_source,
       m.premium_since,
       m.rc_subscriber_id,
       m.app_id
FROM premium_users p
LEFT JOIN users        u ON u.id      = p.user_id
LEFT JOIN premium_meta m ON m.user_id = p.user_id
ORDER BY p.created_at DESC;

-- Premium rows with no metadata, or never updated. These are the stale-cache candidates: at the time
-- of writing several rows had a NULL premium_since, meaning we cannot tell when entitlement began.
SELECT p.user_id, u.email, m.premium_since, m.last_source
FROM premium_users p
LEFT JOIN users        u ON u.id      = p.user_id
LEFT JOIN premium_meta m ON m.user_id = p.user_id
WHERE m.user_id IS NULL OR m.premium_since IS NULL;

-- Entitlement audit trail for one user — the "why does this account think it is premium?" query.
SELECT created_at, source, app_id, entitlement_id, rc_subscriber_id
FROM premium_audit
WHERE user_id = ?1
ORDER BY created_at DESC
LIMIT 50;

-- Recent entitlement changes across all users.
SELECT created_at, user_id, source, entitlement_id
FROM premium_audit
ORDER BY created_at DESC
LIMIT 100;


-- ============================================================================================
-- STATIONS  (Stations Plus)
-- ============================================================================================

-- All 341 stations are user-generated; subscriber counts are ~1 each, so this is a long tail rather
-- than a hit list. Treat it as a content browser, not a leaderboard.
SELECT s.id, s.name, s.mood, s.genres, s.created_at,
       COUNT(us.user_id) AS subscribers
FROM stations s
LEFT JOIN user_stations us ON us.station_id = s.id
GROUP BY s.id
ORDER BY s.created_at DESC
LIMIT 100;

-- Stations created per day.
SELECT date(created_at) AS day, COUNT(*) AS created
FROM stations
WHERE created_at > datetime('now', '-30 day')
GROUP BY day ORDER BY day DESC;

-- Orphans: stations nobody is subscribed to. Candidates for artwork cleanup in R2.
SELECT s.id, s.name, s.created_at
FROM stations s
LEFT JOIN user_stations us ON us.station_id = s.id
WHERE us.station_id IS NULL
ORDER BY s.created_at DESC;


-- ============================================================================================
-- USER LOOKUP  — support workflow: "this user says X is broken"
-- ============================================================================================

SELECT id, email, username, created_at, updated_at FROM users WHERE email = ?1;

-- One user's full picture. Note liked/disliked are keyed on a `song` TEXT column, not an id.
SELECT
  (SELECT COUNT(*) FROM liked_songs     WHERE user_id = ?1) AS liked_songs,
  (SELECT COUNT(*) FROM liked_artists   WHERE user_id = ?1) AS liked_artists,
  (SELECT COUNT(*) FROM disliked_songs  WHERE user_id = ?1) AS disliked_songs,
  (SELECT COUNT(*) FROM past_plays      WHERE user_id = ?1) AS tracks_played,
  (SELECT COUNT(*) FROM user_stations   WHERE user_id = ?1) AS stations,
  (SELECT COUNT(*) FROM premium_users   WHERE user_id = ?1) AS is_premium;

-- Most recent activity for a user (created_at, NOT played_at).
SELECT song, created_at FROM past_plays
WHERE user_id = ?1 ORDER BY created_at DESC LIMIT 50;


-- ============================================================================================
-- DATA QUALITY  — surface these as a standing panel, not a one-off
--
-- Both of these are how real bugs stayed hidden. A dashboard that shows them going wrong is worth
-- more than one that shows things going right.
-- ============================================================================================

-- Tracks with no ISRC. 15% of past_plays lack one while 0% of liked_songs do — that asymmetry is
-- what made the like button behave as a repeat button, because exclusions were ISRC-only.
SELECT
  (SELECT COUNT(*) FROM past_plays  WHERE song NOT LIKE '%isrc%') AS plays_maybe_no_isrc,
  (SELECT COUNT(*) FROM past_plays)                               AS plays_total;

-- played_at should be non-zero once play events are fixed. Today it is 0 of 34,870.
SELECT COUNT(*) AS played_at_present FROM past_plays WHERE played_at IS NOT NULL;

-- Auth hygiene: OTPs at or near the attempt ceiling (MAX_OTP_ATTEMPTS = 5) suggest brute force.
SELECT email, attempts, created_at FROM otps WHERE attempts >= 3 ORDER BY attempts DESC;

-- Refresh-token accumulation per account. A large count is the retry-storm signature behind the
-- "stuck on loading" incident.
SELECT email, COUNT(*) AS tokens FROM refresh_tokens
GROUP BY email HAVING tokens > 5 ORDER BY tokens DESC;


-- ============================================================================================
-- SCHEMA INTROSPECTION  — trust this, not migrations/
--
-- The migrations directory does not describe production. Read the live schema.
-- ============================================================================================

SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name;
SELECT sql  FROM sqlite_master WHERE type = 'table' AND name = ?1;
