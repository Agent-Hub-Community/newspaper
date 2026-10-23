# Story Feedback

Cloudflare Workers accepts votes; D1 stores one current choice per anonymous browser
and article revision. Web Analytics is independent and is not used as a vote store.

Current local preview works without a server and labels saved choices as device-only.
No counts are invented. Online collection requires the deployment below.

## Production Service

The production Worker runs on the Cloudflare Workers free plan with one D1 database.
The free plan has request and storage limits. Reaching them must not trigger a paid upgrade.
Wrangler needs only these scopes: user read, account read, Workers scripts write and D1 write.
Never commit credentials or copy them into frontend code.

The GitHub repository variable `FEEDBACK_API_URL` supplies the Worker origin to the Pages workflow.
Deploying the Worker alone does not update the public website. Register the release catalog before Pages deploys.
Old registered revisions and their votes remain intact.

`node test/feedback-live.mjs --live` verifies real D1 counts, repeated PUTs, changing
votes, cancellation, and reload at 390/820/1440px with the production Origin and CSP.
It uses local frontend assets, not the live Pages frontend, and cancels its test vote.
Add `--production` after a Pages deployment to load actual published assets,
compare the complete edition payload, and verify image loading and real voting.
Public controls show real integer counts including zero; unknown/unavailable counts
and offline preview counts use `—`, not fabricated zeros.

## Deployment

Do not upgrade a plan automatically.
Authorize Wrangler with account read, user read, Workers scripts write and D1 write.
The production database already exists and its ID is in `feedback/wrangler.jsonc`.
Reuse that ID; do not create another database on redeploy.

```sh
npx wrangler d1 execute agenthub-feedback --remote --config feedback/wrangler.jsonc --file feedback/schema.sql
npm run build -- --public
node scripts/feedback-catalog.mjs dist/data.js scratch/feedback-catalog.sql
npx wrangler d1 execute agenthub-feedback --remote --config feedback/wrangler.jsonc --file scratch/feedback-catalog.sql
npx wrangler deploy --config feedback/wrangler.jsonc
# Use the actual HTTPS origin printed by deploy:
FEEDBACK_API_URL=https://YOUR-WORKER.workers.dev npm run build -- --public
```

Set `FEEDBACK_API_URL` in the Pages build environment when publishing. Register new
approved article revisions before publishing them, otherwise the API returns 404.
Do not register private draft articles. Formatting/order changes keep the article ID;
changing its title, body, group or date produces a new ID with independent feedback.

## Library Hearts

The library page reuses this service for hearts. Each library item registers as a row with
`group_id = 'library'` and an ID from `libraryFeedbackId(item.id)`; `scripts/feedback-catalog.mjs`
emits those rows together with the story revisions. A heart is `PUT {vote: 'up'}` and removing it is
`PUT {vote: null}`. Because a page shows a few hundred items, the page reads all counts at once with
`GET /votes?collection=library&voter=<uuid>`, which returns `{ items: { <id>: { up, down, vote } } }`
for every registered row in that collection. Only collections listed in the worker are accepted.
Before the first library release, deploy the worker and run `feedback/schema.sql` again: it adds the
`stories_group` index that keeps collection reads from scanning every story. Without the worker the page
shows "—" for every count.

## Reading Results

Use the D1 console or `wrangler d1 execute` with:

```sql
SELECT s.date, s.group_id, s.title,
  SUM(CASE WHEN v.vote = 'up' THEN 1 ELSE 0 END) AS likes,
  SUM(CASE WHEN v.vote = 'down' THEN 1 ELSE 0 END) AS dislikes
FROM stories s LEFT JOIN votes v ON v.story_id = s.id
GROUP BY s.id
ORDER BY s.date DESC, likes DESC;
```

Only totals and the calling browser's choice are available through the public API.
The database stores the article ID, random browser ID, choice and last update time.
No names, chat records, avatars or raw IP addresses are stored in D1. The edge rate
limiter uses the IP transiently; Cloudflare itself still processes request metadata.
Application request logging is disabled in the Worker configuration.

