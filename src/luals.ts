import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { dependenciesIn, requiredIn } from './dependencies';
import { isAssetPack, Links } from './links';

const LUA_EXTENSION = 'sumneko.lua';
const DECLINED = 'luaDefinitionsDeclined';

// Go to Definition, Find References and hover in Codea projects come from the Lua extension
// (LuaLS), given Codea's API as definition files and a plugin for class() and require(asset...).
// Completion and signature help stay with Codea's own language server. LuaLS keeps its diagnostics:
// they are also what makes it read again the files changed on disk, such as those synced from Codea.
export class LuaDefinitions {
    constructor(private readonly context: vscode.ExtensionContext, private readonly links: Links) { }

    private get folder(): vscode.WorkspaceFolder | undefined {
        return vscode.workspace.workspaceFolders?.[0];
    }

    private get plugin(): string {
        return path.join(this.context.extensionPath, 'luals', 'plugin.lua');
    }

    // Set up when the folder's Lua settings name this extension's plugin, from this version or another
    private isSetUp(folder: vscode.WorkspaceFolder): boolean {
        const plugin = vscode.workspace.getConfiguration('Lua', folder.uri).get<string>('runtime.plugin') ?? '';
        return /[\\/]luals[\\/]plugin\.lua$/.test(plugin);
    }

    // Brings the settings up to date, and asks once per folder when the Lua extension is there
    async update() {
        const folder = this.folder;
        if (folder === undefined || vscode.extensions.getExtension(LUA_EXTENSION) === undefined) {
            return;
        }
        // Once set up, the folders left out follow the links, down to none
        if (!this.isSetUp(folder)) {
            if (!this.links.isLinked() || this.context.workspaceState.get<boolean>(DECLINED)) {
                return;
            }
            const answer = await vscode.window.showInformationMessage(
                "The Lua extension can add Go to Definition, Find References and hover to your linked Codea projects. Set it up for this folder?",
                "Set Up", "Not Now", "Never for This Folder");
            if (answer === "Never for This Folder") {
                await this.context.workspaceState.update(DECLINED, true);
            }
            if (answer !== "Set Up") {
                return;
            }
        }
        await this.apply(folder);
    }

    // Keeps the projects in use up to date as code adds or drops a require, in a folder already set up
    watch(): vscode.Disposable {
        let timer: NodeJS.Timeout | undefined;
        const changed = () => {
            clearTimeout(timer);
            timer = setTimeout(() => {
                const folder = this.folder;
                if (folder !== undefined && vscode.extensions.getExtension(LUA_EXTENSION) !== undefined && this.isSetUp(folder)) {
                    this.apply(folder);
                }
            }, 1000);
        };
        const watcher = vscode.workspace.createFileSystemWatcher('**/{*.lua,Info.plist}');
        return vscode.Disposable.from(watcher, watcher.onDidCreate(changed), watcher.onDidChange(changed), watcher.onDidDelete(changed),
            { dispose: () => clearTimeout(timer) });
    }

    // The Codea: Set Up Go to Definition command, which installs the Lua extension if needed
    async setUp() {
        const folder = this.folder;
        if (folder === undefined) {
            return;
        }
        if (vscode.extensions.getExtension(LUA_EXTENSION) === undefined) {
            const answer = await vscode.window.showInformationMessage(
                "Go to Definition in Codea projects uses the Lua extension by sumneko. Install it?", "Install", "Cancel");
            if (answer !== "Install") {
                return;
            }
            await vscode.commands.executeCommand('workbench.extensions.installExtension', LUA_EXTENSION);
        }
        await this.context.workspaceState.update(DECLINED, undefined);
        await this.apply(folder);
    }

    // The folders LuaLS should leave alone: everything in the folder but the linked projects, so
    // that a folder holding many projects, such as a git repository, is not all read. A required
    // project is left out by name, as LuaLS does not read a library inside a folder it leaves out
    private ignoredFolders(folder: vscode.WorkspaceFolder, required: string[]): string[] {
        const root = folder.uri.fsPath;
        const relative = (project: string) => path.relative(root, project).split(path.sep).join('/');
        const linked = this.linkedProjects().map(relative);
        const kept = [...linked, ...required.map(relative)];
        const ignored: string[] = [];
        const visit = (dir: string) => {
            let entries: fs.Dirent[] = [];
            try {
                entries = fs.readdirSync(path.join(root, dir), { withFileTypes: true });
            } catch {
                return;
            }
            for (const entry of entries) {
                if (!entry.isDirectory() || entry.name.startsWith('.')) {
                    continue;
                }
                const name = dir ? `${dir}/${entry.name}` : entry.name;
                if (linked.includes(name)) {
                    continue;
                }
                if (kept.some(project => project.startsWith(`${name}/`))) {
                    visit(name);
                } else {
                    ignored.push(`/${name}/`);
                }
            }
        };
        visit('');
        return ignored;
    }

