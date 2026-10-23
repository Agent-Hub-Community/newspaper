import { createHash } from 'node:crypto';

export const contentRevision = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Ordinal anchors move when an editor reorders stories. An identity uses the issue, page and title instead.
// A title change creates a new identity; duplicate titles in one page are rejected by the catalog builder.
export function topicId(kind, issue, page, story) {
  const period = kind === 'weekly' ? `${issue.start || issue.from}:${issue.end || issue.through}` : issue.date;
  const title = String(story.title).normalize('NFKC').trim();
  return `${kind}:${period}:${page.id}:${contentRevision(title).slice(0, 24)}`;
}

export const topicReadPath = id => `agents/topics/${id}.json`;