PUT is idempotent; repeat requests cannot increment a vote. The database primary key
makes up/down mutually exclusive; null cancels. Writes and returned totals share one
D1 batch transaction. Unknown article IDs, invalid votes, oversized bodies and
disallowed browser origins are rejected. Rate limiting is approximate, per edge/IP,
and applies to reads and writes. It is not identity verification: clearing browser
storage or using another browser can vote again, and CORS is not bot protection.
Add Turnstile or login only if abuse warrants it.

After a network failure the browser does not claim success or invent counts. It
re-reads before the next vote, because a timed-out write may already have committed.
Local previews never upload votes; public builds without an endpoint remain device-only.

## Discussion Opens

The discussion reader also reports how often each story's original discussion is opened.
When a reader opens a discussion, `discussion-panel.js` sends `POST /opens?story=<id>` with no body,
no cookies and no referrer. A tab reports each story once (`sessionStorage`), so reopening or
switching back does not add to the count. Only public builds with `FEEDBACK_API_URL` report;
local previews and weekly pages (whose stories are not registered) do not.

The worker adds one to `discussion_opens` for the story and the Beijing date. It stores only the
story ID, the date and the count, with no browser ID and no IP address; unknown story IDs return 404
and the same rate limiter applies. Before the first release, run `feedback/schema.sql` again to
create the table, then deploy the worker; until then the reader's reports fail silently.

Most-opened discussions:

```sql
SELECT s.date, s.group_id, s.title, SUM(o.opens) AS opens
FROM discussion_opens o JOIN stories s ON s.id = o.story_id
GROUP BY s.id
ORDER BY opens DESC
LIMIT 30;
```

Counts are approximate: each tab counts once per story, and blocked storage or bots can skew them.
Compare them with Cloudflare Web Analytics page views of the same group page for an open rate.
`node test/discussion-opens-browser.mjs` checks the reader side; `test/discussion-opens.test.mjs` the worker.

## 浏览量统计 (Page Views)

The worker counts page views itself, so the site has traffic numbers without Cloudflare Web Analytics.
`analytics.js` (the Web Analytics loader) is a separate path and stays empty until it has a token.

Only a public build with `FEEDBACK_API_URL` adds `views.js`. The script tag carries the worker origin in
`data-endpoint`, and each page's CSP `connect-src` allows that origin. Every reader page loads it: home, daily
sections, rank boards, weekly sections, library, glossary and search. The 404 page and the `/weekly/` forwarding
page load no script and never report. The script reports only when `location.origin` is the site origin and the path
starts with `basePath` (both from `site.mjs`), so local previews, `file://` and the old site address send nothing.

The script reports the current path once when the page loads, again after `history.pushState` (date and
section changes in `app.js`) and after `popstate` (back and forward). It skips a report when the path equals
the previous report, so hash and query changes such as the discussion reader do not count. `replaceState` does
not count. On the reader app, `views.js` runs before `app.js`, so a reader who opens the home address counts as a
home view (`/newspaper/`) before `app.js` replaces the address with the latest daily section.

Each report is `POST /views` with a `text/plain` JSON body `{"path": "/newspaper/daily/2026-10-22/group-1/",
"visitor": "<uuid>"}`. A text body needs no CORS preflight. The script uses `fetch` with `keepalive`,
`credentials: 'omit'` and no referrer, not `navigator.sendBeacon`: WebKit (Safari and WeChat on iOS)
sends `Origin: null` for a beacon from a page with `no-referrer` policy, and the worker rejects that origin.
Failed reports are dropped silently.

The worker applies the same checks as the other browser routes:

- The `Origin` header must be one of `ALLOWED_ORIGIN`. The rate limiter key is `views:<IP>` (120 per minute).
- The body must be `text/plain` or `application/json` and at most 1024 bytes.
- The path loses its query and hash, and `index.html` names its directory. It must start with `basePath`,
  be at most 200 characters, and match a published route shape: home, `daily/<date>/<group-N|external>/`,
  `weekly/<start>/<end>/<page>/`, `weekly/<start>_<end>/<page>/`, `rank/<week|month|all>/[group-N/]`,
  `library/`, `glossary/` or `search/`. Anything else returns HTTP 400.
- `source` is `wechat` when the User-Agent contains `MicroMessenger`, otherwise `other`.
- The date is the Beijing date, as for discussion opens.

A valid report returns HTTP 204 and writes in one D1 batch:

