import { readFile, writeFile } from 'node:fs/promises';
import { validateExternalReview } from '../lib/external-workflow.mjs';

const [draftFile, selectionFile, output, reviewer, flag] = process.argv.slice(2);
if (!draftFile || !selectionFile || !output || !reviewer || flag !== '--approve') {
  throw new Error('After manual review: node scripts/review-external.mjs DRAFT SELECTION RECEIPT REVIEWER --approve');
}
const draft = JSON.parse(await readFile(draftFile, 'utf8'));
const selection = JSON.parse(await readFile(selectionFile, 'utf8'));
const review = {
  status: 'approved', reviewer, reviewedAt: new Date().toISOString(), draft, selection,
};
validateExternalReview(draft, selection, review);
await writeFile(output, JSON.stringify(review, null, 2) + '\n', { mode: 0o600 });
console.log('Recorded editorial approval for this exact draft and evidence. No site files changed.');
