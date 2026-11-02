import * as vscode from 'vscode';
import { AirCode } from '../aircode';
import { getWorkspaceUri } from '../extension';

export class CodeaDebugSession implements vscode.DebugAdapter {

	private _airCode: AirCode;
	private _onDidSendMessage = new vscode.EventEmitter<vscode.DebugProtocolMessage>();
	private _eventRegistration?: vscode.Disposable;
	// Requests this session added itself, whose responses VS Code did not ask for
	private _addedRequests = new Set<number>();
	private _nextAddedSeq = 1_000_000;

	public constructor(airCode: AirCode) {
		this._airCode = airCode;

		const uri = getWorkspaceUri();
		if (uri === undefined) {
			return;
		}
		
		this._eventRegistration = this._airCode.debugEvents.event((message: string) => {
			const parsed = JSON.parse(message);
			if (parsed.type === 'response' && this._addedRequests.delete(parsed.request_seq)) {
				return;
			}
			this._onDidSendMessage.fire(this._airCode.links?.rewriteSourcePaths(parsed, 'toLocal') ?? parsed);
		});
	}

	public get onDidSendMessage(): vscode.Event<vscode.DebugProtocolMessage> {
		return this._onDidSendMessage.event;
	}

	public handleMessage(message: vscode.DebugProtocolMessage): void {
		const uri = getWorkspaceUri();
		if (uri === undefined) {
			return;
		}

		this._airCode.debugMessage(uri, this._airCode.links?.rewriteSourcePaths(message, 'toRemote') ?? message);
		for (const added of this.breakpointsInDependents(message as any)) {
			this._airCode.debugMessage(uri, added);
		}
	}

	// A project's files run inside each project depending on it, under
	// "Dependent/Dependencies/Project/File.lua", so their breakpoints are set there too
	private breakpointsInDependents(message: any): any[] {
		const links = this._airCode.links;
		const path = message.type === 'request' && message.command === 'setBreakpoints' ? message.arguments?.source?.path : undefined;
		const found = links && typeof path === 'string' && links.find(vscode.Uri.file(path));
		const host = links?.host();
		if (!links || !found || host === undefined) {
			return [];
		}
		const [project, file] = found;
		const name = project.remotePath.split('/').pop();
		return links.dependents(project).map(dependent => {
			const seq = this._nextAddedSeq++;
			this._addedRequests.add(seq);
			const remote = `codea://${host}/${AirCode.rootFolder}/${dependent.remotePath}/Dependencies/${name}/${file}`;
			return { ...message, seq, arguments: { ...message.arguments, source: { ...message.arguments.source, path: remote } } };
		});
	}

	public dispose() {
		this._eventRegistration?.dispose();
	}
}