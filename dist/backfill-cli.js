import { backfillArchive, formatBackfillReport } from './backfill.js';
import { getArchiveDir } from './paths.js';
import { indexArchive, listArchiveProjects } from './sync/index.js';
const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Usage: episodic-memory backfill [--dry-run] [--project <name>] [--no-index]

Distill conversations that were archived before sync started distilling them.
Drops noise records (attachments, queue operations, API request dumps,
progress), replaces images with a placeholder and trims large tool results and
tool inputs to 2 KB. Thinking and conversation text are kept whole.

Files are rewritten in place through a temp file and a rename, keeping their
modification time. Each rewritten file's index rows are removed and the file is
indexed again, because its line numbers moved.

OPTIONS:
  --dry-run           Report how many bytes would be saved; change nothing
  --project <name>    Only this archive project directory (exact name)
  --no-index          Skip re-indexing; the next 'sync' re-indexes the files

Run --dry-run first. A real run waits for no one: it refuses while a sync runs.
`);
    process.exit(0);
}
function flagValue(name) {
    const i = args.indexOf(name);
    if (i === -1)
        return undefined;
    const value = args[i + 1];
    if (value === undefined || value.startsWith('--')) {
        console.error(`${name} needs a value`);
        process.exit(2);
    }
    return value;
}
async function main() {
    const dryRun = args.includes('--dry-run');
    const project = flagValue('--project');
    const archiveDir = getArchiveDir();
    const report = await backfillArchive({ archiveDir, project, dryRun });
    console.log(formatBackfillReport(report));
    if (!dryRun && report.changed > 0 && !args.includes('--no-index')) {
        const others = new Set(listArchiveProjects(archiveDir).filter(name => project !== undefined && name !== project));
        console.log('Re-indexing rewritten conversations...');
        const result = await indexArchive(archiveDir, { skipProjects: others });
        console.log(`Indexed ${result.indexed} conversation(s).`);
        if (result.errors.length > 0) {
            for (const e of result.errors)
                console.error(`  ✗ ${e.file}: ${e.error}`);
            return 1;
        }
    }
    return report.failed.length > 0 ? 1 : 0;
}
main().then(code => process.exit(code)).catch((error) => {
    console.error(`Error: ${error.message}`);
    process.exit(1);
});
