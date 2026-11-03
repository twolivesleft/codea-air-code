import * as path from 'path';
import * as vscode from 'vscode';
import { Links } from './links';

const LUA_EXTENSION = 'sumneko.lua';

// Go to Definition, Find References and hover in Codea projects come from the Lua extension
// (LuaLS), given Codea's API as definition files and a plugin for class() and require(asset...).
// Completion and signature help stay with Codea's own language server. LuaLS keeps its diagnostics:
// they are also what makes it read again the files changed on disk, such as those synced from Codea.
export class LuaDefinitions {
    constructor(private readonly extensionPath: string, private readonly links: Links) { }

    private get folder(): vscode.WorkspaceFolder | undefined {
        return vscode.workspace.workspaceFolders?.[0];
    }

    // "on" or "off" for this folder; empty until asked
    private get choice(): string | undefined {
        return this.folder && vscode.workspace.getConfiguration('codea-air-code', this.folder.uri).get<string>('luaDefinitions');
    }

    private async setChoice(choice: 'on' | 'off') {
        await vscode.workspace.getConfiguration('codea-air-code', this.folder?.uri).update('luaDefinitions', choice, vscode.ConfigurationTarget.Workspace);
    }

    // Brings the settings up to date, and asks once per folder when the Lua extension is there
    async update() {
        const folder = this.folder;
        if (folder === undefined || !this.links.isLinked() || vscode.extensions.getExtension(LUA_EXTENSION) === undefined) {
            return;
        }
        if (!this.choice) {
            const answer = await vscode.window.showInformationMessage(
                "The Lua extension can add Go to Definition, Find References and hover to your Codea projects. Set it up for this folder?",
                "Set Up", "Not Now", "Never for This Folder");
            if (answer === "Never for This Folder") {
                await this.setChoice('off');
            }
            if (answer !== "Set Up") {
                return;
            }
            await this.setChoice('on');
        }
        if (this.choice === 'on') {
            await this.apply(folder);
        }
    }

    // The Codea: Set Up Go to Definition command, which installs the Lua extension if needed
    async setUp() {
        if (vscode.extensions.getExtension(LUA_EXTENSION) === undefined) {
            const answer = await vscode.window.showInformationMessage(
                "Go to Definition in Codea projects uses the Lua extension by sumneko. Install it?", "Install", "Cancel");
            if (answer !== "Install") {
                return;
            }
            await vscode.commands.executeCommand('workbench.extensions.installExtension', LUA_EXTENSION);
        }
        await this.setChoice('on');
        const folder = this.folder;
        if (folder !== undefined && vscode.extensions.getExtension(LUA_EXTENSION) !== undefined) {
            await this.apply(folder);
        }
    }

    private async apply(folder: vscode.WorkspaceFolder) {
        const lua = vscode.workspace.getConfiguration('Lua', folder.uri);
        const api = path.join(this.extensionPath, 'luals', 'api');
        // Earlier versions of this extension are installed at another path
        const library = (lua.get<string[]>('workspace.library') ?? []).filter(entry => !/[\\/]luals[\\/]api$/.test(entry) || entry === api);
        // Codea's globals are written in lowercase, and its reference lists neither every overload nor
        // every parameter's type, which LuaLS would report as mistakes
        const quiet = ['lowercase-global', 'redundant-parameter', 'missing-parameter', 'param-type-mismatch'];
        const disabled = lua.get<string[]>('diagnostics.disable') ?? [];
        const settings: [string, unknown][] = [
            ['runtime.version', 'Lua 5.4'],
            ['runtime.plugin', path.join(this.extensionPath, 'luals', 'plugin.lua')],
            ['workspace.library', library.includes(api) ? library : [...library, api]],
            ['workspace.checkThirdParty', false],
            ['diagnostics.disable', [...disabled, ...quiet.filter(name => !disabled.includes(name))]],
            ['completion.enable', false],
            ['signatureHelp.enable', false],
        ];
        for (const [key, value] of settings) {
            if (JSON.stringify(lua.inspect(key)?.workspaceValue) !== JSON.stringify(value)) {
                await lua.update(key, value, vscode.ConfigurationTarget.Workspace);
            }
        }
    }
}
