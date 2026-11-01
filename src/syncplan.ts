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
