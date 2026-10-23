import { createHash } from 'node:crypto';

// Formatting and ordering do not reset votes; a changed article is a new revision.
export function feedbackId(date, group, story) {
  return createHash('sha256').update(JSON.stringify([date, group, story.title, story.text])).digest('hex').slice(0, 32);
}

// Library items keep their votes when the summary is edited; the reviewed id is the identity.
export function libraryFeedbackId(id) {
  return createHash('sha256').update(JSON.stringify(['library', id])).digest('hex').slice(0, 32);
}
