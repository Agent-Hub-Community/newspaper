import path from 'node:path';

const MEDIA_KINDS = new Set(['image', 'video', 'audio', 'file']);
const EXTENSIONS = new Set(['.avif', '.avi', '.doc', '.docx', '.flac', '.gif', '.html', '.jpeg', '.jpg', '.m4a', '.md', '.mkv', '.mov', '.mp3', '.mp4', '.ogg', '.pdf', '.png', '.ppt', '.pptx', '.txt', '.wav', '.webm', '.webp', '.xlsx', '.zip']);

export function attachmentPath(value) {
  if (typeof value !== 'string' || !value.startsWith('attachments/') || path.isAbsolute(value)) return null;
  const normalized = path.posix.normalize(value);
  if (normalized !== value || normalized.split('/').includes('..')) return null;
  return normalized;
}

export function validateAttachment(value, label = 'attachment') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid ${label}`);
  const allowed = new Set(['kind', 'src', 'href', 'poster', 'name', 'label', 'alt', 'caption', 'mime', 'bytes', 'width', 'height']);
  if (Object.keys(value).some(key => !allowed.has(key))) throw new Error(`Unexpected ${label} field`);
  if (!MEDIA_KINDS.has(value.kind)) throw new Error(`Invalid ${label} kind`);
  const source = value.src ?? value.href;
  if (source !== undefined) {
    const file = attachmentPath(source);
    if (!file || !EXTENSIONS.has(path.posix.extname(file).toLowerCase())) throw new Error(`Invalid ${label} path`);
  }
  if (value.poster !== undefined && !attachmentPath(value.poster)) throw new Error(`Invalid ${label} poster`);
  if (value.kind === 'image' && value.src === undefined && !value.label) throw new Error(`Image ${label} needs src or label`);
  if (value.kind === 'video' && value.src === undefined && !value.label) throw new Error(`Video ${label} needs src or label`);
  if (value.kind === 'file' && !value.name && !value.label) throw new Error(`File ${label} needs name or label`);
  for (const key of ['name', 'label', 'alt', 'caption', 'mime']) {
    if (value[key] !== undefined && (typeof value[key] !== 'string' || value[key].length > 240)) throw new Error(`Invalid ${label} ${key}`);
  }
  for (const key of ['bytes', 'width', 'height']) {
    if (value[key] !== undefined && (!Number.isSafeInteger(value[key]) || value[key] < 0)) throw new Error(`Invalid ${label} ${key}`);
  }
  return value;
}

export function validateAttachments(value, label = 'attachments') {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length > 12) throw new Error(`Invalid ${label}`);
  value.forEach((attachment, index) => validateAttachment(attachment, `${label}[${index}]`));
}

export function attachmentFiles(attachments) {
  return (attachments || []).flatMap(attachment => [attachment.src, attachment.href, attachment.poster]
    .filter(value => attachmentPath(value)));
}