| Table | Key | Write |
|---|---|---|
| `page_views` | `(day, path, source)` | Upsert; `views` adds one |
| `daily_visitors` | `(day, visitor_hash)` | `INSERT OR IGNORE`; only when `visitor` is a lowercase UUID v4 |

`visitor_hash` is the first 16 bytes, in hex, of SHA-256 of `day + ':' + visitor`. A report with a
missing or malformed visitor still counts the view.

Privacy limits:

- D1 stores no IP address, User-Agent string, referrer, query string, hash or raw visitor ID.
  The rate limiter reads the IP transiently, as for votes.
- The visitor ID is the anonymous browser ID of the vote buttons (`localStorage` key
  `agenthub:feedback:v1:voter`). `views.js` creates it when missing. When storage is blocked, the report
  carries no visitor ID, because a new ID on every page would inflate the visitor count.
- `daily_visitors` holds no path. Hashes of one browser differ from day to day. `votes.voter` stores the raw ID
  of browsers that voted, so an operator with D1 access can link those browsers' daily visitor rows.
- No retention schedule deletes these rows. There is no public read endpoint.

Counts are approximate. Readers whose network cannot reach `workers.dev` (common in mainland China without
a proxy) are not counted, so the WeChat share and the totals undercount those readers. Blocked scripts,
bots and forged requests also skew the numbers; the Origin check and the rate limit are not bot protection.
Visitors are unique per day only. A browser that visits on three days counts three times, so daily visitor
counts cannot be added into a weekly unique count.

Deploy in this order. A worker that runs before the tables exist answers HTTP 503 and stores nothing.

1. Apply `feedback/schema.sql` to the remote database. All statements use `IF NOT EXISTS`.
2. Deploy the worker with `feedback/wrangler.jsonc`.
3. Publish the public site build with `FEEDBACK_API_URL`.

Private report, with read-only fixed queries and Beijing dates. The default range is the last 7 days.
Set `WRANGLER_BIN` to an installed Wrangler, or the script runs `npx -y wrangler@4`. Wrangler must be logged in.

```sh
node scripts/traffic-report.mjs
node scripts/traffic-report.mjs --from 2026-10-16 --to 2026-10-22
node scripts/traffic-report.mjs --json
```

Each day lists total views, daily visitors, the WeChat share of views and the ten most viewed paths.
`test/page-views.test.mjs` checks the worker, `test/views.test.mjs` the browser script and
`test/traffic-report.test.mjs` the report. `node test/views-browser.mjs` (add `BROWSER=webkit` for WebKit)
runs the public build at the production URL with the worker intercepted; build it first with `FEEDBACK_API_URL`.

## Search Statistics

Public search pages use `POST /search-events` when `FEEDBACK_API_URL` is configured.
The reader records a search after input settles for 1.2 seconds, on Enter, or on a result click.
Changing a filter or sort starts a new search; pagination does not. IME composition is not recorded.
Each search has a random event ID, with no persistent visitor ID, cookies, IP address or referrer stored.
The payload includes the query, filters, total result count and optional clicked result path/rank.
Each click includes its search so navigation cannot create an orphan; retry IDs prevent double counting.

The query is normalized and limited to 120 characters. Obvious emails, URLs (with or without a scheme), phone-like
digit runs (also with spaces or dashes), common token prefixes, JWTs, WeChat ids and long letter-digit strings are
replaced with a redaction label on both client and server (`SENSITIVE` in `feedback/search-events.mjs`). This is not a general
personal-data detector; the search page tells readers what is collected and asks them not to enter private information.
The worker accepts only bounded payloads and site result paths. Reporting failure does not block search or navigation.
There is no public endpoint for reading queries. Public clients can forge events; Origin checks and rate limits
do not prove that a person searched. These counts are neither unique readers nor Cloudflare bot-filtered metrics.

Deploy the schema before the worker, then publish the search page. The daily Worker schedule removes
search records older than 30 days and their clicks. Existing votes and discussion totals are unaffected.
Keyword-level history cannot be recovered from earlier Cloudflare page views.

To generate a private local report, set `WRANGLER_BIN` to the installed executable and run:

```sh
node scripts/search-stats.mjs
```

