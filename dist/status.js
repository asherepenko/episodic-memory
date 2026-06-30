function ageLabel(iso, nowIso) {
    const then = Date.parse(iso);
    const now = Date.parse(nowIso);
    if (!Number.isFinite(then) || !Number.isFinite(now) || now < then)
        return iso;
    const secs = Math.floor((now - then) / 1000);
    if (secs < 90)
        return `${secs}s ago`;
    const mins = Math.floor(secs / 60);
    if (mins < 90)
        return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 48)
        return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
}
/**
 * Build the at-a-glance health report. `ok` reflects the core engine
 * (native binding loads + database present) — index emptiness and pending
 * summaries are normal early states, not failures.
 */
export function buildStatusReport(input) {
    const { stats } = input;
    const lines = [];
    const ok = input.nativeBindingOk && input.dbExists;
    lines.push('Episodic Memory — status');
    lines.push('');
    lines.push('Engine');
    if (input.nativeBindingOk) {
        lines.push('  ✅ Native SQLite binding: loaded');
    }
    else {
        lines.push(`  ❌ Native SQLite binding: NOT loaded${input.nativeBindingError ? ` — ${input.nativeBindingError}` : ''}`);
        lines.push('     Fix: cd <plugin-dir> && npm rebuild better-sqlite3');
    }
    if (input.dbExists) {
        lines.push(`  ✅ Index database: present (${input.dbPath})`);
    }
    else {
        lines.push(`  ⚠️  Index database: not created yet (${input.dbPath})`);
        lines.push('     Run a sync to build it: episodic-memory sync');
    }
    lines.push('');
    lines.push('Index');
    if (stats.totalConversations === 0) {
        lines.push('  📭 No conversations indexed yet.');
    }
    else {
        lines.push(`  📚 Conversations: ${stats.totalConversations} (${stats.conversationsWithSummaries} summarized, ${stats.conversationsWithoutSummaries} pending)`);
        lines.push(`  💬 Exchanges: ${stats.totalExchanges}`);
        if (stats.dateRange) {
            lines.push(`  📅 Range: ${stats.dateRange.earliest} → ${stats.dateRange.latest}`);
        }
    }
    if (input.lastSync) {
        lines.push(`  🕒 Last sync: ${input.lastSync} (${ageLabel(input.lastSync, input.now)})`);
    }
    else {
        lines.push('  🕒 Last sync: never');
    }
    lines.push('');
    lines.push('Health');
    if (input.staleEmbeddings > 0) {
        lines.push(`  ⚠️  Embeddings: ${input.staleEmbeddings} exchange(s) on an old model — re-embedding incrementally on each sync`);
    }
    else {
        lines.push('  ✅ Embeddings: all current');
    }
    if (input.poison > 0) {
        lines.push(`  ⚠️  Summaries: ${input.poison} conversation(s) permanently skipped after repeated failures`);
        lines.push('     Retry them: EPISODIC_MEMORY_RETRY_ALL=1 episodic-memory sync');
    }
    else {
        lines.push('  ✅ Summaries: no permanent failures');
    }
    lines.push(`  ℹ️  Summary API: ${input.apiEnvSet ? 'env configured (ANTHROPIC_API_KEY / EPISODIC_MEMORY_API_BASE_URL)' : 'no env vars set — relying on Claude Code ambient auth'}`);
    return { text: lines.join('\n') + '\n', ok };
}
