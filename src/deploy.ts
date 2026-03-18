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

export type PackageManager = 'bun' | 'pnpm' | 'yarn' | 'npm' | null;

function isInternalProcess(name: string): boolean {
    return name === 'bgr-dashboard' || name === 'bgr-guard';
}

async function pathExists(path: string): Promise<boolean> {
    return await Bun.file(path).exists();
}

async function isGitRepo(dir: string): Promise<boolean> {
    return await pathExists(`${dir}/.git`) || await pathExists(`${dir}/.git/HEAD`);
}

export async function detectPackageManager(dir: string): Promise<PackageManager> {
    const hasPackageJson = await pathExists(`${dir}/package.json`);
    if (!hasPackageJson) return null;

    if (await pathExists(`${dir}/bun.lock`) || await pathExists(`${dir}/bun.lockb`)) return 'bun';
    if (await pathExists(`${dir}/pnpm-lock.yaml`)) return 'pnpm';
    if (await pathExists(`${dir}/yarn.lock`)) return 'yarn';
    if (await pathExists(`${dir}/package-lock.json`) || await pathExists(`${dir}/npm-shrinkwrap.json`)) return 'npm';

    return 'bun';
}

async function installDependencies(dir: string): Promise<{ manager: PackageManager; output: string }> {
    const manager = await detectPackageManager(dir);
    if (!manager) return { manager: null, output: '' };

    $.cwd(dir);

    switch (manager) {
        case 'bun':
            return { manager, output: (await $`bun install`.text()).trim() };
        case 'pnpm':
            return { manager, output: (await $`pnpm install --frozen-lockfile`.text()).trim() };
        case 'yarn':
            return { manager, output: (await $`yarn install --frozen-lockfile`.text()).trim() };
        case 'npm':
            return { manager, output: (await $`npm ci`.text()).trim() };
        default:
            return { manager: null, output: '' };
    }
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

        const install = await installDependencies(dir);
        const installOutput = install.output;

        await handleRun({
            action: 'run',
            name,
            force: true,
            remoteName: '',
        });

        addHistoryEntry(name, 'deploy', proc.pid, {
            directory: dir,
            installed: Boolean(install.manager),
            packageManager: install.manager,
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
