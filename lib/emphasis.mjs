export function validateEmphasis(text, phrases, {
  invalidMessage = 'Invalid emphasis', overlapMessage = 'Overlapping emphasis',
} = {}) {
  if (typeof text !== 'string' || !Array.isArray(phrases) ||
      new Set(phrases).size !== phrases.length ||
      phrases.some(phrase => typeof phrase !== 'string' || phrase.trim() !== phrase || phrase.length < 2 ||
        /\n\s*\n/.test(phrase) || !text.includes(phrase) || text.indexOf(phrase) !== text.lastIndexOf(phrase)) ||
      phrases.reduce((sum, phrase) => sum + phrase.length, 0) * 10 > text.length * 3) {
    throw new Error(invalidMessage);
  }
  const ranges = phrases.map(phrase => [text.indexOf(phrase), text.indexOf(phrase) + phrase.length])
    .sort((a, b) => a[0] - b[0]);
  for (let index = 1; index < ranges.length; index++) {
    if (ranges[index][0] < ranges[index - 1][1]) throw new Error(overlapMessage);
  }
}

// Keeps the spans validateEmphasis would accept, in their original order, and reports the rest.
// Model output often miscopies a character or overshoots the 30% budget; generators drop those spans
// instead of discarding the whole page. Budget overruns drop spans from the end of the list.
export function trimEmphasis(text, phrases) {
  const kept = [], dropped = [];
  const taken = [];
  for (const phrase of Array.isArray(phrases) ? phrases : []) {
    const reason = typeof phrase !== 'string' ? 'not-string'
      : phrase.trim() !== phrase || phrase.length < 2 ? 'malformed'
      : /\n\s*\n/.test(phrase) ? 'crosses-paragraph'
      : !text.includes(phrase) ? 'not-in-text'
      : text.indexOf(phrase) !== text.lastIndexOf(phrase) ? 'ambiguous'
      : kept.includes(phrase) ? 'duplicate' : null;
    if (reason) { dropped.push({ phrase, reason }); continue; }
    const start = text.indexOf(phrase), end = start + phrase.length;
    if (taken.some(([a, b]) => start < b && a < end)) { dropped.push({ phrase, reason: 'overlap' }); continue; }
    kept.push(phrase);
    taken.push([start, end]);
  }
  while (kept.reduce((sum, phrase) => sum + phrase.length, 0) * 10 > text.length * 3) {
    dropped.push({ phrase: kept.pop(), reason: 'over-budget' });
  }
  return { kept, dropped };
}
