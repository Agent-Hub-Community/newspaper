import { validateEmphasis } from './emphasis.mjs';

const date = value => /^\d{4}-\d{2}-\d{2}$/.test(value);
const pageId = value => /^(?:group-[1-4]|external)$/.test(value);
const fields = (value, allowed) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) {
    throw new Error('Unexpected weekly field');
  }
};

export function normalizeWeeklyIssue(issue) {
  fields(issue, ['id', 'start', 'end', 'from', 'through', 'label', 'title', 'pages', 'rank']);
  const start = issue.start || issue.from;
  const end = issue.end || issue.through;
  if (!date(start) || !date(end) || start > end || issue.id !== `${start}_${end}` || !Array.isArray(issue.pages)) {
    throw new Error('Invalid weekly edition');
  }
  const ids = new Set();
  const pages = issue.pages.map(page => {
    fields(page, ['id', 'label', 'title', 'intro', 'heading', 'theme', 'note', 'section', 'stories']);
    if (!pageId(page.id) || ids.has(page.id) || !Array.isArray(page.stories)) throw new Error('Invalid weekly page');
    ids.add(page.id);
    const stories = page.stories.map(story => {
      fields(story, ['category', 'title', 'text', 'review', 'aiComment', 'emphasis', 'dates', 'kind', 'timeline', 'resources', 'discussion']);
      if (!story.title?.trim() || !story.text?.trim()) throw new Error('Invalid weekly story');
      // Earlier published editions predate the paragraph review policy.
      if (issue.from) validateEmphasis(story.text, story.emphasis || []);
      else for (const phrase of story.emphasis || []) {
        if (typeof phrase !== 'string' || !phrase || !story.text.includes(phrase)) throw new Error('Invalid historical emphasis');
      }
      for (const resource of story.resources || []) {
        fields(resource, ['kind', 'label', 'url']);
        const url = new URL(resource.url);
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid weekly resource');
      }
      for (const progress of story.timeline || []) {
        fields(progress, ['date', 'text']);
        if (!date(progress.date) || progress.date < start || progress.date > end || !progress.text?.trim()) throw new Error('Invalid weekly timeline');
      }
      for (const message of story.discussion || []) {
        fields(message, ['speaker', 'time', 'text', 'quote', 'continues']);
        if (Object.keys(message).some(key => !['speaker', 'time', 'text', 'quote', 'continues'].includes(key)) ||
            !Number.isSafeInteger(message.speaker) || message.speaker < 1 ||
            !/^\d{2}\.\d{2} (?:[01]\d|2[0-3]):[0-5]\d$/.test(message.time) || !message.text?.trim()) {
          throw new Error('Invalid weekly discussion');
        }
        const messageDay = message.time.slice(0, 5).replace('.', '-');
        const inEdition = [start.slice(0, 4), end.slice(0, 4)].some(year => {
          const messageDate = `${year}-${messageDay}`;
          return messageDate >= start && messageDate <= end;
        });
        if (!inEdition) throw new Error('Weekly message outside edition');
        if (message.quote) fields(message.quote, ['speaker', 'text']);
        if (message.quote && (Object.keys(message.quote).some(key => !['speaker', 'text'].includes(key)) ||
            !(message.quote.speaker === null || Number.isSafeInteger(message.quote.speaker) && message.quote.speaker > 0) ||
            !message.quote.text?.trim())) throw new Error('Invalid weekly quote');
      }
      return { ...story, review: story.review ?? story.aiComment ?? '' };
    });
    return { ...page, title: page.title || page.heading, intro: page.intro ?? page.theme ?? '', stories };
  });
  if (issue.rank) {
    fields(issue.rank, ['groups']);
    for (const group of issue.rank.groups || []) {
      fields(group, ['id', 'label', 'leaders']);
      if (!/^group-[1-4]$/.test(group.id)) throw new Error('Invalid weekly ranking group');
      for (const leader of group.leaders || []) {
        fields(leader, ['rank', 'avatar']);
        if (!Number.isSafeInteger(leader.rank) || leader.rank < 1 ||
            leader.avatar && !new RegExp(`^weekly-assets/${issue.id}/avatars/[a-zA-Z0-9-]+\\.(?:jpg|png)$`).test(leader.avatar)) {
          throw new Error('Invalid weekly ranking');
        }
      }
    }
  }
  return { ...issue, start, end, pages };
}

export function weeklyRoute(issue, page = 'group-3') {
  return `weekly/${issue.start || issue.from}/${issue.end || issue.through}/${page}/`;
}