The report contains keyword counts, result counts, zero-result searches and searches with a result click.
No click does not prove failure, and a result click does not prove the destination answered the question.
Different filters and sorts remain separate rows. The report uses authenticated read-only D1 queries;
its HTML stays in the ignored `output/playwright/` directory.

Open search with `?analytics_test=1` for deployment verification. Those records appear separately in the report.
Run `node test/search-tracking-browser.mjs` against the public local build for intercepted browser checks.
Run it with `--live` only to verify production: it writes two test searches and one result click.
The test blocks Cloudflare beacons and unrelated feedback calls. Verify its event IDs in D1 after the run;
HTTP 204 alone does not establish that the production schema contains the expected records.

## Content Read Statistics

`GET /read/<document>` returns a published Markdown, JSON or text export from GitHub Pages.
For example, `/read/daily/2026-10-15/external/index.md` returns one external-news edition.
The route works without an Origin header or login. Existing feedback routes keep their Origin checks.
Only listed export paths are accepted. The worker never forwards caller credentials, query strings,
range headers or cache validators, and does not follow upstream redirects.

Each completed response decision increments `agent_reads` by UTC hour, document path, method,
status, test flag and client category. GET and HEAD are separate. Status 200 means content was
served, not that the client finished downloading or reading it. Missing documents and upstream
failures have separate status codes. OPTIONS, rejected paths and rate-limited requests are not counted.
The reader has a separate rate limit of 120 requests per minute per edge/IP.

Client categories use User-Agent patterns, which callers can forge. A Python or curl request can
come from an agent, a person or a script. Counts are not unique readers or confirmed agent usage.
The application stores no IP, full User-Agent, cookies or visitor ID. The daily schedule deletes
hourly records older than 30 days. `?analytics_test=1` puts verification requests in a separate group.

The response uses `Cache-Control: no-store` so subsequent gateway requests reach the worker.
Upstream content can still have GitHub Pages cache delay. A failed read (any status other than 200) is counted
under the fixed path `unavailable-document`, so arbitrary missing paths cannot add rows. The write waits at most
one second; after that the response goes out unrecorded. `X-AgentHub-Recorded: 1` means the D1 write
succeeded. A value of `0` means it did not; the document remains readable. Verify stored rows after deployment.

Deploy in this order:

1. Apply `feedback/schema.sql` to the remote D1 database.
2. Deploy the worker with `feedback/wrangler.jsonc`.
3. Verify test-marked GET, HEAD, JSON and missing-document requests, then query their D1 rows.
4. Publish the public site build, which rewrites machine-readable discovery links to `/read/`.

The original GitHub Pages URLs remain available and bypass this counter. HTML citations stay on Pages.
Previously installed Skills need a fresh download to use the reader. These counters cannot recover earlier requests.

For private agent queries, set `WRANGLER_BIN` to the installed executable and authenticate with Wrangler.
This command returns JSON without creating an HTML file:

```sh
node scripts/agent-read-stats.mjs --json --days 7
```

The command runs fixed read-only SELECT queries; it does not accept SQL from callers.
JSON includes totals, daily successful GET counts, and at most 200 file/client/method/status groups.
Test requests remain separate. `--days` accepts 1 to 30; daily labels use Beijing time.
The time filter uses complete hourly buckets within the rolling window.
Without `--json`, the command writes a private report to `output/playwright/agent-read-stats.html`.
There is no public statistics or SQL endpoint. Local Wrangler credentials are not distributed with the site or Skill.

## Public Library Query

`GET /library/search` lets website readers and their agents search the published resource library without authentication.
It reads the same `library/resources.json` as the website; it cannot query raw chats, private statistics or arbitrary SQL.

| Parameter | Meaning |
|---|---|
| `q` | Optional search text, at most 120 characters; BM25 over title, keywords, summary and source links |
| `type` | One resource type, such as `benchmark` or `code` |
| `topic` | One topic, such as `computer-use` |
| `keyword` | One keyword or a known keyword alias |
| `limit` | Page size, 1 to 20; default 5, as in the content API |
| `offset` | Zero-based result offset; default 0 |
| `revision` | Optional catalog revision from a previous response; a mismatch returns HTTP 409 |

