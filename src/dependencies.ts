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


// The projects a project's code requires: require(asset.documents.Common) is Common in Documents,
// require(asset.documents["iPad Projects"].Common) is Common in the iPad Projects collection
export function requiredIn(source: string): { collection: string, project: string }[] {
    const required: { collection: string, project: string }[] = [];
    for (const [, keys] of source.matchAll(/require\s*\(\s*asset\s*\.\s*documents((?:\s*(?:\.\s*[A-Za-z_]\w*|\[\s*(?:"[^"]*"|'[^']*')\s*\]))+)/g)) {
        const names = [...keys.matchAll(/\.\s*([A-Za-z_]\w*)|\[\s*(?:"([^"]*)"|'([^']*)')\s*\]/g)].map(([, name, double, single]) => name ?? double ?? single);
        if (names.length === 1) {
            required.push({ collection: 'Documents', project: names[0] });
        } else if (names.length === 2) {
            required.push({ collection: names[0], project: names[1] });
        }
    }
    return required;
}
