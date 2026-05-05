import { query } from '@anthropic-ai/claude-agent-sdk';
import { SUMMARIZER_CONTEXT_MARKER } from './constants.js';
import { log } from './logger.js';
const DEFAULT_CALL_TIMEOUT_MS = 180_000; // 3 min per Claude SDK call
function getCallTimeoutMs() {
    const raw = process.env.EPISODIC_MEMORY_API_TIMEOUT_MS;
    const parsed = raw ? parseInt(raw, 10) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_CALL_TIMEOUT_MS;
}
export class SummarizerTimeoutError extends Error {
    constructor(timeoutMs) {
        super(`Claude SDK call exceeded ${timeoutMs}ms timeout`);
        this.name = 'SummarizerTimeoutError';
    }
}
/**
 * Get API environment overrides for summarization calls.
 * Returns full env merged with process.env so subprocess inherits PATH, HOME, etc.
 *
 * Env vars (all optional):
 * - EPISODIC_MEMORY_API_MODEL: Model to use (default: haiku)
 * - EPISODIC_MEMORY_API_MODEL_FALLBACK: Fallback model on error (default: sonnet)
 * - EPISODIC_MEMORY_API_BASE_URL: Custom API endpoint
 * - EPISODIC_MEMORY_API_TOKEN: Auth token for custom endpoint
 * - EPISODIC_MEMORY_API_TIMEOUT_MS: Timeout for API calls (default: SDK default)
 */
let cachedApiEnv = null;
let cachedApiEnvKey = '';
export function getApiEnv() {
    const baseUrl = process.env.EPISODIC_MEMORY_API_BASE_URL;
    const token = process.env.EPISODIC_MEMORY_API_TOKEN;
    const timeoutMs = process.env.EPISODIC_MEMORY_API_TIMEOUT_MS;
    // Memoize: reuse the spread of process.env across long sessions (10+ chunks)
    // when none of the watched vars changed.
    const key = `${baseUrl ?? ''}|${token ?? ''}|${timeoutMs ?? ''}`;
    if (cachedApiEnv && cachedApiEnvKey === key)
        return cachedApiEnv;
    // Always include the reentrancy guard so the SDK-spawned Claude subprocess
    // (which inherits this env) marks itself as a reentrant context. The
    // SessionStart hook checks the guard via shouldSkipReentrantSync() and
    // exits before launching another sync, breaking the recursive cascade
    // reported in #87.
    cachedApiEnv = {
        ...process.env,
        EPISODIC_MEMORY_SUMMARIZER_GUARD: '1',
        ...(baseUrl && { ANTHROPIC_BASE_URL: baseUrl }),
        ...(token && { ANTHROPIC_AUTH_TOKEN: token }),
        ...(timeoutMs && { API_TIMEOUT_MS: timeoutMs }),
    };
    cachedApiEnvKey = key;
    return cachedApiEnv;
}
/**
 * Detect whether the current process is running inside the Claude Agent SDK
 * subprocess that the summarizer just spawned. The flag is set by getApiEnv()
 * and inherited by the spawned subprocess. Used by sync entry points to bail
 * out before re-entering the sync→summarizer→spawn cycle (#87).
 */
