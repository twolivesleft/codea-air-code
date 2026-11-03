import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
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
        if (folder === undefined || !this.links.isLinked() || vscode.extensions.getExtension(LUA_EXTENSION) === undefined) {
            return;
        }
        if (!this.isSetUp(folder)) {
            if (this.context.workspaceState.get<boolean>(DECLINED)) {
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
    // that a folder holding many projects, such as a git repository, is not all read
    private ignoredFolders(folder: vscode.WorkspaceFolder): string[] {
        const root = folder.uri.fsPath;
        const linked = this.links.projects()
            .filter(project => !isAssetPack(project))
            .map(project => path.relative(root, project.localUri.fsPath).split(path.sep).join('/'));
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
                const relative = dir ? `${dir}/${entry.name}` : entry.name;
                if (linked.includes(relative)) {
                    continue;
                }
                if (linked.some(project => project.startsWith(`${relative}/`))) {
                    visit(relative);
                } else {
                    ignored.push(`/${relative}/`);
                }
            }
        };
        visit('');
        return ignored;
    }

    private async apply(folder: vscode.WorkspaceFolder) {
        const lua = vscode.workspace.getConfiguration('Lua', folder.uri);
        const api = path.join(this.context.extensionPath, 'luals', 'api');
        // Earlier versions of this extension are installed at another path
        const library = (lua.get<string[]>('workspace.library') ?? []).filter(entry => !/[\\/]luals[\\/]api$/.test(entry) || entry === api);
        // Codea's globals are written in lowercase, and its reference lists neither every overload nor
        // every parameter's type, which LuaLS would report as mistakes
        const quiet = ['lowercase-global', 'redundant-parameter', 'missing-parameter', 'param-type-mismatch'];
        const disabled = lua.get<string[]>('diagnostics.disable') ?? [];
        // The folders this extension leaves out start with "/"; any others are the user's own
        const ignoreDir = [...(lua.get<string[]>('workspace.ignoreDir') ?? []).filter(entry => !entry.startsWith('/')), ...this.ignoredFolders(folder)];
        const settings: [string, unknown][] = [
            ['runtime.version', 'Lua 5.4'],
            ['runtime.plugin', this.plugin],
            ['workspace.library', library.includes(api) ? library : [...library, api]],
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
