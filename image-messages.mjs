// The private pipeline's collect-images.mjs stores what the image model saw in message.image while message.content keeps the
// speaker's own "[图片]". Discussion excerpts read content, so generated descriptions reach only the
// daily and weekly draft models, through modelInput().
const qualityLabels = { original: '原图', thumbnail: '缩略图' };

export function imageMessageText(image) {
  if (image.quality === 'missing') return '[图片（未取到）]';
  const label = qualityLabels[image.quality];
  if (!label) throw new Error(`Unknown image quality: ${image.quality}`);
  return image.description ? `[图片（${label}）：${image.description}]` : `[图片（${label}，未能识别）]`;
}

export function modelInput(input) {
  return {
    ...input,
    messages: input.messages.map(({ image, ...message }) =>
      image ? { ...message, content: imageMessageText(image) } : message),
  };
}

export function imageCoverage(records) {
  const count = quality => records.filter(record => record.quality === quality).length;
  return {
    total: records.length, original: count('original'), thumbnail: count('thumbnail'), missing: count('missing'),
    described: records.filter(record => record.description).length,
  };
}

// Text that only modelInput() produces; it must never be shown as something a member said.
export const generatedImageText = /\[图片（/;
