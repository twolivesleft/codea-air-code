import * as fs from 'fs';
import * as vscode from 'vscode';

import { AirCode } from './aircode';
import { dependenciesIn, dependencyFile } from './dependencies';

// A local folder kept in sync with a project in Codea
export interface LinkedProject {
    localUri: vscode.Uri;
    // Path of the project under /Codea, e.g. "iPad Projects/EmuTests" or "iCloud/Collection/Project"
    remotePath: string;
}

// A linked asset pack rather than a project: its path under /Codea is in Assets
export function isAssetPack(project: LinkedProject): boolean {
    return project.remotePath.startsWith('Assets/');
}

// Codea's Documents packs, local and iCloud, whose folders are collections and projects, not assets
export function isDocumentsPack(project: LinkedProject): boolean {
    return project.remotePath === 'Assets/Internal/Documents' || project.remotePath === 'Assets/Internal/iCloud Documents';
}

const section = 'codea-air-code';

// Linked folders are configured per workspace folder in .vscode/settings.json:
//   "codea-air-code.host": "192.168.1.10:18513",
//   "codea-air-code.links": { "EmuTests.codea": "iPad Projects/EmuTests" }
export class Links {
    private _onDidChange = new vscode.EventEmitter<void>();
    onDidChange = this._onDidChange.event;

