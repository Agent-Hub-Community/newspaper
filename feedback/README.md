# Feedback Worker

This directory holds the site's only server: a Cloudflare Worker with one D1 database. The website itself is static
and works without it. The Worker stores votes and anonymous usage counts, and serves the public query API that
readers' agents use.

| Route | Purpose | Section |
|---|---|---|
| `GET /votes`, `PUT /votes` | Story votes and library hearts | [Votes](#votes), [Library Hearts](#library-hearts) |
| `POST /opens` | Count discussion openings | [Discussion Opens](#discussion-opens) |
| `POST /views` | Count page views | [浏览量统计 (Page Views)](#浏览量统计-page-views) |
| `POST /search-events` | Record site searches | [Search Statistics](#search-statistics) |
| `GET /read/<document>` | Serve published Markdown, JSON and text, with hourly counts | [Content Read Statistics](#content-read-statistics) |
| `GET /library/search` | Search the resource library | [Public Library Query](#public-library-query) |
| `GET /content/...` | Browse and search published editions, topics and resources | [Public Content Query](#public-content-query) |
| `GET /`, `GET /llms.txt` | Plain-text description with `Link: rel="describedby"`, so an agent that only knows the Worker origin can find the entry points | |

A daily scheduled run deletes records that are older than their retention period.
Request logging is disabled in [`wrangler.jsonc`](wrangler.jsonc) (`observability.enabled: false`).

## Deployment

The production Worker runs on the Cloudflare Workers free plan with one D1 database. The free plan has request and
storage limits. Reaching them must not trigger a paid upgrade; do not upgrade a plan automatically.

Wrangler needs only these permissions: user read, account read, Workers scripts write and D1 write.
[`scripts/embed-catalog.mjs`](../scripts/embed-catalog.mjs) also needs Workers AI.
Never commit credentials or copy them into frontend code.

The production database already exists, and its ID is in `wrangler.jsonc`. Reuse that ID; do not create another
database on redeploy. Every statement in [`schema.sql`](schema.sql) uses `IF NOT EXISTS`, so applying it again is safe.

Deploy from the repository root in this order:

```sh
# 1. Apply the schema before deploying a Worker that uses new tables.
npx wrangler d1 execute agenthub-feedback --remote --config feedback/wrangler.jsonc --file feedback/schema.sql
# 2. Build the public site and register its stories and library items.
npm run build -- --public
node scripts/feedback-catalog.mjs dist/data.js scratch/feedback-catalog.sql
npx wrangler d1 execute agenthub-feedback --remote --config feedback/wrangler.jsonc --file scratch/feedback-catalog.sql
# 3. Deploy the Worker.
npx wrangler deploy --config feedback/wrangler.jsonc
# 4. Build the site again with the HTTPS origin that deploy printed.
FEEDBACK_API_URL=https://<worker-origin> npm run build -- --public
```

The GitHub repository variable `FEEDBACK_API_URL` supplies the Worker origin to the Pages workflow.
Deploying the Worker alone does not update the website, and deploying the website does not update the Worker.

- Register new approved story revisions before Pages deploys them; an unregistered story returns HTTP 404.
- Do not register private draft stories.
- Previously registered revisions and their votes remain in D1.
- Publish the site's catalog and topic files before deploying a Worker that reads new fields from them.

The site address the Worker reads from comes from [`lib/site.mjs`](../lib/site.mjs).
`ALLOWED_ORIGIN` in `wrangler.jsonc` lists the site origins that may vote and report; change it together with the site address.

## Votes

The vote buttons on each story store one current choice per anonymous browser and story revision.

- A browser ID is a random UUID kept in the browser's `localStorage`. It is not an account.
- A vote is `PUT /votes` with `{vote: 'up' | 'down' | null}`; `null` cancels. PUT is idempotent, so a repeated
  request cannot add a vote. The primary key makes up and down mutually exclusive.
- Writes and returned totals run in one D1 batch transaction.
- Unknown story IDs, invalid votes, oversized bodies and disallowed browser origins are rejected.

Story IDs come from `feedbackId` in [`lib/feedback-id.mjs`](../lib/feedback-id.mjs): a hash of the date, the group,
the title and the body. Formatting and order changes keep the ID. A changed title, body, group or date produces a
new ID with its own count.

What the reader sees:

- Public controls show real integer counts, including zero.
- Unknown or unavailable counts show `—`, never an invented zero.
- Local previews never upload votes and label saved choices as device-only.
- Public builds without `FEEDBACK_API_URL` stay device-only.
- After a network failure, the browser does not claim success or invent counts. It reads the count again before the
  next vote, because a timed-out write may already be stored.

What is stored: the story ID, the random browser ID, the choice and the last update time. D1 stores no names, chat
records, avatars or IP addresses. The edge rate limiter uses the IP transiently; Cloudflare itself still processes
request metadata.

Limits: rate limiting is approximate, per edge and IP, and applies to reads and writes. It is not identity
verification. Clearing browser storage or using another browser can vote again, and CORS is not bot protection.
Add Turnstile or login only if abuse warrants it.

Only totals and the calling browser's own choice are available through the public API. Maintainers can read
totals with `wrangler d1 execute` or the D1 console:

```sql
SELECT s.date, s.group_id, s.title,
  SUM(CASE WHEN v.vote = 'up' THEN 1 ELSE 0 END) AS likes,
  SUM(CASE WHEN v.vote = 'down' THEN 1 ELSE 0 END) AS dislikes
FROM stories s LEFT JOIN votes v ON v.story_id = s.id
GROUP BY s.id
ORDER BY s.date DESC, likes DESC;
```

`node test/feedback-live.mjs --live` checks real D1 counts, repeated PUTs, changed votes, cancellation and reload at
390, 820 and 1440 px with the production origin and CSP. It uses local frontend assets and cancels its test vote.
Add `--production` after a Pages deployment to load the published assets, compare the complete edition payload, and
check image loading and real voting.

## Library Hearts

The library page reuses the vote service for hearts.

- Each library item is registered as a row with `group_id = 'library'` and an ID from `libraryFeedbackId(item.id)`.
  [`scripts/feedback-catalog.mjs`](../scripts/feedback-catalog.mjs) writes these rows together with the story revisions.
  Because the ID depends only on the item `id`, editing a summary keeps its hearts.
- A heart is `PUT {vote: 'up'}`; removing it is `PUT {vote: null}`.
- The page shows a few hundred items, so it reads all counts in one request:
  `GET /votes?collection=library&voter=<uuid>` returns `{ items: { <id>: { up, down, vote } } }` for every
  registered row in that collection. Only collections listed in the Worker are accepted.
- The `stories_group` index in `schema.sql` keeps collection reads from scanning every story.
- Without the Worker, the page shows `—` for every count.

## Discussion Opens

The discussion reader reports how often each story's original discussion is opened.

- When a reader opens a discussion, `discussion-panel.js` sends `POST /opens?story=<id>` with no body, no cookies and
  no referrer.
- A tab reports each story once (`sessionStorage`), so reopening or switching back does not add to the count.
- Only public builds with `FEEDBACK_API_URL` report. Local previews and weekly pages (whose stories are not
  registered) do not.

The Worker adds one to `discussion_opens` for the story and the Beijing date. It stores only the story ID, the date
and the count, with no browser ID and no IP address. Unknown story IDs return HTTP 404, and the same rate limiter
applies. If the table does not exist yet, reports fail silently.

Most-opened discussions:

```sql
SELECT s.date, s.group_id, s.title, SUM(o.opens) AS opens
FROM discussion_opens o JOIN stories s ON s.id = o.story_id
GROUP BY s.id
ORDER BY opens DESC
LIMIT 30;
```

Counts are approximate: each tab counts once per story, and blocked storage or bots can skew them.
Compare them with the page views of the same group page (see the next section) for an open rate.
`node test/discussion-opens-browser.mjs` checks the reader side; `test/discussion-opens.test.mjs` checks the Worker.

## 浏览量统计 (Page Views)

TODO: written in the page-view change.

## Search Statistics

Public search pages send `POST /search-events` when `FEEDBACK_API_URL` is set.

When a search is recorded:

- after the input stays unchanged for 1.2 seconds, on Enter, or on a result click;
- a filter or sort change starts a new search; pagination does not;
- IME composition is not recorded.

What a record holds: a random event ID, the query, the filters, the total result count, and an optional clicked
result path and rank. Each click includes its search, so a click cannot create an orphan record; retry IDs prevent
double counting. No persistent visitor ID, cookie, IP address or referrer is stored.

Redaction: the query is normalized and limited to 120 characters. Obvious emails, URLs (with or without a scheme),
phone-like digit runs (also with spaces or dashes), common token prefixes, JWTs, WeChat IDs and long letter-digit
strings are replaced with a redaction label, on both the client and the server (`SENSITIVE` in
[`search-events.mjs`](search-events.mjs)). This is not a general personal-data detector. The search page tells readers
what is collected and asks them not to enter private information.

Limits:

- The Worker accepts only bounded payloads and site result paths. A reporting failure does not block search or navigation.
- There is no public endpoint for reading queries.
- Public clients can forge events; Origin checks and rate limits do not prove that a person searched.
  These counts are neither unique readers nor bot-filtered metrics.
- The daily schedule removes search records older than 30 days, with their clicks.

Deploy the schema before the Worker, then publish the search page.

Reports: set `WRANGLER_BIN` to the installed Wrangler executable and run

```sh
node scripts/search-stats.mjs
```

The report uses authenticated read-only D1 queries and writes HTML to the ignored `output/playwright/` directory.
It lists keyword counts, result counts, zero-result searches, searches with a result click, and the API searches
described in [API Search Records](#api-search-records). Different filters and sorts stay separate rows.
No click does not prove failure, and a click does not prove that the destination answered the question.

Verification:

- Open search with `?analytics_test=1`. Those records appear separately in the report.
- `node test/search-tracking-browser.mjs` checks the public local build with intercepted requests.
- `node test/search-tracking-browser.mjs --live` checks production: it writes two test searches and one result click.
  Check its event IDs in D1 afterwards; HTTP 204 alone does not show that the production schema stored them.

## API Search Records

The two search endpoints (`/content/search` and `/library/search`) write one row per first-page search to the D1
table `api_searches`, so the editors can see what readers' agents look for and which words the site lacks.

- A row holds the endpoint, the query, the filters, the result count, the words the site never uses (unknown, dropped
  or missing versions), the coarse client category, the test flag and the time.
- The query is redacted with the same rule as site searches (`cleanQuery`). A redacted query keeps no unmatched words either.
- Following `next_url` does not record again. A request with neither a query nor a filter is not recorded.
- No IP address, User-Agent string, cookie or visitor ID is stored. The daily schedule deletes rows older than 30 days.
- The write runs after the response through `ctx.waitUntil`; a failed write does not affect the search.
- Hourly read counts in `agent_reads` never carry the query.

`node scripts/search-stats.mjs` adds an “Agent 经接口搜了什么” section with query counts, zero-result counts,
unmatched words and client categories. Test-marked searches appear separately.

## Content Read Statistics

`GET /read/<document>` returns a published Markdown, JSON or text export from GitHub Pages. For example,
`/read/daily/2026-10-15/external/index.md` returns one external-news edition. Public builds point the read links in
`llms.txt`, `index.md` and the Skill at this route. The original GitHub Pages URLs stay available and bypass the counter.

Request handling:

- The route works without an Origin header or login. The other browser routes keep their Origin checks.
- Only listed export paths are accepted.
- The Worker never forwards caller credentials, query strings, range headers or cache validators, and does not
  follow upstream redirects.
- The response uses `Cache-Control: no-store`, so later requests reach the Worker. GitHub Pages caching can still delay new content.
- The reader has its own rate limit: 120 requests per minute per edge and IP.

Counting:

- Each completed response increments `agent_reads` by UTC hour, document path, method, status, test flag and client
  category. GET and HEAD are counted separately.
- A failed read (any status other than 200) is counted under the fixed path `unavailable-document`, so arbitrary
  missing paths cannot add rows. OPTIONS, rejected paths and rate-limited requests are not counted.
- Status 200 means content was served, not that the client finished reading it.
- The write waits at most one second; after that the response goes out unrecorded. `X-AgentHub-Recorded: 1` means
  the D1 write succeeded, `0` means it did not; the document is served either way.
- The daily schedule deletes hourly records older than 30 days.
- `?analytics_test=1` puts verification requests in a separate group.

Client categories come from User-Agent patterns, which callers can forge. A Python or curl request can come from an
agent, a person or a script. Counts are not unique readers or confirmed agent usage. The application stores no IP,
full User-Agent, cookie or visitor ID.

Deploy order:

1. Apply `schema.sql` to the remote D1 database.
2. Deploy the Worker.
3. Send test-marked GET, HEAD, JSON and missing-document requests, then query their D1 rows.
4. Publish the public site build, which rewrites the machine-readable read links to `/read/`.

Previously installed Skills need a fresh download to use the reader. These counters cannot recover earlier requests.

Reports: set `WRANGLER_BIN` and authenticate Wrangler, then run

```sh
node scripts/agent-read-stats.mjs --json --days 7
```

The command runs fixed read-only SELECT queries and does not accept SQL from callers. The JSON includes totals,
daily successful GET counts, and at most 200 file, client, method and status groups. Test requests stay separate.
`--days` accepts 1 to 30; daily labels use Beijing time, and the filter uses complete hourly buckets in the rolling
window. Without `--json`, the command writes a private report to `output/playwright/agent-read-stats.html`.
There is no public statistics or SQL endpoint.

## Public Library Query

`GET /library/search` lets readers and their agents search the published resource library without authentication.
It reads the same `library/resources.json` as the website; it cannot query raw chats, private statistics or arbitrary SQL.

| Parameter | Meaning |
|---|---|
| `q` | Optional search text, at most 120 characters. BM25 over title, keywords, summary and source links |
| `type` | One resource type, such as `benchmark` or `code` |
| `topic` | One topic, such as `computer-use` |
| `keyword` | One keyword or a known keyword alias |
| `limit` | Page size, 1 to 20; default 5 |
| `offset` | Zero-based result offset; default 0 |
| `revision` | Optional catalog revision from a previous response; a mismatch returns HTTP 409 |

Filters combine with AND. With `q`, results sort by relevance; without it, they keep the library's first-share order,
newest first. The browser and the API use the same query fields, glossary aliases and synonym groups
(see [search rules](../docs/search.md)).

Response:

- `total`, `items`, `next_offset`, `coverage` and `source_loaded_at`. The first page, and any empty result, also
  list the valid type and topic values in `available`.
- Each item carries `content_id` (its ID with the `library:` prefix) and `detail_url`, which `/content/item` reads.
- `discussions` lists only topics that cite one of the item's links. Topics that name the work without linking it,
  and shares from before the dailies began (2026-08-26), are not listed; `discussion_search_url` searches the site
  for the work's name.
- Follow `next_url` to keep the filters and the returned `revision`. Pagination can shift when the source data changes.

Errors:

- An empty match returns HTTP 200 with an empty `items` array.
- Unknown parameters, types, topics or keywords return HTTP 400 with `code: invalid_parameter` and `param`.
  An empty parameter value counts as not given.
- The library has its own revision; a revision from `/content/` returns HTTP 409. After HTTP 409, follow `restart_url`.

Caching: the Worker caches the published data and the BM25 index for five minutes per warm isolate. Concurrent
initial requests share one fetch. A failed refresh keeps the previous data with `stale: true` and retries after 30
seconds; with no previous data, the endpoint returns HTTP 503 until then. Source refresh does not need another Worker deployment.

Library requests share the reader rate limit and use the fixed `library/search` statistics label. The Worker keeps
the redacted query of each first-page search (see [API Search Records](#api-search-records)). Successful counts
include zero-result searches; they do not measure whether the reader found a useful resource.

## Public Content Query

Readers and their agents can browse and search published daily topics, weekly topics, library entries and
opportunities through `/content/`. The build generates `search/catalog.json` from the published source; no separate
database or model service is required for lexical search. The catalog excludes raw chat excerpts and member identities.

Use the Worker origin (the origin of `contentAPIBase` in [`lib/agent-reading.mjs`](../lib/agent-reading.mjs)) with these routes:

| Route | Reader task | Response |
|---|---|---|
| `GET /content/edition` | Browse the latest published daily edition | Group headings and every topic title with a read link |
| `GET /content/edition?kind=weekly` | Browse the latest published weekly edition | Weekly group headings and topic read links |
| `GET /content/search?q=%E7%A7%91%E7%A0%94%E7%BB%8F%E9%AA%8C&limit=5` | Find a topic across the site (`q=科研经验`) | Ranked excerpts, citations and read links |
| `GET /content/item?id=<id>` | Read a known result or related resource | One complete published entry |
| `GET /content/editions?kind=daily&limit=3` | Find available dates | Latest edition and a paginated edition list |

Send non-ASCII query text percent-encoded, or use `curl -G --data-urlencode`. Raw Chinese characters from curl or
Python make the Cloudflare edge return HTTP 400 with an empty body.

### Edition outlines

Start an edition-reading task with `/content/edition`, then follow the selected topics' `read_url` values.

- The outline lists every topic title in source order, grouped by section. Each topic has only `title` and `read_url`,
  so a client does not download excerpts just to choose what to read. Use the edition's `read_url` for the whole issue.
- `kind` defaults to `daily` and also accepts `weekly`. `date` defaults to `latest` or accepts a real `YYYY-MM-DD`;
  a weekly date names its last day.
- `group` optionally selects `group-N` or `external`. The Worker accepts any `group-N`; the published catalog decides
  which groups exist, so a new reader section in `lib/groups.mjs` needs no Worker change.
- The service selects the issue before the group. A group the issue lacks returns HTTP 404; it never falls back to an
  older issue. Unknown dates also return HTTP 404 with discovery links and a `recovery_url`.
- `edition.date` always names the actual published date, also for a `latest` request.
- Each group has its label, heading, an introduction of at most 160 Unicode characters, and `topic_count`.
  Its `outline_url` selects that group while keeping the issue date and catalog revision. Daily groups also have
  their full-group Markdown `read_url`; weekly groups use per-topic reads.
- `trend_count` counts edition-level observations (动向观察). They are not topics and are available only in the full
  group or edition text, so a section with only observations can have zero topics.
- Edition lists stay compact and add `outline_url` to each item. An older cached catalog without section metadata
  returns HTTP 503 with `Retry-After: 30` for outlines; the other routes still work with it.

### Search

`/content/search` accepts:

| Parameter | Meaning |
|---|---|
| `q` | Search text, at most 120 characters |
| `kind` | `daily`, `weekly`, `library` or `opportunity` |
| `group` | `group-N` or `external` |
| `from`, `to` | Inclusive `YYYY-MM-DD` range; weekly periods match when they overlap it |
| `limit`, `offset` | `limit` 1 to 20 (default 5); `offset` 0 to 99999 |

- All supplied filters must match. Filters apply before the relative score cut, so a filtered search keeps every
  match that is strong relative to the best match inside the filter. Without `q`, results sort by date, newest first.
- Library entries use their latest recorded share date. With group or date filters, library results use the latest
  matching share and include `matched_shared`; the group and date must match the same share. Use `/library/search`
  for resource type and topic filters.
- Opportunities (hiring, events and calls for papers shared in the groups) filter by share in the same way. Their
  results add `opportunity_kind` (`hiring`, `event`, `cfp`), `first_shared`, `closes`, any stated `deadline` or
  `event_date`, and `open`. The Worker computes `open` from the request's Beijing date, so it stays correct between
  builds. `closes` is the stated deadline or event day, else 60 days after the last share.
- Observations (动向观察) are results with `trend: true`. Their `url` opens the observation section and their
  `read_url` returns it as Markdown.

Each result has `excerpt` (at most 400 characters of the summary), `url` (a webpage citation), `read_url` (one topic
as Markdown) and `detail_url` (the complete entry as JSON, with the catalog revision). Follow `next_url` to continue
with the same filters and revision.

### Revisions and coverage

- The top-level `revision` names the published catalog; each item's `revision` names that item's content.
- When a supplied catalog revision no longer matches, the API returns HTTP 409 with `code: revision_conflict` and
  `restart_url` (the same request without `revision` and `offset`). The service keeps no old catalog snapshots.
- Every response states `today`, the current Beijing date. Search responses add the first and last covered date of
  each kind under `coverage`; a date range outside all of them adds `coverage.note`.
- `source_loaded_at` is a cache timestamp, not a content version.

### IDs

- Resource IDs use the `library:` prefix; add it to an ID from a resource's `related` list for exact reads.
  `/content/item` also accepts a bare resource ID from `/library/search`.
- Opportunity IDs use the `opportunity:` prefix.
- Topic IDs do not use topic positions. The title is part of a topic's identity, so a title change creates a new ID.

### Errors

| Status | Meaning |
|---|---|
| 200 with an empty list | No match. This does not prove that a subject was never discussed in the groups |
| 400 | Invalid parameter: `code: invalid_parameter`, `param` and `expected`. An empty value counts as not given |
| 404 | Unknown ID, date or group, with discovery links. A missing edition date returns `nearest.before` and `nearest.after`; a weekly addressed by its first day points at that week |
| 409 | Catalog revision changed; follow `restart_url` |
| 429 | Rate limited: `code: rate_limited` and `Retry-After: 60`, on every reader JSON endpoint |
| 503 | Catalog unavailable; this does not mean zero matches |

### Ranking

Search is lexical: BM25 with the documented aliases and synonyms (see [search rules](../docs/search.md)).

Both search endpoints report how they read a query:

- `query.expanded` lists the aliases and synonyms searched.
- Each result has `relevance`, its score divided by the best score in the result set (0.3 to 1).
- Question words do not take part in matching: Chinese ones such as 群里有没有人聊过, and English ones such as what,
  does, the and about, unless they belong to a vocabulary spelling such as Mixture of Experts.
- An English word or identifier the site never uses rejects the query, so an unknown name cannot match generic words.
  When that leaves no result and the remaining words still carry at least half of the query's weight, the search runs
  again without those words and lists them in `query.dropped_terms`. Words containing digits are never dropped.
- A name followed by a version the site never wrote, such as GPT-7 or DeepSeek V5, returns no result even though each
  part is known; `query.missing_versions` names it. Vocabulary spellings and ordinary words such as top 5 are exempt.
  A version is a number after a name the site writes with versions (GPT-6.1, DeepSeek V4.1, Qwen3.6). Years such as
  2026, sizes such as 8B or 1M, and V4 when the site wrote V4.1 do not count as missing.
- A zero-result response adds `query.unmatched_terms`, `query.missing_versions`, and for a missing version
  `query.known_versions`. `hint` explains the result. `retry_url` is set only after a missing version: it searches the
  same names without the version. Otherwise `retry_url` is null.

Semantic ranking: when the Worker has the Workers AI binding `AI` and the build published `search/vectors.json` and
`search/vectors.bin`, `/content/search` also ranks by meaning.

- The query, as typed, is embedded with `@cf/qwen/qwen3-embedding-0.6b` and compared with the stored document vectors
  (cosine at least 0.5, top 50). The result is fused with the top 50 BM25 matches by reciprocal rank.
- `query.semantic` is `used`; `unavailable` (the binding, the vectors or the call failed, including a used-up daily
  allocation, so the result is BM25 only); or `skipped` (a missing version such as GPT-7, which has no answer).
  Each result then has `matched_by`: `words`, `meaning` or `both`. Without the binding, the field is absent.
- The query text goes to Workers AI only through this endpoint. The browser search page stays lexical and sends nothing.
- On the 40 labelled queries of the 2026-10-18 review, hybrid ranking raised Hit@5 from 0.69 to 0.86 and MRR@5 from
  0.62 to 0.81, with the same no-answer false positives (1 of 4). Ranking one query costs about 1 ms of CPU.

Document vectors come from [`scripts/embed-catalog.mjs`](../scripts/embed-catalog.mjs) and are stored in
`data/semantic-vectors.json`, keyed by entry ID and a hash of the embedded text (title, keywords, summary, AI comment).

- The script needs `CLOUDFLARE_ACCOUNT_ID`, and the local Wrangler login or `CLOUDFLARE_API_TOKEN` with Workers AI permission.
- Only new or changed entries are sent. One daily issue is about 30 entries and 10 seconds.
- The build packs current vectors as int8 rows. An entry without a vector is still found by BM25, and a public build warns about it.
- Run the script after each publication that adds entries, before pushing.

### Caching and limits

- The routes share one catalog for five minutes per warm isolate. Concurrent loads share one fetch.
- When a refresh fails, the previous catalog keeps serving with `stale: true` until a refresh succeeds. Without a
  previous catalog, the route returns HTTP 503 for a 30-second retry window.
- The search index is built only when a nonempty query needs it, then reused with the cached catalog. Outline reads
  still fetch the full catalog on a cold cache; smaller responses do not show lower cold-start latency.
- Calls use the reader rate limit. Hourly read counts store the fixed endpoint, status and coarse client category;
  searches are also recorded with their redacted query (see [API Search Records](#api-search-records)).
- For verification, append `analytics_test=1` to every request, including followed read and detail links.

Build and test locally before deploying. The small benchmark is documented in
[`bench/agent-api/README.md`](../bench/agent-api/README.md).