    private linkedProjects(): string[] {
        return this.links.projects().filter(project => !isAssetPack(project)).map(project => project.localUri.fsPath);
    }

    // The projects in this folder the linked projects require or depend on, in turn, but are not linked:
    // read as a library, for their definitions without their warnings. A project is looked for beside
    // its dependent, or in the folder holding that collection's
    private requiredProjects(root: string): string[] {
        const found = this.links.projects()
            .filter(project => !isAssetPack(project))
            .map(project => ({ local: project.localUri.fsPath, collection: project.remotePath.split('/').slice(-2, -1)[0] }));
        for (let i = 0; i < found.length; i++) {
            const { local, collection } = found[i];
            const used = [...dependenciesIn(read(path.join(local, 'Info.plist'))), ...luaFiles(local).flatMap(file => requiredIn(read(file)))];
            for (const dependency of used) {
                const named = dependency.collection ?? collection;
                const parent = path.dirname(path.dirname(local));
                const folders = named === collection ? [path.dirname(local)] : [path.join(parent, named), path.join(path.dirname(local), named), ...(named === 'Documents' ? [parent] : [])];
                const project = folders.flatMap(dir => [path.join(dir, `${dependency.project}.codea`), path.join(dir, dependency.project)])
                    .find(candidate => isDirectory(candidate) && isInside(root, candidate));
                if (project !== undefined && !found.some(other => other.local === project)) {
                    found.push({ local: project, collection: named });
                }
            }
        }
        const linked = this.linkedProjects();
        return found.map(project => project.local).filter(project => !linked.includes(project));
    }

    private async apply(folder: vscode.WorkspaceFolder) {
        const lua = vscode.workspace.getConfiguration('Lua', folder.uri);
        const api = path.join(this.context.extensionPath, 'luals', 'api');
        // Earlier versions of this extension are installed at another path
        // The required projects are the entries inside the folder, and are listed again each time
        const library = (lua.get<string[]>('workspace.library') ?? [])
            .filter(entry => (!/[\\/]luals[\\/]api$/.test(entry) || entry === api) && !isInside(folder.uri.fsPath, entry));
        // Codea's globals are written in lowercase, its reference lists neither every overload nor
        // every parameter's type, and its projects add fields to any table, which LuaLS would report as mistakes
        const quiet = ['lowercase-global', 'redundant-parameter', 'missing-parameter', 'param-type-mismatch', 'inject-field'];
        const disabled = lua.get<string[]>('diagnostics.disable') ?? [];
        // The folders this extension leaves out start with "/"; any others are the user's own
        const required = this.requiredProjects(folder.uri.fsPath);
        const ignoreDir = [...(lua.get<string[]>('workspace.ignoreDir') ?? []).filter(entry => !entry.startsWith('/')), ...this.ignoredFolders(folder, required)];
        const settings: [string, unknown][] = [
            ['runtime.version', 'Lua 5.4'],
            ['runtime.plugin', this.plugin],
            ['workspace.library', [...library.includes(api) ? library : [...library, api], ...required]],
            ['workspace.ignoreDir', ignoreDir],
            ['workspace.checkThirdParty', false],
            ['diagnostics.disable', [...disabled, ...quiet.filter(name => !disabled.includes(name))]],
            ['completion.enable', false],
            ['signatureHelp.enable', false],
        ];
        try {
            for (const [key, value] of settings) {
                if (JSON.stringify(lua.inspect(key)?.workspaceValue) !== JSON.stringify(value)) {
                    await lua.update(key, value, vscode.ConfigurationTarget.Workspace);
                }
            }
        } catch (error) {
            // A Lua extension installed or updated in this window is only known once it reloads
            const answer = await vscode.window.showWarningMessage(
                `The Lua extension could not be set up yet: ${error instanceof Error ? error.message : error}. Reload the window to finish.`,
                "Reload Window");
            if (answer === "Reload Window") {
                await vscode.commands.executeCommand('workbench.action.reloadWindow');
            }
        }
    }
}

function read(file: string): string {
    try {
        return fs.readFileSync(file, 'utf8');
    } catch {
        return '';
    }
}

function isDirectory(dir: string): boolean {
    try {
        return fs.statSync(dir).isDirectory();
    } catch {
        return false;
    }
}

function luaFiles(dir: string): string[] {
    let entries: fs.Dirent[] = [];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return [];
    }
    return entries.flatMap(entry => entry.isDirectory() && !entry.name.startsWith('.') ? luaFiles(path.join(dir, entry.name))
        : entry.name.endsWith('.lua') ? [path.join(dir, entry.name)] : []);
}

function isInside(root: string, entry: string): boolean {
    const relative = path.relative(root, entry);
    return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}
