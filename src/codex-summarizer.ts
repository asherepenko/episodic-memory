import { spawn } from 'child_process';
import { createInterface } from 'readline';
import { SUMMARIZER_CONTEXT_MARKER } from './constants.js';
import { VERSION } from './version.js';
import { getApiEnv } from './summarizer.js';
import {
  codexVersionRequirementMessage,
  parseCodexCliVersion,
  versionMeetsMinimum,
} from './codex-support.js';

export interface CodexSummarizerCommand {
  command: string;
  args: string[];
  prompt: string;
  sessionId: string;
  model?: string;
  versionArgs?: string[];
  skipVersionCheck?: boolean;
}

export function buildCodexSummaryPrompt(): string {
  return `${SUMMARIZER_CONTEXT_MARKER}.

You are running in an ephemeral Codex fork of an existing session. Use the forked session context, including available reasoning summaries and thinking context, to write a concise, factual summary of the conversation.

Do not inspect files, run commands, search the web, or modify state. Use only the conversation context already available in this forked session.

Output ONLY a <summary></summary> block. Summarize what happened in 2-4 sentences.

Include:
- What was built/changed/discussed (be specific)
- Key technical decisions or approaches
- Problems solved or current state

Exclude:
- Apologies, meta-commentary, or your questions
- Raw logs or debug output
- Generic descriptions - focus on what makes THIS conversation unique

Good:
<summary>Built JWT authentication for React app with refresh tokens and protected routes. Fixed token expiration bug by implementing refresh-during-request logic.</summary>

Bad:
<summary>I apologize. The conversation discussed authentication and various approaches were considered...</summary>`;
}

export function buildCodexSummarizerCommand(args: {
  sessionId: string;
  prompt: string;
  model?: string;
  codexBin?: string;
}): CodexSummarizerCommand {
  const command = args.codexBin || process.env.EPISODIC_MEMORY_CODEX_BIN || 'codex';

  return {
    command,
    args: ['app-server'],
    prompt: args.prompt,
    sessionId: args.sessionId,
    model: args.model,
  };
}

interface PendingAppServerRequest {
  method: string;
  resolve: (value: any) => void;
  reject: (error: Error) => void;
}

function appServerTimeoutMs(): number {
  const configured = Number(process.env.EPISODIC_MEMORY_CODEX_SUMMARY_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : 120000;
}

function readCommandOutput(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: getApiEnv(),
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = '';

    child.stdout.on('data', chunk => {
      output += chunk.toString();
    });
    child.stderr.on('data', chunk => {
      output += chunk.toString();
    });
    child.on('error', reject);
    child.on('exit', code => {
      if (code === 0) {
        resolve(output);
      } else {
        reject(new Error(`${command} ${args.join(' ')} failed with exit code ${code}: ${output.trim()}`));
      }
    });
  });
}

async function assertSupportedCodexVersion(command: CodexSummarizerCommand): Promise<void> {
  if (command.skipVersionCheck) {
    return;
  }

  const output = await readCommandOutput(command.command, command.versionArgs || ['--version']);
  const version = parseCodexCliVersion(output);
  if (!version || !versionMeetsMinimum(version)) {
    throw new Error(codexVersionRequirementMessage(output));
  }
}

function requireThreadId(result: any, method: string): string {
  const threadId = result?.thread?.id;
  if (typeof threadId !== 'string' || !threadId) {
    throw new Error(`${method} returned unexpected response: ${JSON.stringify(result)}`);
  }
  return threadId;
}

function requireTurnId(result: any, method: string): string {
  const turnId = result?.turn?.id;
  if (typeof turnId !== 'string' || !turnId) {
    throw new Error(`${method} returned unexpected response: ${JSON.stringify(result)}`);
  }
  return turnId;
}

