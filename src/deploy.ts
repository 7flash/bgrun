import { getProcess, getAllProcesses, addHistoryEntry } from './db';
import { handleRun } from './commands/run';
import { $ } from 'bun';

export interface DeployResult {
    name: string;
    ok: boolean;
    skipped?: boolean;
    reason?: string;
    pullOutput?: string;
    installOutput?: string;
}

function isInternalProcess(name: string): boolean {
    return name === 'bgr-dashboard' || name === 'bgr-guard';
}

async function pathExists(path: string): Promise<boolean> {
    return await Bun.file(path).exists();
}

async function isGitRepo(dir: string): Promise<boolean> {
    return await pathExists(`${dir}/.git`) || await pathExists(`${dir}/.git/HEAD`);
}

export async function deployProcess(name: string): Promise<DeployResult> {
    const proc = getProcess(name);
    if (!proc) {
        return { name, ok: false, reason: `Process '${name}' not found` };
    }

    if (isInternalProcess(proc.name)) {
        return { name, ok: false, skipped: true, reason: 'Internal bgrun process skipped' };
    }

    const dir = proc.workdir;
    if (!(await isGitRepo(dir))) {
        return { name, ok: false, skipped: true, reason: `'${dir}' is not a git repository` };
    }

    try {
        $.cwd(dir);

        const pullOutput = (await $`git pull`.text()).trim();

        let installOutput = '';
        const hasPackageJson = await pathExists(`${dir}/package.json`);
        if (hasPackageJson) {
            installOutput = (await $`bun install`.text()).trim();
        }

        await handleRun({
            action: 'run',
            name,
            force: true,
            remoteName: '',
        });

        addHistoryEntry(name, 'deploy', proc.pid, {
            directory: dir,
            installed: hasPackageJson,
        });

        return { name, ok: true, pullOutput, installOutput };
    } catch (e: any) {
        return { name, ok: false, reason: e?.message || String(e) };
    }
}

export async function deployAllProcesses(group?: string): Promise<DeployResult[]> {
    const processes = getAllProcesses()
        .filter(proc => !isInternalProcess(proc.name))
        .filter(proc => !group || proc.group === group);

    const seen = new Set<string>();
    const results: DeployResult[] = [];

    for (const proc of processes) {
        if (seen.has(proc.name)) continue;
        seen.add(proc.name);
        results.push(await deployProcess(proc.name));
    }

    return results;
}
