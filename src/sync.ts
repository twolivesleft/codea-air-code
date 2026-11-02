import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import { AirCode } from './aircode';
import { LinkedProject, Links } from './links';
import { renameInBufferOrder } from './bufferorder';
import { guardDeletion, planSync, shortList, SyncSource } from './syncplan';

// When both sides last agreed on a file: its content hash, Codea's modification time for it,
// and the local file's modification time and size, which spare reading it again when unchanged
type Base = { hash: string; mtime: number; localMtime?: number; localSize?: number };
type Bases = { [file: string]: Base };

type RemoteFile = { mtime: number };
type LocalStat = { mtime: number; size: number };

type Conflict = { project: LinkedProject; name: string };

// Deleting more files than this at once asks before they are deleted in Codea
const deletionsWithoutAsking = 5;

// Codea refuses to delete these, so deleting them here would only lose them here
const keptFiles = ['Main.lua', 'Info.plist'];

// A modal dialog taller than the screen hides its buttons, so its detail lists only this many
const itemsInDialog = 12;

// What each linked project's files were when both sides last agreed, kept in a file per project
// and saved within moments of each change: VS Code's own state is saved later, and lost if VS
// Code is killed, which would make every file edited since look like a conflict.
class BaseStore {
    private cache = new Map<string, Bases>();
    private dirty = new Set<string>();
    private timer: NodeJS.Timeout | undefined;

    constructor(private readonly folder: string) { }

    get(key: string): Bases {
        let bases = this.cache.get(key);
        if (bases === undefined) {
            try {
                bases = JSON.parse(fs.readFileSync(this.file(key), 'utf8')) as Bases;
            } catch {
                bases = {};
            }
            this.cache.set(key, bases);
        }
        return bases;
    }

