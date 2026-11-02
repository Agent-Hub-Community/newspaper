import { createHash } from 'node:crypto';

// WeChat serves the same "暂时无法查看" image when a member's avatar cannot be shown. Such files are rejected
// automatically so they never reach a ranking or the library; the rank or share itself is kept without an avatar.
// Add a new MD5 here when another identical placeholder turns up.
export const PLACEHOLDER_AVATAR_MD5 = new Set([
  'fee9458c29cdccf10af7ec01155dc7f0', // 暂时无法查看 (seen 2026-10-21 and 2026-11-01)
]);

export function isPlaceholderAvatar(bytes) {
  return PLACEHOLDER_AVATAR_MD5.has(createHash('md5').update(bytes).digest('hex'));
}
