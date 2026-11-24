// Server-only: admin import workflow for curated official notices.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NoticeFileSchema, setNoticeOverride, type NoticeFile } from './adapters/officialNotices';

const here = path.dirname(fileURLToPath(import.meta.url));
export const NOTICES_PATH = path.resolve(here, 'data/official-notices.json');

/** Validate, persist to the JSON seed, and activate immediately. Throws ZodError on bad input. */
export function importNoticeFile(raw: unknown, p = NOTICES_PATH): NoticeFile {
  const parsed = NoticeFileSchema.parse(raw);
  fs.writeFileSync(p, JSON.stringify(parsed, null, 2));
  setNoticeOverride(parsed);
  return parsed;
}
