import fs from 'fs';
import path from 'path';
import { parseConversation } from './parser.js';
import { initDatabase, getAllExchanges, getFileLastIndexed } from './db.js';
import { getArchiveDir, getExcludedProjects, findJsonlFiles, entryIsDirectory } from './paths.js';

export interface VerificationResult {
  missing: Array<{ path: string; reason: string }>;
  orphaned: Array<{ uuid: string; path: string }>;
  outdated: Array<{ path: string; fileTime: number; dbTime: number }>;
  corrupted: Array<{ path: string; error: string }>;
}

export interface VerifyOptions {
  /** Called after each conversation is checked. */
  onProgress?: (done: number, total: number) => void;
}

export async function verifyIndex(options: VerifyOptions = {}): Promise<VerificationResult> {
  const result: VerificationResult = {
    missing: [],
    orphaned: [],
    outdated: [],
    corrupted: []
  };

  const archiveDir = getArchiveDir();

  // Track all files we find
  const foundFiles = new Set<string>();

  // Find all conversation files
  if (!fs.existsSync(archiveDir)) {
    return result;
  }

  // Initialize database once for all checks
  const db = initDatabase();

  const excludedProjects = getExcludedProjects();
  const excludedDirSet = new Set(excludedProjects);
  let totalChecked = 0;

  // List everything first so progress has a total.
  const work: Array<{ project: string; conversationPath: string }> = [];
  for (const projectEntry of fs.readdirSync(archiveDir, { withFileTypes: true })) {
    if (!entryIsDirectory(archiveDir, projectEntry)) continue;
    const project = projectEntry.name;
    if (excludedProjects.includes(project)) continue;
    const projectPath = path.join(archiveDir, project);
    for (const file of findJsonlFiles(projectPath, excludedDirSet)) {
      work.push({ project, conversationPath: path.join(projectPath, file) });
    }
  }

  for (const { project, conversationPath } of work) {
    totalChecked++;
    options.onProgress?.(totalChecked, work.length);

    foundFiles.add(conversationPath);

    const summaryPath = conversationPath.replace('.jsonl', '-summary.txt');

    // Parse first: this both detects corruption and lets us count exchanges
    // before deciding the conversation is "missing" a summary.
    let exchanges;
    try {
      exchanges = await parseConversation(conversationPath, project, conversationPath);
    } catch (error) {
      result.corrupted.push({
        path: conversationPath,
        error: error instanceof Error ? error.message : String(error)
      });
      continue;
    }

    // Conversations with no exchanges (empty/aborted sessions) have nothing
    // to summarize or index. They never get a summary file, so flagging them
    // as "missing" loops forever — repair re-parses, finds 0 exchanges, skips,
    // and the next verify flags them again. Treat them as nothing to do.
    if (exchanges.length === 0) {
      continue;
    }

    // A missing summary file means the conversation hasn't been summarized
    // yet. Error/retry state lives in ConversationSyncState (Poison), not in
    // the file; here we only care whether the derived summary exists.
    if (!fs.existsSync(summaryPath)) {
      result.missing.push({ path: conversationPath, reason: 'No summary file' });
      continue;
    }

    // Check if file is outdated (modified after last_indexed)
    const lastIndexed = getFileLastIndexed(db, conversationPath);
    if (lastIndexed !== null) {
      const fileStat = fs.lstatSync(conversationPath);
      if (fileStat.mtimeMs > lastIndexed) {
        result.outdated.push({
          path: conversationPath,
          fileTime: fileStat.mtimeMs,
          dbTime: lastIndexed
        });
      }
    }
  }

  // Check for orphaned database entries
  const dbExchanges = getAllExchanges(db);
  db.close();

  for (const exchange of dbExchanges) {
    if (!foundFiles.has(exchange.archivePath)) {
      result.orphaned.push({
        uuid: exchange.id,
        path: exchange.archivePath
      });
    }
  }

  return result;
}

export interface RepairResult {
  removed: number;
  reindexed: number;
  exchanges: number;
  skipped: number;
  summaryFailures: number;
  failed: Array<{ path: string; error: string }>;
}

export interface RepairOptions {
  /** Called before each conversation is re-indexed. */
  onProgress?: (done: number, total: number, file: string) => void;
}

export async function repairIndex(issues: VerificationResult, options: RepairOptions = {}): Promise<RepairResult> {
  const result: RepairResult = { removed: 0, reindexed: 0, exchanges: 0, skipped: 0, summaryFailures: 0, failed: [] };

  // To avoid circular dependencies, we import the indexer functions dynamically
  const { initDatabase, insertExchange, deleteExchange } = await import('./db.js');
  const { parseConversation } = await import('./parser.js');
  const { initEmbeddings, generateExchangeEmbedding } = await import('./embeddings.js');
  const { summarizeConversation } = await import('./summarizer.js');

  const db = initDatabase();
  await initEmbeddings();

  // Remove orphaned entries first
  for (const orphan of issues.orphaned) {
    deleteExchange(db, orphan.uuid);
    result.removed++;
  }

  // Re-index missing and outdated conversations
  const toReindex = [
    ...issues.missing.map(m => m.path),
    ...issues.outdated.map(o => o.path)
  ];

  for (const [i, conversationPath] of toReindex.entries()) {
    options.onProgress?.(i, toReindex.length, conversationPath);
    try {
      // Extract project name from path
      const archiveDir = getArchiveDir();
      const relativePath = conversationPath.replace(archiveDir + path.sep, '');
      const project = relativePath.split(path.sep)[0];

      // Parse conversation
      const exchanges = await parseConversation(conversationPath, project, conversationPath);

      if (exchanges.length === 0) {
        result.skipped++;
        continue;
      }

      // Generate/update summary. This is best-effort: it calls the Claude
      // Agent SDK, which can fail independently of indexing (missing API key,
      // or a missing native CLI binary under `/plugin install --omit=optional`).
      // Embeddings are local and need no SDK, so a summary failure must not
      // block indexing — mirror the indexer, which records the failure and
      // moves on. Otherwise verify --repair re-indexes nothing on every run.
      const summaryPath = conversationPath.replace('.jsonl', '-summary.txt');
      try {
        const summary = await summarizeConversation(exchanges);
        fs.writeFileSync(summaryPath, summary, 'utf-8');
      } catch {
        result.summaryFailures++;
      }

      // Index exchanges
      for (const exchange of exchanges) {
        const toolNames = exchange.toolCalls?.map(tc => tc.toolName);
        const embedding = await generateExchangeEmbedding(
          exchange.userMessage,
          exchange.assistantMessage,
          toolNames
        );
        insertExchange(db, exchange, embedding, toolNames);
      }

      result.reindexed++;
      result.exchanges += exchanges.length;
    } catch (error) {
      result.failed.push({ path: conversationPath, error: error instanceof Error ? error.message : String(error) });
    }
  }
  options.onProgress?.(toReindex.length, toReindex.length, '');

  db.close();
  // Corrupted files need manual review; the CLI lists them.
  return result;
}
