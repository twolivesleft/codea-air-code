import * as path from 'path';
import * as vscode from 'vscode';

import { AirCode } from './aircode';
import { AirCodePath } from './aircodepath';
import { ParametersViewProvider } from './parameters';
import { ReferenceViewProvider } from './reference';
import { SearchViewProvider } from './search';
import { CodeaDebugConfigurationProvider } from './debug-adapter/CodeaDebugConfigurationProvider';
import { CodeaDecorationProvider } from './decorator';
import { InlineDebugAdapterFactory } from './debug-adapter/InlineDebugAdapterFactory';
import { AssetKeyOnDropProvider } from './drop';
import { AirCodeService } from './service';
import { Links } from './links';
import { LinkSync } from './sync';

// The uri commands are sent to: the codea:// workspace folder, or Codea's root for linked folders
export function getWorkspaceUri(): vscode.Uri {
	const folders = vscode.workspace.workspaceFolders;
	if (folders?.length === 1 && folders[0].uri.scheme === "codea") {
		return folders[0].uri;
	}

	const connectionUri = links?.isLinked() ? links.connectionUri() : undefined;
	if (connectionUri) {
		return connectionUri;
	}

	if (folders?.length === 1) {
		return folders[0].uri;
	}

	return vscode.window.activeTextEditor?.document.uri ?? vscode.Uri.parse("");
}

var airCode: AirCode;
var links: Links | undefined;

export function deactivate() {
	airCode.deactivate();
}

