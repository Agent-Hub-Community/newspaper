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
