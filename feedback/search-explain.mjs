// How a reader API search read its query, so an agent can tell a topic the site never covered from a query
// written in words the site does not use. Both search endpoints share this shape.
export function searchReading(read, q) {
  if (!q) return {};
  return { expanded: read.expanded, dropped_terms: read.dropped_terms,
    ...(read.matches.size ? {} : { unmatched_terms: read.unknown_terms, missing_versions: read.missing_versions,
      ...(read.missing_versions.length ? { known_versions: read.known_versions } : {}) }) };
}

// A zero-result search says why. A retry is offered only for a family search after a version the site never wrote;
// dropping an unknown word is already tried inside the search (explain), under the rules that keep a rare name from
// falling back to generic words, so a retry_url that dropped it again would bypass those rules.
export function zeroResultHint(read, q, url, retry) {
  if (!q || read.matches.size) return {};
  const reasons = [];
  if (read.missing_versions.length) {
    reasons.push(`No published text mentions ${read.missing_versions.join(', ')}; known_versions lists the versions the site has written.`);
  }
  if (read.unknown_terms.length) reasons.push(`The site never uses: ${read.unknown_terms.join(', ')}.`);
  reasons.push('Zero results cover published summaries and library entries only; they do not prove the group never discussed it.');
  let retry_url = null;
  const family = read.version_free;
  if (family && /[a-z㐀-鿿]{2}/i.test(family) && retry?.(family)) {
    const next = new URL(url);
    next.searchParams.set('q', family);
    next.searchParams.delete('offset');
    retry_url = next.href;
    reasons.push('retry_url searches the same names without the version, if any version will do.');
  } else if (!read.missing_versions.length) {
    reasons.push('Try two to four topic words, a Chinese term for the topic, or a broader name.');
  }
  return { hint: reasons.join(' '), retry_url };
}

// Score relative to the best match in this result set, from 0.3 (the cut) to 1.
export const relevance = (score, top) => top ? Math.round(score / top * 100) / 100 : undefined;