export function activate(context: vscode.ExtensionContext) {
	links = new Links(context);
	const linkedFolders = links;

	let workspaceUri = getWorkspaceUri();
	vscode.commands.executeCommand('setContext', 'codea-air-code.hasWorkspaceUri', workspaceUri.scheme == "codea");
	vscode.commands.executeCommand('setContext', 'codea-air-code.isLinked', linkedFolders.isLinked());

	const parametersViewProvider = new ParametersViewProvider(context.extensionUri);
	const referenceViewProvider = new ReferenceViewProvider(context.extensionUri);
	const searchViewProvider = new SearchViewProvider(context.extensionUri);
	const assetKeyOnDropProvider = new AssetKeyOnDropProvider();
	const decorationProvider = new CodeaDecorationProvider();
	const outputChannel = vscode.window.createOutputChannel("Codea", "codea-output");
	const service = new AirCodeService();

	// Start the service to browse for codea-air-code services.
	service.start();

	airCode = new AirCode(
		outputChannel,
		parametersViewProvider,
		referenceViewProvider,
		searchViewProvider,
		context.extension.packageJSON.version);
	airCode.links = linkedFolders;

	const sync = new LinkSync(linkedFolders, airCode, context.workspaceState, outputChannel);
	context.subscriptions.push(sync);

	if (process.env.DEBUG_LSP == "1") {
		console.log("LSP debugging enabled");
		airCode.debugLSP = true;
	}

	//Register configurations	
	const codeaProvider = new CodeaDebugConfigurationProvider();

	context.subscriptions.push(
		vscode.debug.registerDebugConfigurationProvider('luaInline', codeaProvider)
	);

	context.subscriptions.push(
		vscode.debug.registerDebugAdapterDescriptorFactory('luaInline', new InlineDebugAdapterFactory(airCode))
	);
	
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(ParametersViewProvider.viewType, parametersViewProvider)
	);	

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(ReferenceViewProvider.viewType, referenceViewProvider)
	);	

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(SearchViewProvider.viewType, searchViewProvider)
	);	

	// The linked project of the last linked file focused, which Play runs when no editor is open
	let lastLinkedFile: vscode.Uri | undefined;

	// Overwrite the debug actions if we are under a codea workspace or have linked folders
	let playCommandsRegistered = false;
	function registerPlayCommands() {
		if (playCommandsRegistered) {
			return;
		}
		playCommandsRegistered = true;

		context.subscriptions.push(vscode.commands.registerCommand('workbench.action.debug.start', async () => {
			const uri = vscode.window.activeTextEditor?.document.uri;
			if (uri?.scheme == "codea") {
				// The user has clicked the "Start" button or used the keyboard shortcut
				await airCode.startHost(uri);
				return;
			}

			const linkedFile = (uri && linkedFolders.find(uri)) ? uri : lastLinkedFile;
			const found = linkedFile && linkedFolders.find(linkedFile);
			if (linkedFile === undefined || found === undefined) {
				return;
			}

			// Run what is on disk, including edits not pushed yet
			await sync.sync(found[0]);
			await airCode.startHost(linkedFolders.airCodeUri(linkedFile));
		}));

		context.subscriptions.push(vscode.commands.registerCommand('workbench.action.debug.restart', async () => {
			// The user has clicked the "Restart" button or used the keyboard shortcut
			airCode.restart(getWorkspaceUri());
		}));
	
		context.subscriptions.push(vscode.commands.registerCommand('workbench.action.debug.disconnect', () => {
			// The user has clicked the "Disconnect" button or used the keyboard shortcut
			vscode.debug.stopDebugging();
			airCode.stopHost(getWorkspaceUri());
		}));

		outputChannel.show(true);
	}

	if (workspaceUri.scheme == "codea") {
		registerPlayCommands();
	}

	// Linked folders sync on start, when the window regains focus, and as files change on disk
	let lastSync = 0;
	function syncLinkedFolders() {
		if (!linkedFolders.isLinked() || Date.now() - lastSync < 2000) {
			return;
		}
		lastSync = Date.now();
		sync.syncAll();
	}

	// Codea reports changes to the linked projects, and to those of codea:// files open here
	function updateWatchedPaths() {
		const paths = new Set(linkedFolders.projects().map(project => `/${AirCode.rootFolder}/${project.remotePath}`));
		for (const document of vscode.workspace.textDocuments) {
			if (document.uri.scheme === "codea") {
				const airCodePath = new AirCodePath(document.uri.path);
				if (airCodePath.project) {
					const collection = airCodePath.isCloud ? `iCloud/${airCodePath.collection}` : airCodePath.collection;
					paths.add(`/${AirCode.rootFolder}/${collection}/${airCodePath.project}`);
				}
			}
		}
		airCode.setWatchedPaths(getWorkspaceUri(), [...paths].sort());
	}

	const syncItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 98);
	syncItem.text = "$(sync)";
	syncItem.tooltip = "Sync linked folders with Codea";
	syncItem.command = "codea-air-code.syncLinkedFolders";
	context.subscriptions.push(syncItem);
	context.subscriptions.push(sync.onDidChangeBusy(busy => {
		syncItem.text = busy ? "$(sync~spin) Syncing" : "$(sync)";
	}));

	function linksChanged() {
		vscode.commands.executeCommand('setContext', 'codea-air-code.isLinked', linkedFolders.isLinked());
		updateWatchedPaths();
		airCode.restartLanguageClient();
		if (!linkedFolders.isLinked()) {
			syncItem.hide();
			sync.dispose();
			return;
		}

		syncItem.show();
		registerPlayCommands();
		sync.watch();
		lastSync = 0;
		syncLinkedFolders();
	}

	context.subscriptions.push(airCode.filesChanged.event(({ path, files }) => sync.remoteFilesChanged(path, files)));
	context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(updateWatchedPaths));
	context.subscriptions.push(vscode.workspace.onDidCloseTextDocument(updateWatchedPaths));

	// Without change reports from Codea, check the linked folders every few seconds instead
	const fallbackSync = setInterval(() => {
		if (!airCode.watchesFiles && vscode.window.state.focused) {
			lastSync = 0;
			syncLinkedFolders();
		}
	}, 10000);
	context.subscriptions.push({ dispose: () => clearInterval(fallbackSync) });

	context.subscriptions.push(linkedFolders.onDidChange(linksChanged));
	context.subscriptions.push(vscode.window.onDidChangeWindowState(state => {
		if (state.focused) {
			syncLinkedFolders();
		}
	}));
	linksChanged();

	console.log(`"codea-air-code" is now active`);
	
	parametersViewProvider.airCode = airCode;
	referenceViewProvider.airCode = airCode;
	searchViewProvider.airCode = airCode;
	assetKeyOnDropProvider.airCode = airCode;

	airCode.connectionStatusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
	airCode.connectionStatusItem.text = "Not connected";
	airCode.connectionStatusItem.command = "codea-air-code.refreshConnection";
	airCode.connectionStatusItem.tooltip = "Click to refresh connection...";
	airCode.connectionStatusItem.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
	airCode.connectionStatusItem.show();
	context.subscriptions.push(airCode.connectionStatusItem);

	airCode.playProjectItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
	airCode.playProjectItem.text = "";
	airCode.playProjectItem.command = "workbench.action.debug.start";
	airCode.playProjectItem.tooltip = "Click to Play this project in Codea...";
	airCode.playProjectItem.color = "white";
	airCode.playProjectItem.backgroundColor = new vscode.ThemeColor("statusBarItem.prominentBackground");
	context.subscriptions.push(airCode.playProjectItem);

	context.subscriptions.push(vscode.workspace.registerFileSystemProvider('codea', airCode, { isCaseSensitive: true }));

	context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(async (textEditor) => {
		const linked = textEditor && linkedFolders.find(textEditor.document.uri);
		if (linked) {
			lastLinkedFile = textEditor.document.uri;
			if (!linked[1].includes('/')) {
				sync.syncFiles(linked[0], [linked[1]]);
			}
			if (airCode.playProjectItem) {
				airCode.playProjectItem.text = `▶️ Play ${linked[0].remotePath.split('/').pop()} in Codea`;
				airCode.playProjectItem.show();
			}
			return;
		}

		if (textEditor?.document.uri.scheme != "codea") {
			airCode.playProjectItem?.hide();
			return;
		}

		const airCodePath = new AirCodePath(textEditor?.document.uri.path);
		if (airCodePath.collection == ".vscode") {
			airCode.playProjectItem?.hide();
			return;
		}

		if (airCode.playProjectItem) {
			airCode.playProjectItem.text = `▶️ Play ${airCodePath.project} in Codea`;
			airCode.playProjectItem.show();
		}
	}));

	context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(async (textDocument) => {
		if (textDocument.uri.scheme == "codea" && textDocument.eol == vscode.EndOfLine.CRLF) {
			const edit = new vscode.WorkspaceEdit();
			const edits = [vscode.TextEdit.setEndOfLine(vscode.EndOfLine.LF)];
			edit.set(textDocument.uri, edits);
			vscode.workspace.applyEdit(edit);
		}
	}));

	context.subscriptions.push(vscode.workspace.onDidSaveTextDocument((document) => {
        reapplyBreakpoints(document.uri);
    }));

	context.subscriptions.push(vscode.commands.registerCommand('codea-air-code.refreshConnection', async () => {
		await airCode.getSocketForUri(getWorkspaceUri(), true);
	}));

	context.subscriptions.push(vscode.commands.registerCommand('codea-air-code.connectToHost', async () => {
		let defaultPort = "18513";
		let defaultHost = `127.0.0.1:${defaultPort}`;

		await service.pickService().then(async host => {
			if (host === undefined) {
				return;
			}

			if (host == "") {
				host = defaultHost;
			}

			if (!host.includes(":")) {
				host += `:${defaultPort}`;
			}

			let uri = vscode.Uri.parse(`codea://${host}/${AirCode.rootFolder}/`);
			await vscode.commands.executeCommand("vscode.openFolder", uri);
		});
	}));

	context.subscriptions.push(vscode.commands.registerCommand('codea-air-code.connectOverUSB', async () => {
		let defaultCodeaPort = "18513";
		let defaultLocalPort = "18514";

		// Ask for "codeaPort:localPort" instead of two separate inputs.
		let host = await vscode.window.showInputBox({
			placeHolder: `${defaultCodeaPort}:${defaultLocalPort}`,
			prompt: "Enter codeaPort:localPort, for example: '18513:18514'."
		});
		if (host === undefined) {
			vscode.window.showWarningMessage("Connection to Codea was cancelled.");
			return;
		}
		else if (host === "") {
			host = `${defaultCodeaPort}:${defaultLocalPort}`;
		}

		let [codeaPort, localPort] = host.split(":");
		if (localPort === undefined || codeaPort === undefined) {
			vscode.window.showWarningMessage("Invalid input. Connection to Codea was cancelled.");
			return;
		}

		// Make sure the ports are digits only
		if (!/^\d+$/.test(localPort) || !/^\d+$/.test(codeaPort)) {
			vscode.window.showWarningMessage("Invalid input. Connection to Codea was cancelled.");
			return;
		}

		// We're using a special format here so we can tell when USB is used.
		// e.g. codea://18513:18514/ (codeaPort = 18513, localPort = 18514)
		let uri = vscode.Uri.parse(`codea://${host}/${AirCode.rootFolder}/`);
		await vscode.commands.executeCommand("vscode.openFolder", uri);
	}));	

	context.subscriptions.push(vscode.commands.registerCommand('codea-air-code.executeLine', async () => {
		let activeEditor = vscode.window.activeTextEditor;
		let line = activeEditor?.document.lineAt(activeEditor.selection.active.line);
		let text = line?.text;

		if (activeEditor?.document.uri === undefined || text === undefined) {
			return;
		}

		airCode.loadString(linkedFolders.airCodeUri(activeEditor.document.uri), text);
	}));

	context.subscriptions.push(vscode.commands.registerCommand('codea-air-code.executeSelection', async () => {
		let activeEditor = vscode.window.activeTextEditor;
		let text = activeEditor?.document.getText(activeEditor.selection);

		if (activeEditor?.document.uri === undefined || text === undefined) {
			return;
		}

		airCode.loadString(linkedFolders.airCodeUri(activeEditor.document.uri), text);
	}));

	async function findReference(uri: vscode.Uri, text: string) {
		let response = await airCode.findReference(uri, text);

		if (response) {
			if (airCode.referenceView.isReadyAndVisible()) {
				airCode.referenceView.getFunctionDetails(response.chapter, response.function);
			}
			else {
				await vscode.commands.executeCommand("codea-reference.focus");
				airCode.referenceView.referenceToLoad = response;
			}
		}
	}

	context.subscriptions.push(vscode.commands.registerCommand('codea-air-code.selectionReference', async () => {
		let activeEditor = vscode.window.activeTextEditor;
		let text = activeEditor?.document.getText(activeEditor.selection);

		if (activeEditor?.document.uri === undefined || text === undefined) {
			return;
		}

		findReference(linkedFolders.airCodeUri(activeEditor.document.uri), text);
	}));

	context.subscriptions.push(vscode.commands.registerCommand('codea-air-code.textReference', async () => {
		let text = await vscode.window.showInputBox({
			prompt: "Enter the text to lookup."
		});

		if (text === undefined) {
			return;
		}

		findReference(getWorkspaceUri(), text);
	}));

	context.subscriptions.push(vscode.commands.registerCommand('codea-air-code.findInFiles', async () => {
		let query = "";

		const editor = vscode.window.activeTextEditor;
		if (editor) {
			const selection = editor.selection;
			const range = selection.isEmpty ? editor.document.getWordRangeAtPosition(selection.active) : selection;
			if (range && range.isSingleLine) {
				query = editor.document.getText(range);
			}
		}

		await searchViewProvider.show(query);
	}));

	context.subscriptions.push(vscode.commands.registerCommand('codea-air-code.executeCommand', async () => {
		let command = await vscode.window.showInputBox({
			prompt: "Enter a Lua command."
		});

		if (command === undefined) {
			return;
		}

		const uri = getWorkspaceUri();
		if (uri === undefined) {
			return;
		}

		airCode.loadString(uri, command);
	}));

	context.subscriptions.push(vscode.commands.registerCommand('codea-air-code.restartProject', async () => {
		const uri = getWorkspaceUri();
		if (uri === undefined) {
			return;
		}

		airCode.restart(uri);
	}));

	context.subscriptions.push(vscode.commands.registerCommand('codea-air-code.setRuntime', async () => {
		let activeEditor = vscode.window.activeTextEditor;

		const editorUri = activeEditor?.document.uri;
		if (editorUri === undefined) {
			return;
		}
		const uri = linkedFolders.airCodeUri(editorUri);

		let runtime = await vscode.window.showQuickPick(["modern", "legacy"], { placeHolder: "Select runtime" });
		if (runtime === undefined) {
			return;
		}

		await airCode.setRuntime(uri, runtime);

		// The runtime is stored in Info.plist
		const linked = linkedFolders.find(editorUri);
		if (linked) {
			await sync.sync(linked[0]);
		}
	}));

	context.subscriptions.push(vscode.commands.registerCommand('codea-air-code.addDependency', async () => {
		let activeEditor = vscode.window.activeTextEditor;

		const editorUri = activeEditor?.document.uri;
		if (editorUri === undefined) {
			return;
		}
		const uri = linkedFolders.airCodeUri(editorUri);

		const airCodePath = new AirCodePath(uri.path);

		const projects = await airCode.listUnimportedProjects(uri);

		vscode.window.showQuickPick(projects.map(label => ({ label })), { 
			title: `Add a dependency to ${airCodePath.project}`,
			canPickMany: false }).then(async choice => {
			if (choice !== undefined) {
				let response = await airCode.addDependency(uri, choice.label);
				if (response.isFirstDependency) {
					airCode.onDependenciesCreated(airCodePath.collection, airCodePath.project);
				}

				let path = `codea://${uri.authority}/${AirCode.rootFolder}/${airCodePath.project}/Dependencies/${choice}`;
				let newUri = vscode.Uri.parse(path);
				airCode.fileCreated(newUri);	

				// Dependencies are stored in Info.plist
				const linked = linkedFolders.find(editorUri);
				if (linked) {
					await sync.sync(linked[0]);
				}
			}
		});
	}));

	async function pickHost(): Promise<string | undefined> {
		const defaultPort = "18513";
		let host = await service.pickService();
		if (host === undefined) {
			return undefined;
		}
		if (host == "") {
			host = `127.0.0.1:${defaultPort}`;
		}
		if (!host.includes(":")) {
			host += `:${defaultPort}`;
		}
		return host;
	}

	// Projects in Codea as paths under /Codea, e.g. "iPad Projects/EmuTests" or "iCloud/Collection/Project"
	async function listCodeaProjects(host: string): Promise<string[]> {
		const root = vscode.Uri.from({ scheme: 'codea', authority: host, path: `/${AirCode.rootFolder}` });
		const folders = async (uri: vscode.Uri) =>
			(await airCode.readDirectory(uri)).filter(([, type]) => type === vscode.FileType.Directory).map(([name]) => name);

		const projects: string[] = [];
		for (const collection of await folders(root)) {
			if (collection === ".vscode") {
				continue;
			}
			if (collection === "iCloud") {
				for (const cloudCollection of await folders(vscode.Uri.joinPath(root, collection))) {
					for (const project of await folders(vscode.Uri.joinPath(root, collection, cloudCollection))) {
						projects.push(`${collection}/${cloudCollection}/${project}`);
					}
				}
				continue;
			}
			for (const project of await folders(vscode.Uri.joinPath(root, collection))) {
				projects.push(`${collection}/${project}`);
			}
		}
		return projects;
	}

	context.subscriptions.push(vscode.commands.registerCommand('codea-air-code.linkFolder', async (target?: vscode.Uri) => {
		let localUri = target;
		if (localUri === undefined) {
			const editorUri = vscode.window.activeTextEditor?.document.uri;
			const picked = await vscode.window.showOpenDialog({
				canSelectFiles: false,
				canSelectFolders: true,
				defaultUri: editorUri?.scheme === "file" ? vscode.Uri.joinPath(editorUri, "..") : vscode.workspace.workspaceFolders?.[0]?.uri,
				openLabel: "Link to Codea",
			});
			localUri = picked?.[0];
		}
		if (localUri === undefined) {
			return;
		}

		const folder = vscode.workspace.getWorkspaceFolder(localUri);
		if (folder === undefined || folder.uri.scheme !== "file") {
			vscode.window.showErrorMessage("Open the folder in VS Code before linking it: the link is saved in its .vscode/settings.json.");
			return;
		}

		const host = linkedFolders.host() ?? await pickHost();
		if (host === undefined) {
			return;
		}

		let projects: string[];
		try {
			projects = await vscode.window.withProgress(
				{ location: vscode.ProgressLocation.Notification, title: "Listing Codea projects..." },
				() => listCodeaProjects(host));
		} catch (error) {
			vscode.window.showErrorMessage(`Could not list the projects in Codea: ${error}`);
			return;
		}

		// Codea stores a project as "Name.codea", inside its collection's folder
		const parts = localUri.path.split('/');
		const localName = parts.pop()!.replace(/\.codea$/, '');
		const localCollection = parts.pop();
		const items = projects.map(project => ({ label: project, picked: false }));
		const guess = items.find(item => item.label === `${localCollection}/${localName}`)
			?? items.find(item => item.label.endsWith(`/${localName}`));
		if (guess) {
			items.splice(items.indexOf(guess), 1);
			items.unshift({ ...guess, picked: true });
		}

		const choice = await vscode.window.showQuickPick(items, {
			title: `Link ${vscode.workspace.asRelativePath(localUri)} to a Codea project`,
			placeHolder: "Codea project",
		});
		if (choice === undefined) {
			return;
		}

		await linkedFolders.addLink(folder, localUri, choice.label, host);
		vscode.window.showInformationMessage(`${vscode.workspace.asRelativePath(localUri)} is linked to ${choice.label} in Codea.`);
	}));

	context.subscriptions.push(vscode.commands.registerCommand('codea-air-code.syncLinkedFolders', async () => {
		lastSync = 0;
		await sync.syncAll();
	}));

	context.subscriptions.push(vscode.languages.registerDocumentDropEditProvider({ language: 'lua' }, assetKeyOnDropProvider));

	context.subscriptions.push(vscode.window.registerFileDecorationProvider(decorationProvider));
}

function reapplyBreakpoints(uri: vscode.Uri) {
    const breakpoints = vscode.debug.breakpoints;

    // Filter breakpoints for the saved document
    const fileBreakpoints = breakpoints.filter(bp => bp instanceof vscode.SourceBreakpoint && bp.location.uri.toString() === uri.toString());

    // Remove breakpoints for the current file
    vscode.debug.removeBreakpoints(fileBreakpoints);

    // Re-add the breakpoints
    setTimeout(() => {
        fileBreakpoints.forEach(bp => {
            if (bp instanceof vscode.SourceBreakpoint) {
                const newBp = new vscode.SourceBreakpoint(bp.location, bp.enabled, bp.condition, bp.hitCondition, bp.logMessage);
                vscode.debug.addBreakpoints([newBp]);
            }
        });
    }, 100); // Delay to ensure the breakpoints are properly re-added. Adjust as necessary.
}
