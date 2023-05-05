import * as vscode from 'vscode';
import { ProviderResult } from 'vscode';
import { CodeaDebugSession } from './CodeaDebugSession';
import { AirCode  } from '../aircode';

export class InlineDebugAdapterFactory implements vscode.DebugAdapterDescriptorFactory {

	private _airCode: AirCode;

	public constructor(airCode: AirCode) {
		this._airCode = airCode;
	}

	createDebugAdapterDescriptor(_session: vscode.DebugSession): ProviderResult<vscode.DebugAdapterDescriptor> {
		return new vscode.DebugAdapterInlineImplementation(new CodeaDebugSession(this._airCode));		
	}
}