Filters combine with AND. With `q`, results sort by relevance; otherwise they keep the library's first-share order, newest first.
The browser and API use the same query fields, glossary aliases, and synonym groups.
The endpoint returns public resource fields and links to related daily and weekly topics.
The response includes `total`, `items`, `next_offset`, `coverage` and `source_loaded_at`. The first page, and any
empty result, also lists the valid type and topic values in `available`; later pages omit them.
Each item carries `content_id` (its id with the `library:` prefix) and `detail_url`, which `/content/item` reads.
`discussions` lists only topics that cite one of the item's links. Topics that name the work without linking it,
and shares from before the dailies began (2026-08-26), are not listed; `discussion_search_url` searches the site for the work's name.
An empty match returns HTTP 200 with an empty `items` array. Unknown parameters, types, topics or keywords return HTTP 400
with `code: invalid_parameter` and `param` naming the value to fix. An empty parameter value counts as not given.
Pagination can shift when the source data changes. Follow `next_url` to preserve filters and the returned `revision`.
The library has its own revision; a revision from `/content/` returns HTTP 409. After HTTP 409, follow `restart_url`.

The worker caches the published data and BM25 index for five minutes per warm isolate.
Concurrent initial requests share one fetch. A failed refresh keeps the previous data with `stale: true` and retries after
30 seconds; with no previous data the endpoint returns HTTP 503 until then.
GitHub Pages caching can add delay. Source refresh does not require another worker deployment.

Library requests share the reader rate limit and use the fixed `library/search` statistics label.
The worker keeps the redacted query of each first-page search; see API Search Records. Use `analytics_test=1` for verification.
Successful counts include zero-result searches; they do not measure whether the reader found a useful resource.
The public site exposes a sample request and a copyable agent prompt in the library's "给 Agent 用" section.

## API Search Records

The two search endpoints write one row per first-page search to the D1 table `api_searches`, so the editors can see
what readers' agents look for and which words the site lacks. A row holds the endpoint, the query, the filters, the
result count, the words the site never uses (unknown, dropped or missing versions), the coarse client category, the test flag
and the time. The query is redacted with the same rule as site searches (`cleanQuery`): obvious emails, URLs, long digit
sequences and credential patterns become a redaction label, and a redacted query keeps no unmatched words either.
Following `next_url` does not record again; a request with neither a query nor a filter is not recorded.
No IP address, User-Agent string, cookie or visitor ID is stored. The daily schedule deletes rows older than 30 days.
The write runs after the response through `ctx.waitUntil`; a failed write does not affect the search.
Hourly read counts in `agent_reads` still never carry the query.

Deploy order: apply `feedback/schema.sql` (all statements are `IF NOT EXISTS`), then deploy the worker.
`node scripts/search-stats.mjs` adds an “Agent 经接口搜了什么” section with query counts, zero-result counts,
unmatched words and client categories; test-marked searches appear separately.

## Public Content Query

Readers can search published daily topics, weekly topics, and library entries through `/content/search`.
The build generates `search/catalog.json` from the published source. No separate database or model service is required.
The catalog excludes raw chat excerpts and member identities.
Search covers story summaries, library entries and edition-level observations (动向观察). An observation is a search
result with `trend: true`; its `url` opens the observation section and its `read_url` returns it as Markdown.
Observations are not topics: edition outlines list only stories and count observations in `trend_count`.

Use the Worker origin (the origin of `contentAPIBase` in `agent-reading.mjs`) with these routes:

| Route | Reader task | Response |
|---|---|---|
| `GET /content/edition` | Browse the latest published daily edition | Group headings and every topic title with a read link |
| `GET /content/edition?kind=weekly` | Browse the latest published weekly edition | Weekly group headings and topic read links |
| `GET /content/search?q=科研经验&limit=5` | Find a topic across the site | Ranked excerpts, citations, and read links |
| `GET /content/item?id=<id>` | Read a known result or related resource | One complete published entry |
| `GET /content/editions?kind=daily&limit=3` | Find available dates | Latest edition and a paginated edition list |

Start an edition-reading task with `/content/edition`, then follow selected topics' `read_url` values.
The outline includes every topic title in source order, grouped by the published section.
Each topic contains only `title` and `read_url`; its body contains the source links and webpage citation.
This avoids downloading excerpts and several copies of identifiers and URLs just to choose what to read.
Use the edition's `read_url` when the caller needs the whole issue.

