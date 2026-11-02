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

