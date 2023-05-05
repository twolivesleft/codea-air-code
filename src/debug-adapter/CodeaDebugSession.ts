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
			this._onDidSendMessage.fire(JSON.parse(message));
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

		this._airCode.debugMessage(uri, message);
	}

	public dispose() {
		this._eventRegistration?.dispose();
	}
}