
function formatEnvKey(key: string): string {
    return key.toUpperCase().replace(/\./g, '_');
}

function flattenConfig(obj: any, prefix = ''): Record<string, string> {
    return Object.keys(obj).reduce((acc: Record<string, string>, key: string) => {
        const value = obj[key];
        const newPrefix = prefix ? `${prefix}.${key}` : key;

        if (Array.isArray(value)) {
            value.forEach((item, index) => {
                const indexedPrefix = `${newPrefix}.${index}`;
                if (typeof item === 'object' && item !== null) {
                    Object.assign(acc, flattenConfig(item, indexedPrefix));
                } else {
                    acc[formatEnvKey(indexedPrefix)] = String(item);
                }
            });
        } else if (typeof value === 'object' && value !== null) {
            Object.assign(acc, flattenConfig(value, newPrefix));
        } else {
            acc[formatEnvKey(newPrefix)] = String(value);
        }
        return acc;
    }, {});
}


export async function parseConfigFile(configPath: string): Promise<Record<string, string>> {
    // @note t suffix solves caching issue with env variables when using --watch flag
    const importPath = `${configPath}?t=${Date.now()}`;
    const parsedConfig = await import(importPath).then(m => m.default);
    return flattenConfig(parsedConfig);
}

export async function loadConfigEnv(directory: string, configPath = '.config.toml'): Promise<{
    configEnv: Record<string, string>;
    fullConfigPath: string;
    exists: boolean;
}> {
    const { join } = await import('path');
    const fullConfigPath = join(directory, configPath);

    if (!(await Bun.file(fullConfigPath).exists())) {
        return {
            configEnv: {},
            fullConfigPath,
            exists: false,
        };
    }

    return {
        configEnv: await parseConfigFile(fullConfigPath),
        fullConfigPath,
        exists: true,
    };
}
