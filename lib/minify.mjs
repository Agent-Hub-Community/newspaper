// Zero-dependency CSS and JS minifiers for the static build.
// CSS minifier preserves strings, url(), calc()/color-mix() spacing, media queries, and descendant combinators.
// JS minifier strips comments and redundant indentation/blank lines while preserving newlines (100% ASI-safe).

export function minifyCss(source) {
  let out = '';
  let i = 0;
  const len = source.length;
  let inString = '';
  let inUrl = false;
  let pendingSpace = false;

  const flushSpace = nextChar => {
    if (!pendingSpace) return;
    pendingSpace = false;
    if (!out) return;
    const prev = out[out.length - 1];
    // Never drop space before ':' (descendant combinator like `body :is(...)`) or around '+'/'-' inside calc().
    if (prev === '{' || prev === '}' || prev === ';' || prev === ',' || prev === '(' || prev === ':') return;
    if (nextChar === '{' || nextChar === '}' || nextChar === ';' || nextChar === ',' || nextChar === ')') return;
    out += ' ';
  };

  while (i < len) {
    const ch = source[i];
    if (inString) {
      out += ch;
      if (ch === '\\' && i + 1 < len) { out += source[++i]; }
      else if (ch === inString) inString = '';
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      flushSpace(ch);
      inString = ch;
      out += ch;
      i++;
      continue;
    }
    if (ch === '/' && source[i + 1] === '*') {
      i += 2;
      while (i < len && !(source[i] === '*' && source[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (inUrl) {
      if (ch === ')') inUrl = false;
      if (!/\s/.test(ch)) out += ch;
      i++;
      continue;
    }
    if ((ch === 'u' || ch === 'U') && /^url\(\s*(?!['"])/i.test(source.slice(i, i + 8))) {
      flushSpace(ch);
      out += 'url(';
      i += 4;
      while (i < len && /\s/.test(source[i])) i++;
      inUrl = true;
      continue;
    }
    if (/\s/.test(ch)) {
      pendingSpace = true;
      i++;
      continue;
    }
    if (ch === '}' && out.endsWith(';')) out = out.slice(0, -1);
    flushSpace(ch);
    out += ch;
    i++;
  }
  return out.trim();
}

// Punctuation/keywords after which `/` starts a regex literal rather than division.
const REGEX_PREV_KEYWORDS = new Set([
  'return', 'case', 'throw', 'in', 'of', 'typeof', 'void', 'delete', 'new', 'yield', 'await', 'else', 'do',
]);
const REGEX_PREV_CHARS = new Set([
  '(', '[', '{', ',', ';', ':', '=', '!', '?', '&', '|', '^', '~', '+', '-', '*', '%', '<', '>',
]);

// Strips JS comments (// and /* */) and trims indentation/blank lines while preserving newlines for ASI safety.
export function minifyJs(source) {
  const len = source.length;
  let i = 0;
  let out = '';
  let lastSigChar = '';
  let lastWord = '';
  let wordBuf = '';
  const templateBraceDepths = [];

  const flushWord = () => {
    if (wordBuf) { lastWord = wordBuf; wordBuf = ''; }
  };

  const canStartRegex = () => {
    if (!lastSigChar) return true;
    if (REGEX_PREV_CHARS.has(lastSigChar)) return true;
    if (lastSigChar === '}' && !lastWord) return true;
    if (/[A-Za-z0-9_$]/.test(lastSigChar) && REGEX_PREV_KEYWORDS.has(lastWord)) return true;
    return false;
  };

  while (i < len) {
    const ch = source[i];
    const next = source[i + 1];

    // Single or double quoted string
    if (ch === "'" || ch === '"') {
      flushWord();
      const quote = ch;
      out += ch;
      i++;
      while (i < len) {
        const c = source[i++];
        out += c;
        if (c === '\\' && i < len) out += source[i++];
        else if (c === quote) break;
      }
      lastSigChar = quote;
      lastWord = '';
      continue;
    }

    // Template literal
    if (ch === '`') {
      flushWord();
      out += ch;
      i++;
      while (i < len) {
        const c = source[i++];
        out += c;
        if (c === '\\' && i < len) { out += source[i++]; continue; }
        if (c === '$' && source[i] === '{') {
          out += source[i++];
          templateBraceDepths.push(0);
          lastSigChar = '{';
          lastWord = '';
          break;
        }
        if (c === '`') {
          lastSigChar = '`';
          lastWord = '';
          break;
        }
      }
      continue;
    }

    // Resume template literal after matching `}` inside `${ ... }`
    if (ch === '}' && templateBraceDepths.length) {
      const top = templateBraceDepths[templateBraceDepths.length - 1];
      if (top === 0) {
        flushWord();
        templateBraceDepths.pop();
        out += '}';
        i++;
        while (i < len) {
          const c = source[i++];
          out += c;
          if (c === '\\' && i < len) { out += source[i++]; continue; }
          if (c === '$' && source[i] === '{') {
            out += source[i++];
            templateBraceDepths.push(0);
            lastSigChar = '{';
            lastWord = '';
            break;
          }
          if (c === '`') {
            lastSigChar = '`';
            lastWord = '';
            break;
          }
        }
        continue;
      }
      templateBraceDepths[templateBraceDepths.length - 1] = top - 1;
    } else if (ch === '{' && templateBraceDepths.length) {
      templateBraceDepths[templateBraceDepths.length - 1]++;
    }

    // Line comment
    if (ch === '/' && next === '/') {
      flushWord();
      i += 2;
      while (i < len && source[i] !== '\n') i++;
      continue;
    }

    // Block comment
    if (ch === '/' && next === '*') {
      flushWord();
      let hasNewline = false;
      i += 2;
      while (i < len && !(source[i] === '*' && source[i + 1] === '/')) {
        if (source[i] === '\n') hasNewline = true;
        i++;
      }
      i += 2;
      out += hasNewline ? '\n' : ' ';
      continue;
    }

    // Regex literal
    if (ch === '/' && canStartRegex()) {
      flushWord();
      out += ch;
      i++;
      let inClass = false;
      while (i < len) {
        const c = source[i++];
        out += c;
        if (c === '\\' && i < len) { out += source[i++]; continue; }
        if (c === '[') inClass = true;
        else if (c === ']') inClass = false;
        else if (c === '/' && !inClass) break;
      }
      while (i < len && /[a-z]/i.test(source[i])) out += source[i++];
      lastSigChar = '/';
      lastWord = '';
      continue;
    }

    if (/[A-Za-z0-9_$]/.test(ch)) {
      wordBuf += ch;
      lastSigChar = ch;
    } else {
      flushWord();
      if (!/\s/.test(ch)) {
        lastSigChar = ch;
        lastWord = '';
      }
    }
    out += ch;
    i++;
  }

  // Trim per-line leading/trailing whitespace and drop empty lines, preserving newlines inside template strings.
  const lines = [];
  let inTpl = false;
  let tplDepth = 0;
  for (const rawLine of out.split('\n')) {
    const line = inTpl ? rawLine : rawLine.trim();
    if (!inTpl && !line) continue;
    lines.push(line);
    // Track whether the next line is inside a multiline template literal.
    for (let k = 0; k < rawLine.length; k++) {
      const c = rawLine[k];
      if (c === '\\') { k++; continue; }
      if (!inTpl) {
        if (c === "'" || c === '"') {
          const q = c; k++;
          while (k < rawLine.length && rawLine[k] !== q) { if (rawLine[k] === '\\') k++; k++; }
        } else if (c === '`') {
          inTpl = true;
        }
      } else {
        if (c === '$' && rawLine[k + 1] === '{') { tplDepth++; k++; }
        else if (c === '}' && tplDepth > 0) { tplDepth--; }
        else if (c === '`' && tplDepth === 0) { inTpl = false; }
      }
    }
  }
  return `${lines.join('\n')}\n`;
}
