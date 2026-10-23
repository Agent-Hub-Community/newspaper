import { generatedImageText } from './image-messages.mjs';

// Only anonymous display fields may travel from the private source to the reader.
export function validateStoryDiscussion(messages) {
  if (messages === undefined) return;
  if (!Array.isArray(messages) || !messages.length) throw new Error('Invalid discussion messages');
  const fields = (value, allowed) => {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        Object.keys(value).some(key => !allowed.includes(key))) throw new Error('Unexpected discussion field');
  };
  const speaker = value => Number.isSafeInteger(value) && value > 0;
  const text = value => typeof value === 'string' && value.trim().length > 0;
  for (const message of messages) {
    fields(message, ['speaker', 'time', 'text', 'quote']);
    if (!speaker(message.speaker) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(message.time) ||
        !text(message.text)) throw new Error('Invalid discussion message');
    // Excerpts quote members verbatim; an image is shown as its "[图片]" tag, never as a model's description.
    if (generatedImageText.test(message.text) || generatedImageText.test(message.quote?.text ?? '')) {
      throw new Error('Generated image description in discussion');
    }
    if (message.quote !== undefined) {
      fields(message.quote, ['speaker', 'text']);
      if (!(message.quote.speaker === null || speaker(message.quote.speaker)) || !text(message.quote.text)) {
        throw new Error('Invalid discussion quote');
      }
    }
  }
}
