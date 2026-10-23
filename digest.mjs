import { readdir, readFile } from 'node:fs/promises';

const directory = new URL('./editions/', import.meta.url);
const files = (await readdir(directory)).filter(name => /^\d{4}-\d{2}-\d{2}\.json$/.test(name)).sort();
export const digests = await Promise.all(files.map(async name =>
  JSON.parse(await readFile(new URL(name, directory), 'utf8'))));
