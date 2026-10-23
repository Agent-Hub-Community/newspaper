CREATE TABLE IF NOT EXISTS stories (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  group_id TEXT NOT NULL,
  title TEXT NOT NULL
);
-- GET /votes?collection= reads every item of one collection.
CREATE INDEX IF NOT EXISTS stories_group ON stories(group_id);
CREATE TABLE IF NOT EXISTS votes (
  story_id TEXT NOT NULL REFERENCES stories(id),
  voter TEXT NOT NULL,
  vote TEXT NOT NULL CHECK (vote IN ('up', 'down')),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (story_id, voter)
);
-- POST /opens counts how often each story's discussion is opened per Beijing date; no reader id is kept.
CREATE TABLE IF NOT EXISTS discussion_opens (
  story_id TEXT NOT NULL REFERENCES stories(id),
  day TEXT NOT NULL,
  opens INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (story_id, day)
);

-- A random ID identifies one search, not a visitor. Click retries keep their event ID.
CREATE TABLE IF NOT EXISTS search_events (
  id TEXT PRIMARY KEY,
  query TEXT NOT NULL,
  result_count INTEGER NOT NULL CHECK (result_count >= 0),
  kind TEXT NOT NULL,
  group_id TEXT NOT NULL,
  time_filter TEXT NOT NULL,
  sort TEXT NOT NULL,
  is_test INTEGER NOT NULL CHECK (is_test IN (0, 1)),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS search_events_time ON search_events(created_at);
CREATE TABLE IF NOT EXISTS search_clicks (
  id TEXT PRIMARY KEY,
  search_id TEXT NOT NULL REFERENCES search_events(id) ON DELETE CASCADE,
  target TEXT NOT NULL,
  rank INTEGER NOT NULL CHECK (rank > 0),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS search_clicks_search ON search_clicks(search_id);

-- Hourly request counts, not visitor identities. Client categories are unverified UA hints.
CREATE TABLE IF NOT EXISTS agent_reads (
  hour TEXT NOT NULL,
  path TEXT NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('GET', 'HEAD')),
  client TEXT NOT NULL,
  status INTEGER NOT NULL,
  is_test INTEGER NOT NULL CHECK (is_test IN (0, 1)),
  requests INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (hour, path, method, client, status, is_test)
);

-- One row per first-page reader API search (content/search, library/search). The query is redacted like site
-- searches; no IP, User-Agent string or visitor ID is stored. The daily schedule deletes rows after 30 days.
CREATE TABLE IF NOT EXISTS api_searches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint TEXT NOT NULL CHECK (endpoint IN ('content/search', 'library/search')),
  query TEXT NOT NULL,
  filters TEXT NOT NULL,
  result_count INTEGER NOT NULL CHECK (result_count >= 0),
  unmatched_terms TEXT NOT NULL,
  client TEXT NOT NULL,
  is_test INTEGER NOT NULL CHECK (is_test IN (0, 1)),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS api_searches_time ON api_searches(created_at);

-- POST /views counts page views per Beijing date, site path and coarse source. No IP address, User-Agent string,
-- referrer or query string is stored; source only records whether the User-Agent named WeChat.
CREATE TABLE IF NOT EXISTS page_views (
  day TEXT NOT NULL,
  path TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('wechat', 'other')),
  views INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, path, source)
);
-- One row per browser and Beijing date, for daily unique visitors. visitor_hash is the first 16 bytes of
-- SHA-256(day + ':' + random browser ID). Rows of different days join only through that ID, which votes.voter
-- holds for browsers that voted. No path is stored here.
CREATE TABLE IF NOT EXISTS daily_visitors (
  day TEXT NOT NULL,
  visitor_hash TEXT NOT NULL,
  PRIMARY KEY (day, visitor_hash)
);
