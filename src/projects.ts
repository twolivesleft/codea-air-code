import * as vscode from 'vscode';

import { AirCode } from './aircode';
import { LinkedProject, Links } from './links';

// A collection of projects in Codea, or one of its projects
export class ProjectNode {
    constructor(
        // Path under /Codea, e.g. "iPad Projects" or "iPad Projects/EmuTests"
        readonly remotePath: string,
        readonly isProject: boolean) { }

    get name(): string {
        return this.remotePath.split('/').pop()!;
    }
}

// Projects in Codea as paths under /Codea, e.g. "iPad Projects/EmuTests" or "iCloud/Collection/Project"
export async function listCodeaProjects(airCode: AirCode, host: string): Promise<string[]> {
    const projects: string[] = [];
    for (const collection of await listCollections(airCode, host)) {
        for (const project of await listFolders(airCode, host, collection)) {
            projects.push(`${collection}/${project}`);
        }
    }
    return projects;
}

async function listFolders(airCode: AirCode, host: string, path: string): Promise<string[]> {
    const uri = vscode.Uri.from({ scheme: 'codea', authority: host, path: `/${AirCode.rootFolder}${path ? `/${path}` : ''}` });
    return (await airCode.readDirectory(uri))
        .filter(([name, type]) => type === vscode.FileType.Directory && name !== ".vscode")
        .map(([name]) => name);
}

// Collections as paths under /Codea; iCloud's are "iCloud/Collection". Assets holds no projects.
async function listCollections(airCode: AirCode, host: string): Promise<string[]> {
    const collections: string[] = [];
    for (const collection of await listFolders(airCode, host, "")) {
        if (collection === "Assets") {
            continue;
        }
        if (collection === "iCloud") {
            for (const cloudCollection of await listFolders(airCode, host, collection)) {
                collections.push(`${collection}/${cloudCollection}`);
            }
            continue;
        }
        collections.push(collection);
    }
    return collections;
}

// The Projects view of the Codea sidebar
export class ProjectsViewProvider implements vscode.TreeDataProvider<ProjectNode> {
    public static readonly viewType = 'codea-projects';

    private _onDidChangeTreeData = new vscode.EventEmitter<ProjectNode | undefined>();
    onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor(private readonly airCode: AirCode, private readonly links: Links) { }

    refresh() {
        this._onDidChangeTreeData.fire(undefined);
    }

    linkedProject(node: ProjectNode): LinkedProject | undefined {
        return this.links.projects().find(project => project.remotePath === node.remotePath);
    }

    getTreeItem(node: ProjectNode): vscode.TreeItem {
        if (!node.isProject) {
            const isCloud = node.remotePath.startsWith("iCloud/");
            // Collections with linked projects start open, so those projects are in view
            const hasLinked = this.links.projects().some(project => project.remotePath.startsWith(`${node.remotePath}/`));
            const state = hasLinked ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed;
            const item = new vscode.TreeItem(isCloud ? `${node.name} (iCloud)` : node.name, state);
            item.iconPath = new vscode.ThemeIcon(isCloud ? "cloud" : "folder");
            item.contextValue = "collection";
            return item;
        }

        const linked = this.linkedProject(node);
        const item = new vscode.TreeItem(node.name, vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon(linked ? "link" : "codea-logo");
        item.contextValue = linked ? "linkedProject" : "project";
        if (linked) {
            item.description = "linked";
            item.tooltip = `${node.remotePath}, linked to ${vscode.workspace.asRelativePath(linked.localUri)}`;
            item.command = {
                command: "vscode.open",
                title: "Open",
                arguments: [vscode.Uri.joinPath(linked.localUri, "Main.lua")],
            };
        } else {
            item.tooltip = `${node.remotePath} in Codea`;
        }
        return item;
    }

    async getChildren(node?: ProjectNode): Promise<ProjectNode[]> {
        const host = this.links.host();
        if (host === undefined) {
            return [];
        }

        try {
            if (node === undefined) {
                return (await listCollections(this.airCode, host)).map(collection => new ProjectNode(collection, false));
            }
            return (await listFolders(this.airCode, host, node.remotePath))
                .sort((a, b) => a.localeCompare(b))
                .map(project => new ProjectNode(`${node.remotePath}/${project}`, true));
        } catch {
            return [];
        }
    }
}
