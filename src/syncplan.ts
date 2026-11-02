// What to do with one file of a linked project, given the hash of its content
// on each side and the hash both sides had when they were last in sync.
export type SyncAction =
    | 'none'
    | 'record'        // both sides agree, remember it as the new base
    | 'forget'        // gone on both sides
    | 'push'
    | 'pull'
    | 'deleteLocal'
    | 'deleteRemote'
    | 'conflict';

export function planSync(local: string | undefined, remote: string | undefined, base: string | undefined): SyncAction {
    if (local === undefined && remote === undefined) {
        return base === undefined ? 'none' : 'forget';
    }

    if (local === remote) {
        return base === local ? 'none' : 'record';
    }

    if (remote === undefined) {
        if (base === undefined) {
            return 'push';
        }
        return base === local ? 'deleteLocal' : 'conflict';
    }

    if (local === undefined) {
        if (base === undefined) {
            return 'pull';
        }
        return base === remote ? 'deleteRemote' : 'conflict';
    }

    if (base === local) {
        return 'pull';
    }
    if (base === remote) {
        return 'push';
    }
    return 'conflict';
}

// What started a sync, which decides whether it may delete:
// - 'local': a change on disk the file watcher saw happen
// - 'remote': a change Codea reported
// - 'full': comparing everything, on connecting, reloading or linking
export type SyncSource = 'local' | 'remote' | 'full';

// A deletion is only passed on when it was seen happening on the side it came from. Otherwise
// a full sync brings the file back from the other side: a folder emptied while VS Code was
// closed, or a project not yet downloaded, must never empty the other side. A change reported
// by Codea leaves a file missing here alone: the local deletion may simply not have been seen
// yet, and is passed on when it is.
export function guardDeletion(action: SyncAction, source: SyncSource): SyncAction {
    if (action === 'deleteRemote' && source !== 'local') {
        return source === 'remote' ? 'none' : 'pull';
    }
    if (action === 'deleteLocal' && source !== 'remote') {
        return 'push';
    }
    return action;
}

// A list for a dialog's detail: the first items, then how many more there are
export function shortList(items: string[], count: number): string {
    if (items.length <= count) {
        return items.join('\n');
    }
    return [...items.slice(0, count), `and ${items.length - count} more, all listed in the Codea output`].join('\n');
}