    set(key: string, bases: Bases | undefined) {
        this.cache.set(key, bases ?? {});
        this.dirty.add(key);
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.save(), 500);
    }

    save() {
        fs.mkdirSync(this.folder, { recursive: true });
        for (const key of this.dirty) {
            const bases = this.cache.get(key) ?? {};
            if (Object.keys(bases).length === 0) {
                fs.rmSync(this.file(key), { force: true });
            } else {
                fs.writeFileSync(this.file(key), JSON.stringify(bases));
            }
        }
        this.dirty.clear();
    }

    private file(key: string): string {
        return path.join(this.folder, crypto.createHash('sha1').update(key).digest('hex') + '.json');
    }
}

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

    // Local deletions seen in the last moment, passed on together once they settle
    private pendingDeletions = new Map<string, { project: LinkedProject, name: string }>();
    private deletionTimer: NodeJS.Timeout | undefined;

    // Folders being renamed in VS Code. Until their links follow, the old folder going is not a
    // deletion, and the projects in them are not synced.
    private renaming = new Set<string>();

    // Files pushed in the last moments, by project, to tell a renamed tab from a deleted one
    private recentPushes = new Map<string, { name: string, hash: string, time: number }[]>();

    // Linked projects found missing on one side, which are not synced until asked about
    private missingLocally = new Map<string, LinkedProject>();
    private missingInCodea = new Map<string, LinkedProject>();
    private askingAboutMissing = false;

    // Files a full sync brought back to the side missing them, reported once it is done
    private broughtBack: string[] = [];

    private _onDidChangeBusy = new vscode.EventEmitter<boolean>();
    onDidChangeBusy = this._onDidChangeBusy.event;

    constructor(
        private readonly links: Links,
        private readonly airCode: AirCode,
        private readonly store: BaseStore,
        private readonly log: vscode.OutputChannel) { }

    static storeIn(folder: string): BaseStore {
        return new BaseStore(folder);
    }

    // Saves the sync records now, as when the extension is deactivated
    flush() {
        this.store.save();
    }

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
                if (found && this.isSyncedName(found[1]) && !this.isRenaming(uri.path)) {
                    this.fileChanged(found[0], found[1]);
                }
            };
            watcher.onDidCreate(onEvent);
            watcher.onDidChange(onEvent);
            watcher.onDidDelete(uri => this.deleted(uri));
            this.watchers.push(watcher);
        }
    }

    async syncAll() {
        for (const project of this.links.projects()) {
            await this.sync(project);
        }
        await this.reportFullSync();
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
            await this.reportFullSync();
        }
    }

    // Waits for the syncs already queued for a project
    async idle(project: LinkedProject) {
        await this.queues.get(project.localUri.toString());
    }

    // Brings both sides of a project up to date, asking about files changed on both. It never
    // deletes: a file missing on one side is brought back, and a project missing on one side is
    // left alone until asked about.
    sync(project: LinkedProject): Promise<void> {
        return this.enqueue(project, async () => {
            if (this.airCode.disconnected || this.isRenaming(project.localUri.path)) {
                return;
            }
            const key = project.localUri.toString();
            if (!await this.localFolderExists(project)) {
                this.missingLocally.set(key, project);
                return;
            }
            this.missingLocally.delete(key);

            const remoteFiles = await this.listRemote(project);
            if (remoteFiles === 'missing') {
                this.missingInCodea.set(key, project);
                return;
            }
            this.missingInCodea.delete(key);
            if (remoteFiles === undefined) {
                return;
            }

            const localNames = await this.listLocal(project);
            const bases = this.bases(project);
            const names = new Set([...localNames, ...remoteFiles.keys(), ...Object.keys(bases)]);

            for (const name of [...names].sort()) {
                await this.syncFile(project, name, remoteFiles, 'full');
            }
        });
    }

    // Files in folders inside a project only with a Codea that keeps them; hidden ones never
    private isSyncedName(name: string): boolean {
        return !name.split('/').some(part => part.startsWith('.')) && (this.airCode.listsSubfolders || !name.includes('/'));
    }

    private fileChanged(project: LinkedProject, name: string) {
        // Editors save in several steps, so wait for the file to settle
        const key = vscode.Uri.joinPath(project.localUri, name).toString();
        clearTimeout(this.pendingFiles.get(key));
        this.pendingFiles.set(key, setTimeout(() => {
            this.pendingFiles.delete(key);
            this.enqueue(project, async () => {
                // Deletions are passed on by deleted() only
                const local = await this.readLocal(project, name);
                if (local === undefined || this.bases(project)[name]?.hash === hash(local)) {
                    return;
                }

                await this.syncNamed(project, [name], 'local');
            });
        }, 150));
    }

    // A file or folder deleted on disk. Files are passed on together once deletions settle; a
    // linked project's folder, or a folder holding some, counts as those projects going missing.
    private deleted(uri: vscode.Uri) {
        // Connect compares everything and asks then
        if (this.airCode.disconnected || this.isRenaming(uri.path)) {
            return;
        }
        const folderPath = uri.path.replace(/\/$/, '');
        const projects = this.links.projects().filter(project =>
            project.localUri.path === folderPath || project.localUri.path.startsWith(folderPath + '/'));
        if (projects.length > 0) {
            for (const project of projects) {
                this.missingLocally.set(project.localUri.toString(), project);
            }
            this.askAboutMissingProjects();
            return;
        }

        const found = this.links.find(uri);
        if (found === undefined || !this.isSyncedName(found[1])) {
            return;
        }
        // A folder inside a project: its files that were synced are what was deleted
        const [project, name] = found;
        const inFolder = Object.keys(this.bases(project)).filter(file => file.startsWith(`${name}/`));
        for (const file of inFolder.length > 0 ? inFolder : [name]) {
            this.pendingDeletions.set(vscode.Uri.joinPath(project.localUri, file).toString(), { project, name: file });
        }
        clearTimeout(this.deletionTimer);
        this.deletionTimer = setTimeout(() => this.passOnDeletions(), 1500);
    }

    private async passOnDeletions() {
        const deletions = [...this.pendingDeletions.values()];
        this.pendingDeletions.clear();

        // Files of a project whose whole folder went are not deletions of those files
        let files: typeof deletions = [];
        for (const deletion of deletions) {
            if (await this.localFolderExists(deletion.project)) {
                files.push(deletion);
            } else {
                this.missingLocally.set(deletion.project.localUri.toString(), deletion.project);
            }
        }
        if (this.missingLocally.size > 0) {
            this.askAboutMissingProjects();
        }
        if (files.length === 0) {
            return;
        }

        const kept = files.filter(({ name }) => keptFiles.includes(name));
        if (kept.length > 0) {
            vscode.window.showWarningMessage(
                `Codea projects need ${kept.map(({ name }) => name).filter((name, i, all) => all.indexOf(name) === i).join(' and ')}, so ${kept.length === 1 ? "it was" : "they were"} put back.`);
            for (const { project, name } of kept) {
                await this.syncFiles(project, [name], 'full');
            }
            files = files.filter(file => !kept.includes(file));
            if (files.length === 0) {
                return;
            }
        }

        // A Codea that keeps no folders inside projects would lose a tab moved into one
        if (!this.airCode.listsSubfolders) {
            const moved = await this.movedIntoFolders(files);
            if (moved.length > 0) {
                vscode.window.showWarningMessage(
                    `This version of Codea cannot keep folders inside a project, so ${moved.map(({ project, name }) => this.describe(project, name)).join(', ')} ${moved.length === 1 ? "was" : "were"} put back here and left in Codea. Update Codea to sync folders.`);
                for (const { project, name } of moved) {
                    await this.syncFiles(project, [name], 'full');
                }
                files = files.filter(file => !moved.includes(file));
                if (files.length === 0) {
                    return;
                }
            }
        }

        let source: SyncSource = 'local';
        if (files.length > deletionsWithoutAsking) {
            const deleteInCodea = 'Delete in Codea';
            const question = `${files.length} files were deleted from linked projects. Delete them in Codea too?`;
            this.log.appendLine(question);
            const choice = await vscode.window.showWarningMessage(
                question,
                { modal: true, detail: this.listForDialog('Deleted locally:', files.map(({ project, name }) => this.describe(project, name))) },
                deleteInCodea, 'Restore Them Here');
            // Anything but an explicit yes brings the files back
            source = choice === deleteInCodea ? 'local' : 'full';
        }

        if (source === 'local') {
            for (const { project, name } of files) {
                await this.keepTabPlaceOfRename(project, name);
            }
        }

        const byProject = new Map<string, { project: LinkedProject, names: string[] }>();
        for (const { project, name } of files) {
            const key = project.localUri.toString();
            const entry = byProject.get(key) ?? { project, names: [] };
            entry.names.push(name);
            byProject.set(key, entry);
        }
        for (const { project, names } of byProject.values()) {
            await this.syncFiles(project, names, source);
        }
    }

    // Asks once what to do with linked projects missing on one side. Until then they are not synced.
    private async askAboutMissingProjects() {
        if (this.askingAboutMissing) {
            return;
        }
        this.askingAboutMissing = true;
        try {
            // Let a folder deletion finish before asking about it
            await new Promise(resolve => setTimeout(resolve, 1500));

            if (this.missingLocally.size > 0) {
                const projects = [...this.missingLocally.values()];
                const getAgain = 'Get Them Again';
                const unlink = 'Unlink Them';
                const question = projects.length === 1
                    ? `The linked project ${projects[0].remotePath} is missing from this folder. Nothing was changed in Codea.`
                    : `${projects.length} linked projects are missing from this folder. Nothing was changed in Codea.`;
                this.log.appendLine(question);
                const choice = await vscode.window.showWarningMessage(
                    question,
                    { modal: true, detail: `${this.listForDialog('Missing from this folder:', projects.map(project => project.remotePath))}\n\nTo delete a project in Codea, use Delete Project in Codea on its folder or in the Projects view.` },
                    getAgain, unlink);
                this.missingLocally.clear();
                if (choice === getAgain) {
                    for (const project of projects) {
                        await vscode.workspace.fs.createDirectory(project.localUri);
                        await this.sync(project);
                    }
                    await this.reportFullSync();
                } else if (choice === unlink) {
                    await this.unlink(projects);
                }
            }

            if (this.missingInCodea.size > 0) {
                const projects = [...this.missingInCodea.values()];
                const unlink = 'Unlink Them';
                const question = projects.length === 1
                    ? `The linked project ${projects[0].remotePath} is missing in Codea. Its folder here was left as it is.`
                    : `${projects.length} linked projects are missing in Codea. Their folders here were left as they are.`;
                this.log.appendLine(question);
                const choice = await vscode.window.showWarningMessage(
                    question,
                    { modal: true, detail: this.listForDialog('Missing in Codea:', projects.map(project => project.remotePath)) },
                    unlink);
                this.missingInCodea.clear();
                if (choice === unlink) {
                    await this.unlink(projects);
                }
            }
        } finally {
            this.askingAboutMissing = false;
        }
    }

    // The first items for a dialog's detail. A longer list goes in full to the output, shown behind the dialog.
    private listForDialog(heading: string, items: string[]): string {
        if (items.length > itemsInDialog) {
            this.log.appendLine(heading);
            for (const item of items) {
                this.log.appendLine(`  ${item}`);
            }
            this.log.show(true);
        }
        return shortList(items, itemsInDialog);
    }

    renameStarting(uri: vscode.Uri) {
        this.renaming.add(uri.path.replace(/\/$/, ''));
    }

    // The file watcher reports the old folder going a moment after the rename
    renameDone(uri: vscode.Uri) {
        setTimeout(() => this.renaming.delete(uri.path.replace(/\/$/, '')), 3000);
    }

    private isRenaming(path: string): boolean {
        return [...this.renaming].some(renamed => path === renamed || path.startsWith(`${renamed}/`));
    }

    async renameBack(oldUri: vscode.Uri, newUri: vscode.Uri) {
        await vscode.workspace.fs.rename(newUri, oldUri);
        vscode.window.showWarningMessage("Codea projects need Main.lua, so it was renamed back.");
    }

    // Moves a project's link, and what was last synced, to its renamed folder or project
    async moveLink(project: LinkedProject, folder: vscode.WorkspaceFolder, localUri: vscode.Uri, remotePath: string) {
        this.store.set(this.stateKey({ localUri, remotePath }), this.bases(project));
        this.store.set(this.stateKey(project), undefined);
        await this.links.moveLink(project, folder, localUri, remotePath);
        this.log.appendLine(remotePath === project.remotePath
            ? `${remotePath} is now linked to ${vscode.workspace.asRelativePath(localUri)}`
            : `Renamed ${project.remotePath} to ${remotePath} in Codea`);
    }

    // A renamed tab arrives as a new file and a deletion. When the deleted tab's content was just
    // pushed under another name, that is a rename, and the tab keeps its place.
    private async keepTabPlaceOfRename(project: LinkedProject, name: string) {
        const deleted = this.bases(project)[name];
        const folder = (path: string) => path.split('/').slice(0, -1).join('/');
        const renamed = deleted && name.endsWith('.lua') && (this.recentPushes.get(project.localUri.toString()) ?? []).find(push =>
            push.hash === deleted.hash && push.name !== name && push.name.endsWith('.lua') && folder(push.name) === folder(name));
        if (renamed) {
            await this.renameTab(project, name, renamed.name);
        }
    }

    // Renames a tab in Info.plist's Buffer Order here; the watcher pushes it like any edit
    private async renameTab(project: LinkedProject, oldName: string, newName: string) {
        if (oldName.includes('/')) {
            return;
        }
        const plistUri = vscode.Uri.joinPath(project.localUri, 'Info.plist');
        try {
            const plist = new TextDecoder().decode(await vscode.workspace.fs.readFile(plistUri));
            const renamed = renameInBufferOrder(plist, oldName, newName);
            if (renamed !== undefined) {
                await vscode.workspace.fs.writeFile(plistUri, new TextEncoder().encode(renamed));
            }
        } catch {
            // No Info.plist here: Codea keeps its own order
        }
    }

    // A rename in VS Code of a linked project's folder, or of a folder holding some
    isFolderRename(oldUri: vscode.Uri): boolean {
        const oldPath = oldUri.path.replace(/\/$/, '');
        return this.links.projects().some(project => project.localUri.path === oldPath || project.localUri.path.startsWith(`${oldPath}/`));
    }

    // Main.lua renamed in VS Code, which Codea projects cannot do without
    isMainRename(oldUri: vscode.Uri): boolean {
        const from = this.links.find(oldUri);
        return from !== undefined && from[1] === 'Main.lua';
    }

    async unlink(projects: LinkedProject[]) {
        for (const project of projects) {
            this.store.set(this.stateKey(project), undefined);
        }
        await this.links.removeLinks(projects);
        this.log.appendLine(`Unlinked ${projects.map(project => project.remotePath).join(', ')}`);
    }

    // After comparing everything: says what was brought back, and asks about missing projects
    private async reportFullSync() {
        if (this.broughtBack.length > 0) {
            const files = this.broughtBack;
            this.broughtBack = [];
            vscode.window.showInformationMessage(
                `${files.length} ${files.length === 1 ? "file was" : "files were"} missing on one side and brought back from the other. Deletions are only passed on when they happen while connected.`,
                "Show Output").then(choice => {
                    if (choice) {
                        this.log.show();
                    }
                });
        }
        if (this.missingLocally.size > 0 || this.missingInCodea.size > 0) {
            await this.askAboutMissingProjects();
        }
    }

    // Brings the named files of a project up to date; the source decides what may be deleted
    syncFiles(project: LinkedProject, names: string[], source: SyncSource): Promise<void> {
        return this.enqueue(project, () => this.syncNamed(project, names, source));
    }

    // Projects of filesChanged paths, e.g. "/Codea/Documents/Project"
    remoteFilesChanged(path: string, files: string[]) {
        for (const project of this.links.projects()) {
            if (path === `/${AirCode.rootFolder}/${project.remotePath}`) {
                this.syncFiles(project, files.filter(name => !name.startsWith('.')), 'remote');
            }
        }
    }

    private async syncNamed(project: LinkedProject, names: string[], source: SyncSource) {
        const projectUri = this.links.remoteProjectUri(project);
        if (projectUri === undefined || this.airCode.disconnected || this.isRenaming(project.localUri.path)) {
            return;
        }
        names = names.filter(name => !this.isRenaming(vscode.Uri.joinPath(project.localUri, name).path));

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
            await this.syncFile(project, name, remoteFiles, source);
        }
    }

    private async syncFile(project: LinkedProject, name: string, remoteFiles: Map<string, RemoteFile>, source: SyncSource) {
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

        const planned = planSync(localHash, remoteHash, base?.hash);
        const action = guardDeletion(planned, source);
        // A local deletion waiting to be passed on decides for this file, not another sync
        // that happens to see it first
        if (action !== planned && this.pendingDeletions.has(localUri.toString())) {
            return;
        }
        if (action !== planned && action !== 'none') {
            this.broughtBack.push(this.describe(project, name));
            this.log.appendLine(`${this.describe(project, name)} was missing ${planned === 'deleteRemote' ? "here" : "in Codea"}; bringing it back`);
        }
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
        const key = project.localUri.toString();
        this.recentPushes.set(key, [...(this.recentPushes.get(key) ?? []).filter(push => Date.now() - push.time < 10000),
            { name, hash: hash(content), time: Date.now() }]);
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

    // Undefined when Codea cannot be reached, so a lost connection never reads as deleted files,
    // and 'missing' when Codea has no such project
    private async listRemote(project: LinkedProject): Promise<Map<string, RemoteFile> | 'missing' | undefined> {
        const projectUri = this.links.remoteProjectUri(project);
        if (projectUri === undefined || this.airCode.disconnected) {
            return undefined;
        }

        try {
            await this.airCode.ensureResponsive(projectUri);
            const files = new Map<string, RemoteFile>();

            if (this.airCode.listsFileVersions) {
                for (const version of await this.airCode.listFileVersions(projectUri)) {
                    files.set(version.name, { mtime: version.mtime });
                }
                // An empty listing may be a project that is gone
                if (files.size === 0 && !await this.remoteProjectExists(projectUri)) {
                    return 'missing';
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
            if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
                return 'missing';
            }
            this.log.appendLine(`Could not list ${project.remotePath} in Codea: ${error}`);
            return undefined;
        }
    }

    private async remoteProjectExists(projectUri: vscode.Uri): Promise<boolean> {
        try {
            await this.airCode.stat(projectUri);
            return true;
        } catch (error) {
            return !(error instanceof vscode.FileSystemError && error.code === 'FileNotFound');
        }
    }

    private async localFolderExists(project: LinkedProject): Promise<boolean> {
        try {
            return (await vscode.workspace.fs.stat(project.localUri)).type === vscode.FileType.Directory;
        } catch {
            return false;
        }
    }

    // A project's files, those in its folders as "Folder/File.lua" when Codea keeps them
    private async listLocal(project: LinkedProject, folder = '', everything = false): Promise<string[]> {
        let entries: [string, vscode.FileType][];
        try {
            entries = await vscode.workspace.fs.readDirectory(folder ? vscode.Uri.joinPath(project.localUri, folder) : project.localUri);
        } catch {
            return [];
        }
        const names: string[] = [];
        for (const [name, type] of entries.filter(([name]) => !name.startsWith('.'))) {
            const path = folder ? `${folder}/${name}` : name;
            if (type === vscode.FileType.File) {
                names.push(path);
            } else if (type === vscode.FileType.Directory && (everything || this.airCode.listsSubfolders)) {
                names.push(...await this.listLocal(project, path, everything));
            }
        }
        return names;
    }

    // Deleted top-level files of which a file of the same name is now in one of the project's folders
    private async movedIntoFolders(files: { project: LinkedProject, name: string }[]) {
        const moved: typeof files = [];
        for (const file of files.filter(({ name }) => !name.includes('/'))) {
            const nested = await this.listLocal(file.project, '', true);
            if (nested.some(path => path.includes('/') && path.split('/').pop() === file.name)) {
                moved.push(file);
            }
        }
        return moved;
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
        return this.store.get(this.stateKey(project));
    }

    private setBase(project: LinkedProject, name: string, base: Base | undefined) {
        const bases = { ...this.bases(project) };
        if (base === undefined) {
            delete bases[name];
        } else {
            bases[name] = base;
        }
        this.store.set(this.stateKey(project), bases);
    }
}
