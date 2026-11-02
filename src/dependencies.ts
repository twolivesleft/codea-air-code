// A project's dependencies, from its Info.plist, where each is written "Collection:Project", or
// by the project's name alone when added over Air Code
export function dependenciesIn(plist: string): { collection: string | undefined, project: string }[] {
    const list = /<key>Dependencies<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(plist);
    if (list === null) {
        return [];
    }
    return [...list[1].matchAll(/<string>([^<]*)<\/string>/g)].map(([, entry]) => {
        const separator = entry.indexOf(':');
        return separator < 0
            ? { collection: undefined, project: entry }
            : { collection: entry.slice(0, separator), project: entry.slice(separator + 1) };
    });
}

// A dependency's file as Codea names it while running the project that depends on it:
// "/Codea/Collection/Game/Dependencies/Common/File.lua", in iCloud "/Codea/iCloud/Collection/..."
export function dependencyFile(path: string): { dependent: string, dependency: string, file: string } | undefined {
    const match = /\/Codea\/((?:iCloud\/)?[^/]+\/[^/]+)\/Dependencies\/([^/]+)\/(.+)$/.exec(path);
    if (match === null || match[1].startsWith('iCloud/') && match[1].split('/').length !== 3) {
        return undefined;
    }
    return { dependent: match[1], dependency: match[2], file: match[3] };
}

// The asset keys a modern project requires, as their parts after "asset":
// require(asset.documents["iPad Projects"].Common) gives ["documents", "iPad Projects", "Common"]
export function requiredAssets(source: string): string[][] {
    const keys: string[][] = [];
    for (const [, key] of source.matchAll(/\brequire\s*\(\s*asset((?:\s*\.\s*[A-Za-z_][A-Za-z0-9_]*|\s*\[\s*(?:"[^"]*"|'[^']*')\s*\])+)\s*\)/g)) {
        keys.push([...key.matchAll(/\.\s*([A-Za-z_][A-Za-z0-9_]*)|\[\s*(?:"([^"]*)"|'([^']*)')\s*\]/g)]
            .map(([, name, double, single]) => name ?? double ?? single));
    }
    return keys;
}

// The require statement Codea writes for a project, from its path under /Codea
export function requireOf(remotePath: string): string {
    const part = (name: string) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? `.${name}` : `["${name}"]`;
    const parts = remotePath.split('/');
    const root = parts[0] === 'iCloud' ? 'icloud' : 'documents';
    const inRoot = parts[0] === 'iCloud' ? parts.slice(1) : parts[0] === 'Documents' ? parts.slice(1) : parts;
    return `require(asset.${root}${inRoot.map(part).join('')})`;
}

// A project's source without its require statements of one asset key
export function withoutRequire(source: string, key: string[]): string {
    return source.split('\n').filter(line => {
        const required = requiredAssets(line);
        return !(required.length === 1 && line.trim().startsWith('require') && JSON.stringify(required[0]) === JSON.stringify(key));
    }).join('\n');
}

// A legacy project's Info.plist without one of its dependencies, written "Collection:Project" or by
// the project's name alone
export function withoutDependency(plist: string, collection: string | undefined, project: string): string {
    return plist.replace(/(<key>Dependencies<\/key>\s*<array>)([\s\S]*?)(<\/array>)/, (_, open, entries: string, close) =>
        open + entries.replace(/\n?[ \t]*<string>([^<]*)<\/string>/g, (entry, name: string) =>
            name === project || name === `${collection}:${project}` ? '' : entry) + close);
}