export async function runCodexCommand(command: CodexSummarizerCommand): Promise<string> {
  await assertSupportedCodexVersion(command);

  return new Promise((resolve, reject) => {
    const child = spawn(command.command, command.args, {
      env: getApiEnv(),
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stderr = '';
    let answer = '';
    let nextRequestId = 1;
    let targetTurnId: string | undefined;
    let finished = false;
    let timeout: NodeJS.Timeout | undefined;
    const pending = new Map<number, PendingAppServerRequest>();
    const lines = createInterface({ input: child.stdout });

    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });

    const cleanup = () => {
      if (timeout) {
        clearTimeout(timeout);
      }
      lines.close();
      if (!child.killed) {
        child.kill('SIGTERM');
      }
    };

    const finish = (error: Error | undefined, result = '') => {
      if (finished) return;
      finished = true;
      cleanup();
      if (error) {
        reject(error);
      } else {
        resolve(result);
      }
    };

    timeout = setTimeout(() => {
      finish(new Error(`Codex summarizer timed out after ${appServerTimeoutMs()}ms: ${stderr.trim()}`));
    }, appServerTimeoutMs());

    const send = (method: string, params?: Record<string, unknown>): Promise<any> => {
      const id = nextRequestId++;
      child.stdin.write(JSON.stringify({ method, id, params }) + '\n');
      return new Promise((resolveRequest, rejectRequest) => {
        pending.set(id, { method, resolve: resolveRequest, reject: rejectRequest });
      });
    };

    const notify = (method: string, params?: Record<string, unknown>) => {
      const message = params === undefined ? { method } : { method, params };
      child.stdin.write(JSON.stringify(message) + '\n');
    };

    lines.on('line', line => {
      if (!line.trim()) return;

      let message: any;
      try {
        message = JSON.parse(line);
      } catch (error) {
        finish(new Error(`Codex app-server emitted invalid JSON: ${line}`));
        return;
      }

      if (typeof message.id === 'number' && pending.has(message.id)) {
        const request = pending.get(message.id)!;
        pending.delete(message.id);
        if (message.error) {
          request.reject(new Error(`${request.method} failed: ${JSON.stringify(message.error)}`));
        } else {
          request.resolve(message.result);
        }
        return;
      }

      if (message.method === 'item/agentMessage/delta') {
        answer += message.params?.delta ?? '';
        return;
      }

      if (message.method === 'item/completed' && message.params?.item?.type === 'agentMessage') {
        answer = message.params.item.text ?? answer;
        return;
      }

      if (
        message.method === 'turn/completed' &&
        (!targetTurnId || message.params?.turn?.id === targetTurnId)
      ) {
        if (message.params.turn.status === 'completed') {
          finish(undefined, answer);
        } else {
          const detail = message.params.turn.error?.message || message.params.turn.status;
          finish(new Error(`Codex summarizer turn did not complete: ${detail}`));
        }
      }
    });

    child.on('error', error => {
      finish(error);
    });

    child.on('exit', code => {
      if (!finished) {
        const detail = code === 0
          ? 'Codex app-server exited before the summary turn completed'
          : `Codex summarizer failed with exit code ${code}: ${stderr.trim()}`;
        finish(new Error(detail));
      }
    });

    (async () => {
      try {
        await send('initialize', {
          clientInfo: {
            name: 'episodic-memory',
            title: 'Episodic Memory',
            version: VERSION,
          },
          capabilities: {
            experimentalApi: true,
          },
        });
        notify('initialized');

        const fork = await send('thread/fork', {
          threadId: command.sessionId,
          ephemeral: true,
          sandbox: 'read-only',
          approvalPolicy: 'never',
          ...(command.model ? { model: command.model } : {}),
        });
        const forkThreadId = requireThreadId(fork, 'thread/fork');

        const turn = await send('turn/start', {
          threadId: forkThreadId,
          input: [{
            type: 'text',
            text: command.prompt,
            textElements: [],
          }],
        });
        targetTurnId = requireTurnId(turn, 'turn/start');
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    })();
  });
}

/**
 * Deep entry point for Codex-native summarization. Builds the app-server
 * command and runs the fork→turn lifecycle, returning the raw agent message
 * text. The summarization domain (summarizer.ts) depends on this session-in /
 * text-out interface, not on the JSON-RPC transport internals below.
 */
export async function runCodexSummary(
  sessionId: string,
  prompt: string,
  model?: string,
  codexBin?: string
): Promise<string> {
  const command = buildCodexSummarizerCommand({ sessionId, prompt, model, codexBin });
  return runCodexCommand(command);
}
