// BM25 ranking shared by the site search and the library page. Chinese has no spaces, so CJK runs are split
// into overlapping character pairs; Latin words and numbers stay whole. Documents and queries are tokenized
// the same way, so a query need not appear verbatim to match.
(() => {
  'use strict';
  const K1 = 1.2, B = 0.75;
  // A document must cover at least this share of the query's weight (IDF). Rare words therefore have to match;
  // a common word alone does not qualify. Pairs that straddle two words (“型自” in “模型自己”) still count
  // toward the weight, so the share is kept low enough for a natural-language query to find its topic.
  // Chinese pairs the collection lacks are left out of the weight, as many are just two words meeting; an
  // English word or number it lacks counts as the rarest possible term, so “dpsk4.1” does not match every
  // document that contains “1”.
  const COVERAGE = 0.25, RELATIVE = 0.3;
  // Question words and particles in a typed query carry no topic. Single characters such as 是、在、对
  // are kept because they are often part of a real word (对齐, 在线). Readers also ask whether the group
  // discussed something (群里有没有人聊过); those words describe the question, not the topic. 有人 counts only
  // at the start, since inside a sentence it is often part of 有人类 or 所有人.
  const FILLER = /怎么样|怎么|怎样|如何|为什么|为啥|什么|哪些|哪个|哪里|是否|有没有人|有没有|^有人|有哪些|能不能|可不可以|能否|一下|请问|群里|群友|大家|讨论过|聊过|咋整|咋办|咋|啥|的|吗|呢|吧|啊|呀/g;
  // The same for English questions (“What does the group think about reward hacking?”). Most of these words
  // never occur on the site, so leaving them in would reject the whole query as an unknown name. A word that
  // belongs to a spelling in the vocabulary (Mixture of Experts, Know Your Customer) is kept.
  const ENGLISH_FILLER = new Set(('what which who whom whose when where why how whether does did do doing done is are was were be ' +
    'been being am a an the of to in on at by for with from about into onto over than then there here this that these those it its ' +
    'they them their we our you your i me my he she his her any anyone anybody anything someone somebody something some has ' +
    'have had having can could would should will shall may might must please tell know think thinks thought say says said talk ' +
    'talks talked talking discuss discusses discussed discussing mention mentions mentioned share shared sharing or and but if so ' +
    'also just really actually currently').split(' '));
  const RUN = /[a-z0-9]+|[㐀-鿿豈-﫿]+/g;
  const isCjk = run => /[㐀-鿿豈-﫿]/.test(run[0]);
  const normalize = text => String(text ?? '').normalize('NFKC').toLowerCase();

  function tokens(text) {
    const out = [];
    for (const [run] of normalize(text).matchAll(RUN)) {
      if (!isCjk(run) || run.length === 1) out.push(run);
      else for (let i = 0; i < run.length - 1; i++) out.push(run.slice(i, i + 2));
    }
    return out;
  }

  // fields: { name: weight }. Each document is { name: text }.
  function createIndex(docs, fields) {
    const names = Object.keys(fields);
    const df = new Map(), lengths = names.map(() => 0);
    const prepared = docs.map(doc => names.map((name, f) => {
      const tf = new Map();
      const list = tokens(doc[name]);
      for (const token of list) tf.set(token, (tf.get(token) || 0) + 1);
      lengths[f] += list.length;
      return { tf, length: list.length };
    }));
    for (const doc of prepared) {
      const seen = new Set(doc.flatMap(field => [...field.tf.keys()]));
      for (const token of seen) df.set(token, (df.get(token) || 0) + 1);
    }
    const n = docs.length, average = lengths.map(total => total / Math.max(1, n) || 1);
    const idf = token => { const d = df.get(token) || 0; return d ? Math.log(1 + (n - d + 0.5) / (d + 0.5)) : 0; };
    // The weight a set of distinct terms carries toward coverage (see COVERAGE).
    const unseen = Math.log(1 + (n + 0.5) / 0.5);
    const weightOf = terms => terms.reduce((sum, token) => sum + (df.has(token) ? idf(token) : isCjk(token) ? 0 : unseen), 0);
    const contains = (i, token) => prepared[i].some(field => field.tf.has(token));

    // Scores one tokenized query; returns per-document { score, coverage } for documents with any match.
    function score(terms, keep) {
      const all = [...new Set(terms)], unique = all.filter(token => df.has(token));
      const mass = weightOf(all);
      const out = new Map();
      if (!mass) return out;
      prepared.forEach((doc, i) => {
        if (keep && !keep(i)) return;
        let total = 0, covered = 0;
        for (const token of unique) {
          let weighted = 0;
          doc.forEach((field, f) => {
            const count = field.tf.get(token);
            if (count) weighted += fields[names[f]] * count / (1 - B + B * field.length / average[f]);
          });
          if (!weighted) continue;
          total += idf(token) * weighted * (K1 + 1) / (K1 + weighted);
          covered += idf(token);
        }
        if (total) out.set(i, { score: total, coverage: covered / mass });
      });
      return out;
    }

    // variants: the query as typed plus versions with aliases or synonyms replaced, each { text, weight, names }
    // (a plain string weighs 1). A document's score is its best weighted variant; it qualifies when that
    // variant covers enough of the query. In a replaced variant, two more conditions hold:
    // - A name put in must show its rarest English word, so “Google Gemini” needs Gemini rather than any Google
    //   item. Chinese names rely on coverage alone: the rarer pair of 知识蒸馏 is 知识, not the part that carries
    //   the meaning.
    // - The words left as typed must be covered on their own. Otherwise swapping a common word for a rare one
    //   (Agent for 智能体) lets the rare word carry “Agent 记忆” and brings in every item about 智能体.
    // keep(i), when given, limits the documents before the relative cut, so a filtered search compares an item
    // with the best match among the items it is filtered to, not with a stronger item the filter excludes.
    function search(variants, keep) {
      const best = new Map();
      for (const item of variants) {
        const { text, weight = 1, names = [], required = [] } = typeof item === 'string' ? { text: item } : item;
        const terms = [...new Set(tokens(text))];
        // Unknown Latin names and identifiers must not disappear behind matches to common words.
        // Chinese pairs remain tolerant because many merely cross two words in a natural sentence.
        if (terms.some(token => !isCjk(token) && !df.has(token))) continue;
        const anchors = names.map(name => tokens(name).filter(token => !isCjk(token))
          .sort((a, c) => (df.get(a) || 0) - (df.get(c) || 0))[0]).filter(Boolean);
        const named = new Set(names.flatMap(name => tokens(name)));
        const rest = [...new Set(tokens(text))].filter(token => !named.has(token));
        const restMass = names.length ? weightOf(rest) : 0;
        for (const [i, result] of score(terms, keep)) {
          if (result.coverage < COVERAGE || !anchors.every(token => contains(i, token))) continue;
          if (!required.every(group => group.some(name => {
            if (/[a-z0-9]/i.test(name) && /[㐀-鿿豈-﫿]/.test(name)) {
              return Object.keys(fields).some(field => normalize(docs[i][field]).includes(normalize(name)));
            }
            const list = tokens(name);
            const latin = list.filter(token => !isCjk(token)).sort((a, c) => (df.get(a) || 0) - (df.get(c) || 0));
            return latin.length ? contains(i, latin[0]) : list.every(token => contains(i, token));
          }))) continue;
          if (restMass && weightOf(rest.filter(token => contains(i, token))) < COVERAGE * restMass) continue;
          const weighted = { ...result, score: result.score * weight, variant: text };
          if (!best.has(i) || best.get(i).score < weighted.score) best.set(i, weighted);
        }
      }
      // A long query also matches many items through one common word; those trail far behind the best
      // match and are dropped.
      const top = Math.max(0, ...[...best.values()].map(result => result.score));
      for (const [i, result] of best) if (result.score < RELATIVE * top) best.delete(i);
      return best;
    }
    return { search, idf, size: n, known: token => df.has(token), weightOf };
  }

  // expand: { alias (lower case): [target, ...] }, one way from a spelling to what it stands for; synonyms: groups
  // of interchangeable spellings ([[画图, 绘图, …], …]), searched both ways at a lower weight so the spelling typed
  // ranks first. synonyms.mjs builds both from the keyword aliases, the glossary and search-synonyms.json.
  // Spellings written in Chinese are found anywhere in the query; Latin ones only as whole words, so “cc” does
  // not fire inside “accuracy”. At most eight variants.
  const SYNONYM_WEIGHT = 0.85;
  function variants(query, expand, synonyms = []) {
    const text = normalize(query).trim();
    if (!text) return { variants: [], found: [] };
    // A spelling that is both an alias and in a synonym group gets the targets of both, each at its higher weight.
    const found = new Map();
    const look = (alias, targets, weight) => {
      const key = normalize(alias);
      if (key.length < 2 || !targets?.length) return;
      const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = isCjk(key) ? new RegExp(escaped, 'g') : new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, 'g');
      if (text.search(pattern) < 0) return;
      if (!found.has(key)) found.set(key, { alias: key, pattern, targets: new Map() });
      const item = found.get(key);
      for (const target of targets) {
        const name = normalize(target);
        if (name !== key && !(item.targets.get(name)?.weight >= weight)) item.targets.set(name, { target, weight });
      }
    };
    for (const [alias, targets] of Object.entries(expand || {})) look(alias, targets, 1);
    // Keep named aliases as requirements in every variant, including the typed variant. Otherwise a
    // mixed alias such as A社 becomes the unrelated English token “a” and can match other entities.
    const aliasesFound = new Set(found.keys());
    for (const group of synonyms) for (const term of group) look(term, group, SYNONYM_WEIGHT);
    // Longer aliases first, and an alias inside a longer found alias is dropped (“cc” inside “claude code”).
    const sorted = [...found.values()].sort((a, c) => c.alias.length - a.alias.length);
    const kept = sorted.filter((item, index) => !sorted.slice(0, index).some(other => other.alias.includes(item.alias))).filter(item => item.targets.size);
    const spelled = new Set(kept.flatMap(item => item.alias.match(/[a-z0-9]+/g) || []));
    const typed = text.replace(FILLER, ' ').replace(/[a-z0-9]+/g, word => ENGLISH_FILLER.has(word) && !spelled.has(word) ? ' ' : word);
    let list = [{ text: typed, weight: 1, names: [] }];
    for (const { pattern, targets } of kept) {
      list = list.flatMap(variant => [variant, ...[...targets.values()].map(({ target, weight }) =>
        ({ text: variant.text.replace(pattern, ` ${normalize(target)} `), weight: variant.weight * weight, names: [...variant.names, target] }))]);
      if (list.length >= 8) { list = list.slice(0, 8); break; }
    }
    const unique = new Map();
    for (const variant of list) if (!unique.has(variant.text) || unique.get(variant.text).weight < variant.weight) unique.set(variant.text, variant);
    // A canonical name may itself belong to an interchangeable-spelling group. Its entity requirement
    // must accept those spellings too, or a valid synonym variant would be rejected after scoring.
    const required = kept.filter(item => aliasesFound.has(item.alias))
      .map(item => [item.alias, ...[...item.targets.values()].map(({ target }) => target)]);
    return { variants: [...unique.values()].map(variant => ({ ...variant, ...(required.length ? { required } : {}) })),
      found: kept.map(({ alias, targets }) => ({ alias, targets: [...targets.values()].map(({ target }) => target) })) };
  }

  // Character ranges in text matched by the tokens of a variant; overlapping or touching ranges merge,
  // so consecutive Chinese pairs highlight as one phrase.
  function ranges(text, variant) {
    const low = normalize(text);
    const found = [];
    for (const token of new Set(tokens(variant))) {
      let at = low.indexOf(token);
      while (at >= 0) { found.push([at, at + token.length]); at = low.indexOf(token, at + token.length); }
    }
    found.sort((a, c) => a[0] - c[0] || c[1] - a[1]);
    const merged = [];
    for (const range of found) {
      const last = merged.at(-1);
      if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
      else merged.push([...range]);
    }
    // NFKC can change length for a few characters; ranges are only used when lengths agree.
    return low.length === text.length ? merged : [];
  }

  globalThis.AgentHubBM25 = { tokens, createIndex, variants, ranges, normalize, isCjk };
})();
