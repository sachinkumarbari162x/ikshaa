-- ============================================================================
-- Newsletter store, PostgreSQL.
--
-- A port of api/db.js (node:sqlite), not a redesign. The two properties the
-- SQLite version exists to hold are the same here:
--
--     subscribers   one row per address, ever
--     messages      many rows per address
--
-- One thing does NOT port. SQLite spells case-insensitive uniqueness
-- `COLLATE NOCASE`; Postgres has no such collation on a column. Getting this
-- wrong is silent and expensive: Maria@Example.com and maria@example.com
-- become two subscribers, and they each receive every letter.
--
-- citext is the honest translation — the column itself compares
-- case-insensitively, so UNIQUE, foreign keys and ordinary WHERE clauses all
-- behave the way the SQLite schema does without every query having to
-- remember to wrap the column in lower().
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS citext;

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subscribers (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    -- citext, not text. See the note above; this is the load-bearing line.
    email           CITEXT      NOT NULL UNIQUE,

    name            TEXT,
    origin          TEXT,                       -- "where you are writing from"
    weekly          BOOLEAN     NOT NULL DEFAULT TRUE,
    seasonal        BOOLEAN     NOT NULL DEFAULT TRUE,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Double opt-in. An address is not mailable until its owner proves they
    -- asked: anyone can type someone else's address into a form.
    confirmed_at    TIMESTAMPTZ,
    -- The SHA-256 of the token, never the token. A leaked dump cannot be
    -- used to confirm anybody.
    confirm_hash    TEXT,
    confirm_expires TIMESTAMPTZ,

    -- Null means subscribed. Unsubscribing is not a delete: the row is the
    -- record that consent was given and later withdrawn.
    unsubscribed_at TIMESTAMPTZ
);

-- ---------------------------------------------------------------------------
-- What they wrote
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS messages (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    subscriber_id BIGINT      NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
    body          TEXT        NOT NULL,
    received_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- id DESC in the index as well as the query: two messages can arrive inside
-- the same millisecond, and received_at alone leaves their order undefined.
CREATE INDEX IF NOT EXISTS messages_by_subscriber
    ON messages (subscriber_id, received_at DESC, id DESC);

-- ---------------------------------------------------------------------------
-- The mailable list, as a view rather than a second copy
--
-- A duplicated table of addresses is a second thing to keep in sync, and its
-- failure mode is mailing somebody who unsubscribed. Derive it instead: this
-- cannot drift, because there is nothing to drift from.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW mailable AS
    SELECT id, email, name, origin, weekly, seasonal, confirmed_at
    FROM subscribers
    WHERE confirmed_at IS NOT NULL
      AND unsubscribed_at IS NULL;

-- ---------------------------------------------------------------------------
-- The outbox
--
-- Not a duplicate of the list — a different fact. `subscribers` is people;
-- this is attempts. It exists so that a crash mid-send cannot double-post,
-- so a failure can be retried with backoff, and so "did Maria get the October
-- letter" has an answer.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS campaigns (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    slug       TEXT        NOT NULL UNIQUE,     -- 'weekly-2026-08-09'
    list       TEXT        NOT NULL CHECK (list IN ('weekly', 'seasonal')),
    subject    TEXT        NOT NULL,
    body       TEXT        NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    sent_at    TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS outbox (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    campaign_id   BIGINT      NOT NULL REFERENCES campaigns(id)  ON DELETE CASCADE,
    subscriber_id BIGINT      NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,

    -- The address as it was when queued. Denormalised on purpose: if somebody
    -- corrects their address later, the record of where this actually went
    -- must not silently change with them.
    email         CITEXT      NOT NULL,

    status        TEXT        NOT NULL DEFAULT 'queued'
                  CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'skipped')),
    attempts      INT         NOT NULL DEFAULT 0,
    last_error    TEXT,

    queued_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- When it may next be tried. Backoff moves this forward rather than
    -- sleeping, so a worker restart does not lose the schedule.
    visible_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    sent_at       TIMESTAMPTZ,

    -- One attempt per person per campaign. This is the constraint that makes
    -- "run the sender twice" harmless instead of embarrassing.
    UNIQUE (campaign_id, subscriber_id)
);

-- The worker's query: due, not yet done, oldest first.
CREATE INDEX IF NOT EXISTS outbox_due
    ON outbox (status, visible_at)
    WHERE status IN ('queued', 'sending');
