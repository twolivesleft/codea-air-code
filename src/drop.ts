import * as vscode from 'vscode';
import { AirCode } from './aircode';

const uriListMime = 'text/uri-list';

export class AssetKeyOnDropProvider implements vscode.DocumentDropEditProvider {
    public airCode?: AirCode;
    
	async provideDocumentDropEdits(
		_document: vscode.TextDocument,
		_position: vscode.Position,
		dataTransfer: vscode.DataTransfer,
		token: vscode.CancellationToken
	): Promise<vscode.DocumentDropEdit | undefined> {
		// Check the data transfer to see if we have dropped a list of uris
		const dataTransferItem = dataTransfer.get(uriListMime);
		if (!dataTransferItem) {
			return undefined;
		}

		// 'text/uri-list' contains a list of uris separated by new lines.
		// Parse this to an array of uris.
		const urlList = await dataTransferItem.asString();
		if (token.isCancellationRequested) {
			return undefined;
		}

		const uris: vscode.Uri[] = [];
		for (const resource of urlList.split('\n')) {
			try {
				uris.push(vscode.Uri.parse(resource));
			} catch {
				// noop
			}
		}

		if (uris.length !== 1) {
			return undefined;
		}

        const uri = uris[0];
        const assetKey = await this.airCode?.getAssetKey(uri, _document.uri);
        if (!assetKey) {
            return undefined;
        }

		const snippet = new vscode.SnippetString();
        snippet.appendText(`${assetKey.assetKey}`);

		return new vscode.DocumentDropEdit(snippet);
	}
}
