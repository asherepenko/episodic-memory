import { formatDateRange } from './stats.js';
import { createUi, formatAgo, num, plural, tildify } from './cli-ui.js';
import { VERSION } from './version.js';
/**
 * Draw the at-a-glance health report. Returns `ok`, which reflects the core
 * engine (native binding loads + database present) — index emptiness and
 * pending summaries are normal early states, not failures.
 */
export function renderStatus(ui, input) {
    const { stats } = input;
    const ok = input.nativeBindingOk && input.dbExists;
    ui.line(`${ui.paint('bold', 'Episodic Memory')} ${ui.paint('dim', `v${VERSION} · status`)}`);
    ui.heading('Engine');
    if (input.nativeBindingOk) {
        ui.row('ok', 'SQLite binding', 'loaded');
    }
    else {
        ui.row('fail', 'SQLite binding', `NOT loaded${input.nativeBindingError ? ` — ${input.nativeBindingError}` : ''}`);
        ui.sub('fix: cd <plugin-dir> && npm rebuild better-sqlite3');
    }
    if (input.dbExists) {
        ui.row('ok', 'Index database', `present (${tildify(input.dbPath)})`);
    }
    else {
        ui.row('warn', 'Index database', `not created yet (${tildify(input.dbPath)})`);
        ui.sub('run a sync to build it: episodic-memory sync');
    }
    ui.heading('Index');
    if (stats.totalConversations === 0) {
        ui.row('info', 'Conversations', 'none indexed yet');
    }
    else {
        ui.field('Conversations', `${num(stats.totalConversations)} (${num(stats.conversationsWithSummaries)} summarized, ${num(stats.conversationsWithoutSummaries)} pending)`);
        ui.field('Exchanges', num(stats.totalExchanges));
        if (stats.dateRange)
            ui.field('Range', formatDateRange(stats.dateRange.earliest, stats.dateRange.latest));
    }
    const syncedAt = input.lastSync ? Date.parse(input.lastSync) : NaN;
    if (input.lastSync && Number.isFinite(syncedAt)) {
        ui.field('Last sync', formatAgo(syncedAt, Date.parse(input.now)));
    }
    else if (input.lastSync) {
        ui.field('Last sync', input.lastSync);
    }
    else {
        ui.field('Last sync', 'never');
    }
    ui.heading('Health');
    if (input.staleEmbeddings > 0) {
        ui.row('warn', 'Embeddings', `${plural(input.staleEmbeddings, 'exchange')} on an old model`);
        ui.sub('re-embedding incrementally on each sync');
    }
    else {
        ui.row('ok', 'Embeddings', 'all current');
    }
    if (input.poison > 0) {
        ui.row('warn', 'Summaries', `${plural(input.poison, 'conversation')} permanently skipped after repeated failures`);
        ui.sub('retry with: EPISODIC_MEMORY_RETRY_ALL=1 episodic-memory sync');
    }
    else {
        ui.row('ok', 'Summaries', 'no permanent failures');
    }
    ui.row('info', 'Summary API', input.apiEnvSet ? 'env configured (ANTHROPIC_API_KEY / EPISODIC_MEMORY_API_BASE_URL)' : 'no env vars set — relying on Claude Code ambient auth');
    return ok;
}
/** Plain-text rendering (no color, no animation); same layout as the terminal. */
export function buildStatusReport(input) {
    const chunks = [];
    const ok = renderStatus(createUi({ out: { write: s => chunks.push(s) }, live: { write: () => { } }, color: false }), input);
    return { text: chunks.join(''), ok };
}
