import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// The daily renderer depends on the shared discussion module, as in index.html.
const sources = ['../discussion-panel.js', '../digest.js'].map(file => readFileSync(new URL(file, import.meta.url), 'utf8'));
export function runDigest(context) {
  for (const source of sources) runInNewContext(source, context);
  return context;
}

// Messages render share cards, file chips, link cards and shortened link labels; compare the words
// verbatim. Punctuation is left out because a link-only message drops what follows its address.
const strip = text => text.replace(/https?:\/\/[^\s<>"'，。；！？、]+/g, '').replace(/[\s.,;!?()[\]（）。，；！？、]/g, '');
export function visibleMessageText(element) {
  const copy = element.cloneNode(true);
  for (const link of copy.querySelectorAll('a')) link.remove();
  // Emoji stand in for WeChat codes; their tooltip keeps the original code.
  for (const face of copy.querySelectorAll('.discussion-emoji')) face.replaceWith(face.getAttribute('title'));
  return strip(copy.textContent);
}
export function expectedMessageText(text) {
  if (/^\[链接\]/.test(text) && /\n\s+URL[:：]/.test(text)) return null;
  if (/^\[(?:文件|表情|图片|视频|语音|动画表情|媒体引用未解析)\]/.test(text)) return null;
  return strip(text);
}