export function shouldSkipReentrantSync() {
    return process.env.EPISODIC_MEMORY_SUMMARIZER_GUARD === '1';
}
export function formatConversationText(exchanges) {
    return exchanges.map(ex => {
        return `User: ${ex.userMessage}\n\nAgent: ${ex.assistantMessage}`;
    }).join('\n\n---\n\n');
}
function extractSummary(text) {
    const match = text.match(/<summary>(.*?)<\/summary>/s);
    if (match) {
        return match[1].trim();
    }
    // Fallback if no tags found
    return text.trim();
}
const SUMMARIZER_SYSTEM_PROMPT = 'Write concise, factual summaries. Output ONLY the summary - no preamble, no "Here is", no "I will". Your output will be indexed directly.';
const HIERARCHICAL_SUMMARIZER_SYSTEM_PROMPT = 'Write concise, factual summaries. Output ONLY the summary - no preamble, no "Here is", no "I will". Each user message is an independent summarization request — answer it on its own without referring back to prior turns.';
async function callClaude(prompt, sessionId, useFallback = false) {
    const primaryModel = process.env.EPISODIC_MEMORY_API_MODEL || 'haiku';
    const fallbackModel = process.env.EPISODIC_MEMORY_API_MODEL_FALLBACK || 'sonnet';
    const model = useFallback ? fallbackModel : primaryModel;
    const timeoutMs = getCallTimeoutMs();
    const abortController = new AbortController();
    const startedAt = Date.now();
    log.debug(`callClaude start model=${model} sessionId=${sessionId ?? 'none'} timeoutMs=${timeoutMs}`);
    const timer = setTimeout(() => {
        log.warn(`callClaude timeout after ${timeoutMs}ms — aborting (model=${model})`);
        abortController.abort();
    }, timeoutMs);
    try {
        const iterator = query({
            prompt,
            options: {
                model,
                max_tokens: 4096,
                env: getApiEnv(),
                resume: sessionId,
                abortController,
                // Isolation: skip user/project settings, MCP servers, and tools.
                // Cuts subprocess cold-start from ~10s to ~2s per call.
                settingSources: [],
                mcpServers: {},
                allowedTools: [],
                disallowedTools: ['*'],
                strictMcpConfig: true,
                // Pipe subprocess stderr into our log file at debug level — gives live
                // visibility into MCP/auth/network issues without cluttering stdout.
                stderr: (data) => {
                    const trimmed = String(data).trim();
                    if (trimmed)
                        log.debug(`[sdk] ${trimmed}`);
                },
                // Don't override systemPrompt when resuming - it uses the original session's prompt
                // Instead, the prompt itself should provide clear instructions
                ...(sessionId ? {} : { systemPrompt: SUMMARIZER_SYSTEM_PROMPT })
            }
        });
        for await (const message of iterator) {
            if (message && typeof message === 'object' && 'type' in message && message.type === 'result') {
                const result = message.result;
                const elapsed = Date.now() - startedAt;
                log.debug(`callClaude done model=${model} elapsedMs=${elapsed}`);
                // Check if result is an API error (SDK returns errors as result strings)
                if (typeof result === 'string' && result.includes('API Error') && result.includes('thinking.budget_tokens')) {
                    if (!useFallback) {
                        log.info(`  ${primaryModel} hit thinking budget error, retrying with ${fallbackModel}`);
                        return await callClaude(prompt, sessionId, true);
                    }
                    // If fallback also fails, return error message
                    return result;
                }
                return result;
            }
        }
        return '';
    }
    catch (error) {
        if (abortController.signal.aborted) {
            throw new SummarizerTimeoutError(timeoutMs);
        }
        throw error;
    }
    finally {
        clearTimeout(timer);
    }
}
function chunkExchanges(exchanges, chunkSize) {
    const chunks = [];
    for (let i = 0; i < exchanges.length; i += chunkSize) {
        chunks.push(exchanges.slice(i, i + chunkSize));
    }
    return chunks;
}
const TRIVIAL_USER_PATTERNS = [
    /^\/(clear|exit|help|init|compact|status|model|cost|theme|login|logout|config|fast|caveman.*|loop|cancel.*|ship|kickoff|verify|todo|build|recall|sweep|todo|dream|triage|handoff)(\s|$)/i,
    /^(yes|no|y|n|ok|ack|continue|go|stop|thanks|thank you|cool|nice|done|next)\.?$/i,
];
function isTrivialUserMessage(msg) {
    const trimmed = msg.trim();
    if (trimmed.length === 0)
        return true;
    return TRIVIAL_USER_PATTERNS.some(rx => rx.test(trimmed));
}
/**
 * Fast pre-filter: returns a trivial summary if the conversation has no
 * substantive user prose, otherwise null (caller should run full SDK summary).
 *
 * Catches: only slash-commands, only ack words, total user text <500 chars,
 * empty assistant outputs.
 */
