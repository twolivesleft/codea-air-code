import * as vscode from 'vscode';
import { AirCode } from '../aircode';

export class CodeaDebugConfigurationProvider implements vscode.DebugConfigurationProvider {
    resolveDebugConfiguration(folder: vscode.WorkspaceFolder | undefined, config: vscode.DebugConfiguration, token?: vscode.CancellationToken | undefined): vscode.ProviderResult<vscode.DebugConfiguration> {
		if (folder?.uri.authority) {
			var replacement = `${folder?.uri.authority}/${AirCode.rootFolder}/`;
			config['sourceBasePath'] = config['sourceBasePath'].replace("AUTHORITY", replacement);
		}

		return config;        
    }
}