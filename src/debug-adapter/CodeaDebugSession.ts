import * as vscode from 'vscode';
import { AirCode } from '../aircode';
import { getWorkspaceUri } from '../extension';

export class CodeaDebugSession implements vscode.DebugAdapter {

	private _airCode: AirCode;
	private _onDidSendMessage = new vscode.EventEmitter<vscode.DebugProtocolMessage>();
	private _eventRegistration?: vscode.Disposable;

	public constructor(airCode: AirCode) {
		this._airCode = airCode;

		const uri = getWorkspaceUri();
		if (uri === undefined) {
			return;
		}
		
		this._eventRegistration = this._airCode.debugEvents.event((message: string) => {
			const parsed = JSON.parse(message);
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
	}

	public dispose() {
		this._eventRegistration?.dispose();
	}
}