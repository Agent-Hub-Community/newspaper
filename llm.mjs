import http from 'node:http';
import https from 'node:https';

// Shared chat-completions settings for every generator (daily, external, weekly). Any OpenAI-compatible endpoint
// works: set DAILY_LLM_BASE_URL, DAILY_LLM_API_KEY when it needs one, and DAILY_LLM_MODEL when the endpoint names
// the model differently. Generators check that each response reports this model, so issues stay comparable.
export const llmModel = process.env.DAILY_LLM_MODEL || 'gemini-4-argon';

// Without DAILY_LLM_BASE_URL every request fails on this reserved .invalid host instead of reaching a default service.
export const llmUrl = `${(process.env.DAILY_LLM_BASE_URL || 'https://set-DAILY_LLM_BASE_URL.invalid/v1').replace(/\/$/, '')}/chat/completions`;

// The gateway caps argon at 32,768 output tokens, reasoning included. A larger max_tokens is accepted,
// but an answer cut at the cap then comes back with finish_reason "stop", so requests stay at this limit.
export const llmMaxOutputTokens = 32768;

export function llmHeaders() {
  const key = process.env.DAILY_LLM_API_KEY;
  return { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) };
}

// Node's fetch gives up after 300 s without response headers, and the gateway sends none until a
// reasoning answer is complete; the largest group already takes 270–290 s alone. Requests that
// reason go through node:http instead, bounded only by the caller's signal.
export function llmFetch({ body, signal }) {
  const url = new URL(llmUrl);
  return new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? https : http).request(url,
      { method: 'POST', headers: llmHeaders(), signal }, response => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('error', reject);
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve({ ok: response.statusCode >= 200 && response.statusCode < 300, status: response.statusCode,
            json: async () => JSON.parse(text) });
        });
      });
    request.on('error', reject);
    request.end(body);
  });
}
