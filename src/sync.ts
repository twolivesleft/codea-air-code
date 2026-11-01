import * as crypto from 'crypto';
import * as vscode from 'vscode';

import { AirCode } from './aircode';
import { LinkedProject, Links } from './links';
import { planSync } from './syncplan';

// The content hash of a file and Codea's modification time for it, when both sides last agreed
type Base = { hash: string; mtime: number };
type Bases = { [file: string]: Base };

type RemoteFile = { mtime: number };

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

    constructor(
        private readonly links: Links,
        private readonly airCode: AirCode,
        private readonly state: vscode.Memento,
        private readonly log: vscode.OutputChannel) { }

    dispose() {
        this.watchers.forEach(watcher => watcher.dispose());
        this.watchers = [];
    }

    // Pushes local edits, from VS Code or any other tool, as they land on disk
    watch() {
        this.dispose();

        for (const project of this.links.projects()) {
            const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(project.localUri, '*'));
            const onEvent = (uri: vscode.Uri) => this.fileChanged(project, uri);
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

                const remoteFiles = await this.listRemote(project);
                if (remoteFiles !== undefined) {
                    await this.syncFile(project, name, remoteFiles);
                }
            });
        }, 150));
    }

    private async syncFile(project: LinkedProject, name: string, remoteFiles: Map<string, RemoteFile>) {
        const localUri = vscode.Uri.joinPath(project.localUri, name);
        const remoteUri = this.remoteUri(project, name);
        const base = this.bases(project)[name];

        const local = await this.readLocal(project, name);
        const localHash = local && hash(local);

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
                    this.setBase(project, name, { hash: base.hash, mtime: remoteFile.mtime });
                }
                break;
            case 'record':
                this.setBase(project, name, { hash: localHash!, mtime: remoteFile!.mtime });
                break;
            case 'forget':
                this.setBase(project, name, undefined);
                break;
            case 'push':
                await this.push(project, name, local!);
                break;
            case 'pull':
                // The base is set first so the watcher sees this write as already synced
                this.setBase(project, name, { hash: remoteHash!, mtime: remoteFile!.mtime });
                await vscode.workspace.fs.writeFile(localUri, remote ?? await this.airCode.readFile(remoteUri));
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
                this.resolveConflict(project, name);
                break;
        }
    }

    private async push(project: LinkedProject, name: string, content: Uint8Array) {
        const remoteUri = this.remoteUri(project, name);
        await this.airCode.writeFile(remoteUri, content, { create: true, overwrite: true });
        const stat = await this.airCode.stat(remoteUri);
        this.setBase(project, name, { hash: hash(content), mtime: stat.mtime });
        this.log.appendLine(`Pushed ${this.describe(project, name)}`);
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

            if (choice === undefined) {
                return;
            }

            await this.enqueue(project, async () => {
                const local = await this.readLocal(project, name);
                const remoteFiles = await this.listRemote(project);
                if (remoteFiles === undefined) {
                    return;
                }
                const remoteFile = remoteFiles.get(name);

                if (choice === keepLocal) {
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
                } else {
                    this.setBase(project, name, undefined);
                    await vscode.workspace.fs.delete(localUri, { useTrash: true });
                }
            });
        } finally {
            this.conflicts.delete(key);
        }
    }

    // Runs one task at a time per project, so a save never races a sync of the same files
    private enqueue(project: LinkedProject, task: () => Promise<void>): Promise<void> {
        const key = project.localUri.toString();
        const next = (this.queues.get(key) ?? Promise.resolve())
            .then(task)
            .catch(error => {
                this.log.appendLine(`Sync of ${project.remotePath} failed: ${error}`);
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
            const entries = await this.airCode.readDirectory(projectUri);
            const files = new Map<string, RemoteFile>();
            for (const [name, type] of entries) {
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
