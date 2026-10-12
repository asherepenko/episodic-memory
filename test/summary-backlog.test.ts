import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { collectSummaryBacklog } from '../src/sync/sync.js';
import { openConversationSyncStateStore } from '../src/sync/index.js';

// Summaries were only queued for transcripts sync saw in a live source dir
// *and* whose name held a session id. Archive-only projects (live copy
// deleted) and subagent files (agent-*.jsonl) were never summarized: about
// half of the 61% backlog. The backlog now comes from the index itself.
let archiveDir: string;

beforeEach(() => {
  archiveDir = fs.mkdtempSync(path.join(os.tmpdir(), 'em-backlog-'));
});

afterEach(() => {
  fs.rmSync(archiveDir, { recursive: true, force: true });
});

function transcript(rel: string, summary?: string): string {
  const file = path.join(archiveDir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{}\n');
  if (summary !== undefined) fs.writeFileSync(file.replace('.jsonl', '-summary.txt'), summary);
  return file;
}

describe('collectSummaryBacklog', () => {
  it('queues indexed conversations without a summary, including subagent files', () => {
    const store = openConversationSyncStateStore({ archiveDir });
    const plain = transcript('proj/982581eb-41b9-46da-86c1-ac34168117a8.jsonl');
    const subagent = transcript('proj/982581eb-41b9-46da-86c1-ac34168117a8/subagents/agent-a1b2c3.jsonl');

    const backlog = collectSummaryBacklog([plain, subagent], store, new Set(), () => false);
    expect(backlog.map(b => b.path).sort()).toEqual([plain, subagent].sort());
  });

  it('skips conversations that already have a summary', () => {
    const store = openConversationSyncStateStore({ archiveDir });
    const legacy = transcript('proj/a.jsonl', 'An old summary.');
    const done = transcript('proj/b.jsonl');
    store.save(done, { kind: 'complete', lastUpdated: new Date().toISOString() });

    expect(collectSummaryBacklog([legacy, done], store, new Set(), () => false)).toEqual([]);
  });

  it('skips files already queued this run, files that are gone, and marker-excluded files', () => {
    const store = openConversationSyncStateStore({ archiveDir });
    const queued = transcript('proj/queued.jsonl');
    const excluded = transcript('proj/excluded.jsonl');
    const keep = transcript('proj/keep.jsonl');
    const gone = path.join(archiveDir, 'proj/gone.jsonl');

    const backlog = collectSummaryBacklog([queued, excluded, keep, gone], store, new Set([queued]), f => f === excluded);
    expect(backlog.map(b => b.path)).toEqual([keep]);
  });
});
