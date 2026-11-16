import { formatDateRange } from './stats.js';
import { createUi, formatAgo, formatBar, num, plural, tildify } from './cli-ui.js';
import { VERSION } from './version.js';
const COL = 12;
const HEADER_WIDTH = 52;
/**
 * Draw the at-a-glance dashboard. Facts sit in one aligned column; anything
 * that needs Andrew's attention is repeated at the bottom with its fix.
 * Returns `ok`, which reflects the core engine (native binding loads +
 * database present) — an empty index and pending summaries are normal early
 * states, not failures.
 */
export function renderStatus(ui, input) {
    const { stats } = input;
    const ok = input.nativeBindingOk && input.dbExists;
    const field = (label, value) => ui.line(` ${label.padEnd(COL)}${value}`);
    const more = (value) => ui.line(` ${' '.repeat(COL)}${value}`);
    const mark = (good) => (good ? ui.paint('green', '✓') : ui.paint('red', '✗'));
    const title = `Episodic Memory v${VERSION}`;
    const health = ok ? ui.paint('green', '● healthy') : ui.paint('red', '● unhealthy');
    ui.line(` ${ui.paint('bold', 'Episodic Memory')} ${ui.paint('dim', `v${VERSION}`)}${' '.repeat(Math.max(2, HEADER_WIDTH - title.length))}${health}`);
    ui.line();
    const syncedAt = input.lastSync ? Date.parse(input.lastSync) : NaN;
    const synced = !input.lastSync ? 'never synced'
        : Number.isFinite(syncedAt) ? `synced ${formatAgo(syncedAt, Date.parse(input.now))}`
            : `synced ${input.lastSync}`;
    if (stats.totalConversations === 0) {
        field('Index', `none indexed yet · ${synced}`);
    }
    else {
        field('Index', `${plural(stats.totalConversations, 'conversation')} · ${plural(stats.totalExchanges, 'exchange')}`);
        more([stats.dateRange ? formatDateRange(stats.dateRange.earliest, stats.dateRange.latest) : undefined, synced].filter(Boolean).join(' · '));
        const done = stats.conversationsWithSummaries;
        const pct = Math.floor((done / stats.totalConversations) * 100);
        field('Summaries', `${ui.paint('green', formatBar(done, stats.totalConversations))} ${pct}%`);
        const parts = [`${num(done)} done`, `${num(stats.conversationsWithoutSummaries)} pending`];
        if (input.poison > 0)
            parts.push(ui.paint('yellow', `${num(input.poison)} failed`));
        more(parts.join(' · '));
    }
    field('Embeddings', input.staleEmbeddings > 0
        ? `${ui.paint('yellow', '⚠')} ${plural(input.staleEmbeddings, 'exchange')} on an old model`
        : `${mark(true)} all current`);
    field('Engine', `${mark(input.nativeBindingOk)} SQLite ${input.nativeBindingOk ? 'loaded' : 'not loaded'} · ${input.dbExists ? mark(true) : ui.paint('yellow', '⚠')} database`);
    field('Summary API', `${ui.paint('dim', '·')} ${input.apiEnvSet ? 'API key from env' : 'Claude Code auth'}`);
    // Problems, each with the one command that fixes it.
    const problems = [];
    if (!input.nativeBindingOk) {
        problems.push(['fail', `SQLite binding not loaded${input.nativeBindingError ? ` — ${input.nativeBindingError}` : ''}`, 'fix: cd <plugin-dir> && npm rebuild better-sqlite3']);
    }
    if (!input.dbExists) {
        problems.push(['warn', `index database not created yet (${tildify(input.dbPath)})`, 'run: episodic-memory sync']);
    }
    if (input.staleEmbeddings > 0) {
        problems.push(['warn', `${plural(input.staleEmbeddings, 'exchange')} on an old embedding model`, 're-embedding a batch on each sync']);
    }
    if (input.poison > 0) {
        problems.push(['warn', `${plural(input.poison, 'summary', 'summaries')} failed for good`, 'retry: EPISODIC_MEMORY_RETRY_ALL=1 episodic-memory sync']);
    }
    for (const [status, text, fix] of problems) {
        ui.line();
        ui.line(` ${status === 'fail' ? ui.paint('red', '✗') : ui.paint('yellow', '⚠')} ${text}`);
        ui.line(`   ${ui.paint('dim', fix)}`);
    }
    return ok;
}
/** Plain-text rendering (no color, no animation); same layout as the terminal. */
export function buildStatusReport(input) {
    const chunks = [];
    const ok = renderStatus(createUi({ out: { write: s => chunks.push(s) }, live: { write: () => { } }, color: false }), input);
    return { text: chunks.join(''), ok };
}
