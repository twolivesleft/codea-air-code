import * as vscode from 'vscode';
import { AirCode } from './aircode';
import { AirCodePath } from './aircodepath';
import { getWorkspaceUri } from './extension';
import { FindInFilesResponse } from './responses';

export class SearchViewProvider implements vscode.WebviewViewProvider {

	public static readonly viewType = 'codea-search';

	private _view?: vscode.WebviewView;

	public airCode?: AirCode;

	private findInFilesResponse?: FindInFilesResponse
	private uriMap?: {[uri: string]: string}

	constructor(
		private readonly _extensionUri: vscode.Uri
	) { }

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	) {
		this._view = webviewView;

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [
				this._extensionUri
			]
		};

		webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

		webviewView.webview.onDidReceiveMessage(data => {
			(async () => {
				switch (data.type) {
					case 'webViewReady':
						{
							break;
						}
					case 'debugMessage':
						{
							console.log(`search webView debugMessage: ${data.value}`);
							break;
						}
					case 'findInFiles':
						{
							let activeEditor = vscode.window.activeTextEditor;
							if (activeEditor?.document.uri.scheme == "codea") {
								this.findInFilesResponse = await this.airCode?.findInFiles(activeEditor.document.uri, data.text, data.caseSensitive, data.wholeWord, data.isRegex);
								this.uriMap = {}
								if (this.findInFilesResponse) {
									for (const [uri, fileResults] of Object.entries(this.findInFilesResponse.fileResults)) {
										const path = uri.substring(0, uri.lastIndexOf("/"));
										const airCodePath = new AirCodePath(vscode.Uri.parse(path).path);
										const prefix = `/Codea/`;
										const projectPath = path.substring(path.indexOf(prefix) + prefix.length);
										this.uriMap[uri] = projectPath;
									}	
								}
								this.sendResults();
							}
							else {
								vscode.window.showErrorMessage("Open and click inside a code file in order to search in the corresponding project.");
							}				

							break;
						}
					case 'openFile':
						{
							const uri = data.uri;
							const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(uri));
							await vscode.window.showTextDocument(document);

							const line = data.line;
							const position = data.position;
							const length = data.length;

							const editor = vscode.window.activeTextEditor;
							if (editor) {
								const range = new vscode.Range(line, position, line, position + length);
								editor.selection = new vscode.Selection(range.start, range.end);
								editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
							}
						}
				}
			})();
		});
	}

	private sendResults() {
		if (this._view) {
			this._view.webview.postMessage({ type: 'setResults', data: {
				fileResults: this.findInFilesResponse?.fileResults,
				uriMap: this.uriMap
		 	}});
		}
	}

	private _getHtmlForWebview(webview: vscode.Webview) {
		// Get the local path to main script run in the webview, then convert it to a uri we can use in the webview.
		const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'search', 'main.js'));
		const codiconsUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'node_modules', '@vscode/codicons', 'dist', 'codicon.css'));

		// Do the same for the stylesheet.
		const styleMainUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'search', 'main.css'));

		// Use a nonce to only allow a specific script to be run.
		const nonce = getNonce();

		const htmlUri = vscode.Uri.joinPath(this._extensionUri, 'media', 'search', 'main.html');

		let fs = require("fs");
		let html = fs.readFileSync(htmlUri.fsPath, { encoding:'utf8', flag:'r' })
			.replaceAll('${styleMainUri}', styleMainUri)
			.replaceAll('${nonce}', nonce)
			.replaceAll('${webview.cspSource}', webview.cspSource)
			.replaceAll('${codiconsUri}', codiconsUri)
			.replaceAll('${scriptUri}', scriptUri);

		return html;
	}
}

function getNonce() {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}