export function detectTrivial(exchanges) {
    if (exchanges.length === 0) {
        return 'Trivial conversation with no substantive content.';
    }
    const substantive = exchanges.filter(ex => !isTrivialUserMessage(ex.userMessage));
    if (substantive.length === 0) {
        return 'Trivial conversation: only slash-commands or acknowledgements.';
    }
    const totalUserChars = substantive.reduce((sum, ex) => sum + ex.userMessage.trim().length, 0);
    const totalAssistantChars = exchanges.reduce((sum, ex) => sum + (ex.assistantMessage?.trim().length ?? 0), 0);
    if (totalUserChars < 500 && totalAssistantChars < 500) {
        return 'Trivial conversation with minimal content.';
    }
    if (totalAssistantChars === 0) {
        return 'Trivial conversation: no assistant output.';
    }
    return null;
}
// ─── Prompt builders ──────────────────────────────────────────────────────────
// Tiered prompts (#6 + #9). XML output schema for grep-friendly summaries.
const COMMON_RULES = `Rules:
- Output ONLY the requested XML. No preamble, no apologies, no meta-commentary.
- Be specific: name files, modules, libraries, decisions. Avoid generic phrases.
- Skip raw logs, stack traces, exact error strings — capture intent and outcome.
- Use past-tense, active voice. One concrete claim per element.`;
function buildShortPrompt(conversationText) {
    return `${SUMMARIZER_CONTEXT_MARKER}.

Write a one-line label (≤25 words) capturing what this short conversation accomplished. Output in <summary></summary>.

${COMMON_RULES}

Examples:
<summary>Renamed FeedRepository.fetchPage() to loadPage() across 4 callers; tests still green.</summary>
<summary>Diagnosed flaky CI run on main; root cause was missing TZ=UTC in Postgres container.</summary>
<summary>Added retry-with-backoff wrapper around Stripe webhook verification; 3 unit tests added.</summary>

Conversation:
${conversationText}`;
}
function buildMediumPrompt(conversationText, includeText) {
    return `${SUMMARIZER_CONTEXT_MARKER}.

Summarize this conversation. Output exactly this XML structure:

<summary>
  <changes>2-3 sentences on what was built/changed/refactored. Name files, functions, modules.</changes>
  <decisions>Key technical decisions or trade-offs. Use "decided X over Y because Z" form. Empty tag if none.</decisions>
  <blockers>Open problems, dead ends, or current state if mid-flight. Empty tag if all resolved.</blockers>
</summary>

${COMMON_RULES}

Examples:

<summary>
  <changes>Added OfflineFirstFeedRepository in feature/feed/impl backed by Room (FeedDao) and a Retrofit FeedApi. Wired into FeedViewModel via Hilt.</changes>
  <decisions>Decided NetworkBoundResource pattern over manual Flow.combine because the team already uses it in PostRepository. Picked SQLite FTS over LIKE search for offline query path.</decisions>
  <blockers>Pagination cursor handling unfinished — last-page detection still uses size==0 heuristic.</blockers>
</summary>

<summary>
  <changes>Diagnosed sync hang in episodic-memory; added AbortController + 180s timeout in summarizer.ts, structured logger writing to sync.log, and bounded concurrency pool (default 2).</changes>
  <decisions>Decided against direct Anthropic SDK because Andrew wants subscription auth. Picked settingSources:[] + mcpServers:{} to strip MCP cold-start.</decisions>
  <blockers></blockers>
</summary>

${includeText ? 'Conversation:\n' + conversationText : ''}`;
}
function buildChunkPrompt(chunkText, chunkNum, totalChunks) {
    return `${SUMMARIZER_CONTEXT_MARKER}.

Summarize part ${chunkNum}/${totalChunks} of a long conversation in ≤3 sentences. Capture concrete actions and decisions only.

${COMMON_RULES}

Output: <summary>...</summary>

Example: <summary>Implemented HID keyboard for ESP32 in main.c. Fixed Bluetooth controller init crash by raising BT_CTRL_HCI_TL_BUF_SIZE from 256 to 512.</summary>

Conversation part:
${chunkText}`;
}
function buildSynthesisPrompt(chunkSummaries) {
    return `${SUMMARIZER_CONTEXT_MARKER}.

Synthesize these part-summaries into one cohesive XML summary using the schema below.

<summary>
  <changes>2-4 sentences spanning the whole session. Name files/modules.</changes>
  <decisions>Key decisions across all parts. Empty tag if none.</decisions>
  <blockers>Open problems or current state at session end. Empty tag if resolved.</blockers>
</summary>

${COMMON_RULES}

Part summaries:
${chunkSummaries.map((s, i) => `${i + 1}. ${s}`).join('\n')}

Your synthesis:`;
}
function pickTier(exchanges) {
    const totalChars = exchanges.reduce((sum, ex) => sum + (ex.userMessage?.length ?? 0) + (ex.assistantMessage?.length ?? 0), 0);
    if (exchanges.length <= 15) {
        if (exchanges.length <= 3 && totalChars < 2000)
            return 'short';
        return 'medium';
    }
    return 'long';
}
// ─── Hierarchical session reuse (#1, narrow) ─────────────────────────────────
// Within ONE long conversation's hierarchical pipeline (N chunks + 1 synthesis),
// keep one isolated CLI subprocess alive and stream user messages through it.
// Saves N× cold-start (~2s each) per long conversation. Context bleed across
// turns is intentional — all chunks belong to the same source conversation.
class HierarchicalSession {
    q = null;
    inbox = [];
    inboxResolver = null;
    closed = false;
    abortController = new AbortController();
    // Lifetime counter for diagnostic logs — survives reopen() across thinking-budget fallbacks.
    turnsSent = 0;
    resumeSessionId;
    constructor(opts = {}) {
        this.resumeSessionId = opts.sessionId;
    }
    inputStream() {
        return {
            [Symbol.asyncIterator]: () => ({
                next: () => {
                    if (this.closed && this.inbox.length === 0) {
                        return Promise.resolve({ value: undefined, done: true });
                    }
                    if (this.inbox.length > 0) {
                        const m = this.inbox.shift();
                        return Promise.resolve({ value: m, done: false });
                    }
                    return new Promise(resolve => {
                        this.inboxResolver = resolve;
                    });
                },
                return: () => Promise.resolve({ value: undefined, done: true }),
            }),
        };
    }
    push(prompt) {
        const msg = {
            type: 'user',
            message: { role: 'user', content: prompt },
            parent_tool_use_id: null,
            session_id: '',
        };
        if (this.inboxResolver) {
            const r = this.inboxResolver;
            this.inboxResolver = null;
            r({ value: msg, done: false });
        }
        else {
            this.inbox.push(msg);
        }
    }
    async send(prompt, useFallback = false) {
        const primaryModel = process.env.EPISODIC_MEMORY_API_MODEL || 'haiku';
        const fallbackModel = process.env.EPISODIC_MEMORY_API_MODEL_FALLBACK || 'sonnet';
        const model = useFallback ? fallbackModel : primaryModel;
        if (!this.q) {
            log.debug(`HierarchicalSession start model=${model}`);
            this.q = query({
                prompt: this.inputStream(),
                options: {
                    model,
                    max_tokens: 4096,
                    env: getApiEnv(),
                    abortController: this.abortController,
                    ...(this.resumeSessionId ? { resume: this.resumeSessionId } : {}),
                    settingSources: [],
                    mcpServers: {},
                    allowedTools: [],
                    disallowedTools: ['*'],
                    strictMcpConfig: true,
                    systemPrompt: HIERARCHICAL_SUMMARIZER_SYSTEM_PROMPT,
                    stderr: (data) => {
                        const trimmed = String(data).trim();
                        if (trimmed)
                            log.debug(`[sdk] ${trimmed}`);
                    },
                },
            });
        }
        const timeoutMs = getCallTimeoutMs();
        const startedAt = Date.now();
        const timer = setTimeout(() => {
            log.warn(`HierarchicalSession turn timeout after ${timeoutMs}ms — aborting session`);
            this.abortController.abort();
        }, timeoutMs);
        this.push(prompt);
        this.turnsSent++;
        try {
            while (true) {
                const { value, done } = await this.q.next();
                if (done) {
                    throw new Error('HierarchicalSession ended unexpectedly');
                }
                const m = value;
                if (m && m.type === 'result') {
                    const result = m.result;
                    log.debug(`HierarchicalSession turn ${this.turnsSent} done in ${Date.now() - startedAt}ms`);
                    if (typeof result === 'string' && result.includes('API Error') && result.includes('thinking.budget_tokens') && !useFallback) {
                        // Recycle session on fallback (changing model mid-session is unsupported).
                        log.info(`  ${primaryModel} hit thinking budget error, recycling session with ${fallbackModel}`);
                        await this.close();
                        this.reopen();
                        return await this.send(prompt, true);
                    }
                    return result;
                }
            }
        }
        catch (error) {
            if (this.abortController.signal.aborted) {
                throw new SummarizerTimeoutError(timeoutMs);
            }
            throw error;
        }
        finally {
            clearTimeout(timer);
        }
    }
    async close() {
        if (this.closed)
            return;
        this.closed = true;
        if (this.inboxResolver) {
            const r = this.inboxResolver;
            this.inboxResolver = null;
            r({ value: undefined, done: true });
        }
        try {
            this.abortController.abort();
        }
        catch {
            // ignore
        }
        this.q = null;
    }
    /**
     * Reset internal state after a forced close so a follow-up send() (e.g. the
     * thinking-budget fallback path) starts a fresh subprocess instead of
     * landing on a closed input stream. turnsSent is preserved so log lines
     * keep accurate lifetime turn counts across the fallback.
     */
    reopen() {
        this.closed = false;
        this.inbox = [];
        this.inboxResolver = null;
        this.abortController = new AbortController();
        this.q = null;
    }
}
export async function summarizeConversation(exchanges, optsOrSessionId) {
    // Back-compat: callers may pass sessionId positionally.
    const opts = typeof optsOrSessionId === 'string' ? { sessionId: optsOrSessionId } : (optsOrSessionId ?? {});
    const { sessionId } = opts;
    // Fast pre-filter: skip SDK call entirely for trivial conversations
    const trivial = detectTrivial(exchanges);
    if (trivial !== null) {
        return trivial;
    }
    const tier = pickTier(exchanges);
    log.debug(`tier=${tier} exchanges=${exchanges.length}`);
    if (tier === 'short') {
        const conversationText = formatConversationText(exchanges);
        const prompt = buildShortPrompt(conversationText);
        const result = await callClaude(prompt, sessionId);
        return extractSummary(result);
    }
    if (tier === 'medium') {
        const conversationText = sessionId ? '' : formatConversationText(exchanges);
        const prompt = buildMediumPrompt(conversationText, !sessionId);
        const result = await callClaude(prompt, sessionId);
        return extractSummary(result);
    }
    // Long → hierarchical
    log.info(`  Long conversation (${exchanges.length} exchanges) - using hierarchical summarization`);
    const chunks = chunkExchanges(exchanges, 8);
    log.info(`  Split into ${chunks.length} chunks`);
    // Discard cached chunks that exceed current chunk count — chunkSize change or
    // shrunk conversation invalidates resumption.
    const initial = opts.initialChunkSummaries ?? [];
    const chunkSummaries = initial.length <= chunks.length ? [...initial] : [];
    if (chunkSummaries.length > 0) {
        log.info(`  Resuming from partial state: ${chunkSummaries.length}/${chunks.length} chunks already done`);
    }
    // Reuse one CLI subprocess for all chunks + synthesis (#1).
    const session = new HierarchicalSession({ sessionId });
    try {
        for (let i = chunkSummaries.length; i < chunks.length; i++) {
            const chunkText = formatConversationText(chunks[i]);
            const prompt = buildChunkPrompt(chunkText, i + 1, chunks.length);
            try {
                const summary = await session.send(prompt);
                const extracted = extractSummary(summary);
                chunkSummaries.push(extracted);
                log.info(`  Chunk ${i + 1}/${chunks.length}: ${extracted.split(/\s+/).length} words`);
                opts.onChunkComplete?.(chunkSummaries, chunks.length, exchanges.length);
            }
            catch (error) {
                const msg = error instanceof Error ? error.message : String(error);
                log.warn(`  Chunk ${i + 1} failed: ${msg}`);
                // Persist what we have so a retry can pick up after this index.
                if (chunkSummaries.length > 0) {
                    opts.onChunkComplete?.(chunkSummaries, chunks.length, exchanges.length);
                }
                // Re-throw so caller (sync.ts) marks file as failed and retry-state ticks.
                throw error;
            }
        }
        if (chunkSummaries.length === 0) {
            return 'Error: Unable to summarize conversation.';
        }
        // Synthesize chunks into final summary — same session reused.
        const synthesisPrompt = buildSynthesisPrompt(chunkSummaries);
        log.info(`  Synthesizing final summary...`);
        try {
            const result = await session.send(synthesisPrompt);
            return extractSummary(result);
        }
        catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            log.warn(`  Synthesis failed (${msg}), using chunk summaries`);
            // Keep partial — synthesis can be retried next run from cached chunks.
            return chunkSummaries.join(' ');
        }
    }
    finally {
        await session.close();
    }
}
