// Opportunities shared in the groups: hiring (full-time, internships, postdocs, RA), events (talks, round tables,
// meetups, hackathons, competitions) and calls for papers. They expire, often arrive as plain chat text without a
// link, and must never carry personal contact details, so they live in opportunities.json beside the library rather
// than as one more library type. The library page shows the open ones first; the reader API filters them by kind.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { GROUPS, LINK_KINDS, canonicalUrl, libraryUrl, md } from './library.mjs';
import { site } from './site.mjs';
import { groupLabels } from './groups.mjs';

export const opportunitiesUrl = `${libraryUrl}#opportunities`;
export const OPPORTUNITY_KINDS = { hiring: '招聘', event: '活动', cfp: '征稿' };
export const HIRING_ROLES = { 'full-time': '全职', intern: '实习', postdoc: '博后', ra: 'RA/访问', phd: '博士招生' };
// Without a stated deadline an opportunity counts as open this long after it was last shared.
export const DEFAULT_OPEN_DAYS = 60;
const ALL_GROUPS = { ...GROUPS, ...groupLabels };

// A real calendar day: Date.parse would quietly roll 2026-02-30 over to March, moving a deadline.
const date = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const only = (value, allowed, what) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid opportunity ${what}`);
  const extra = Object.keys(value).filter(key => !allowed.includes(key));
  if (extra.length) throw new Error(`Unexpected opportunity ${what} field: ${extra.join(', ')}`);
};
const text = (value, max, what) => {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || [...value].length > max) throw new Error(`Invalid opportunity ${what}`);
};
// Public text never carries a way to reach a person: emails, phone numbers, WeChat ids or QR-code hints.
const CONTACT = /@[a-z0-9-]+\.[a-z]|(?<!\d)1[3-9]\d[\s-]?\d{4}[\s-]?\d{4}(?!\d)|微信号|wxid_|vx[:：]|加微|二维码|私聊我|私信我|dm me/i;
const addDays = (day, days) => new Date(Date.parse(`${day}T00:00:00Z`) + days * 86400e3).toISOString().slice(0, 10);

// The candidate collector's test for a posting in chat text. A posting names an offer (hiring verb or event/call
// word) and something concrete (a role, a date, a place). Questions about jobs, banter about hiring and
// daily-update relays are left out; review decides the rest.
export const OFFER = /招聘|招人|在招|急招|长期招|招募|内推|hiring|we.?re hiring|open (?:role|position)|加入我们|欢迎加入|欢迎投递|投递|简历|征稿|call for (?:papers|participation)|\bCFP\b|截稿|workshop|研讨会|讲座|分享会|圆桌|meetup|见面会|开放日|open ?day|黑客松|hackathon|比赛|竞赛|challenge|报名/i;
export const CONCRETE = /实习|intern|全职|full.?time|校招|社招|博后|postdoc|\bRA\b|研究员|工程师|researcher|engineer|PhD|博士生|岗位|\bHC\b|\bJD\b|base|薪资|\d{1,2}\s*月\s*\d{1,2}\s*日|\d{1,2}[./]\d{1,2}|\d{4}-\d{2}-\d{2}|deadline|截止|线上|线下|地点|上海|北京|深圳|杭州|新加坡|湾区/i;
const NOISE = /(?:日报|周报)已(?:更新|上线)|^\[引用\][^↳]{0,40}$/;
const QUESTION = /^(?:\[引用\])?\s*(?:有没有|有人|请问|求|大家|话说.*吗)/;

export function looksLikePosting(content) {
  const text = String(content || '').replace(/\s+/g, ' ').trim();
  if (text.length < 40 || NOISE.test(text)) return false;
  // A reply quoting a posting is not a posting; the quoted original is recorded on its own.
  const own = text.split('↳')[0];
  if (own.length < 40 || QUESTION.test(own)) return false;
  return OFFER.test(own) && CONCRETE.test(own);
}

export async function readOpportunities(dir) {
  return JSON.parse(await readFile(path.join(dir, 'opportunities.json'), 'utf8').catch(error => {
    if (error.code === 'ENOENT') return '{"version":1,"through":"2026-01-01","items":[]}';
    throw error;
  }));
}

// Validates the reviewed file and adds the derived fields: first and last share, the closing date and whether the
// opportunity is still open on `today` (a Beijing date).
export function normalizeOpportunities(file, { today } = {}) {
  only(file, ['version', 'through', 'items'], 'file');
  if (file.version !== 1 || !date(file.through) || !Array.isArray(file.items)) throw new Error('Invalid opportunities file');
  const ids = new Set();
  const items = file.items.map(item => {
    only(item, ['id', 'kind', 'title', 'org', 'summary', 'roles', 'location', 'deadline', 'event_date', 'topics', 'links', 'shares'], 'item');
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.id) || item.id.length > 64 || ids.has(item.id)) throw new Error(`Invalid or duplicate opportunity id: ${item.id}`);
    ids.add(item.id);
    if (!OPPORTUNITY_KINDS[item.kind]) throw new Error(`Invalid opportunity kind for ${item.id}`);
    text(item.title, 80, `title for ${item.id}`);
    text(item.org, 40, `org for ${item.id}`);
    text(item.summary, 160, `summary for ${item.id}`);
    for (const field of ['title', 'org', 'summary', 'location']) {
      if (item[field] && CONTACT.test(item[field])) throw new Error(`Opportunity ${item.id} ${field} contains contact details`);
    }
    if (item.kind === 'hiring') {
      if (!Array.isArray(item.roles) || !item.roles.length || item.roles.some(role => !HIRING_ROLES[role]) || new Set(item.roles).size !== item.roles.length) {
        throw new Error(`Hiring opportunity ${item.id} needs roles from ${Object.keys(HIRING_ROLES).join(', ')}`);
      }
    } else if (item.roles !== undefined) throw new Error(`Only hiring opportunities have roles: ${item.id}`);
    if (item.location !== undefined) text(item.location, 30, `location for ${item.id}`);
    for (const field of ['deadline', 'event_date']) if (item[field] !== undefined && !date(item[field])) throw new Error(`Invalid ${field} for ${item.id}`);
    if (!Array.isArray(item.topics) || item.topics.length > 6 || item.topics.some(topic => typeof topic !== 'string' || !topic.trim() || [...topic].length > 20 || topic.includes('|'))) {
      throw new Error(`Invalid opportunity topics for ${item.id}`);
    }
    if (!Array.isArray(item.links)) throw new Error(`Invalid opportunity links for ${item.id}`);
    for (const link of item.links) {
      only(link, ['kind', 'url'], 'link');
      if (!LINK_KINDS[link.kind] || canonicalUrl(link.url) !== link.url || !link.url.startsWith('https://')) throw new Error(`Invalid opportunity link for ${item.id}: ${link.url}`);
    }
    if (!Array.isArray(item.shares) || !item.shares.length) throw new Error(`Opportunity ${item.id} has no shares`);
    for (const share of item.shares) {
      only(share, ['date', 'group'], 'share');
      if (!date(share.date) || share.date > file.through || !ALL_GROUPS[share.group]) throw new Error(`Invalid opportunity share for ${item.id}`);
    }
    const shares = [...new Map(item.shares.map(share => [`${share.date}/${share.group}`, share])).values()]
      .sort((a, b) => a.date.localeCompare(b.date) || a.group.localeCompare(b.group));
    const first = shares[0].date, last = shares.at(-1).date;
    // An event closes after it happens; otherwise the stated deadline, or DEFAULT_OPEN_DAYS after the last share.
    const closes = item.deadline || item.event_date || addDays(last, DEFAULT_OPEN_DAYS);
    return { ...item, roles: item.roles || [], topics: item.topics, shares, first, last, closes,
      inferred_close: !item.deadline && !item.event_date, open: !today || closes >= today };
  });
  // Keep closed opportunities separate; within each section show the newest posted day first.
  items.sort((a, b) => Number(b.open) - Number(a.open)
    || b.first.localeCompare(a.first) || a.title.localeCompare(b.title, 'zh-CN'));
  return { through: file.through, items, today: today || null };
}

const groupList = item => [...new Set(item.shares.map(share => ALL_GROUPS[share.group]))].join('、');
// Posted day first: these go stale. A close date the post never gave is said to be the 60-day rule, not a deadline.
export const opportunityWhen = item => `${item.first} 发布，${item.kind === 'event' && item.event_date ? `活动日期 ${item.event_date}`
  : item.deadline ? `截止 ${item.deadline}` : `未写截止日期（按 ${DEFAULT_OPEN_DAYS} 天算到 ${item.closes}）`}`;

// The agent copy: same facts as the page, never a contact person.
export function opportunitiesJson(opportunities) {
  return {
    name: 'AgentHub 机会',
    description: `AgentHub 微信群分享过的招聘、活动和征稿。first_shared 是首次分享（发布）日期；开放项和已截止项分别按发布日期从新到旧排列，没写截止日的按最后一次分享后 ${DEFAULT_OPEN_DAYS} 天算（inferred_close 为 true）。`,
    page: opportunitiesUrl,
    through: opportunities.through,
    today: opportunities.today,
    kinds: Object.entries(OPPORTUNITY_KINDS).map(([id, label]) => ({ id, label })),
    roles: Object.entries(HIRING_ROLES).map(([id, label]) => ({ id, label })),
    items: opportunities.items.map(item => ({
      id: item.id, kind: item.kind, title: item.title, org: item.org, summary: item.summary,
      ...(item.roles.length ? { roles: item.roles } : {}), ...(item.location ? { location: item.location } : {}),
      ...(item.deadline ? { deadline: item.deadline } : {}), ...(item.event_date ? { event_date: item.event_date } : {}),
      first_shared: item.first, last_shared: item.last,
      closes: item.closes, inferred_close: item.inferred_close, open: item.open, topics: item.topics, links: item.links,
      shared: item.shares, url: `${libraryUrl}#${item.id}`,
      ...(item.links.length ? {} : { contact: `见 ${groupList(item)} ${item.last} 的原消息` }),
    })),
  };
}

