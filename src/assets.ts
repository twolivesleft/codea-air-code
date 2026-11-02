import * as path from 'path';
import * as vscode from 'vscode';

import { AirCode } from './aircode';
import { Links } from './links';

// A folder or file under Codea's Assets: pack types, packs, and their files
export class AssetNode {
    constructor(
        readonly uri: vscode.Uri,
        readonly isFolder: boolean,
        readonly depth: number) { }
}

// The Assets view of the Codea sidebar. Its files open from Codea and drag into the editor as
// asset keys; packs Codea lets you write to take new files, added or dropped on them.
export class AssetsViewProvider implements vscode.TreeDataProvider<AssetNode>, vscode.TreeDragAndDropController<AssetNode> {
    public static readonly viewType = 'codea-assets';

    readonly dragMimeTypes = ['text/uri-list'];
    readonly dropMimeTypes = ['text/uri-list'];

    private _onDidChangeTreeData = new vscode.EventEmitter<AssetNode | undefined>();
    onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor(private readonly airCode: AirCode, private readonly links: Links) { }

    refresh() {
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(node: AssetNode): vscode.TreeItem {
        const item = new vscode.TreeItem(node.uri, node.isFolder ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
        item.label = path.posix.basename(node.uri.path);
        if (node.isFolder) {
            item.iconPath = new vscode.ThemeIcon(node.depth === 1 ? "package" : "folder");
            item.contextValue = node.depth === 1 ? "assetPack" : "assetFolder";
        } else {
            item.contextValue = "asset";
            item.tooltip = "Drag into a file to insert its asset key";
            item.command = { command: "vscode.open", title: "Open", arguments: [node.uri] };
        }
        return item;
    }

    async getChildren(node?: AssetNode): Promise<AssetNode[]> {
        const host = this.links.host();
        if (host === undefined) {
            return [];
        }
        const folder = node?.uri ?? vscode.Uri.from({ scheme: 'codea', authority: host, path: `/${AirCode.rootFolder}/Assets` });
        try {
            return (await this.airCode.readDirectory(folder))
                .filter(([name]) => !name.startsWith('.'))
                .sort(([a, aType], [b, bType]) => (bType - aType) || a.localeCompare(b))
                .map(([name, type]) => new AssetNode(vscode.Uri.joinPath(folder, name), type === vscode.FileType.Directory, (node?.depth ?? -1) + 1));
        } catch {
            return [];
        }
    }

    handleDrag(nodes: readonly AssetNode[], dataTransfer: vscode.DataTransfer) {
        const files = nodes.filter(node => !node.isFolder);
        if (files.length > 0) {
            dataTransfer.set('text/uri-list', new vscode.DataTransferItem(files.map(node => node.uri.toString()).join('\n')));
        }
    }

    // Copies files from this computer into a pack Codea lets you write to
    async addFiles(node: AssetNode) {
        if (!await this.isWritable(node.uri)) {
            return;
        }
        const files = await vscode.window.showOpenDialog({ canSelectMany: true, openLabel: "Add to Codea" });
        if (files !== undefined) {
            await this.copyInto(node.uri, files);
        }
    }

    // Files dropped on a pack, a folder in one, or one of their files, from Finder or the Explorer
    async handleDrop(target: AssetNode | undefined, dataTransfer: vscode.DataTransfer) {
        const list = await dataTransfer.get('text/uri-list')?.asString();
        if (target === undefined || list === undefined) {
            return;
        }
        const folder = target.isFolder ? target.uri : vscode.Uri.joinPath(target.uri, '..');
        const dropped = list.split(/\r?\n/).filter(line => line.trim() !== '').map(line => vscode.Uri.parse(line.trim()))
            .filter(uri => uri.scheme === 'file');
        const files: vscode.Uri[] = [];
        for (const uri of dropped) {
            if ((await vscode.workspace.fs.stat(uri)).type === vscode.FileType.File) {
                files.push(uri);
            }
        }
        if (files.length > 0 && await this.isWritable(folder)) {
            await this.copyInto(folder, files);
        }
    }

    // Whether Codea lets files be written into a folder; says so when it does not
    private async isWritable(folder: vscode.Uri): Promise<boolean> {
        let writable = false;
        try {
            writable = ((await this.airCode.stat(folder)).permissions ?? 0) !== vscode.FilePermission.Readonly;
        } catch {
            // Treated as read-only
        }
        if (!writable) {
            vscode.window.showWarningMessage(`Codea does not take new files in ${path.posix.basename(folder.path)}.`);
        }
        return writable;
    }

    private async copyInto(folder: vscode.Uri, files: readonly vscode.Uri[]) {
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Adding to ${path.posix.basename(folder.path)}...` }, async () => {
            for (const file of files) {
                await this.airCode.writeFile(vscode.Uri.joinPath(folder, path.basename(file.fsPath)), await vscode.workspace.fs.readFile(file), { create: true, overwrite: true });
            }
        });
        this.refresh();
    }
}
