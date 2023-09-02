import * as vscode from 'vscode';
import { AirCode } from './aircode';
import { getWorkspaceUri } from './extension';
import { FindReferenceResponse } from './responses';

export class ReferenceViewProvider implements vscode.WebviewViewProvider {

	public static readonly viewType = 'codea-reference';

	private _view?: vscode.WebviewView;

	private chapters: any[] = [];
	private categoryImages: { [category: string]: string } = {}
	private isReady = false

	public airCode?: AirCode;
	public referenceToLoad?: FindReferenceResponse;

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
							await this.getChapters(this.referenceToLoad !== undefined);

							if (this.referenceToLoad) {
								await this.getFunctionDetails(this.referenceToLoad.chapter, this.referenceToLoad.function);

								this.referenceToLoad = undefined;
							}

							this.isReady = true;

							break;
						}
					case 'debugMessage':
						{
							console.log(`reference webView debugMessage: ${data.value}`);
							break;
						}
					case 'getChapters':
						{
							this.getChapters(false);

							break;
						}
					case 'getChapterImage':
						{
							const chapter = data.chapter;
							this.getChapterImage(chapter);

							break;
						}
					case 'getFunctions':
						{
							const chapter = data.chapter;
							this.getFunctions(chapter);
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
							this.getFunctionDetails(data.chapter, data.functionId);
							break;
						}
				}
			})();
		});
	}

	public sendChapters() {
		if (this._view) {
			this._view.webview.postMessage({ type: 'setChapters', data: this.chapters });
		}
	}

	public async getChapters(loadOnly: boolean) {
		if (this.chapters.length > 0) {
			this.sendChapters();
			return;
		}
	
		let chapters = await this.airCode?.getChapters(getWorkspaceUri());

		if (chapters) {
			this.chapters = chapters;

			if (!loadOnly) {
				this.sendChapters();
			}
		}
	}

	public async getChapterImage(chapterName: string) {
		let chapterImage = await this.airCode?.getChapterImage(getWorkspaceUri(), chapterName);

		if (chapterImage) {
			let chapter = this.chapters.findIndex(function(chapter) {
				return chapter["name"] == chapterName;
			})

			if (chapter != -1) {
				this.chapters[chapter]["image"] = chapterImage;
			}

			if (this._view) {
				this._view.webview.postMessage({ type: 'setChapterImage', data: {
					chapter: chapterName,
					image: chapterImage}
				});
			}
		}
	}

	public async getFunctions(chapterName: string) {
		let chapter = this.chapters.findIndex(function(chapter) {
			return chapter["name"] == chapterName;
		})

		if (!this.chapters[chapter]["functions"]) {
			let response = await this.airCode?.getFunctions(getWorkspaceUri(), chapterName);

			if (response) {
				this.chapters[chapter]["groups"] = response.groups;
				this.chapters[chapter]["localGroups"] = response.localGroups;
				this.chapters[chapter]["functions"] = response.functions;
			}
		}

		if (this._view) {
			this._view.webview.postMessage({ type: 'setFunctions', data: {
				chapter: chapterName,
				chapterTitle: this.chapters[chapter]["title"],
				chapterImage: this.chapters[chapter]["image"],
				groups: this.chapters[chapter]["groups"],
				localGroups: this.chapters[chapter]["localGroups"],
				functions: this.chapters[chapter]["functions"],
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

	public async getFunctionDetails(chapter: string, functionId: string) {
		if (this._view) {
			let response = await this.airCode?.getFunctionDetails(getWorkspaceUri(), chapter, functionId);

			this._view.webview.postMessage({ type: 'setFunctionDetails', data: {
				chapter: chapter,
				details: response,
				categoryImages: this.categoryImages
			} });
		}
	}

	private _getHtmlForWebview(webview: vscode.Webview) {
		// Get the local path to main script run in the webview, then convert it to a uri we can use in the webview.
		const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'reference', 'main.js'));
		const markedUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'reference', 'marked.min.js'));

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
			.replaceAll('${scriptUri}', scriptUri)
			.replaceAll('${markedUri}', markedUri);

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