export function opportunitiesMarkdown(opportunities) {
  const lines = ['# AgentHub 机会', '',
    `> AgentHub 微信群分享过的招聘、活动和征稿，收录至 ${opportunities.through}。没写截止日的按最后一次分享后 ${DEFAULT_OPEN_DAYS} 天算。`,
    `> 网页：${opportunitiesUrl}`, ''];
  for (const [label, list] of [['开放中', opportunities.items.filter(item => item.open)], ['已截止', opportunities.items.filter(item => !item.open)]]) {
    if (!list.length) continue;
    lines.push(`## ${label}（${list.length}）`, '');
    for (const item of list) {
      const roles = item.roles.map(role => HIRING_ROLES[role]).join('、');
      lines.push(`- ${OPPORTUNITY_KINDS[item.kind]}${roles ? `（${roles}）` : ''} · ${md(item.org)} · ${md(item.title)} · ${opportunityWhen(item)}${item.location ? ` · ${md(item.location)}` : ''}`);
      lines.push(`  ${md(item.summary)}`);
      lines.push(`  ${item.links.length ? item.links.map(link => `[${LINK_KINDS[link.kind]}](${link.url})`).join(' · ') : `联系方式见 ${groupList(item)} ${item.last} 的原消息`}`);
    }
    lines.push('');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

export { site };