`kind` defaults to `daily` and also accepts `weekly`. `date` defaults to `latest` or accepts a real `YYYY-MM-DD`.
A weekly date identifies its ending day. `group` optionally selects a group such as `group-1`, or `external`.
The worker accepts any `group-N`; the published catalog decides which groups exist, so a new reader section
(for example the fifth group in `groups.mjs`) needs no worker change. A group the issue lacks returns HTTP 404.
The service selects the issue before selecting the group; a missing group never falls back to an older issue.
Unknown dates or absent groups return HTTP 404 with discovery links and a `recovery_url`.
The response's `edition.date` always identifies the actual published date, including for a `latest` request.

Each group includes its label, heading, an introduction of at most 160 Unicode characters, and `topic_count`.
Follow its `outline_url` to select that group while retaining the issue date and catalog revision.
Daily groups also expose their existing full-group Markdown `read_url`; weekly groups use individual topic reads.
`trend_count` identifies edition-level observations available only in the full group or full edition text.
They are not counted as indexed topics. A section containing only observations can therefore have zero topics.
The top-level `topic_count` counts topics in the returned groups.

Edition lists remain compact and add `outline_url` to each item and latest-edition object.
The outline route requires the new section metadata; an older cached catalog returns HTTP 503 with `Retry-After: 30`.
The original content routes remain usable with that older catalog.

Search accepts `q` (up to 120 characters), `kind` (`daily`, `weekly`, `library`, or `opportunity`),
`group` (`group-N` such as `group-1`, or `external`), `from`, and `to`.
Dates use `YYYY-MM-DD`. Date ranges are inclusive; weekly periods match when they overlap the requested range.
All supplied filters must match. Filters apply before the relative score cut, so a filtered search keeps
every match that is strong relative to the best match inside the filter. Without `q`, results sort by date, newest first.
For library entries, this date is the latest recorded share. Use `/library/search` for resource type and topic filters.
With group or date filters, library results use the latest matching share date and include `matched_shared`.
The group and date constraints must match the same share record.
Opportunities (hiring, events, calls for papers shared in the groups) filter by share the same way. Their results add
`opportunity_kind` (`hiring`, `event`, `cfp`), `first_shared` (the day it was first posted), `closes`, any stated
`deadline` or `event_date`, and `open`. The worker computes `open` from the request's Beijing date, so it stays right
between builds. `closes` is the stated deadline or event day, else 60 days after the last share.
Edition queries accept only daily or weekly kinds.

List responses default to 5 items. `limit` accepts 1 to 20; `offset` accepts 0 to 99999.
Search results contain at most 400 characters of each summary in `excerpt`.
The `url` is a webpage citation. The `read_url` returns one topic as Markdown.
The `detail_url` returns the complete entry as JSON and includes the catalog revision.
Follow `next_url` to continue with the same filters and revision.

The top-level `revision` identifies the published catalog, while each item's `revision` identifies that item's content.
Every response states `today`, the current date in Beijing, which the editions use. Search responses add the first and
last covered date of each kind under `coverage` (`daily`, `weekly`, `library`, `opportunity`); a date range outside all of them adds `coverage.note`.
`source_loaded_at` is a cache timestamp, not a content version.
When a supplied catalog revision no longer matches, the API returns HTTP 409 with `code: revision_conflict`.
Restart from offset 0. The service does not retain old catalog snapshots.
Resource IDs use the `library:` prefix; add this prefix to an ID from a resource's `related` list for exact reads.
Opportunity IDs use the `opportunity:` prefix.
Topic IDs do not use topic positions. Titles participate in topic identity, so a title change creates a new ID.

