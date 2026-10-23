// Browser and reader APIs search the same public fields with the same vocabulary.
(() => {
  'use strict';
  function createFields(entry) {
    return {
      title: entry.title ?? entry.t ?? '',
      keywords: (entry.keywords ?? entry.kw ?? []).join(' '),
      text: [entry.text ?? entry.summary ?? entry.x ?? '', entry.ai_comment ?? '',
        ...(entry.links || []).map(link => link.url),
        ...(entry.resources || []).flatMap(resource => [resource.label, resource.url])].filter(Boolean).join('\n'),
    };
  }
  // Ordinary words followed by a number (top 5, pass 1) are not model versions.
  const GENERIC = new Set(('top pass step level stage day days week weeks page part phase round rank chapter section version ' +
    'layer layers epoch batch size year month the and for with to of in on at by').split(' '));
  // A name, then a version: GPT-7, DeepSeek V5, Qwen3.6. A number that runs into a letter is a size or variant
  // (1M, 8B, 4o), not a version, and a four-digit year (ICLR 2026) is a date.
  const VERSIONED = /([a-z]{2,})[\s_-]*(v?\d+(?:\.\d+)?)(?![\d.]*[a-z\d])/g;
  const isYear = version => /^(?:19|20)\d\d$/.test(version);
  const bare = version => version.replace(/^v/, '');
  // After dropping unknown words, what remains must still carry this share of the query's weight.
  const KEPT = 0.5;

  function createSearcher(entries, vocabulary = {}) {
    const { createIndex, variants, tokens, normalize, isCjk } = globalThis.AgentHubBM25;
    const fields = entries.map(createFields);
    const index = createIndex(fields, { title: 3, keywords: 2, text: 1 });
    const squash = text => normalize(text).replace(/[\s_-]+/g, '');
    const spellings = new Set([...Object.keys(vocabulary.expand || {}), ...(vocabulary.groups || []).flat()].map(squash));
    let versions;
    // Each name the site writes with a version, and the versions it writes: { gemini: [3.5, 3.8, 4], … }.
    function siteVersions() {
      if (versions) return versions;
      versions = new Map();
      for (const field of fields) for (const match of normalize(`${field.title} ${field.keywords} ${field.text}`).matchAll(VERSIONED)) {
        if (isYear(match[2])) continue;
        if (!versions.has(match[1])) versions.set(match[1], new Set());
        versions.get(match[1]).add(bare(match[2]));
      }
      return versions;
    }
    // “GPT-7” or “DeepSeek V5” splits into a known name and a known number, so the unknown-word rule cannot
    // reject it and every GPT item would match. Only names the site writes with versions are checked; a version
    // it never wrote for that name has no answer. V4 also counts as written when the site has V4.1.
    function missingVersions(query) {
      const out = [];
      for (const match of normalize(query).matchAll(VERSIONED)) {
        const [text, name, version] = match;
        const seen = siteVersions().get(name);
        if (!seen || GENERIC.has(name) || isYear(version) || spellings.has(squash(text))) continue;
        const wanted = bare(version);
        if (![...seen].some(v => v === wanted || v.startsWith(`${wanted}.`))) {
          out.push({ text: text.trim(), name, known: [...seen].sort((a, b) => parseFloat(b) - parseFloat(a)).slice(0, 6) });
        }
      }
      return out;
    }
    // Returns the matches plus how the query was read, so a reader or agent can tell an absent topic from a
    // query the site cannot match as typed.
    function explain(query, keep) {
      const read = variants(query, vocabulary.expand, vocabulary.groups);
      const spelled = new Set(read.found.flatMap(item => tokens(item.alias)));
      const typed = read.variants[0] ? [...new Set(tokens(read.variants[0].text))] : [];
      const unknown = typed.filter(token => !isCjk(token) && !index.known(token) && !spelled.has(token));
      const missing = read.variants.length ? missingVersions(query) : [];
      const result = { matches: new Map(), expanded: read.found, unknown_terms: unknown, dropped_terms: [],
        missing_versions: missing.map(item => item.text),
        known_versions: Object.fromEntries(missing.map(item => [item.name, item.known])),
        // Without the missing versions the query names the family, which the reader can choose to search.
        version_free: missing.length ? missing.reduce((text, item) => text.replace(new RegExp(`(?<=${item.name})[\\s_-]*v?${
          item.text.slice(item.name.length).trim().replace(/^[\s_-]*v?/, '').replace(/\./g, '\\.')}(?![\\d.])`, 'i'), ''),
        normalize(query)).replace(/\s+/g, ' ').trim() : '' };
      if (!read.variants.length || missing.length) return result;
      result.matches = index.search(read.variants, keep);
      if (result.matches.size || !unknown.length) return result;
      // An unknown English word rejects the query so that a name the site lacks never falls back to common
      // words. When the rest of the query still carries most of its weight, search the rest and say so.
      // Identifiers with digits (dpsk5, o5-mini) are never dropped.
      const known = typed.filter(token => !unknown.includes(token));
      if (unknown.some(token => /\d/.test(token)) || !known.some(token => isCjk(token) || !/^\d+$/.test(token))
        || index.weightOf(known) < KEPT * index.weightOf(typed)) return result;
      const rest = normalize(query).replace(new RegExp(`(?<![a-z0-9])(?:${unknown.join('|')})(?![a-z0-9])`, 'g'), ' ');
      const retry = variants(rest, vocabulary.expand, vocabulary.groups);
      const matches = index.search(retry.variants, keep);
      if (matches.size) Object.assign(result, { matches, expanded: retry.found, dropped_terms: unknown });
      return result;
    }
    return {
      fields,
      explain,
      search: (query, keep) => explain(query, keep).matches,
    };
  }
  globalThis.AgentHubQuery = { createFields, createSearcher };
})();
