import { zstdDecompressSync } from 'node:zlib';

export const dayOf = seconds => new Date(seconds * 1000 + 8 * 3600_000).toISOString().slice(0, 10);
export const startOf = day => Date.parse(`${day}T00:00:00+08:00`) / 1000;
export const memberKey = username => String(username ?? '');
export const policy = '计文字、引用回复、图片、视频、语音、链接、文件和合并转发；排除系统、拍一拍和表情包。每条计 1 次，媒体另列，不按格式判断质量。';

export function classify(row) {
  const base = row.type % 4294967296;
  const subtype = Math.floor(row.type / 4294967296);
  if (base === 10000 || base === 10002 || (base === 49 && subtype === 62)) return 'system';
  if (![1, 3, 34, 43, 62].includes(base) && !(base === 49 && [4, 5, 6, 19, 57].includes(subtype))) return 'other';
  if (!row.sender || row.sender.endsWith('@chatroom')) return 'unresolved';
  if (base === 1) {
    let text;
    try {
      text = typeof row.content === 'string' ? row.content
        : (row.compressed === 4 ? zstdDecompressSync(row.content) : Buffer.from(row.content)).toString('utf8');
    } catch { return 'decode-error'; }
    text = text.replace(/^[^\s:]+:\n/, '').trim();
    return text ? 'counted' : 'empty';
  }
  return 'counted';
}

export function deduplicate(rows) {
  const seen = new Set();
  return rows.filter(row => {
    // Server IDs are strings: WeChat's 64-bit IDs exceed JS integer precision.
    const id = row.server && row.server !== '0'
      ? `${row.group}:${row.server}` : `${row.group}:${row.shard}:${row.local}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export function summarize(rows, start, end) {
  const selected = rows.filter(r => r.timestamp >= start && r.timestamp < end);
  const counts = new Map(), excluded = {};
  for (const row of selected) {
    const kind = classify(row);
    if (kind !== 'counted') { excluded[kind] = (excluded[kind] || 0) + 1; continue; }
    const key = row.sender;
    const member = counts.get(key) || { key, count: 0, media: 0, days: new Set() };
    member.count++;
    if ([3, 34, 43, 62].includes(row.type % 4294967296) || row.type === 4 * 4294967296 + 49) member.media++;
    member.days.add(dayOf(row.timestamp));
    counts.set(key, member);
  }
  const members = [...counts.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  let rank = 0;
  return {
    raw: selected.length, counted: members.reduce((n, m) => n + m.count, 0),
    participants: members.length, media: members.reduce((n, m) => n + m.media, 0), excluded,
    leaders: members.slice(0, 10).map((m, i) => {
      if (!i || m.count !== members[i - 1].count) rank = i + 1;
      return { key: m.key, label: `成员 ${i + 1}`, count: m.count, media: m.media, activeDays: m.days.size, rank };
    }),
  };
}
