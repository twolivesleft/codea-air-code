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
import { LinkedProject } from './links';
import { CodeaStatus } from './status';
import { isBuiltInCollection, listCodeaProjects, listCollectionProjects, localProjectUri, ProjectNode, ProjectsViewProvider, remoteProjectPath } from './projects';

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
	// A codea:// workspace, as opposed to linked folders, which getWorkspaceUri also maps to codea://
	const isCodeaWorkspace = vscode.workspace.workspaceFolders?.[0]?.uri.scheme == "codea";
	vscode.commands.executeCommand('setContext', 'codea-air-code.hasWorkspaceUri', isCodeaWorkspace);
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


	const status = new CodeaStatus(context);
	airCode.status = status;
	status.setVisible(isCodeaWorkspace);

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

			await syncBeforePlay(found[0]);
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

	if (isCodeaWorkspace) {
		registerPlayCommands();
	}

	// Linked folders sync on start, when the window regains focus, and as files change on disk
	let lastSync = 0;
	function syncLinkedFolders() {
		if (!linkedFolders.isLinked() || linkingMany || Date.now() - lastSync < 2000) {
			return;
		}
		lastSync = Date.now();
		sync.syncAll();
	}

	// Play runs what is on disk. Edits are pushed as they are saved, and Codea reports its own
	// changes, so only older versions of Codea need the project compared first.
	async function syncBeforePlay(project: LinkedProject) {
		if (airCode.watchesFiles) {
			await sync.idle(project);
		} else {
			await sync.sync(project);
		}
	}

	// While many projects are being linked, their first sync is run with progress instead
	let linkingMany = false;

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

	context.subscriptions.push(sync.onDidChangeBusy(busy => status.setSyncing(busy)));

	function linksChanged() {
		vscode.commands.executeCommand('setContext', 'codea-air-code.isLinked', linkedFolders.isLinked());
		vscode.commands.executeCommand('setContext', 'codea-air-code.hasLocalHost', linkedFolders.host() !== undefined);
		updateWatchedPaths();
		airCode.restartLanguageClient();
		status.setVisible(isCodeaWorkspace || linkedFolders.isLinked());
		if (!linkedFolders.isLinked()) {
			sync.dispose();
			return;
		}

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
	// Codea reports changes while connected, so everything is compared only when it connects,
	// or each time the window is focused for versions of Codea that do not report them
	context.subscriptions.push(vscode.window.onDidChangeWindowState(state => {
		if (state.focused && !airCode.watchesFiles) {
			syncLinkedFolders();
		}
	}));
	context.subscriptions.push(airCode.onDidConnect(() => syncLinkedFolders()));
	linksChanged();

	console.log(`"codea-air-code" is now active`);
	
	parametersViewProvider.airCode = airCode;
	referenceViewProvider.airCode = airCode;
	searchViewProvider.airCode = airCode;
	assetKeyOnDropProvider.airCode = airCode;

	context.subscriptions.push(vscode.commands.registerCommand('codea-air-code.showMenu', async () => {
		const items: (vscode.QuickPickItem & { command: string })[] = [];
		if (linkedFolders.isLinked()) {
			items.push({ label: "$(sync) Sync Linked Folders", command: "codea-air-code.syncLinkedFolders" });
		}
		items.push(
			{ label: "$(debug-restart) Reconnect", command: "codea-air-code.refreshConnection" },
			{ label: "$(link) Link Folder to Project...", command: "codea-air-code.linkFolder" },
			{ label: "$(output) Show Output", command: "codea-air-code.showOutput" },
			{ label: "$(book) Get Started with Codea Projects", command: "codea-air-code.showWalkthrough" });
		const choice = await vscode.window.showQuickPick(items, { placeHolder: "Codea" });
		if (choice) {
			await vscode.commands.executeCommand(choice.command);
		}
	}));

	const walkthrough = `${context.extension.id}#linkedFolders`;
	// VS Code never checks off a step whose context already holds when it registers the
	// walkthrough, which it does when the walkthrough is first shown, so these keys are only
	// set once it is open
	let walkthroughShown = false;
	function updateWalkthroughSteps() {
		if (!walkthroughShown) {
			return;
		}
		const hasLocalFolder = vscode.workspace.workspaceFolders?.some(folder => folder.uri.scheme === "file") ?? false;
		vscode.commands.executeCommand('setContext', 'codea-air-code.walkthroughFolderReady', hasLocalFolder);
		vscode.commands.executeCommand('setContext', 'codea-air-code.walkthroughConnected', linkedFolders.host() !== undefined);
		vscode.commands.executeCommand('setContext', 'codea-air-code.walkthroughLinked', linkedFolders.projects().length > 0);
	}
	context.subscriptions.push(linkedFolders.onDidChange(updateWalkthroughSteps));

	context.subscriptions.push(vscode.commands.registerCommand('codea-air-code.showWalkthrough', async () => {
		await vscode.commands.executeCommand('workbench.action.openWalkthrough', walkthrough, false);
		walkthroughShown = true;
		updateWalkthroughSteps();
	}));

	// People who connect to Codea the old way hear about linked folders once
	const introducedKey = 'linkedFoldersIntroduced';
	if (isCodeaWorkspace && !context.globalState.get(introducedKey)) {
		context.globalState.update(introducedKey, true);
		const open = "Open Walkthrough";
		vscode.window.showInformationMessage(
			"Codea Air Code now works with folders on your computer. Your projects can live in a local folder that stays in sync with Codea, so search, source control and AI coding assistants work with them.",
			open, "Not Now").then(choice => {
				if (choice === open) {
					vscode.commands.executeCommand('codea-air-code.showWalkthrough');
				}
			});
	}

	context.subscriptions.push(vscode.commands.registerCommand('codea-air-code.showOutput', () => outputChannel.show()));

	context.subscriptions.push(vscode.workspace.registerFileSystemProvider('codea', airCode, { isCaseSensitive: true }));

	// Play shows the project of the Codea file in focus, or of the last linked file focused
	context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(async (textEditor) => {
		const linked = textEditor && linkedFolders.find(textEditor.document.uri);
		if (linked) {
			lastLinkedFile = textEditor.document.uri;
			if (!linked[1].includes('/')) {
				sync.syncFiles(linked[0], [linked[1]]);
			}
			status.setProject(linked[0].remotePath.split('/').pop());
			return;
		}

		if (textEditor?.document.uri.scheme == "codea") {
			const airCodePath = new AirCodePath(textEditor.document.uri.path);
			status.setProject(airCodePath.collection == ".vscode" ? undefined : airCodePath.project);
			return;
		}

		const lastLinked = lastLinkedFile && linkedFolders.find(lastLinkedFile);
		status.setProject(lastLinked ? lastLinked[0].remotePath.split('/').pop() : undefined);
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
				() => listCodeaProjects(airCode, host));
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

	const projectsView = new ProjectsViewProvider(airCode, linkedFolders);
	context.subscriptions.push(vscode.window.createTreeView(ProjectsViewProvider.viewType, { treeDataProvider: projectsView }));
	context.subscriptions.push(linkedFolders.onDidChange(() => projectsView.refresh()));

	function fileFolder(): vscode.WorkspaceFolder | undefined {
		return vscode.workspace.workspaceFolders?.find(folder => folder.uri.scheme === "file");
	}

	// Projects are kept in a local folder, so commands that get or link them say when none is open
	async function requireFolder(): Promise<vscode.WorkspaceFolder | undefined> {
		const folder = fileFolder();
		if (folder === undefined) {
			const open = "Open Folder";
			const choice = await vscode.window.showInformationMessage(
				"Codea projects are kept in a folder on your computer. Open a folder to work in first, such as an empty one or a repository of Codea projects.",
				open);
			if (choice === open) {
				await vscode.commands.executeCommand('workbench.action.files.openFolder');
			}
		}
		return folder;
	}

	async function requireHost(): Promise<string | undefined> {
		const host = linkedFolders.host();
		if (host === undefined) {
			const connect = "Connect to Codea";
			const choice = await vscode.window.showInformationMessage("Connect this folder to Codea first.", connect);
			if (choice === connect) {
				await vscode.commands.executeCommand('codea-air-code.connect');
			}
		}
		return host;
	}

	context.subscriptions.push(vscode.commands.registerCommand('codea-air-code.refreshProjects', () => projectsView.refresh()));

	context.subscriptions.push(vscode.commands.registerCommand('codea-air-code.connect', async () => {
		const folder = await requireFolder();
		if (folder === undefined) {
			return;
		}
		const host = await pickHost();
		if (host === undefined) {
			return;
		}
		await vscode.workspace.getConfiguration('codea-air-code', folder).update('host', host, vscode.ConfigurationTarget.WorkspaceFolder);
		projectsView.refresh();

		// Choosing the device already saved changes nothing, so say it worked and show the projects
		await vscode.commands.executeCommand(`${ProjectsViewProvider.viewType}.focus`);
		vscode.window.showInformationMessage(`Connected to Codea at ${host}.`);
	}));

	// Downloads a project into the workspace, where Codea itself would keep it, and links it
	context.subscriptions.push(vscode.commands.registerCommand('codea-air-code.getProject', async (node: ProjectNode) => {
		const folder = await requireFolder();
		const host = folder && await requireHost();
		if (folder === undefined || host === undefined) {
			return;
		}

		const localUri = localProjectUri(folder.uri, node.remotePath);

		let existing: [string, vscode.FileType][] = [];
		try {
			existing = await vscode.workspace.fs.readDirectory(localUri);
		} catch {
			// The folder does not exist yet
		}
		if (existing.length > 0) {
			const link = "Link";
			const choice = await vscode.window.showWarningMessage(
				`${vscode.workspace.asRelativePath(localUri)} already exists. Link it to ${node.remotePath} in Codea? Files that differ will be compared before anything is overwritten.`,
				{ modal: true }, link);
			if (choice !== link) {
				return;
			}
		}

		await vscode.workspace.fs.createDirectory(localUri);
		await linkedFolders.addLink(folder, localUri, node.remotePath, host);

		const project = linkedFolders.projects().find(linked => linked.remotePath === node.remotePath);
		if (project) {
			await vscode.window.withProgress(
				{ location: vscode.ProgressLocation.Notification, title: `Getting ${node.name} from Codea...` },
				() => sync.sync(project));
			await vscode.window.showTextDocument(vscode.Uri.joinPath(project.localUri, "Main.lua"));
		}
	}));

	// Links many projects at once: the folders and links are made first, then each project's
	// first sync runs with progress, and files that differ on both sides are asked about together
	async function linkMany(folder: vscode.WorkspaceFolder, host: string, entries: { localUri: vscode.Uri, remotePath: string }[], title: string) {
		linkingMany = true;
		try {
			for (const entry of entries) {
				await vscode.workspace.fs.createDirectory(entry.localUri);
			}
			await linkedFolders.addLinks(folder, entries, host);
		} finally {
			linkingMany = false;
		}

		const remotePaths = new Set(entries.map(entry => entry.remotePath));
		await sync.syncMany(linkedFolders.projects().filter(project => remotePaths.has(project.remotePath)), title);
		projectsView.refresh();
	}

	// Gets every project of Codea, or of one collection, that the folder does not have yet
	context.subscriptions.push(vscode.commands.registerCommand('codea-air-code.getAllProjects', async (collection?: ProjectNode) => {
		const folder = await requireFolder();
		const host = folder && await requireHost();
		if (folder === undefined || host === undefined) {
			return;
		}

		let remotePaths: string[];
		try {
			remotePaths = await vscode.window.withProgress(
				{ location: vscode.ProgressLocation.Notification, title: "Listing Codea projects..." },
				() => collection ? listCollectionProjects(airCode, host, collection.remotePath) : listCodeaProjects(airCode, host));
		} catch (error) {
			vscode.window.showErrorMessage(`Could not list the projects in Codea: ${error}`);
			return;
		}

		const linked = new Set(linkedFolders.projects().map(project => project.remotePath));
		const toGet = remotePaths.filter(path => !linked.has(path) && (collection !== undefined || !isBuiltInCollection(airCode, path)));
		const where = collection ? `in ${collection.name}` : "in Codea";
		if (toGet.length === 0) {
			vscode.window.showInformationMessage(`This folder already has every project ${where}.`);
			return;
		}

		const get = `Get ${toGet.length} Projects`;
		const choice = await vscode.window.showInformationMessage(
			`Get ${toGet.length} projects ${where} into ${folder.name}?`,
			{
				modal: true,
				detail: "Each project is kept in its own folder, the way Codea keeps it, and stays in sync with Codea." +
					(collection ? "" : ` Built-in collections (${airCode.builtInCollections.join(", ")}) are left out.`),
			},
			get);
		if (choice !== get) {
			return;
		}

		await linkMany(folder, host, toGet.map(remotePath => ({ remotePath, localUri: localProjectUri(folder.uri, remotePath) })),
			`Getting projects from Codea`);
	}));

	context.subscriptions.push(vscode.commands.registerCommand('codea-air-code.getCollectionProjects', (collection: ProjectNode) =>
		vscode.commands.executeCommand('codea-air-code.getAllProjects', collection)));

	// Links the folder's projects, kept the way Codea keeps them, to the same projects in Codea
	context.subscriptions.push(vscode.commands.registerCommand('codea-air-code.linkAllFolders', async () => {
		const folder = await requireFolder();
		const host = folder && (linkedFolders.host() ?? await pickHost());
		if (folder === undefined || host === undefined) {
			return;
		}

		const projectFiles = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, '**/*.codea/{Info.plist,Main.lua}'));
		const localFolders = new Map<string, vscode.Uri>();
		for (const file of projectFiles) {
			const localUri = vscode.Uri.joinPath(file, "..");
			const remotePath = remoteProjectPath(folder.uri, localUri);
			if (remotePath !== undefined && !linkedFolders.find(file)) {
				localFolders.set(remotePath, localUri);
			}
		}

		let remotePaths: Set<string>;
		try {
			remotePaths = new Set(await vscode.window.withProgress(
				{ location: vscode.ProgressLocation.Notification, title: "Listing Codea projects..." },
				() => listCodeaProjects(airCode, host)));
		} catch (error) {
			vscode.window.showErrorMessage(`Could not list the projects in Codea: ${error}`);
			return;
		}

		const matches = [...localFolders].filter(([remotePath]) => remotePaths.has(remotePath)).sort(([a], [b]) => a.localeCompare(b));
		const unmatched = localFolders.size - matches.length;
		if (matches.length === 0) {
			vscode.window.showInformationMessage(unmatched > 0
				? `None of the ${unmatched} project folders here has a project of the same name in Codea.`
				: "No unlinked project folders were found here.");
			return;
		}

		const picked = await vscode.window.showQuickPick(
			matches.map(([remotePath, localUri]) => ({ label: remotePath, description: vscode.workspace.asRelativePath(localUri), picked: true })),
			{
				canPickMany: true,
				title: `Link ${matches.length} folders to the same projects in Codea`,
				placeHolder: unmatched > 0 ? `${unmatched} other project folders have no project of the same name in Codea` : undefined,
			});
		if (picked === undefined || picked.length === 0) {
			return;
		}

		await linkMany(folder, host, picked.map(item => ({ remotePath: item.label, localUri: localFolders.get(item.label)! })),
			"Linking projects to Codea");
	}));

	context.subscriptions.push(vscode.commands.registerCommand('codea-air-code.playProject', async (node: ProjectNode) => {
		const project = projectsView.linkedProject(node);
		if (project) {
			lastLinkedFile = vscode.Uri.joinPath(project.localUri, "Main.lua");
			await syncBeforePlay(project);
			await airCode.startHost(linkedFolders.airCodeUri(lastLinkedFile));
		}
	}));

	context.subscriptions.push(vscode.commands.registerCommand('codea-air-code.revealProject', async (node: ProjectNode) => {
		const project = projectsView.linkedProject(node);
		if (project) {
			await vscode.commands.executeCommand('revealInExplorer', project.localUri);
		}
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
