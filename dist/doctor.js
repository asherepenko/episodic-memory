import { MIN_CODEX_VERSION, parseCodexCliVersion, versionMeetsMinimum, } from './codex-support.js';
import { createUi, tildify } from './cli-ui.js';
function parseFeatureState(featuresOutput, feature) {
    const line = featuresOutput
        .split(/\r?\n/)
        .map(entry => entry.trim())
        .find(entry => entry.startsWith(`${feature} `));
    if (!line) {
        return undefined;
    }
    const lastColumn = line.split(/\s+/).at(-1);
    if (lastColumn === 'true')
        return true;
    if (lastColumn === 'false')
        return false;
    return undefined;
}
function parseMcpState(mcpListOutput) {
    const line = mcpListOutput
        .split(/\r?\n/)
        .map(entry => entry.trim())
        .find(entry => entry.startsWith('episodic-memory '));
    if (!line) {
        return 'missing';
    }
    return line.includes(' enabled') ? 'enabled' : 'disabled';
}
/** Short detail for the hook-trust row plus the fix hint shown under it. */
function hookTrustRow(state) {
    switch (state) {
        case 'trusted':
            return { status: 'ok', detail: 'trusted' };
        case 'untrusted':
            return {
                status: 'fail',
                detail: 'untrusted',
                hint: 'open /hooks in Codex, review the Episodic Memory hook, and press t to trust it',
            };
        case 'modified':
            return {
                status: 'fail',
                detail: 'modified since it was trusted',
                hint: 'open /hooks in Codex, review the Episodic Memory hook, and press t to trust it again',
            };
        case 'not_found':
            return {
                status: 'fail',
                detail: 'not found',
                hint: 'confirm the Episodic Memory plugin is installed and enabled',
            };
        case 'unknown':
            return {
                status: 'fail',
                detail: 'unknown',
                hint: 'could not inspect Codex hooks; open /hooks in Codex to verify trust',
            };
    }
}
/** Draw the Codex checks with the shared UI kit and return the tallies. */
export function renderCodexDoctor(ui, inputs) {
    const version = parseCodexCliVersion(inputs.codexVersionOutput);
    const versionOk = version !== undefined && versionMeetsMinimum(version);
    const legacyHookLine = inputs.featuresOutput.split(/\r?\n/)
        .find(line => /^plugin_hooks\s+/.test(line.trim()));
    const hookFeature = legacyHookLine && !/^plugin_hooks\s+removed\s+/.test(legacyHookLine.trim())
        ? 'plugin_hooks' : 'hooks';
    const pluginHooksEnabled = parseFeatureState(inputs.featuresOutput, hookFeature);
    const pluginsEnabled = parseFeatureState(inputs.featuresOutput, 'plugins');
    const mcpState = parseMcpState(inputs.mcpListOutput);
    const counts = { checks: 0, warnings: 0, failures: 0 };
    const row = (status, label, detail, hint) => {
        if (status === 'ok')
            counts.checks++;
        else if (status === 'warn')
            counts.warnings++;
        else if (status === 'fail')
            counts.failures++;
        ui.row(status, label, detail);
        if (hint)
            ui.sub(hint);
    };
    const featureState = (value) => value === true ? 'enabled' : value === false ? 'disabled' : 'unknown';
    ui.heading('Codex');
    const versionText = inputs.codexVersionOutput.trim() || '(not found)';
    if (versionOk) {
        row('ok', 'Version', `${versionText} (minimum ${MIN_CODEX_VERSION})`);
    }
    else {
        row('fail', 'Version', `${versionText} (requires minimum ${MIN_CODEX_VERSION})`, `upgrade Codex with codex update (minimum ${MIN_CODEX_VERSION})`);
    }
    ui.field('Home', tildify(inputs.codexHome));
    if (inputs.sessionsDirExists) {
        row('ok', 'Sessions', 'found');
    }
    else {
        row('fail', 'Sessions', 'missing', 'start at least one Codex session to create the sessions directory');
    }
    ui.heading('Features');
    if (pluginsEnabled === false) {
        row('fail', 'Plugins', 'disabled', 'run codex features enable plugins');
    }
    else {
        row(pluginsEnabled === true ? 'ok' : 'info', 'Plugins', featureState(pluginsEnabled));
    }
    const hooksLabel = hookFeature === 'hooks' ? 'Plugin hooks' : 'Plugin hooks (legacy)';
    if (pluginHooksEnabled === true) {
        row('ok', hooksLabel, 'enabled');
    }
    else {
        row('fail', hooksLabel, featureState(pluginHooksEnabled), `run codex features enable ${hookFeature}`);
    }
    ui.heading('Episodic Memory');
    if (mcpState === 'enabled') {
        row('ok', 'MCP server', 'enabled');
    }
    else {
        row('fail', 'MCP server', mcpState, 'not enabled in codex mcp list');
    }
    const trust = hookTrustRow(inputs.hookTrustState);
    row(trust.status, 'Hook trust', trust.detail, trust.hint);
    ui.field('Index database', tildify(inputs.dbPath));
    ui.field('Sync log', tildify(inputs.logPath));
    return counts;
}
export function buildCodexDoctorReport(inputs) {
    let text = '';
    const ui = createUi({
        out: { write: chunk => { text += chunk; } },
        live: { write: () => { } },
        color: false,
        interactive: false,
    });
    const counts = renderCodexDoctor(ui, inputs);
    return { ok: counts.failures === 0, text };
}
