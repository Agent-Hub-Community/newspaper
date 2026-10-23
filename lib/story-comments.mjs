import { feedbackId } from './feedback-id.mjs';

export function commentStories(issues) {
  return issues.flatMap(issue => issue.pages.flatMap(page => (page.stories || []).map(story => ({
    id: feedbackId(issue.date, page.id, story), date: issue.date, group: page.id,
    title: story.title, text: story.text,
  }))));
}

export function validateComments(entries, stories) {
  if (!Array.isArray(entries) || entries.length !== stories.length) throw new Error('Comment coverage mismatch');
  const expected = new Set(stories.map(story => story.id));
  const seen = new Set();
  for (const entry of entries) {
    if (!entry || !expected.has(entry.id) || seen.has(entry.id)
        || typeof entry.comment !== 'string' || entry.comment !== entry.comment.trim()
        || [...entry.comment].length < 6 || [...entry.comment].length > 90
        || /[<>\n\r]/.test(entry.comment)) throw new Error(`Invalid comment: ${entry?.id}`);
    seen.add(entry.id);
  }
  return entries.map(({ id, comment }) => ({ id, comment }));
}

export function applyComments(issues, entries) {
  const comments = new Map(validateComments(entries, commentStories(issues)).map(entry => [entry.id, entry.comment]));
  for (const issue of issues) for (const page of issue.pages) for (const story of page.stories || []) {
    story.aiComment = comments.get(feedbackId(issue.date, page.id, story));
  }
}
