import { cleanText, safeUrl } from './content.mjs';
import { validateEmphasis } from './emphasis.mjs';

export function sanitizeInput(input) {
  return {
    ...input,
    messages: input.messages.map(m => ({
      ...m,
      content: cleanText(m.content)
        .replace(/(?:<\?xml[\s\S]*|<msg>[\s\S]*)/g, '[媒体引用未解析]')
        .replace(/\bwxid_[A-Za-z0-9_]+/g, '[成员]')
        .replace(/https?:\/\/[^\s<>"'，。]+/g, url => safeUrl(url) || '[链接]'),
    })),
  };
}

export function validateDraft(draft, input, { requireEmphasis = false } = {}) {
  if (!draft || typeof draft.heading !== 'string' || !draft.heading.trim() ||
      typeof draft.theme !== 'string' || !Array.isArray(draft.stories)) {
    throw new Error('Invalid draft header or story count');
  }
  const ids = new Set(input.messages.map(m => m.id));
  const evidence = refs => {
    if (!Array.isArray(refs) || !refs.length || refs.some(id => !ids.has(id))) throw new Error('Missing or unknown evidence ID');
  };
  const kinds = new Set(['discussion_position', 'reported_experience', 'open_question', 'shared_link', 'verified_fact']);
  const titles = new Set();
  for (const story of draft.stories) {
    for (const key of ['category', 'title', 'text', 'topic_key']) {
      if (typeof story[key] !== 'string' || !story[key].trim()) throw new Error(`Missing ${key}`);
    }
    if (titles.has(story.title)) throw new Error('Duplicate title');
    titles.add(story.title);
    if (requireEmphasis || story.emphasis !== undefined) {
      validateEmphasis(story.text, story.emphasis, {
        invalidMessage: `Invalid emphasis in "${story.title}": use unique exact spans within one paragraph and 30% of the body`,
      });
    }
    evidence(story.evidence_ids);
    if (!Array.isArray(story.claims) || !story.claims.length) throw new Error('Missing claim audit');
    for (const claim of story.claims) {
      if (!kinds.has(claim.kind) || !claim.text?.trim()) throw new Error('Invalid claim');
      evidence(claim.evidence_ids);
      if (claim.evidence_ids.some(id => !story.evidence_ids.includes(id))) throw new Error('Claim outside story evidence');
    }
  }
  for (const resource of draft.resources || []) {
    evidence(resource.evidence_ids);
    if (!safeUrl(resource.url) || !input.messages.some(m => m.content.includes(resource.url))) throw new Error('Invented resource URL');
  }
  const reader = JSON.stringify({ heading: draft.heading, theme: draft.theme,
    stories: draft.stories.map(({ category, title, text }) => ({ category, title, text })) });
  if (/aeskey|wxid_|@chatroom|xsec_token|\/Users\/|\b1[3-9]\d{9}\b/.test(reader)) throw new Error('Private material in reader copy');
  return draft;
}

export function readerPage(draft, input) {
  validateDraft(draft, input);
  const cutoff = new Date(input.cutoff).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }).slice(0, 5);
  return {
    ...input.group, section: '今日讨论', heading: draft.heading, theme: draft.theme,
    note: `${input.date} · 截至北京时间 ${cutoff} · 本地可读记录选编，非完整全天日报。`,
    stories: draft.stories.map(({ category, title, text, emphasis }) => ({
      category, title, text, ...(emphasis !== undefined ? { emphasis: [...emphasis] } : {}),
    })),
  };
}
