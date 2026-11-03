import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as vscode from 'vscode';

import { AirCode } from './aircode';
import { AirCodePath } from './aircodepath';
import { AssetNode, AssetsViewProvider } from './assets';
import { ParametersViewProvider } from './parameters';
import { ReferenceViewProvider } from './reference';
import { LuaDefinitions } from './luals';
import { CodeaDecorationProvider } from './decorator';
import { InlineDebugAdapterFactory } from './debug-adapter/InlineDebugAdapterFactory';
import { AssetKeyOnDropProvider } from './drop';
import { AirCodeService } from './service';
import { isAssetPack, Links } from './links';
import { LinkSync } from './sync';
import { LinkedProject } from './links';
import { CodeaStatus } from './status';
import { collectionOfFolder } from './layout';
import { isBuiltInCollection, listCodeaProjects, listCollectionProjects, listCollections, localProjectUri, DependencyNode, ProjectNode, ProjectsViewProvider, remoteProjectPath } from './projects';

// The uri commands are sent to: Codea's root on the linked folders' host
export function getWorkspaceUri(): vscode.Uri {
	const folders = vscode.workspace.workspaceFolders;
	const connectionUri = links?.connectionUri();
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
	const luaDefinitions = new LuaDefinitions(context, linkedFolders);
	context.subscriptions.push(vscode.extensions.onDidChange(() => luaDefinitions.update()));
	context.subscriptions.push(luaDefinitions.watch());
	context.subscriptions.push(vscode.commands.registerCommand('codea-air-code.setUpGoToDefinition', () => luaDefinitions.setUp()));

	let workspaceUri = getWorkspaceUri();
	vscode.commands.executeCommand('setContext', 'codea-air-code.isLinked', linkedFolders.isLinked());

	const parametersViewProvider = new ParametersViewProvider(context.extensionUri);
	const referenceViewProvider = new ReferenceViewProvider(context.extensionUri);
	const assetKeyOnDropProvider = new AssetKeyOnDropProvider();
	const outputChannel = vscode.window.createOutputChannel("Codea", "codea-output");
	const service = new AirCodeService();

	// Start the service to browse for codea-air-code services.
	service.start();

	airCode = new AirCode(
		outputChannel,
		parametersViewProvider,
		referenceViewProvider,
		context.extension.packageJSON.version);
	airCode.links = linkedFolders;

	// Disconnecting lasts until connecting again, across reloads and restarts. It is kept in a
	// file written at once: workspaceState is saved later and is lost if VS Code is killed.
	const disconnectedFile = context.storageUri && path.join(context.storageUri.fsPath, 'disconnected');
	airCode.disconnected = disconnectedFile !== undefined && fs.existsSync(disconnectedFile);
	function setDisconnected(disconnected: boolean) {
		airCode.disconnected = disconnected;
		if (disconnectedFile === undefined) {
			return;
		}
		if (disconnected) {
			fs.mkdirSync(path.dirname(disconnectedFile), { recursive: true });
			fs.writeFileSync(disconnectedFile, '');
		} else if (fs.existsSync(disconnectedFile)) {
			fs.unlinkSync(disconnectedFile);
		}
	}


	const status = new CodeaStatus(context);
	airCode.status = status;
	status.setVisible(false);

	const storage = context.storageUri?.fsPath ?? context.globalStorageUri.fsPath;
	const sync = new LinkSync(linkedFolders, airCode, LinkSync.storeIn(path.join(storage, 'sync')), outputChannel);
	context.subscriptions.push({ dispose: () => sync.flush() });
	context.subscriptions.push(sync);

	if (process.env.DEBUG_LSP == "1") {
		console.log("LSP debugging enabled");
		airCode.debugLSP = true;
	}

	context.subscriptions.push(
		vscode.debug.registerDebugAdapterDescriptorFactory('luaInline', new InlineDebugAdapterFactory(airCode))
	);
	
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(ParametersViewProvider.viewType, parametersViewProvider)
	);	

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(ReferenceViewProvider.viewType, referenceViewProvider)
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

			const focused = uri && linkedFolders.find(uri);
			const linkedFile = focused && !isAssetPack(focused[0]) ? uri : lastLinkedFile ?? await pickProjectToPlay();
			const found = linkedFile && linkedFolders.find(linkedFile);
			if (linkedFile === undefined || found === undefined) {
				return;
			}

			await syncBeforePlay(found[0]);
			await airCode.startHost(linkedFolders.airCodeUri(linkedFile));
		}));

		// With no linked file focused yet: the only linked project, or the one picked
		async function pickProjectToPlay(): Promise<vscode.Uri | undefined> {
			const projects = linkedFolders.projects().filter(project => !isAssetPack(project));
			const picked = projects.length === 1 ? projects[0] : (await vscode.window.showQuickPick(
				projects.map(project => ({ label: project.remotePath.split('/').pop()!, description: project.remotePath, project })),
				{ title: "Play which project?" }))?.project;
			return picked && vscode.Uri.joinPath(picked.localUri, "Main.lua");
		}

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
		luaDefinitions.update();
		vscode.commands.executeCommand('setContext', 'codea-air-code.isLinked', linkedFolders.isLinked());
		vscode.commands.executeCommand('setContext', 'codea-air-code.hasLocalHost', linkedFolders.host() !== undefined);
		vscode.commands.executeCommand('setContext', 'codea-air-code.linkedFolders', linkedFolders.projects().map(project => project.localUri.fsPath));
		updateWatchedPaths();
		airCode.restartLanguageClient();
		// A folder with a Codea host is connected, linked projects or not
		const connectionUri = linkedFolders.connectionUri();
		status.setVisible(connectionUri !== undefined);
		if (airCode.disconnected && connectionUri !== undefined) {
			status.setConnection('disconnected', connectionUri.authority);
		}
		if (connectionUri !== undefined) {
			airCode.getSocketForUri(connectionUri, false);
		}
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
	assetKeyOnDropProvider.airCode = airCode;

	context.subscriptions.push(vscode.commands.registerCommand('codea-air-code.showMenu', async () => {
		const items: (vscode.QuickPickItem & { command: string })[] = [];
		const host = linkedFolders.host();
		if (airCode.disconnected) {
			items.push({ label: "$(plug) Connect", description: host, command: "codea-air-code.refreshConnection" });
		} else {
			if (linkedFolders.isLinked()) {
				items.push({ label: "$(sync) Sync Linked Folders", command: "codea-air-code.syncLinkedFolders" });
			}
			items.push({ label: "$(debug-restart) Reconnect", description: host, command: "codea-air-code.refreshConnection" });
			if (host !== undefined) {
				items.push({ label: "$(debug-disconnect) Disconnect", command: "codea-air-code.disconnect" });
			}
		}
		if (host !== undefined) {
			items.push({ label: "$(device-mobile) Connect to Another Device...", command: "codea-air-code.connect" });
		}
		items.push(
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

	// A window on codea://, the way Air Code used to work, is moved to a local folder: the
	// host and the projects open here are kept for when that folder opens, in a file written
	// at once, as the window closes before globalState is saved
	const movingFile = path.join(context.globalStorageUri.fsPath, 'moving.json');
	const codeaFolder = vscode.workspace.workspaceFolders?.find(folder => folder.uri.scheme === "codea");
	vscode.commands.executeCommand('setContext', 'codea-air-code.isCodeaWindow', codeaFolder !== undefined);
	if (codeaFolder) {
		const choose = "Choose a Folder...";
		vscode.window.showInformationMessage(
			"Codea Air Code now keeps your projects in a folder on your computer, in sync with Codea, so search, source control and AI coding assistants work with them. Choose a folder to move this window to.",
			choose, "Not Now").then(choice => {
				if (choice === choose) {
					moveToFolder(codeaFolder);
				}
			});
	} else {
		arriveFromCodeaWorkspace();
	}

	context.subscriptions.push(vscode.commands.registerCommand('codea-air-code.moveToFolder', () => codeaFolder && moveToFolder(codeaFolder)));

	async function moveToFolder(codeaFolder: vscode.WorkspaceFolder) {
		// The dialog browses the window's file system, codea:// here, unless it starts on a local one
		const folder = (await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, canSelectMany: false, openLabel: "Use This Folder", defaultUri: vscode.Uri.file(os.homedir()) }))?.[0];
		if (folder === undefined || folder.scheme !== "file") {
			return;
		}
		const projects = new Set<string>();
		for (const document of vscode.workspace.textDocuments) {
			const airCodePath = new AirCodePath(document.uri.path);
			if (document.uri.scheme === "codea" && airCodePath.project) {
				projects.add(`${airCodePath.isCloud ? "iCloud/" : ""}${airCodePath.collection}/${airCodePath.project}`);
			}
		}
		fs.mkdirSync(path.dirname(movingFile), { recursive: true });
		fs.writeFileSync(movingFile, JSON.stringify({ folder: folder.fsPath, host: codeaFolder.uri.authority, projects: [...projects] }));
		// The extension starts in a folder that has settings, and an empty one has none yet
		const settings = vscode.Uri.joinPath(folder, '.vscode', 'settings.json');
		if (!fs.existsSync(settings.fsPath)) {
			await vscode.workspace.fs.writeFile(settings, new TextEncoder().encode(JSON.stringify({ "codea-air-code.host": codeaFolder.uri.authority }, null, 4) + '\n'));
		}
		await vscode.commands.executeCommand('vscode.openFolder', folder);
	}

	async function arriveFromCodeaWorkspace() {
		let moving: { folder: string, host: string, projects: string[] } | undefined;
		try {
			moving = JSON.parse(fs.readFileSync(movingFile, 'utf8'));
		} catch {
			return;
		}
		const folder = vscode.workspace.workspaceFolders?.find(folder => folder.uri.fsPath === moving?.folder);
		if (moving === undefined || folder === undefined) {
			return;
		}
		fs.rmSync(movingFile, { force: true });
		const connected = new Promise<void>(resolve => {
			const listener = airCode.onDidConnect(() => { listener.dispose(); resolve(); });
		});
		await vscode.workspace.getConfiguration('codea-air-code', folder).update('host', moving.host, vscode.ConfigurationTarget.WorkspaceFolder);
		await vscode.commands.executeCommand(`${ProjectsViewProvider.viewType}.focus`);
		if (moving.projects.length === 0) {
			return;
		}
		await connected;
		const names = moving.projects.map(project => project.split('/').pop()).join(", ");
		const one = moving.projects.length === 1;
		const get = one ? "Get Project" : "Get Projects";
		if (await vscode.window.showInformationMessage(`Get the ${one ? "project" : "projects"} you had open in Codea (${names}) into this folder? ${one ? "It stays" : "They stay"} in sync with Codea.`, get, "Not Now") === get) {
			for (const project of moving.projects) {
				await getProject(folder, moving.host, project);
			}
		}
	}

	context.subscriptions.push(vscode.commands.registerCommand('codea-air-code.showOutput', () => outputChannel.show()));

	context.subscriptions.push(vscode.workspace.registerFileSystemProvider('codea', airCode, { isCaseSensitive: true }));

	// Play shows the project of the Codea file in focus, or of the last linked file focused
	context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(async (textEditor) => {
		const linked = textEditor && linkedFolders.find(textEditor.document.uri);
		if (linked && !isAssetPack(linked[0])) {
			lastLinkedFile = textEditor.document.uri;
			if (!linked[1].includes('/')) {
				sync.syncFiles(linked[0], [linked[1]], 'full');
			}
			status.setProject(linked[0].remotePath.split('/').pop());
			return;
		}

		if (textEditor?.document.uri.scheme == "codea") {
			const airCodePath = new AirCodePath(textEditor.document.uri.path);
			status.setProject(airCodePath.project);
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
		setDisconnected(false);
		lastSync = 0;
		await airCode.getSocketForUri(getWorkspaceUri(), true);
	}));

	// Stays disconnected until connected again from the Codea menu; edits made meanwhile are
	// compared and synced when it reconnects
	context.subscriptions.push(vscode.commands.registerCommand('codea-air-code.disconnect', async () => {
		const connectionUri = linkedFolders.connectionUri();
		if (connectionUri === undefined) {
			return;
		}
		setDisconnected(true);
		await airCode.closeConnection(connectionUri);
		status.setConnection('disconnected');
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

	// Looks in the reference of the active project's runtime first, then in the other one
	async function findReference(uri: vscode.Uri, text: string) {
		const modernFirst = airCode.referenceView.activeProjectIsModern() ?? true;
		const references = airCode.hasModernReference ? [modernFirst, !modernFirst] : [false];

		for (const modern of references) {
			// Codea answers a name it doesn't know with no data, which arrives as an error
			const response = await Promise.resolve(airCode.findReference(uri, text, modern)).catch(() => undefined);

			if (!response) {
				continue;
			}

			await airCode.referenceView.show({ ...response, modern });
			return;
		}
	}

	context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(() => {
		const modern = airCode.referenceView.activeProjectIsModern();
		if (modern !== undefined && airCode.hasModernReference) {
			airCode.referenceView.showTab(modern);
		}
	}));

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

	// Adds a dependency to the project of the focused file, or to a project in the Projects view.
	// Codea writes it as its editor does: a require on the modern runtime, in Info.plist on the legacy one.
	context.subscriptions.push(vscode.commands.registerCommand('codea-air-code.addDependency', async (target?: ProjectNode) => {
		const host = linkedFolders.host();
		const editorUri = vscode.window.activeTextEditor?.document.uri;
		const uri = target instanceof ProjectNode && host !== undefined
			? vscode.Uri.from({ scheme: 'codea', authority: host, path: `/${AirCode.rootFolder}/${target.remotePath}` })
			: editorUri && linkedFolders.airCodeUri(editorUri);
		if (uri === undefined) {
			return;
		}
		const airCodePath = new AirCodePath(uri.path);

		const projects = await airCode.listUnimportedProjects(uri);
		const choice = await vscode.window.showQuickPick(projects.map(label => ({ label })), {
			title: `Add a dependency to ${airCodePath.project}`,
			canPickMany: false });
		if (choice === undefined) {
			return;
		}
		await airCode.addDependency(uri, choice.label);
		await dependenciesChanged(uri);
	}));

	context.subscriptions.push(vscode.commands.registerCommand('codea-air-code.removeDependency', async (node: DependencyNode) => {
		const host = linkedFolders.host();
		if (host === undefined) {
			return;
		}
		const projectUri = vscode.Uri.from({ scheme: 'codea', authority: host, path: `/${AirCode.rootFolder}/${node.dependent.remotePath}` });
		try {
			await airCode.delete(vscode.Uri.joinPath(projectUri, 'Dependencies', node.project), { recursive: false });
		} catch (error) {
			vscode.window.showErrorMessage(`Could not remove ${node.project} from ${node.dependent.name}: ${error}`);
			return;
		}
		await dependenciesChanged(projectUri);
	}));

	// Codea changed the project's code or Info.plist, which is brought here at once
	async function dependenciesChanged(remoteUri: vscode.Uri) {
		const linked = linkedFolders.projects().find(project => remoteUri.path === `/${AirCode.rootFolder}/${project.remotePath}`
			|| remoteUri.path.startsWith(`/${AirCode.rootFolder}/${project.remotePath}/`));
		if (linked) {
			await sync.sync(linked);
		}
		projectsView.refresh();
	}

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

		sync.startAfresh([{ localUri, remotePath: choice.label }]);
		await linkedFolders.addLink(folder, localUri, choice.label, host);
		vscode.window.showInformationMessage(`${vscode.workspace.asRelativePath(localUri)} is linked to ${choice.label} in Codea.`);
	}));

	const assetsView = new AssetsViewProvider(airCode, linkedFolders);
	const assetsTree = vscode.window.createTreeView(AssetsViewProvider.viewType, { treeDataProvider: assetsView, dragAndDropController: assetsView });
	context.subscriptions.push(assetsTree);
	context.subscriptions.push(vscode.commands.registerCommand('codea-air-code.refreshAssets', () => assetsView.refresh()));
	context.subscriptions.push(vscode.commands.registerCommand('codea-air-code.addAssetFiles', (node: AssetNode) => assetsView.addFiles(node)));
	// Links a pack Codea lets be written to with a folder here, Assets/Pack, kept in sync like a project
	context.subscriptions.push(vscode.commands.registerCommand('codea-air-code.linkAssetPack', async (node: AssetNode) => {
		const folder = await requireFolder();
		const host = folder && await requireHost();
		if (folder === undefined || host === undefined) {
			return;
		}
		const remotePath = node.uri.path.slice(`/${AirCode.rootFolder}/`.length);
		const name = remotePath.split('/').pop()!;
		const localUri = vscode.Uri.joinPath(folder.uri, 'Assets', name);

		let existing: [string, vscode.FileType][] = [];
		try {
			existing = await vscode.workspace.fs.readDirectory(localUri);
		} catch {
			// The folder does not exist yet
		}
		if (existing.length > 0) {
			const link = "Link";
			const choice = await vscode.window.showWarningMessage(
				`${vscode.workspace.asRelativePath(localUri)} already exists. Link it to ${name} in Codea? Files that differ will be compared before anything is overwritten.`,
				{ modal: true }, link);
			if (choice !== link) {
				return;
			}
		}

		await vscode.workspace.fs.createDirectory(localUri);
		sync.startAfresh([{ localUri, remotePath }]);
		await linkedFolders.addLink(folder, localUri, remotePath, host);
		const pack = linkedFolders.projects().find(linked => linked.remotePath === remotePath);
		if (pack) {
			await vscode.window.withProgress(
				{ location: vscode.ProgressLocation.Notification, title: `Getting ${name} from Codea...` },
				() => sync.sync(pack));
			await vscode.commands.executeCommand('revealInExplorer', localUri);
		}
		assetsView.refresh();
	}));
	context.subscriptions.push(vscode.commands.registerCommand('codea-air-code.revealAssetPack', async (node: AssetNode) => {
		const linked = assetsView.linkedFolder(node);
		if (linked) {
			await vscode.commands.executeCommand('revealInExplorer', linked);
		}
	}));

	// From a menu the item comes with the command; from a key, it is the one selected
	const assetTarget = (node?: AssetNode) => node instanceof AssetNode ? node : assetsTree.selection[0];
	context.subscriptions.push(vscode.commands.registerCommand('codea-air-code.renameAsset', (node?: AssetNode) => {
		const target = assetTarget(node);
		return target?.writable && target.depth > 1 ? assetsView.rename(target) : undefined;
	}));
	context.subscriptions.push(vscode.commands.registerCommand('codea-air-code.deleteAsset', (node?: AssetNode) => {
		const target = assetTarget(node);
		return target?.writable && target.depth > 1 ? assetsView.delete(target) : undefined;
	}));
	context.subscriptions.push(linkedFolders.onDidChange(() => assetsView.refresh()));

	const projectsView = new ProjectsViewProvider(airCode, linkedFolders, context.workspaceState);
	const projectsTree = vscode.window.createTreeView(ProjectsViewProvider.viewType, { treeDataProvider: projectsView });
	context.subscriptions.push(projectsTree);
	const updateProjectsMessage = () => {
		projectsTree.message = projectsView.linkedOnly && linkedFolders.projects().filter(project => !isAssetPack(project)).length === 0
			? "No project is linked. Show all projects to get or link one."
			: undefined;
	};
	updateProjectsMessage();
	context.subscriptions.push(linkedFolders.onDidChange(() => {
		projectsView.refresh();
		updateProjectsMessage();
	}));
	for (const [command, linkedOnly] of [['codea-air-code.showLinkedProjectsOnly', true], ['codea-air-code.showAllProjects', false]] as const) {
		context.subscriptions.push(vscode.commands.registerCommand(command, async () => {
			await projectsView.setLinkedOnly(linkedOnly);
			updateProjectsMessage();
		}));
	}

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
		setDisconnected(false);
		await vscode.workspace.getConfiguration('codea-air-code', folder).update('host', host, vscode.ConfigurationTarget.WorkspaceFolder);

		// Choosing the device already saved changes no setting, so the connection is opened here
		const socket = await airCode.getSocketForUri(linkedFolders.connectionUri()!, true);
		projectsView.refresh();
		if (socket !== undefined) {
			await vscode.commands.executeCommand(`${ProjectsViewProvider.viewType}.focus`);
			vscode.window.showInformationMessage(`Connected to Codea at ${host}.`);
		}
	}));

	context.subscriptions.push(vscode.commands.registerCommand('codea-air-code.getProject', async (node: ProjectNode) => {
		const folder = await requireFolder();
		const host = folder && await requireHost();
		if (folder === undefined || host === undefined) {
			return;
		}
		await getProject(folder, host, node.remotePath);
	}));

	// Downloads a project into the workspace, where Codea itself would keep it, and links it
	async function getProject(folder: vscode.WorkspaceFolder, host: string, remotePath: string) {
		const localUri = localProjectUri(folder.uri, remotePath);

		let existing: [string, vscode.FileType][] = [];
		try {
			existing = await vscode.workspace.fs.readDirectory(localUri);
		} catch {
			// The folder does not exist yet
		}
		if (existing.length > 0) {
			const link = "Link";
			const choice = await vscode.window.showWarningMessage(
				`${vscode.workspace.asRelativePath(localUri)} already exists. Link it to ${remotePath} in Codea? Files that differ will be compared before anything is overwritten.`,
				{ modal: true }, link);
			if (choice !== link) {
				return;
			}
		}

		await vscode.workspace.fs.createDirectory(localUri);
		sync.startAfresh([{ localUri, remotePath }]);
		await linkedFolders.addLink(folder, localUri, remotePath, host);

		const project = linkedFolders.projects().find(linked => linked.remotePath === remotePath);
		if (project) {
			await vscode.window.withProgress(
				{ location: vscode.ProgressLocation.Notification, title: `Getting ${remotePath.split('/').pop()} from Codea...` },
				() => sync.sync(project));
			await vscode.window.showTextDocument(vscode.Uri.joinPath(project.localUri, "Main.lua"));
		}
	}

	// Creates a project in Codea and gets it. From a folder in the Explorer or a collection in the
	// Projects view, the project goes in that collection; otherwise the collection is asked for.
	// The name is asked for unless given; from the Explorer the second argument is the selection.
	context.subscriptions.push(vscode.commands.registerCommand('codea-air-code.newProject', async (target?: vscode.Uri | ProjectNode, nameOrSelection?: unknown) => {
		const givenName = typeof nameOrSelection === 'string' ? nameOrSelection : undefined;
		const folder = await requireFolder();
		const host = folder && await requireHost();
		if (folder === undefined || host === undefined) {
			return;
		}
		const codeaUri = (path: string) => vscode.Uri.from({ scheme: 'codea', authority: host, path: `/${AirCode.rootFolder}/${path}` });

		let collections: string[];
		try {
			await airCode.ensureResponsive(codeaUri(''));
			collections = (await listCollections(airCode, host)).filter(collection => !isBuiltInCollection(airCode, collection));
		} catch (error) {
			vscode.window.showErrorMessage(`Could not list the collections in Codea: ${error}`);
			return;
		}

		let collection = target instanceof ProjectNode ? target.remotePath
			: target instanceof vscode.Uri ? collectionOfFolder(path.posix.relative(folder.uri.path, target.path))
			: undefined;
		if (collection === undefined) {
			const newCollection = "$(add) New Collection...";
			const picked = await vscode.window.showQuickPick(
				["Documents", ...collections.filter(name => name !== "Documents"), newCollection],
				{ title: "New Codea Project", placeHolder: "Collection" });
			collection = picked === newCollection
				? (await vscode.window.showInputBox({ title: "New Codea Collection", prompt: "Collection name", validateInput: validName }))?.trim()
				: picked;
			if (collection === undefined) {
				return;
			}
		}

		const existing = collections.includes(collection)
			? (await listCollectionProjects(airCode, host, collection)).map(path => path.split('/').pop()!.toLowerCase())
			: [];
		const validProjectName = (value: string) => validName(value)
			?? (existing.includes(value.trim().toLowerCase()) ? `${collection} already has a project named ${value.trim()}.` : undefined);
		if (givenName !== undefined && validProjectName(givenName) !== undefined) {
			vscode.window.showErrorMessage(validProjectName(givenName)!);
			return;
		}
		const name = (givenName ?? await vscode.window.showInputBox({
			title: `New Codea Project in ${collection}`,
			prompt: "Project name",
			validateInput: validProjectName,
		}))?.trim();
		if (name === undefined) {
			return;
		}

		// Codea creates both after answering, so each is waited for
		const created = await vscode.window.withProgress(
			{ location: vscode.ProgressLocation.Notification, title: `Creating ${name} in Codea...` },
			async () => {
				if (!collections.includes(collection!)) {
					await airCode.createFolder(codeaUri(collection!));
					if (!await waitFor(codeaUri(collection!.split('/').slice(0, -1).join('/')), collection!.split('/').pop()!)) {
						return false;
					}
				}
				await airCode.createFolder(codeaUri(`${collection}/${name}`));
				return waitFor(codeaUri(`${collection}/${name}`), "Main.lua");
			});
		if (!created) {
			vscode.window.showErrorMessage(`Codea did not create ${name} in ${collection}.`);
			return;
		}

		projectsView.refresh();
		await getProject(folder, host, `${collection}/${name}`);
	}));

	// Deletes a project in Codea, after asking, then its linked folder here. The link goes first,
	// so neither the folder going nor Codea's report of the deletion is synced.
	// Stops keeping a folder in sync; its files stay as they are, here and in Codea
	context.subscriptions.push(vscode.commands.registerCommand('codea-air-code.unlinkFolder', async (target?: vscode.Uri | ProjectNode) => {
		let linked = target instanceof ProjectNode
			? linkedFolders.projects().find(project => project.remotePath === target.remotePath)
			: target && linkedFolders.projects().find(project => project.localUri.fsPath === target.fsPath);
		if (target === undefined) {
			const pick = await vscode.window.showQuickPick(
				linkedFolders.projects().map(project => ({ label: vscode.workspace.asRelativePath(project.localUri), description: project.remotePath, project })),
				{ title: "Unlink a folder from Codea" });
			linked = pick?.project;
		}
		if (linked === undefined) {
			return;
		}
		await sync.unlink([linked]);
		vscode.window.showInformationMessage(`${vscode.workspace.asRelativePath(linked.localUri)} is no longer kept in sync with ${linked.remotePath}. Its files stay here and in Codea.`);
	}));

	context.subscriptions.push(vscode.commands.registerCommand('codea-air-code.deleteProject', async (target: vscode.Uri | ProjectNode) => {
		const folder = await requireFolder();
		const host = folder && await requireHost();
		if (folder === undefined || host === undefined) {
			return;
		}
		const linked = target instanceof ProjectNode
			? linkedFolders.projects().find(project => project.remotePath === target.remotePath)
			: linkedFolders.projects().find(project => project.localUri.path === target.path);
		const remotePath = target instanceof ProjectNode ? target.remotePath : linked?.remotePath;
		if (remotePath === undefined) {
			vscode.window.showErrorMessage(`${vscode.workspace.asRelativePath(target as vscode.Uri)} is not linked to a project in Codea.`);
			return;
		}
		const projectUri = vscode.Uri.from({ scheme: 'codea', authority: host, path: `/${AirCode.rootFolder}/${remotePath}` });

		let files: number;
		try {
			await airCode.ensureResponsive(projectUri);
			files = (await airCode.readDirectory(projectUri)).filter(([, type]) => type === vscode.FileType.File).length;
		} catch (error) {
			vscode.window.showErrorMessage(`Could not read ${remotePath} in Codea: ${error}`);
			return;
		}
		const deleteProject = "Delete Project";
		const choice = await vscode.window.showWarningMessage(
			`Delete ${remotePath} in Codea? Its ${files} ${files === 1 ? "file" : "files"} will be deleted on the device, where they cannot be recovered.`,
			{ modal: true, detail: linked ? `${vscode.workspace.asRelativePath(linked.localUri)} here goes to the Trash.` : undefined },
			deleteProject);
		if (choice !== deleteProject) {
			return;
		}

		if (linked) {
			await sync.unlink([linked]);
		}
		const collectionUri = projectUri.with({ path: projectUri.path.split('/').slice(0, -1).join('/') });
		const deleted = await vscode.window.withProgress(
			{ location: vscode.ProgressLocation.Notification, title: `Deleting ${remotePath} in Codea...` },
			async () => {
				try {
					await airCode.delete(projectUri, { recursive: true });
				} catch {
					// Codea refuses while the project runs; whether it is gone decides
				}
				return waitFor(collectionUri, remotePath.split('/').pop()!, false);
			});
		if (!deleted) {
			if (linked) {
				await linkedFolders.addLink(folder, linked.localUri, linked.remotePath, host);
			}
			vscode.window.showErrorMessage(`Codea did not delete ${remotePath}. If it is running, stop it and try again.`);
			return;
		}
		outputChannel.appendLine(`Deleted ${remotePath} in Codea`);

		if (linked) {
			try {
				await vscode.workspace.fs.delete(linked.localUri, { recursive: true, useTrash: true });
			} catch {
				// Already gone here
			}
		}
		projectsView.refresh();
	}));

	// A linked project's folder renamed in VS Code renames the project in Codea when only its name
	// changed and it still names the project, or is renamed back when Codea does not; moved anywhere
	// else, it stays linked to the project. Renames made outside VS Code are only seen as the folder
	// going missing.
	// Main.lua renamed is renamed back. A renamed tab is synced as a new file and a deletion.
	const mainRenames = new Set<string>();
	context.subscriptions.push(vscode.workspace.onWillRenameFiles(event => {
		for (const { oldUri, newUri } of event.files) {
			if (sync.isFolderRename(oldUri)) {
				sync.renameStarting(oldUri);
			}
			if (sync.isMainRename(oldUri)) {
				sync.renameStarting(oldUri);
				mainRenames.add(oldUri.toString());
				sync.renameStarting(newUri);
			}
		}
	}));
	context.subscriptions.push(vscode.workspace.onDidRenameFiles(async event => {
		for (const { oldUri, newUri } of event.files) {
			try {
				if (mainRenames.delete(oldUri.toString())) {
					await sync.renameBack(oldUri, newUri);
				} else {
					await followRename(oldUri, newUri);
				}
			} finally {
				sync.renameDone(oldUri);
				sync.renameDone(newUri);
			}
		}
	}));

	async function followRename(oldUri: vscode.Uri, newUri: vscode.Uri) {
		const oldPath = oldUri.path.replace(/\/$/, '');
		const moved = linkedFolders.projects().filter(project =>
			project.localUri.path === oldPath || project.localUri.path.startsWith(`${oldPath}/`));
		const folder = vscode.workspace.getWorkspaceFolder(newUri);
		const host = linkedFolders.host();
		if (moved.length === 0 || folder === undefined || host === undefined) {
			return;
		}

		const parent = (path: string) => path.split('/').slice(0, -1).join('/');
		const oldName = oldPath.split('/').pop()!;
		let target = newUri;
		// A project's folder keeps its .codea extension, which Codea and the layout rely on, so a
		// rename without it gets it back first
		if (moved.some(project => project.localUri.path === oldPath) && parent(oldPath) === parent(newUri.path)
			&& oldName.endsWith('.codea') && !newUri.path.endsWith('.codea')) {
			target = newUri.with({ path: `${newUri.path}.codea` });
			try {
				await vscode.workspace.fs.rename(newUri, target, { overwrite: false });
			} catch {
				await vscode.workspace.fs.rename(newUri, oldUri);
				vscode.window.showWarningMessage(`${vscode.workspace.asRelativePath(target)} already exists here, so the folder was renamed back.`);
				return;
			}
		}
		const newName = target.path.split('/').pop()!;

		for (const project of moved) {
			const localUri = target.with({ path: target.path + project.localUri.path.slice(oldPath.length) });
			let remotePath = project.remotePath;
			const projectName = remotePath.split('/').pop()!;
			if (project.localUri.path === oldPath && parent(oldPath) === parent(target.path)
				&& oldName === `${projectName}.codea` && newName.endsWith('.codea') && newName !== oldName) {
				const renamed = `${parent(remotePath)}/${newName.slice(0, -'.codea'.length)}`;
				const problem = await renameInCodea(host, remotePath, renamed);
				if (problem !== undefined) {
					// The folder keeps the project's name, so it goes back to it
					await vscode.workspace.fs.rename(target, oldUri);
					vscode.window.showWarningMessage(`${problem} The folder was renamed back.`);
					return;
				}
				remotePath = renamed;
			}
			await sync.moveLink(project, folder, localUri, remotePath);
		}
	}

	// Renames a project in Codea, within its collection; says why not when it could not
	async function renameInCodea(host: string, remotePath: string, renamed: string): Promise<string | undefined> {
		if (airCode.disconnected) {
			return `Not connected, so ${remotePath} was not renamed in Codea.`;
		}
		const codeaUri = (path: string) => vscode.Uri.from({ scheme: 'codea', authority: host, path: `/${AirCode.rootFolder}/${path}` });
		const collection = renamed.split('/').slice(0, -1).join('/');
		const newName = renamed.split('/').pop()!;
		try {
			await airCode.ensureResponsive(codeaUri(collection));
			const existing = (await airCode.readDirectory(codeaUri(collection))).map(([name]) => name.toLowerCase());
			if (existing.includes(newName.toLowerCase()) && newName.toLowerCase() !== remotePath.split('/').pop()!.toLowerCase()) {
				return `${collection} already has a project named ${newName}, so ${remotePath} was not renamed in Codea.`;
			}
			await airCode.rename(codeaUri(remotePath), codeaUri(renamed), { overwrite: false });
		} catch (error) {
			return `Codea did not rename ${remotePath} (${error}).`;
		}
		return await waitFor(codeaUri(collection), newName) ? undefined : `Codea did not rename ${remotePath}.`;
	}

	function validName(value: string): string | undefined {
		const name = value.trim();
		if (name === "") {
			return "Enter a name.";
		}
		if (name.includes('/') || name.startsWith('.')) {
			return "A name cannot contain / or start with a period.";
		}
		return undefined;
	}

	// Whether a Codea folder comes to list the named entry, or to no longer list it, within ten seconds
	async function waitFor(folderUri: vscode.Uri, entry: string, listed = true): Promise<boolean> {
		for (let attempt = 0; attempt < 40; attempt++) {
			try {
				if ((await airCode.readDirectory(folderUri)).some(([name]) => name === entry) === listed) {
					return true;
				}
			} catch {
				// Not there yet
			}
			await new Promise(resolve => setTimeout(resolve, 250));
		}
		return false;
	}

	// Links many projects at once: the folders and links are made first, then each project's
	// first sync runs with progress, and files that differ on both sides are asked about together
	async function linkMany(folder: vscode.WorkspaceFolder, host: string, entries: { localUri: vscode.Uri, remotePath: string }[], title: string) {
		linkingMany = true;
		try {
			for (const entry of entries) {
				await vscode.workspace.fs.createDirectory(entry.localUri);
			}
			sync.startAfresh(entries);
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

	context.subscriptions.push(vscode.window.registerFileDecorationProvider(new CodeaDecorationProvider(linkedFolders)));
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
