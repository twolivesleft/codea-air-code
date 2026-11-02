import * as crypto from 'crypto';
import * as vscode from 'vscode';

import { AirCode } from './aircode';
import { LinkedProject, Links } from './links';
import { planSync } from './syncplan';

// When both sides last agreed on a file: its content hash, Codea's modification time for it,
// and the local file's modification time and size, which spare reading it again when unchanged
type Base = { hash: string; mtime: number; localMtime?: number; localSize?: number };
type Bases = { [file: string]: Base };

type RemoteFile = { mtime: number };
type LocalStat = { mtime: number; size: number };

type Conflict = { project: LinkedProject; name: string };

function hash(content: Uint8Array): string {
    return crypto.createHash('sha1').update(content).digest('hex');
}

// Files of a project that are not synced: hidden files, and the Dependencies folder Air Code lists
function isSynced(name: string, type: vscode.FileType): boolean {
    return type === vscode.FileType.File && !name.startsWith('.');
}

export class LinkSync {
    private watchers: vscode.Disposable[] = [];
    private queues = new Map<string, Promise<void>>();
    private pendingFiles = new Map<string, NodeJS.Timeout>();
    private conflicts = new Set<string>();
    private running = 0;

    // While syncing many projects at once, conflicts are gathered and asked about together
    private gatheredConflicts: Conflict[] | undefined;

    private _onDidChangeBusy = new vscode.EventEmitter<boolean>();
    onDidChangeBusy = this._onDidChangeBusy.event;

    constructor(
        private readonly links: Links,
        private readonly airCode: AirCode,
        private readonly state: vscode.Memento,
        private readonly log: vscode.OutputChannel) { }

    dispose() {
        this.watchers.forEach(watcher => watcher.dispose());
        this.watchers = [];
    }

