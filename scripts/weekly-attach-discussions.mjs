// Attach the full anonymous discussion to every weekly group story, following the daily rule: the story's
// evidence messages plus the quote-replies to them sent on the same day. Speakers are numbered per story;
// quote headers, @mentions and full nicknames typed in a message become 群友 N. Message ids and identities
// stay in the private audit file.
// Usage: node scripts/weekly-attach-discussions.mjs READER_JSON INPUT_DIR EVIDENCE_DIR AUDIT_JSON
import { readFile, writeFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const [readerFile, inputDir, evidenceDir, auditFile] = process.argv.slice(2);
if (!auditFile) throw new Error('Usage: weekly-attach-discussions.mjs READER_JSON INPUT_DIR EVIDENCE_DIR AUDIT_JSON');
const reader = JSON.parse(await readFile(readerFile, 'utf8'));
const dates = [];
for (let t = Date.parse(`${reader.from || reader.start}T00:00:00Z`); t <= Date.parse(`${reader.through || reader.end}T00:00:00Z`); t += 86400000) dates.push(new Date(t).toISOString().slice(0, 10));
const quoteOf = c => c.match(/^\[引用\]\s*([\s\S]*?)\n\s*↳\s*([^:\n]+):\s*([\s\S]*)$/) || c.match(/^\[引用\] (.*?) {2,}↳ (.+?): (.*)$/s);
const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const audit = [];
// Members are in several groups and address each other across them, so every nickname seen in any group is masked.
const allNames = new Set();
for (const page of reader.pages.filter(p => /^group-/.test(p.id))) for (const date of dates) {
  const file = path.join(inputDir, date, `${page.id}.input.json`);
  for (const m of JSON.parse(await readFile((await realpath(file)).replace(/\.input\.json$/, '.raw.json'), 'utf8'))) if (m.sender) allNames.add(m.sender);
}

for (const page of reader.pages.filter(p => /^group-/.test(p.id))) {
  const messages = new Map(), order = [], names = new Map();
  for (const date of dates) {
    const file = path.join(inputDir, date, `${page.id}.input.json`);
    const input = JSON.parse(await readFile(file, 'utf8'));
    const raw = JSON.parse(await readFile((await realpath(file)).replace(/\.input\.json$/, '.raw.json'), 'utf8'));
    if (raw.length !== input.messages.length) throw new Error(`count mismatch ${date} ${page.id}`);
    input.messages.forEach((m, i) => {
      const ref = `${date}:${m.id}`; messages.set(ref, m); order.push(ref);
      if (raw[i].sender && m.speaker) names.set(raw[i].sender, m.speaker);
    });
  }
  const nameList = [...allNames].filter(n => n.length >= 2).sort((a, b) => b.length - a.length);
  const distinctive = n => (/[一-鿿]/.test(n) && n.length >= 3) || n.length >= 6;
  const { evidence } = JSON.parse(await readFile(path.join(evidenceDir, `${page.id}.evidence.json`), 'utf8'));
  page.stories.forEach((story, index) => {
    const base = (evidence[index] || []).filter(ref => messages.get(ref)?.speaker);
    if (!base.length) { delete story.discussion; return; }
    const set = new Set(base);
    // Quote-replies to an evidence message on the same day belong to the same exchange.
    const heads = base.map(ref => { const c = messages.get(ref).content; return [ref.slice(0, 10), (quoteOf(c)?.[1] ?? c).replace(/\s+/g, ' ').slice(0, 24)]; }).filter(([, h]) => h.length >= 6);
    for (const ref of order) {
      if (set.has(ref)) continue;
      const m = messages.get(ref); const q = m.speaker && quoteOf(m.content); if (!q) continue;
      const quoted = q[3].replace(/\.\.\.$/, '').replace(/\s+/g, ' ');
      if (quoted.length >= 6 && heads.some(([day, h]) => day === ref.slice(0, 10) && quoted.startsWith(h.slice(0, Math.min(h.length, quoted.length, 24))))) set.add(ref);
    }
    const refs = order.filter(ref => set.has(ref));
    const people = new Map(); const number = s => { if (!people.has(s)) people.set(s, people.size + 1); return people.get(s); };
    refs.forEach(ref => number(messages.get(ref).speaker));
    const label = name => { const n = people.get(names.get(name)); return n ? `群友 ${n}` : '群友'; };
    const clean = text => {
      let out = text;
      for (const name of nameList) {
        if (!out.includes(name)) continue;
        out = out.replace(new RegExp(`@${escape(name)}(?=[\\u2005 ，,。:：]|$)`, 'g'), () => `@${label(name)}`);
        if (distinctive(name)) out = out.replaceAll(name, () => label(name));
      }
      // Short nicknames are only masked where a message addresses someone by them (“allen哥”, “@allen”).
      for (const name of nameList) {
        if (distinctive(name) || !/^[A-Za-z][A-Za-z0-9_-]{2,}$/.test(name)) continue;
        out = out.replace(new RegExp(`(^|[^A-Za-z])${escape(name)}(?=(哥|姐|老师|佬|总|同学)|[,，:：\\s]|$)`, 'gi'), (m, pre, offset, all) =>
          /^(bot|ai|agent|opus|sol|astra)$/i.test(name) ? m : `${pre}${label(name)}`);
      }
      return out;
    };
    let previous = null;
    story.discussion = refs.map(ref => {
      const m = messages.get(ref); const q = quoteOf(m.content);
      const speaker = number(m.speaker);
      const entry = { speaker, time: `${ref.slice(5, 7)}.${ref.slice(8, 10)} ${m.time.slice(11, 16)}`, text: clean(q ? q[1] : m.content).trim() || '[图片]' };
      if (q && q[3].trim()) entry.quote = { speaker: names.has(q[2].trim()) ? (people.get(names.get(q[2].trim())) ?? null) : null, text: clean(q[3]).trim() };
      const idNum = Number(m.id.slice(1));
      entry.continues = Boolean(previous && previous.speaker === speaker && previous.day === ref.slice(0, 10) && previous.id + 1 === idNum);
      previous = { speaker, day: ref.slice(0, 10), id: idNum };
      audit.push({ page: page.id, story: index, ref, speaker, sha: createHash('sha256').update(m.content).digest('hex').slice(0, 16) });
      return entry;
    });
  });
  const counts = page.stories.map(s => s.discussion?.length || 0);
  console.log(JSON.stringify({ page: page.id, stories: counts.length, messages: counts.reduce((a, b) => a + b, 0), max: Math.max(...counts), empty: counts.filter(n => !n).length }));
}
await writeFile(readerFile, JSON.stringify(reader, null, 2) + '\n');
await writeFile(auditFile, JSON.stringify(audit, null, 1), { mode: 0o600 });
