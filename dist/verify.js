import fs from 'fs';
import path from 'path';
import { parseConversation } from './parser.js';
import { initDatabase, getAllExchanges, getFileLastIndexed } from './db.js';
import { getArchiveDir, getExcludedProjects, findJsonlFiles } from './paths.js';
export async function verifyIndex() {
    const result = {
        missing: [],
        orphaned: [],
        outdated: [],
        corrupted: []
    };
    const archiveDir = getArchiveDir();
    // Track all files we find
    const foundFiles = new Set();
    // Find all conversation files
    if (!fs.existsSync(archiveDir)) {
        return result;
    }
    // Initialize database once for all checks
    const db = initDatabase();
    const excludedProjects = getExcludedProjects();
    const excludedDirSet = new Set(excludedProjects);
    let totalChecked = 0;
    for (const projectEntry of fs.readdirSync(archiveDir, { withFileTypes: true })) {
        if (!projectEntry.isDirectory())
            continue;
        const project = projectEntry.name;
        if (excludedProjects.includes(project)) {
            console.log("\nSkipping excluded project: " + project);
            continue;
        }
        const projectPath = path.join(archiveDir, project);
        const files = findJsonlFiles(projectPath, excludedDirSet);
        for (const file of files) {
            totalChecked++;
            if (totalChecked % 100 === 0) {
                console.log(`  Checked ${totalChecked} conversations...`);
            }
            const conversationPath = path.join(projectPath, file);
            foundFiles.add(conversationPath);
            const summaryPath = conversationPath.replace('.jsonl', '-summary.txt');
            // Parse first: this both detects corruption and lets us count exchanges
            // before deciding the conversation is "missing" a summary.
            let exchanges;
            try {
                exchanges = await parseConversation(conversationPath, project, conversationPath);
            }
            catch (error) {
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
    }
    console.log(`Verified ${totalChecked} conversations.`);
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
export async function repairIndex(issues) {
    console.log('Repairing index...');
    // To avoid circular dependencies, we import the indexer functions dynamically
    const { initDatabase, insertExchange, deleteExchange } = await import('./db.js');
    const { parseConversation } = await import('./parser.js');
    const { initEmbeddings, generateExchangeEmbedding } = await import('./embeddings.js');
    const { summarizeConversation } = await import('./summarizer.js');
    const db = initDatabase();
    await initEmbeddings();
    // Remove orphaned entries first
    for (const orphan of issues.orphaned) {
        console.log(`Removing orphaned entry: ${orphan.uuid}`);
        deleteExchange(db, orphan.uuid);
    }
    // Re-index missing and outdated conversations
    const toReindex = [
        ...issues.missing.map(m => m.path),
        ...issues.outdated.map(o => o.path)
    ];
    for (const conversationPath of toReindex) {
        console.log(`Re-indexing: ${conversationPath}`);
        try {
            // Extract project name from path
            const archiveDir = getArchiveDir();
            const relativePath = conversationPath.replace(archiveDir + path.sep, '');
            const project = relativePath.split(path.sep)[0];
            // Parse conversation
            const exchanges = await parseConversation(conversationPath, project, conversationPath);
            if (exchanges.length === 0) {
                console.log(`  Skipped (no exchanges)`);
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
                console.log(`  Created summary: ${summary.split(/\s+/).length} words`);
            }
            catch (error) {
                console.log(`  Summary failed (indexing anyway): ${error instanceof Error ? error.message : String(error)}`);
            }
            // Index exchanges
            for (const exchange of exchanges) {
                const toolNames = exchange.toolCalls?.map(tc => tc.toolName);
                const embedding = await generateExchangeEmbedding(exchange.userMessage, exchange.assistantMessage, toolNames);
                insertExchange(db, exchange, embedding, toolNames);
            }
            console.log(`  Indexed ${exchanges.length} exchanges`);
        }
        catch (error) {
            console.error(`Failed to re-index ${conversationPath}:`, error);
        }
    }
    db.close();
    // Report corrupted files (manual intervention needed)
    if (issues.corrupted.length > 0) {
        console.log('\n⚠️  Corrupted files (manual review needed):');
        issues.corrupted.forEach(c => console.log(`  ${c.path}: ${c.error}`));
    }
    console.log('✅ Repair complete.');
}
