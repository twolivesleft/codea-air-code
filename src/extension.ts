import * as vscode from 'vscode';

import { AirCode } from './aircode';
import { ParametersViewProvider } from './parameters';
import { CodeaDebugConfigurationProvider } from './debug-adapter/CodeaDebugConfigurationProvider';
import { InlineDebugAdapterFactory } from './debug-adapter/InlineDebugAdapterFactory';

export function getWorkspaceUri(): vscode.Uri {
	if (vscode.workspace.workspaceFolders?.length === 1) {
		return vscode.workspace.workspaceFolders[0].uri;
	}

	return vscode.window.activeTextEditor?.document.uri ?? vscode.Uri.parse("");
}

export function activate(context: vscode.ExtensionContext) {

	let workspaceUri = getWorkspaceUri();
	vscode.commands.executeCommand('setContext', 'codea-air-code.hasWorkspaceUri', workspaceUri.scheme == "codea");

	const parametersViewProvider = new ParametersViewProvider(context.extensionUri);
	const outputChannel = vscode.window.createOutputChannel("Codea", "codea-output");
	const airCode = new AirCode(outputChannel, parametersViewProvider);

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

	console.log(`"codea-air-code" is now active`);
	
	parametersViewProvider.airCode = airCode;

	context.subscriptions.push(vscode.workspace.registerFileSystemProvider('codea', airCode, { isCaseSensitive: true }));

	context.subscriptions.push(vscode.commands.registerCommand('codea-air-code.connectToHost', async () => {
		let defaultHost = "127.0.0.1:18513";

		let host = await vscode.window.showInputBox({
			placeHolder: defaultHost,
			prompt: "Enter Codea's IP."
		});

		if (host === undefined) {
			vscode.window.showWarningMessage("Connection to Codea was cancelled.");
			return;
		}
		else if (host === "") {
			host = defaultHost;
		}

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

	context.subscriptions.push(vscode.commands.registerCommand('codea-air-code.addDependency', async () => {
		const uri = getWorkspaceUri();
		if (uri === undefined) {
			return;
		}

		const projects = airCode.listUnimportedProjects(uri);

		vscode.window.showQuickPick(projects).then(async choice => {
			if (choice !== undefined) {
				let response = await airCode.addDependency(uri, choice);
				if (response.isFirstDependency) {
					airCode.onDependenciesCreated();
				}

				let path = `codea://${uri.authority}/${AirCode.rootFolder}/${airCode.projectName}/Dependencies/${choice}`;
				let newUri = vscode.Uri.parse(path);
				airCode.fileCreated(newUri);	
			}
		});
	}));
}

// This method is called when your extension is deactivated
export function deactivate() { }
