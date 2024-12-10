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

export function getWorkspaceUri(): vscode.Uri {
	if (vscode.workspace.workspaceFolders?.length === 1) {
		return vscode.workspace.workspaceFolders[0].uri;
	}

	return vscode.window.activeTextEditor?.document.uri ?? vscode.Uri.parse("");
}

var airCode: AirCode;

export function deactivate() {
	airCode.deactivate();
}

export function activate(context: vscode.ExtensionContext) {
	let workspaceUri = getWorkspaceUri();
	vscode.commands.executeCommand('setContext', 'codea-air-code.hasWorkspaceUri', workspaceUri.scheme == "codea");

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

	// Overwrite the debug actions if we are under a codea workspace
	if (workspaceUri.scheme == "codea") {
		context.subscriptions.push(vscode.commands.registerCommand('workbench.action.debug.start', async () => {
			const uri = vscode.window.activeTextEditor?.document.uri;
			if (uri === undefined || uri.scheme != "codea") {
				return;
			}

			// The user has clicked the "Start" button or used the keyboard shortcut
			await airCode.startHost(uri);
		}));

		context.subscriptions.push(vscode.commands.registerCommand('workbench.action.debug.restart', async () => {
			// The user has clicked the "Restart" button or used the keyboard shortcut
			airCode.restart(workspaceUri);
		}));
	
		context.subscriptions.push(vscode.commands.registerCommand('workbench.action.debug.disconnect', () => {
			// The user has clicked the "Disconnect" button or used the keyboard shortcut
			vscode.debug.stopDebugging();
			airCode.stopHost(workspaceUri);
		}));

		outputChannel.show(true);
	}
	
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
		await airCode.getSocketForUri(workspaceUri, true);
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

		airCode.loadString(activeEditor?.document.uri, text);
	}));

	context.subscriptions.push(vscode.commands.registerCommand('codea-air-code.executeSelection', async () => {
		let activeEditor = vscode.window.activeTextEditor;
		let text = activeEditor?.document.getText(activeEditor.selection);

		if (activeEditor?.document.uri === undefined || text === undefined) {
			return;
		}

		airCode.loadString(activeEditor?.document.uri, text);
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

		findReference(activeEditor?.document.uri, text);
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

		const uri = activeEditor?.document.uri;
		if (uri === undefined) {
			return;
		}

		let runtime = await vscode.window.showQuickPick(["modern", "legacy"], { placeHolder: "Select runtime" });
		if (runtime === undefined) {
			return;
		}

		airCode.setRuntime(uri, runtime);
	}));

	context.subscriptions.push(vscode.commands.registerCommand('codea-air-code.addDependency', async () => {
		let activeEditor = vscode.window.activeTextEditor;

		const uri = activeEditor?.document.uri;
		if (uri === undefined) {
			return;
		}

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
			}
		});
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
