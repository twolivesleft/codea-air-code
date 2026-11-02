import * as vscode from 'vscode';
import { AirCode } from './aircode';
import { getWorkspaceUri } from './extension';
import { Reference } from './responses';

export class ReferenceViewProvider implements vscode.WebviewViewProvider {

	public static readonly viewType = 'codea-reference';

	private _view?: vscode.WebviewView;

	private chapters: { legacy: any[], modern: any[] } = { legacy: [], modern: [] };
	private categoryImages: { [category: string]: string } = {}
	private isReady = false

	public airCode?: AirCode;
	private referenceToLoad?: Reference;

	constructor(
		private readonly _extensionUri: vscode.Uri
	) { }

	public isReadyAndVisible() {
		return this.isReady && this._view?.visible
	}

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	) {
		this._view = webviewView;
		this.isReady = false;

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [
				this._extensionUri
			]
		};

		webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

		webviewView.onDidChangeVisibility(() => this.showPendingReference());

		webviewView.webview.onDidReceiveMessage(data => {
			(async () => {
				switch (data.type) {
					case 'webViewReady':
						{
							await this.refresh();

							this.isReady = true;
							await this.showPendingReference();

							break;
						}
					case 'debugMessage':
						{
							console.log(`reference webView debugMessage: ${data.value}`);
							break;
						}
					case 'getChapters':
						{
							this.getChapters(data.modern === true);

							break;
						}
					case 'getChapterImage':
						{
							this.getChapterImage(data.chapter, data.modern === true);

							break;
						}
					case 'getFunctions':
						{
							this.getFunctions(data.chapter, data.modern === true);
							break;
						}
					case 'getCategoryImage':
						{
							const category = data.category;
							this.getCategoryImage(category);

							break;
						}	
					case 'getFunctionDetails':
						{
							this.getFunctionDetails(data.chapter, data.functionId, data.modern === true);
							break;
						}
				}
			})();
		});
	}

	// Loads both references again, for a new connection, which may be to a Codea without the modern one
	public async refresh() {
		this.chapters = { legacy: [], modern: [] };

		const modernIsNative = this.airCode?.hasModernReference === true;
		this._view?.webview.postMessage({ type: 'setModernIsNative', data: modernIsNative });

		await this.getChapters(false);
		if (modernIsNative) {
			await this.getChapters(true);
		}

		const modern = this.activeProjectIsModern();
		if (modern !== undefined) {
			this.showTab(modern);
		}
	}

	// The runtime of the project the active editor's file is in, if it is in a linked one
	public activeProjectIsModern(): boolean | undefined {
		const uri = vscode.window.activeTextEditor?.document.uri;
		const found = uri && this.airCode?.links?.find(uri);
		return found ? this.airCode?.links?.isModern(found[0]) : undefined;
	}

	// Shows an entry, once the view has loaded if it has not
	public async show(reference: Reference) {
		this.referenceToLoad = reference;
		if (this.isReadyAndVisible()) {
			await this.showPendingReference();
		}
		else {
			await vscode.commands.executeCommand("codea-reference.focus");
		}
	}

	private async showPendingReference() {
		const reference = this.referenceToLoad;
		if (reference && this.isReadyAndVisible()) {
			this.referenceToLoad = undefined;
			await this.getFunctionDetails(reference.chapter, reference.function, reference.modern);
		}
	}

	public showTab(modern: boolean) {
		this._view?.webview.postMessage({ type: 'showReference', data: modern });
	}

	private sendChapters(modern: boolean) {
		if (this._view) {
			this._view.webview.postMessage({ type: 'setChapters', modern, data: this.chapterList(modern) });
		}
	}

	private chapterList(modern: boolean): any[] {
		return modern ? this.chapters.modern : this.chapters.legacy;
	}

	public async getChapters(modern: boolean) {
		if (this.chapterList(modern).length === 0) {
			const chapters = await this.airCode?.getChapters(getWorkspaceUri(), modern);

			if (!chapters) {
				return;
			}

			if (modern) {
				this.chapters.modern = chapters;
			}
			else {
				this.chapters.legacy = chapters;
			}
		}

		this.sendChapters(modern);
	}

	public async getChapterImage(chapterName: string, modern: boolean) {
		let chapterImage = await this.airCode?.getChapterImage(getWorkspaceUri(), chapterName, modern);

		if (chapterImage) {
			const chapter = this.chapterList(modern).find(chapter => chapter["name"] == chapterName);

			if (chapter) {
				chapter["image"] = chapterImage;
			}

			if (this._view) {
				this._view.webview.postMessage({ type: 'setChapterImage', modern, data: {
					chapter: chapterName,
					image: chapterImage}
				});
			}
		}
	}

	public async getFunctions(chapterName: string, modern: boolean) {
		const chapter = this.chapterList(modern).find(chapter => chapter["name"] == chapterName);

		if (!chapter) {
			return;
		}

		if (!chapter["functions"]) {
			let response = await this.airCode?.getFunctions(getWorkspaceUri(), chapterName, modern);

			if (response) {
				chapter["groups"] = response.groups;
				chapter["localGroups"] = response.localGroups;
				chapter["functions"] = response.functions;
			}
		}

		if (this._view) {
			this._view.webview.postMessage({ type: 'setFunctions', modern, data: {
				chapter: chapterName,
				chapterTitle: chapter["title"],
				chapterImage: chapter["image"],
				groups: chapter["groups"],
				localGroups: chapter["localGroups"],
				functions: chapter["functions"],
				images: this.categoryImages
			} });
		}
	}

	public async getCategoryImage(category: string) {
		let categoryImage = await this.airCode?.getCategoryImage(getWorkspaceUri(), category);

		if (categoryImage) {
			this.categoryImages[category] = categoryImage;

			if (this._view) {
				this._view.webview.postMessage({ type: 'setCategoryImage', data: {
					category: category,
					image: categoryImage}
				});
			}
		}
	}

	public async getFunctionDetails(chapter: string, functionId: string, modern: boolean) {
		if (this._view) {
			let response = await this.airCode?.getFunctionDetails(getWorkspaceUri(), chapter, functionId, modern);

			this._view.webview.postMessage({ type: 'setFunctionDetails', modern, data: {
				chapter: chapter,
				details: response,
				categoryImages: this.categoryImages
			} });
		}
	}

	private _getHtmlForWebview(webview: vscode.Webview) {
		// Get the local path to main script run in the webview, then convert it to a uri we can use in the webview.
		const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'reference', 'main.js'));

		// Do the same for the stylesheet.
		const styleMainUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'reference', 'main.css'));

		// Use a nonce to only allow a specific script to be run.
		const nonce = getNonce();

		const htmlUri = vscode.Uri.joinPath(this._extensionUri, 'media', 'reference', 'main.html');

		let fs = require("fs");
		let html = fs.readFileSync(htmlUri.fsPath, { encoding:'utf8', flag:'r' })
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