    // Pushes local edits, from VS Code or any other tool, as they land on disk. One watcher per
    // workspace folder serves all of its linked projects, however many there are.
    watch() {
        this.dispose();

        const folders = new Set(this.links.projects()
            .map(project => vscode.workspace.getWorkspaceFolder(project.localUri))
            .filter((folder): folder is vscode.WorkspaceFolder => folder !== undefined));

        for (const folder of folders) {
            const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, '**/*'));
            const onEvent = (uri: vscode.Uri) => {
                const found = this.links.find(uri);
                if (found && !found[1].includes('/')) {
                    this.fileChanged(found[0], uri);
                }
            };
            watcher.onDidCreate(onEvent);
            watcher.onDidChange(onEvent);
            watcher.onDidDelete(onEvent);
            this.watchers.push(watcher);
        }
    }

    async syncAll() {
        for (const project of this.links.projects()) {
            await this.sync(project);
        }
    }

    // Syncs projects one after the other with a progress notification, then asks about all the
    // files that differ on both sides at once
    async syncMany(projects: LinkedProject[], title: string) {
        this.gatheredConflicts = [];
        try {
            await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title, cancellable: true },
                async (progress, token) => {
                    for (const [index, project] of projects.entries()) {
                        if (token.isCancellationRequested) {
                            this.log.appendLine(`Stopped after ${index} of ${projects.length} projects; the others sync when Codea next connects.`);
                            break;
                        }
                        progress.report({
                            message: `${index + 1} of ${projects.length}: ${project.remotePath.split('/').pop()}`,
                            increment: 100 / projects.length,
                        });
                        await this.sync(project);
                    }
                });
        } finally {
            const conflicts = this.gatheredConflicts;
            this.gatheredConflicts = undefined;
            await this.resolveConflicts(conflicts);
        }
    }

    // Waits for the syncs already queued for a project
    async idle(project: LinkedProject) {
        await this.queues.get(project.localUri.toString());
    }

    // Brings both sides of a project up to date, asking about files changed on both
    sync(project: LinkedProject): Promise<void> {
        return this.enqueue(project, async () => {
            const remoteFiles = await this.listRemote(project);
            if (remoteFiles === undefined) {
                return;
            }

            const localNames = await this.listLocal(project);
            const bases = this.bases(project);
            const names = new Set([...localNames, ...remoteFiles.keys(), ...Object.keys(bases)]);

            for (const name of [...names].sort()) {
                await this.syncFile(project, name, remoteFiles);
            }
        });
    }

    private fileChanged(project: LinkedProject, uri: vscode.Uri) {
        const name = uri.path.split('/').pop()!;
        if (name.startsWith('.')) {
            return;
        }

        // Editors save in several steps, so wait for the file to settle
        const key = uri.toString();
        clearTimeout(this.pendingFiles.get(key));
        this.pendingFiles.set(key, setTimeout(() => {
            this.pendingFiles.delete(key);
            this.enqueue(project, async () => {
                const local = await this.readLocal(project, name);
                const base = this.bases(project)[name];
                if (local !== undefined && base?.hash === hash(local)) {
                    return;
                }

                await this.syncNamed(project, [name]);
            });
        }, 150));
    }

    // Brings the named files of a project up to date, for changes Codea reported or a file opened here
    syncFiles(project: LinkedProject, names: string[]): Promise<void> {
        return this.enqueue(project, () => this.syncNamed(project, names));
    }

    // Projects of filesChanged paths, e.g. "/Codea/Documents/Project"
    remoteFilesChanged(path: string, files: string[]) {
        for (const project of this.links.projects()) {
            if (path === `/${AirCode.rootFolder}/${project.remotePath}`) {
                this.syncFiles(project, files.filter(name => !name.startsWith('.')));
            }
        }
    }

    private async syncNamed(project: LinkedProject, names: string[]) {
        const projectUri = this.links.remoteProjectUri(project);
        if (projectUri === undefined) {
            return;
        }

        try {
            await this.airCode.ensureResponsive(projectUri);
        } catch (error) {
            this.log.appendLine(`Could not reach Codea for ${project.remotePath}: ${error}`);
            return;
        }

        const remoteFiles = new Map<string, RemoteFile>();
        for (const name of names) {
            try {
                const stat = await this.airCode.stat(vscode.Uri.joinPath(projectUri, name));
                if (stat.type === vscode.FileType.File) {
                    remoteFiles.set(name, { mtime: stat.mtime });
                }
            } catch (error) {
                if (!(error instanceof vscode.FileSystemError && error.code === 'FileNotFound')) {
                    throw error;
                }
            }
        }

        for (const name of names) {
            await this.syncFile(project, name, remoteFiles);
        }
    }

    private async syncFile(project: LinkedProject, name: string, remoteFiles: Map<string, RemoteFile>) {
        const localUri = vscode.Uri.joinPath(project.localUri, name);
        const remoteUri = this.remoteUri(project, name);
        const base = this.bases(project)[name];

        const localStat = await this.statLocal(localUri);
        let local: Uint8Array | undefined;
        let localHash: string | undefined;
        if (localStat !== undefined) {
            if (base !== undefined && base.localMtime === localStat.mtime && base.localSize === localStat.size) {
                localHash = base.hash;
            } else {
                local = await this.readLocal(project, name);
                localHash = local && hash(local);
            }
        }

        const remoteFile = remoteFiles.get(name);
        let remote: Uint8Array | undefined;
        let remoteHash: string | undefined;
        if (remoteFile !== undefined) {
            if (base !== undefined && base.mtime === remoteFile.mtime) {
                remoteHash = base.hash;
            } else {
                remote = await this.airCode.readFile(remoteUri);
                remoteHash = hash(remote);
            }
        }

        const action = planSync(localHash, remoteHash, base?.hash);
        switch (action) {
            case 'none':
                if (remoteFile !== undefined && base !== undefined && base.mtime !== remoteFile.mtime) {
                    this.setBase(project, name, { ...base, mtime: remoteFile.mtime });
                }
                if (local !== undefined && base !== undefined) {
                    await this.recordLocal(project, name);
                }
                break;
            case 'record':
                this.setBase(project, name, { hash: localHash!, mtime: remoteFile!.mtime });
                await this.recordLocal(project, name);
                break;
            case 'forget':
                this.setBase(project, name, undefined);
                break;
            case 'push':
                await this.push(project, name, local ?? (await this.readLocal(project, name))!);
                break;
            case 'pull':
                // The base is set first so the watcher sees this write as already synced
                this.setBase(project, name, { hash: remoteHash!, mtime: remoteFile!.mtime });
                await vscode.workspace.fs.writeFile(localUri, remote ?? await this.airCode.readFile(remoteUri));
                await this.recordLocal(project, name);
                this.log.appendLine(`Pulled ${this.describe(project, name)}`);
                break;
            case 'deleteLocal':
                this.setBase(project, name, undefined);
                await vscode.workspace.fs.delete(localUri, { useTrash: true });
                this.log.appendLine(`Deleted ${this.describe(project, name)} here, as it was deleted in Codea`);
                break;
            case 'deleteRemote':
                this.setBase(project, name, undefined);
                await this.airCode.delete(remoteUri, { recursive: false });
                this.log.appendLine(`Deleted ${this.describe(project, name)} in Codea`);
                break;
            case 'conflict':
                if (this.gatheredConflicts) {
                    this.gatheredConflicts.push({ project, name });
                } else {
                    this.resolveConflict(project, name);
                }
                break;
        }
    }

    private async push(project: LinkedProject, name: string, content: Uint8Array) {
        const remoteUri = this.remoteUri(project, name);
        await this.airCode.writeFile(remoteUri, content, { create: true, overwrite: true });
        const stat = await this.airCode.stat(remoteUri);
        this.setBase(project, name, { hash: hash(content), mtime: stat.mtime });
        await this.recordLocal(project, name);
        this.log.appendLine(`Pushed ${this.describe(project, name)}`);
    }

    // Asks once about many files that differ on both sides, with the choice of going through them
    private async resolveConflicts(conflicts: Conflict[]) {
        if (conflicts.length === 0) {
            return;
        }
        if (conflicts.length === 1) {
            await this.resolveConflict(conflicts[0].project, conflicts[0].name);
            return;
        }

        const keepLocal = 'Keep Local for All';
        const keepCodea = 'Keep Codea for All';
        const review = 'Review Each';
        const choice = await vscode.window.showWarningMessage(
            `${conflicts.length} files differ between this folder and Codea.`,
            { modal: true, detail: conflicts.map(({ project, name }) => this.describe(project, name)).join('\n') },
            keepLocal, keepCodea, review);

        if (choice === review) {
            for (const { project, name } of conflicts) {
                this.resolveConflict(project, name);
            }
        } else if (choice !== undefined) {
            for (const { project, name } of conflicts) {
                await this.enqueue(project, () => this.keep(project, name, choice === keepLocal ? 'local' : 'codea'));
            }
        }
    }

    // Asks which side to keep; leaving the question unanswered leaves both sides as they are
    private async resolveConflict(project: LinkedProject, name: string) {
        const key = `${project.localUri.toString()}/${name}`;
        if (this.conflicts.has(key)) {
            return;
        }
        this.conflicts.add(key);

        const localUri = vscode.Uri.joinPath(project.localUri, name);
        const remoteUri = this.remoteUri(project, name);
        const keepLocal = 'Keep Local';
        const keepCodea = 'Keep Codea';
        const compare = 'Compare';

        try {
            let choice: string | undefined = compare;
            while (choice === compare) {
                choice = await vscode.window.showWarningMessage(
                    `${this.describe(project, name)} has changed both here and in Codea.`, keepLocal, keepCodea, compare);
                if (choice === compare) {
                    await vscode.commands.executeCommand('vscode.diff', remoteUri, localUri, `${name} (Codea ↔ Local)`);
                }
            }

            if (choice !== undefined) {
                await this.enqueue(project, () => this.keep(project, name, choice === keepLocal ? 'local' : 'codea'));
            }
        } finally {
            this.conflicts.delete(key);
        }
    }

    private async keep(project: LinkedProject, name: string, side: 'local' | 'codea') {
        const localUri = vscode.Uri.joinPath(project.localUri, name);
        const remoteUri = this.remoteUri(project, name);
        const local = await this.readLocal(project, name);
        let remoteFile: RemoteFile | undefined;
        try {
            const stat = await this.airCode.stat(remoteUri);
            remoteFile = { mtime: stat.mtime };
        } catch (error) {
            if (!(error instanceof vscode.FileSystemError && error.code === 'FileNotFound')) {
                throw error;
            }
        }

        if (side === 'local') {
            if (local !== undefined) {
                await this.push(project, name, local);
            } else {
                this.setBase(project, name, undefined);
                await this.airCode.delete(remoteUri, { recursive: false });
            }
        } else if (remoteFile !== undefined) {
            const remote = await this.airCode.readFile(remoteUri);
            this.setBase(project, name, { hash: hash(remote), mtime: remoteFile.mtime });
            await vscode.workspace.fs.writeFile(localUri, remote);
            await this.recordLocal(project, name);
        } else {
            this.setBase(project, name, undefined);
            await vscode.workspace.fs.delete(localUri, { useTrash: true });
        }
    }

    // Runs one task at a time per project, so a save never races a sync of the same files
    private enqueue(project: LinkedProject, task: () => Promise<void>): Promise<void> {
        const key = project.localUri.toString();
        if (this.running++ === 0) {
            this._onDidChangeBusy.fire(true);
        }
        const next = (this.queues.get(key) ?? Promise.resolve())
            .then(task)
            .catch(error => {
                this.log.appendLine(`Sync of ${project.remotePath} failed: ${error}`);
            })
            .finally(() => {
                if (--this.running === 0) {
                    this._onDidChangeBusy.fire(false);
                }
            });
        this.queues.set(key, next);
        return next;
    }

    // Undefined when Codea cannot be reached, so a lost connection never reads as deleted files
    private async listRemote(project: LinkedProject): Promise<Map<string, RemoteFile> | undefined> {
        const projectUri = this.links.remoteProjectUri(project);
        if (projectUri === undefined) {
            return undefined;
        }

        try {
            await this.airCode.ensureResponsive(projectUri);
            const files = new Map<string, RemoteFile>();

            if (this.airCode.listsFileVersions) {
                for (const version of await this.airCode.listFileVersions(projectUri)) {
                    files.set(version.name, { mtime: version.mtime });
                }
                return files;
            }

            // Older versions of Codea are asked about each file in turn
            for (const [name, type] of await this.airCode.readDirectory(projectUri)) {
                if (isSynced(name, type)) {
                    const stat = await this.airCode.stat(vscode.Uri.joinPath(projectUri, name));
                    files.set(name, { mtime: stat.mtime });
                }
            }
            return files;
        } catch (error) {
            this.log.appendLine(`Could not list ${project.remotePath} in Codea: ${error}`);
            return undefined;
        }
    }

    private async listLocal(project: LinkedProject): Promise<string[]> {
        try {
            const entries = await vscode.workspace.fs.readDirectory(project.localUri);
            return entries.filter(([name, type]) => isSynced(name, type)).map(([name]) => name);
        } catch {
            return [];
        }
    }

    private async statLocal(uri: vscode.Uri): Promise<LocalStat | undefined> {
        try {
            const stat = await vscode.workspace.fs.stat(uri);
            return stat.type === vscode.FileType.File ? { mtime: stat.mtime, size: stat.size } : undefined;
        } catch {
            return undefined;
        }
    }

    // Remembers the local file as it is now, once its base is set
    private async recordLocal(project: LinkedProject, name: string) {
        const base = this.bases(project)[name];
        const stat = await this.statLocal(vscode.Uri.joinPath(project.localUri, name));
        if (base !== undefined && stat !== undefined) {
            this.setBase(project, name, { ...base, localMtime: stat.mtime, localSize: stat.size });
        }
    }

    private async readLocal(project: LinkedProject, name: string): Promise<Uint8Array | undefined> {
        try {
            return await vscode.workspace.fs.readFile(vscode.Uri.joinPath(project.localUri, name));
        } catch {
            return undefined;
        }
    }

    private remoteUri(project: LinkedProject, name: string): vscode.Uri {
        return vscode.Uri.joinPath(this.links.remoteProjectUri(project)!, name);
    }

    private describe(project: LinkedProject, name: string): string {
        return `${project.remotePath.split('/').pop()}/${name}`;
    }

    private stateKey(project: LinkedProject): string {
        return `sync:${project.localUri.toString()}:${project.remotePath}`;
    }

    private bases(project: LinkedProject): Bases {
        return this.state.get<Bases>(this.stateKey(project)) ?? {};
    }

    private setBase(project: LinkedProject, name: string, base: Base | undefined) {
        const bases = { ...this.bases(project) };
        if (base === undefined) {
            delete bases[name];
        } else {
            bases[name] = base;
        }
        this.state.update(this.stateKey(project), bases);
    }
}
