import * as vscode from 'vscode';

import { AirCode } from './aircode';
import { chunkLinesIn, decodeChunkPath } from './aircodepath';
import { Links } from './links';

// Makes the files and lines in Codea's errors open where they are: the file of a linked project,
// or the file in Codea
export class OutputLinkProvider implements vscode.DocumentLinkProvider {
    constructor(private readonly links: Links) {}

    provideDocumentLinks(document: vscode.TextDocument): vscode.DocumentLink[] {
        const found: vscode.DocumentLink[] = [];
        for (let index = 0; index < document.lineCount; index++) {
            for (const { start, end, chunk, line } of chunkLinesIn(document.lineAt(index).text)) {
                const file = this.file(chunk);
                if (file !== undefined) {
                    const link = new vscode.DocumentLink(new vscode.Range(index, start, index, end), file.with({ fragment: `L${line}` }));
                    link.tooltip = `Open ${decodeChunkPath(chunk)}, line ${line}`;
                    found.push(link);
                }
            }
        }
        return found;
    }

    private file(chunk: string): vscode.Uri | undefined {
        const local = this.links.toLocal(`/${AirCode.rootFolder}/${chunk}`);
        if (local !== undefined) {
            return local;
        }
        const authority = this.links.connectionUri()?.authority
            ?? vscode.workspace.workspaceFolders?.find(folder => folder.uri.scheme === 'codea')?.uri.authority;
        return authority === undefined ? undefined
            : vscode.Uri.from({ scheme: 'codea', authority, path: `/${AirCode.rootFolder}/${decodeChunkPath(chunk)}` });
    }
}