    constructor(context: vscode.ExtensionContext) {
        context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration(`${section}.links`) || e.affectsConfiguration(`${section}.host`)) {
                this._onDidChange.fire();
            }
        }));
        context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => this._onDidChange.fire()));
    }

    host(): string | undefined {
        for (const folder of this.fileFolders()) {
            const host = vscode.workspace.getConfiguration(section, folder).get<string>('host');
            if (host) {
                return host;
            }
        }
        return undefined;
    }

    projects(): LinkedProject[] {
        const projects: LinkedProject[] = [];
        for (const folder of this.fileFolders()) {
            const links = vscode.workspace.getConfiguration(section, folder).get<{ [local: string]: string }>('links') ?? {};
            for (const [local, remote] of Object.entries(links)) {
                projects.push({
                    localUri: vscode.Uri.joinPath(folder.uri, local),
                    remotePath: remote.replace(/^\/+|\/+$/g, ''),
                });
            }
        }
        return projects;
    }

    isLinked(): boolean {
        return this.host() !== undefined && this.projects().length > 0;
    }

    // codea://host/Codea/, the uri used for commands that are not about a file
    connectionUri(): vscode.Uri | undefined {
        const host = this.host();
        if (host === undefined) {
            return undefined;
        }
        return vscode.Uri.from({ scheme: 'codea', authority: host, path: `/${AirCode.rootFolder}/` });
    }

    remoteProjectUri(project: LinkedProject): vscode.Uri | undefined {
        const host = this.host();
        if (host === undefined) {
            return undefined;
        }
        return vscode.Uri.from({ scheme: 'codea', authority: host, path: `/${AirCode.rootFolder}/${project.remotePath}` });
    }

    // The linked project containing a local file, with the file's path relative to the project
    find(localUri: vscode.Uri): [LinkedProject, string] | undefined {
        if (localUri.scheme !== 'file') {
            return undefined;
        }
        for (const project of this.projects()) {
            const root = project.localUri.path.replace(/\/$/, '');
            if (localUri.path.startsWith(root + '/')) {
                return [project, localUri.path.slice(root.length + 1)];
            }
        }
        return undefined;
    }

    toRemote(localUri: vscode.Uri): vscode.Uri | undefined {
        const found = this.find(localUri);
        if (found === undefined) {
            return undefined;
        }
        const [project, relative] = found;
        const projectUri = this.remoteProjectUri(project);
        return projectUri && vscode.Uri.joinPath(projectUri, relative);
    }

    // Accepts a path under /Codea/, as the debugger reports it, or a codea:// uri
    toLocal(remote: string | vscode.Uri): vscode.Uri | undefined {
        const path = typeof remote === 'string' ? remote : remote.path;
        const match = path.match(/\/Codea\/(.*)$/);
        if (match === null) {
            return undefined;
        }
        const remotePath = match[1];
        const ofDependency = dependencyFile(path);
        if (ofDependency !== undefined) {
            const dependency = this.dependencyProject(ofDependency.dependent, ofDependency.dependency);
            return dependency && vscode.Uri.joinPath(dependency.localUri, ofDependency.file);
        }
        for (const project of this.projects()) {
            if (remotePath.startsWith(project.remotePath + '/')) {
                return vscode.Uri.joinPath(project.localUri, remotePath.slice(project.remotePath.length + 1));
            }
        }
        return undefined;
    }

    // The linked project a project depends on by name: the one its Info.plist names, else one in
    // its collection, else any of that name
    private dependencyProject(dependentPath: string, name: string): LinkedProject | undefined {
        const named = this.projects().filter(project => project.remotePath.split('/').pop() === name);
        const dependent = this.projects().find(project => project.remotePath === dependentPath);
        const listed = dependent && this.dependencies(dependent).find(entry => entry.project === name);
        const collection = (project: LinkedProject) => project.remotePath.split('/').slice(-2, -1)[0];
        return named.find(project => listed?.collection !== undefined && collection(project) === listed.collection)
            ?? named.find(project => collection(project) === dependentPath.split('/').slice(-2, -1)[0])
            ?? named[0];
    }

    // Whether a linked project runs on the modern runtime, by its Info.plist here
    isModern(project: LinkedProject): boolean {
        try {
            return /<key>Runtime Type<\/key>\s*<string>modern<\/string>/.test(fs.readFileSync(vscode.Uri.joinPath(project.localUri, 'Info.plist').fsPath, 'utf8'));
        } catch {
            return false;
        }
    }

    // A legacy project's dependencies, as its Info.plist here lists them
    dependencies(project: LinkedProject): { collection: string | undefined, project: string }[] {
        try {
            return dependenciesIn(fs.readFileSync(vscode.Uri.joinPath(project.localUri, 'Info.plist').fsPath, 'utf8'));
        } catch {
            return [];
        }
    }

    // Linked projects on the legacy runtime that depend on this one, by their Info.plist here.
    // Codea runs a dependency's files under each of them; modern ones require it under its own path.
    dependents(project: LinkedProject): LinkedProject[] {
        const name = project.remotePath.split('/').pop();
        const collection = project.remotePath.split('/').slice(-2, -1)[0];
        return this.projects().filter(other => other !== project && !this.isModern(other) && this.dependencies(other)
            .some(entry => entry.project === name && (entry.collection === undefined || entry.collection === collection)));
    }

    // Codea uri for a local file of a linked project, any other uri unchanged
    airCodeUri(uri: vscode.Uri): vscode.Uri {
        return this.toRemote(uri) ?? uri;
    }

    // Replaces the uris of linked files in a language server message, which Codea knows by their codea:// uri
    rewriteUris<T>(message: T, direction: 'toRemote' | 'toLocal'): T {
        const host = this.host();
        if (host === undefined) {
            return message;
        }

        const prefixes = this.projects().map(project => {
            const local = project.localUri.toString().replace(/\/$/, '') + '/';
            const remote = this.remoteProjectUri(project)!.toString() + '/';
            return direction === 'toRemote' ? [local, remote] : [remote, local];
        });

        const rewrite = (value: any): any => {
            if (typeof value === 'string') {
                for (const [from, to] of prefixes) {
                    if (value.startsWith(from)) {
                        return to + value.slice(from.length);
                    }
                }
                return value;
            }
            if (Array.isArray(value)) {
                return value.map(rewrite);
            }
            if (value !== null && typeof value === 'object') {
                const result: any = {};
                for (const [key, item] of Object.entries(value)) {
                    result[rewrite(key)] = rewrite(item);
                }
                return result;
            }
            return value;
        };

        return rewrite(message);
    }

    // Replaces the source paths in a debug adapter message. Codea's debugger knows a file by
    // "codea://host/Codea/Collection/Project/File.lua", without percent-encoding.
    rewriteSourcePaths<T>(message: T, direction: 'toRemote' | 'toLocal'): T {
        const rewritePath = (path: string): string => {
            if (direction === 'toRemote') {
                const remote = this.toRemote(vscode.Uri.file(path));
                return remote === undefined ? path : `codea://${remote.authority}${remote.path}`;
            }
            return this.toLocal(path)?.fsPath ?? path;
        };

        // Sources are found under "source" (arguments, stack frames, breakpoints) and "sources"
        const rewrite = (value: any, isSource: boolean): any => {
            if (Array.isArray(value)) {
                return value.map(item => rewrite(item, isSource));
            }
            if (value === null || typeof value !== 'object') {
                return value;
            }

            const result: any = {};
            for (const [key, item] of Object.entries(value)) {
                result[key] = rewrite(item, key === 'source' || key === 'sources');
            }
            if (isSource && typeof result.path === 'string') {
                result.path = rewritePath(result.path);
            }
            return result;
        };

        return rewrite(message, false);
    }

    async addLink(folder: vscode.WorkspaceFolder, localUri: vscode.Uri, remotePath: string, host: string) {
        await this.addLinks(folder, [{ localUri, remotePath }], host);
    }

    // Saves the links together, so linking many projects writes the settings once
    async addLinks(folder: vscode.WorkspaceFolder, entries: { localUri: vscode.Uri, remotePath: string }[], host: string) {
        const config = vscode.workspace.getConfiguration(section, folder);
        const links = { ...(config.get<{ [local: string]: string }>('links') ?? {}) };
        const root = folder.uri.path.replace(/\/$/, '');
        for (const { localUri, remotePath } of entries) {
            links[localUri.path.slice(root.length + 1)] = remotePath;
        }
        if (config.get<string>('host') !== host) {
            await config.update('host', host, vscode.ConfigurationTarget.WorkspaceFolder);
        }
        await config.update('links', links, vscode.ConfigurationTarget.WorkspaceFolder);
    }

    // Points a project's link at its folder's new place, or at the project's new name in Codea
    async moveLink(project: LinkedProject, folder: vscode.WorkspaceFolder, localUri: vscode.Uri, remotePath: string) {
        const config = vscode.workspace.getConfiguration(section, folder);
        const links = { ...(config.get<{ [local: string]: string }>('links') ?? {}) };
        const root = folder.uri.path.replace(/\/$/, '');
        delete links[project.localUri.path.slice(root.length + 1)];
        links[localUri.path.slice(root.length + 1)] = remotePath;
        await config.update('links', links, vscode.ConfigurationTarget.WorkspaceFolder);
    }

    // Removes the links of these projects, leaving their folders and Codea alone
    async removeLinks(projects: LinkedProject[]) {
        for (const folder of this.fileFolders()) {
            const config = vscode.workspace.getConfiguration(section, folder);
            const links = { ...(config.get<{ [local: string]: string }>('links') ?? {}) };
            let changed = false;
            for (const [local, remote] of Object.entries(links)) {
                const localUri = vscode.Uri.joinPath(folder.uri, local);
                if (projects.some(project => project.localUri.path === localUri.path && project.remotePath === remote)) {
                    delete links[local];
                    changed = true;
                }
            }
            if (changed) {
                await config.update('links', links, vscode.ConfigurationTarget.WorkspaceFolder);
            }
        }
    }

    private fileFolders(): readonly vscode.WorkspaceFolder[] {
        return (vscode.workspace.workspaceFolders ?? []).filter(folder => folder.uri.scheme === 'file');
    }
}
