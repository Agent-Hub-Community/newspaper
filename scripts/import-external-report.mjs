import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { validateExternalReview } from '../lib/external-workflow.mjs';

const [input, selectionFile, reviewFile] = process.argv.slice(2);
if (!input || !selectionFile || !reviewFile) {
  throw new Error('Usage: node scripts/import-external-report.mjs DRAFT_JSON SELECTION_JSON REVIEW_JSON');
}
const draft = JSON.parse(await readFile(input, 'utf8'));
const selection = JSON.parse(await readFile(selectionFile, 'utf8'));
const review = JSON.parse(await readFile(reviewFile, 'utf8'));
const report = validateExternalReview(draft, selection, review);
const directory = new URL('../data/external-editions/', import.meta.url);
await mkdir(directory, { recursive: true });
const output = new URL(`${report.date}.json`, directory);
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(output.pathname);
