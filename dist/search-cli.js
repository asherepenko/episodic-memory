import { createUi, plural, tildify, truncateMiddle } from './cli-ui.js';
import { fullProjectName } from './sync-report.js';
import { searchConversations, formatResults, searchMultipleConcepts, formatMultiConceptResults, buildEmptyResultHint } from './search.js';
const args = process.argv.slice(2);
// Parse arguments
let mode = 'both';
let after;
let before;
let project;
let sessionId;
let gitBranch;
let limit = 10;
let minScore;
let rerank;
const queries = [];
for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
        console.log(`
Usage: episodic-memory search [OPTIONS] <query>

Search indexed conversations using semantic similarity or exact text matching.

MODES:
  (default)      Combined vector + text search
  --vector       Vector similarity only (semantic)
  --text         Exact string matching only (for git SHAs, error codes)

OPTIONS:
  --after DATE          Only conversations after YYYY-MM-DD
  --before DATE         Only conversations before YYYY-MM-DD
  --project NAME        Filter by project name (exact match)
  --session-id ID       Filter by session ID (exact match)
  --git-branch BRANCH   Filter by git branch name (exact match)
  --limit N             Max results (default: 10)
  --min-score N         Drop semantic matches below cosine similarity N (0-1)
  --rerank              Rerank results with a cross-encoder for higher precision
  --help, -h            Show this help

EXAMPLES:
  # Semantic search
  episodic-memory search "React Router authentication errors"

  # Find exact string
  episodic-memory search --text "a1b2c3d4e5f6"

  # Time filtering
  episodic-memory search --after 2025-09-01 "refactoring"

  # Filter to one project
  episodic-memory search --project my-app "auth flow"

  # Filter to one git branch
  episodic-memory search --git-branch feature/login "validation"

  # Combine modes
  episodic-memory search --both "React Router data loading"

  # Multi-concept search (AND - all concepts must match)
  episodic-memory search "React Router" "authentication" "JWT"
`);
        process.exit(0);
    }
    else if (arg === '--vector') {
        mode = 'vector';
    }
    else if (arg === '--text') {
        mode = 'text';
    }
    else if (arg === '--after') {
        after = args[++i];
    }
    else if (arg === '--before') {
        before = args[++i];
    }
    else if (arg === '--project') {
        project = args[++i];
    }
    else if (arg === '--session-id') {
        sessionId = args[++i];
    }
    else if (arg === '--git-branch') {
        gitBranch = args[++i];
    }
    else if (arg === '--limit') {
        limit = parseInt(args[++i]);
    }
    else if (arg === '--min-score') {
        const v = parseFloat(args[++i]);
        if (Number.isFinite(v) && v >= 0 && v <= 1)
            minScore = v;
    }
    else if (arg === '--rerank') {
        rerank = true;
    }
    else {
        // All non-flag args are query terms
        queries.push(arg);
    }
}
if (queries.length === 0) {
    console.error('Usage: episodic-memory search [OPTIONS] <query> [query2] [query3]...');
    console.error('Try: episodic-memory search --help');
    process.exit(1);
}
const useUi = Boolean(process.stdout.isTTY);
const ui = createUi();
const SNIPPET_WIDTH = 100;
/** One numbered result block: project, date, score, dim snippet, dim location. */
function renderResult(ui, index, exchange, score, snippet) {
    const date = new Date(exchange.timestamp).toISOString().split('T')[0];
    const label = truncateMiddle(`${index + 1}. ${fullProjectName(exchange.project)}`, 44);
    ui.line(`  ${ui.paint('bold', label.padEnd(44))} ${date}${score ? `  ${score}` : ''}`);
    const flat = snippet.replace(/\s+/g, ' ').trim();
    if (flat)
        ui.line(`     ${ui.paint('dim', truncateMiddle(flat, SNIPPET_WIDTH))}`);
    ui.sub(`${truncateMiddle(tildify(exchange.archivePath), 90)}:${exchange.lineStart}-${exchange.lineEnd}`);
}
async function renderEmpty() {
    ui.heading('0 results');
    ui.row('info', 'No results', 'try --text or a broader query');
    const hint = await buildEmptyResultHint();
    if (hint)
        ui.sub(hint);
}
function failSearch(error) {
    if (useUi) {
        ui.row('fail', 'Search failed', error instanceof Error ? error.message : String(error));
    }
    else {
        console.error('Error searching:', error);
    }
    process.exit(1);
}
// Multi-concept search if multiple queries provided
if (queries.length > 1) {
    const options = { limit, after, before, project, session_id: sessionId, git_branch: gitBranch, minScore, rerank };
    const run = useUi
        ? ui.task('searching...', () => searchMultipleConcepts(queries, options)).then(async (results) => {
            if (results.length === 0)
                return renderEmpty();
            ui.heading(`${plural(results.length, 'result')} matching all of ${queries.map(q => `"${q}"`).join(' + ')}`);
            ui.line();
            results.forEach((r, i) => {
                const scores = r.conceptSimilarities.map((sim, j) => `${queries[j]}: ${Math.round(sim * 100)}%`).join(', ');
                renderResult(ui, i, r.exchange, `${Math.round(r.averageSimilarity * 100)}% avg`, r.snippet);
                ui.line(`     ${ui.paint('dim', scores)}`);
            });
        })
        : searchMultipleConcepts(queries, options).then(async (results) => {
            let out = await formatMultiConceptResults(results, queries);
            if (results.length === 0) {
                const hint = await buildEmptyResultHint();
                if (hint)
                    out += `\n\n💡 ${hint}`;
            }
            console.log(out);
        });
    run.catch(failSearch);
}
else {
    // Single query - use regular search
    const options = {
        mode,
        limit,
        after,
        before,
        project,
        session_id: sessionId,
        git_branch: gitBranch,
        minScore,
        rerank,
    };
    const run = useUi
        ? ui.task('searching...', () => searchConversations(queries[0], options)).then(async (results) => {
            if (results.length === 0)
                return renderEmpty();
            ui.heading(`${plural(results.length, 'result')} for "${queries[0]}"`);
            ui.line();
            results.forEach((r, i) => {
                renderResult(ui, i, r.exchange, r.similarity !== undefined ? `${Math.round(r.similarity * 100)}% match` : undefined, r.snippet);
            });
        })
        : searchConversations(queries[0], options).then(async (results) => {
            let out = await formatResults(results);
            if (results.length === 0) {
                const hint = await buildEmptyResultHint();
                if (hint)
                    out += `\n\n💡 ${hint}`;
            }
            console.log(out);
        });
    run.catch(failSearch);
}
