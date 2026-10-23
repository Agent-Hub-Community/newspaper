import { validateComments } from './story-comments.mjs';
import { validateEmphasis } from './emphasis.mjs';

export function mergeExternalEditions(editions, reports) {
  const byDate = new Map(editions.map(issue => [issue.date, { ...issue, pages: [...issue.pages] }]));
  const seen = new Set();
  for (const report of reports) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(report.date) || seen.has(report.date) ||
        !report.title || !report.intro || !Array.isArray(report.stories) ||
        !Array.isArray(report.trends)) throw new Error('Invalid external report');
    seen.add(report.date);
    if (!byDate.has(report.date)) {
      byDate.set(report.date, {
        id: report.date, date: report.date, label: `${report.date} 日报`,
        pages: ['一群', '二群', '三群'].map((label, index) => ({
          id: `group-${index + 1}`, label, section: '今日讨论',
          heading: '本日群聊版尚未收录', theme: '暂无本日稿件', stories: [],
        })),
      });
    }
    const issue = byDate.get(report.date);
    issue.pages = issue.pages.filter(page => page.id !== 'external');
    issue.pages.push({
      id: 'external', label: '外部资讯', section: '研究 · 产品 · 工程',
      heading: report.title, theme: report.intro,
      stories: report.stories.map(story => {
        if (!story.title || !story.text || !story.timing ||
            !Array.isArray(story.links) || !story.links.length || story.links.length > 3) {
          throw new Error('Invalid external story');
        }
        if (story.aiComment !== undefined) {
          validateComments([{ id: 'external', comment: story.aiComment }], [{ id: 'external' }]);
        }
        if (story.emphasis !== undefined) {
          validateEmphasis(story.text, story.emphasis, {
            invalidMessage: 'Invalid external emphasis', overlapMessage: 'Overlapping external emphasis',
          });
        }
        return {
          category: story.timing, title: story.title, text: story.text,
          ...(story.aiComment !== undefined ? { aiComment: story.aiComment } : {}),
          ...(story.emphasis !== undefined ? { emphasis: [...story.emphasis] } : {}),
          resources: story.links.map(link => {
            const url = new URL(link.url);
            if (url.protocol !== 'https:' || url.username || url.password || !link.label) {
              throw new Error('Invalid external link');
            }
            // Older editions put the link type in label; newer ones name the target there and keep the type in kind.
            const type = link.kind || link.label;
            return {
              kind: type === '论文' ? 'paper' : type === '代码' ? 'code'
                : ['原帖', '讨论'].includes(type) ? 'discussion' : 'article',
              label: link.label, url: url.href,
            };
          }),
        };
      }),
      trends: report.trends.map(trend => {
        if (!trend.title || !trend.text) throw new Error('Invalid external trend');
        return { title: trend.title, text: trend.text };
      }),
    });
  }
  for (const issue of byDate.values()) {
    if (!issue.pages.some(page => page.id === 'external')) {
      issue.pages.push({
        id: 'external', label: '外部资讯', section: '研究 · 产品 · 工程',
        heading: '本日外部资讯尚未收录', theme: '暂无本日稿件', stories: [],
      });
    }
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}
