CREATE TABLE IF NOT EXISTS player_profiles (
  user_id TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE player_profiles ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS economy_ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES player_profiles(user_id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL,
  entry_type TEXT NOT NULL,
  amount BIGINT NOT NULL,
  balance_after BIGINT NOT NULL,
  note TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_player_profiles_updated_at ON player_profiles(updated_at);
-- Versus group membership lookups (one season is replicated on every member profile).
CREATE INDEX IF NOT EXISTS idx_player_profiles_versus_group ON player_profiles ((payload->'versus'->>'groupCode'));
CREATE INDEX IF NOT EXISTS idx_economy_ledger_user_created ON economy_ledger(user_id, created_at DESC);


-- Versus canonical projections. Profile JSONB remains migration-compatible, while
-- these tables provide queryable/idempotent state for a multi-instance backend.
CREATE TABLE IF NOT EXISTS versus_queue_tickets (
  ticket_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES player_profiles(user_id) ON DELETE CASCADE,
  queue_key TEXT NOT NULL,
  status TEXT NOT NULL,
  queued_at TIMESTAMPTZ NOT NULL,
  matched_at TIMESTAMPTZ,
  group_code TEXT,
  expires_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_versus_active_ticket_per_user
  ON versus_queue_tickets(user_id, queue_key)
  WHERE status IN ('QUEUED', 'MATCHED');
CREATE INDEX IF NOT EXISTS idx_versus_queue_ready
  ON versus_queue_tickets(queue_key, status, queued_at);

CREATE TABLE IF NOT EXISTS versus_matches (
  match_id TEXT PRIMARY KEY,
  season_id TEXT NOT NULL,
  group_code TEXT NOT NULL,
  round_id INTEGER NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  home_club_id TEXT NOT NULL,
  away_club_id TEXT NOT NULL,
  state TEXT NOT NULL,
  ruleset_version TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_versus_matches_group_round
  ON versus_matches(group_code, round_id, scheduled_at);

CREATE TABLE IF NOT EXISTS versus_market_listings (
  listing_id TEXT PRIMARY KEY,
  season_id TEXT NOT NULL,
  source_club_id TEXT NOT NULL,
  player_snapshot JSONB NOT NULL,
  opening_bid BIGINT NOT NULL,
  minimum_increment BIGINT NOT NULL,
  current_bid BIGINT,
  current_bidder_id TEXT REFERENCES player_profiles(user_id) ON DELETE SET NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL,
  ruleset_version TEXT NOT NULL,
  settled_at TIMESTAMPTZ,
  winner_club_id TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_versus_market_open
  ON versus_market_listings(season_id, status, ends_at);

CREATE TABLE IF NOT EXISTS versus_wallet_reservations (
  reservation_id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL REFERENCES versus_market_listings(listing_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES player_profiles(user_id) ON DELETE CASCADE,
  currency TEXT NOT NULL,
  amount BIGINT NOT NULL CHECK (amount > 0),
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE(listing_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_versus_reservations_user
  ON versus_wallet_reservations(user_id, created_at DESC);

ALTER TABLE economy_ledger ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'PLAYER';
ALTER TABLE economy_ledger ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'MONEY';
ALTER TABLE economy_ledger ADD COLUMN IF NOT EXISTS season_id TEXT;
ALTER TABLE economy_ledger ADD COLUMN IF NOT EXISTS battle_id TEXT;
ALTER TABLE economy_ledger ADD COLUMN IF NOT EXISTS transaction_id TEXT;
CREATE INDEX IF NOT EXISTS idx_economy_ledger_mode_created
  ON economy_ledger(mode, currency, created_at DESC);
