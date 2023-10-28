import * as vscode from 'vscode';
import { AirCode } from './aircode';
import { getWorkspaceUri } from './extension';

export class ParametersViewProvider implements vscode.WebviewViewProvider {

	public static readonly viewType = 'codea-parameters';

	private _view?: vscode.WebviewView;

	private parameters: any[] = [];

	public airCode?: AirCode;

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
							// Query the parameters whenever we display the view in case the project changed.
							let parameters = await this.airCode?.getParameters(getWorkspaceUri());

							if (parameters) {
								this.setParameters(parameters);
							}
							
							break;
						}
					case 'debugMessage':
						{
							console.log(`parameters webView debugMessage: ${data.value}`);
							break;
						}
					case 'setParameter':
						{
							const parameter = JSON.parse(data.parameter);
							this.updateParameter(parameter);
							this.airCode?.setParameter(getWorkspaceUri(), data.parameter);
							break;
						}
				}
			})();
		});
	}

	public setParameters(parameters: any[]) {
		this.parameters = parameters;

		if (this._view) {
			this._view.webview.postMessage({ type: 'setParameters', data: parameters });
		}
	}

	public updateParameter(parameter: any) {
		const existingIndex = this.parameters.findIndex(x => x.name === parameter.name && x.type === parameter.type);
		if (existingIndex !== -1) {
			this.parameters[existingIndex] = parameter;
		}
		else {
			this.parameters.push(parameter);
		}
	}

	public setParameter(parameter: any) {
		this.updateParameter(parameter);

		if (this._view) {
			this._view.webview.postMessage({ type: 'setParameter', data: parameter });
		}
	}

	public clearParameters() {
		this.parameters = [];

		this.setParameters(this.parameters);
	}

	private _getHtmlForWebview(webview: vscode.Webview) {
		// Get the local path to main script run in the webview, then convert it to a uri we can use in the webview.
		const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'parameters', 'main.js'));

		// Do the same for the stylesheet.
		const styleResetUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'parameters', 'reset.css'));
		const styleVSCodeUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'parameters', 'vscode.css'));
		const styleMainUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'parameters', 'main.css'));

		// Use a nonce to only allow a specific script to be run.
		const nonce = getNonce();

		const htmlUri = vscode.Uri.joinPath(this._extensionUri, 'media', 'parameters', 'main.html');

		let fs = require("fs");
		let html = fs.readFileSync(htmlUri.fsPath, { encoding:'utf8', flag:'r' })
			.replaceAll('${styleResetUri}', styleResetUri)
			.replaceAll('${styleVSCodeUri}', styleVSCodeUri)
			.replaceAll('${styleMainUri}', styleMainUri)
			.replaceAll('${nonce}', nonce)
			.replaceAll('${webview.cspSource}', webview.cspSource)
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