Unknown IDs return HTTP 404 with discovery links. Missing Markdown documents also link to `/content/editions`.
`/content/item` also accepts a bare resource id from `/library/search` and reads it as `library:<id>`.
A missing edition date returns `nearest.before` and `nearest.after`; a weekly addressed by its first day points at that week.
HTTP 409 includes `restart_url`, the same request without `revision` and `offset`.
Invalid parameters return HTTP 400 with `code: invalid_parameter`, `param` and `expected`. An empty value counts as not given.
Rate limits return HTTP 429 as JSON with `code: rate_limited` and `Retry-After: 60` on every reader JSON endpoint.
Zero search results return HTTP 200 and an empty list. This does not prove that a subject was never discussed in the group.
HTTP 400 indicates invalid parameters. HTTP 503 indicates catalog unavailability; it does not mean zero matches.
Search is lexical (BM25 with documented aliases and synonyms), plus semantic ranking when the worker has the Workers AI
binding `AI` and the build published `search/vectors.json` and `search/vectors.bin`. The query, as typed, is embedded
with `@cf/qwen/qwen3-embedding-0.6b`, compared with the stored document vectors (cosine at least 0.5, top 50), and fused
with the top 50 BM25 matches by reciprocal rank. `query.semantic` is `used`, `unavailable` (the binding, the vectors or the
call failed, including a used-up daily allocation; the result is BM25 only), or `skipped` (a missing version such as GPT-7,
which has no answer). Each result then has `matched_by`: `words`, `meaning` or `both`. Without the binding the field is absent.
The query text goes to Workers AI only through this endpoint; the browser search page stays lexical and sends nothing.
On the 40 labelled queries of the 2026-10-18 review, hybrid ranking raised Hit@5 from 0.69 to 0.86 and MRR@5 from 0.62
to 0.81 with the same no-answer false positives (1 of 4). Ranking one query costs about 1 ms of CPU.

Document vectors come from `node scripts/embed-catalog.mjs` (requires `CLOUDFLARE_ACCOUNT_ID`; uses the local Wrangler login, or `CLOUDFLARE_API_TOKEN`, with Workers AI permission)
and are stored in `semantic-vectors.json`, keyed by entry id and a hash of the embedded text (title, keywords, summary,
AI comment). Only new or changed entries are sent. The build packs current vectors as int8 rows; an entry without one
is still found by BM25. Run the script after each publication that adds entries, before pushing; one daily issue is
about 30 entries and 10 seconds. A public build warns when entries lack vectors.
Question words do not take part in matching: Chinese ones such as 群里有没有人聊过 and English ones such as
what, does, the and about, unless they belong to a vocabulary spelling such as Mixture of Experts.

Both search endpoints report how they read a query. `query.expanded` lists the aliases and synonyms searched.
Each result has `relevance`, its score divided by the best score in the result set (0.3 to 1).
An English word or identifier the site never uses rejects the query, so an unknown name cannot match generic words.
When that leaves no result and the remaining words still carry at least half of the query's weight, the search
runs again without those words and reports them in `query.dropped_terms`. Words containing digits are never dropped.
A name followed by a version the site never wrote, such as GPT-7 or DeepSeek V5, returns no result even though
each part is known; `query.missing_versions` names it. Vocabulary spellings and ordinary words such as top 5 are exempt.
A zero-result response adds `query.unmatched_terms`, `query.missing_versions`, and for a missing version
`query.known_versions`, the versions the site has written for that name. `hint` explains the result. `retry_url` is set
only after a missing version: it searches the same names without the version. Unknown words are not dropped again
in a retry, because the search already tried that under its own rules; otherwise `retry_url` is null.
A version is a number after a name the site writes with versions (GPT-6.1, DeepSeek V4.1, Qwen3.6). Years such as
2026, sizes such as 8B or 1M, and V4 when the site wrote V4.1 do not count as missing.

The worker shares one catalog across these routes for five minutes per warm isolate. When a refresh fails, the
previous catalog keeps serving with `stale: true` until a refresh succeeds; without a previous catalog the route
returns HTTP 503 for the 30-second retry window.
It creates the search index only when a nonempty search query needs it, then reuses that index with the cached catalog.
Outline reads still fetch the full catalog on a cold cache; smaller client responses do not establish lower cold-start latency.
Concurrent loads coalesce. A failed refresh serves the previous catalog to every waiting request with `stale: true`;
with no previous catalog it returns HTTP 503 for a 30-second retry window.
Calls use the existing reader rate limit. Hourly read counts store the fixed endpoint, status and coarse client category;
searches are also recorded with their redacted query (see API Search Records).
For verification, append `analytics_test=1` to every request, including followed read and detail links.

Publish the site catalog and topic files before deploying a worker that consumes them.
Build and test locally first; the tiny benchmark is documented in `../bench/agent-api/README.md`.
