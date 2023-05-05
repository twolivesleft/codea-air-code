import * as vscode from 'vscode';

export class CodeaDebugConfigurationProvider implements vscode.DebugConfigurationProvider {
    resolveDebugConfiguration(folder: vscode.WorkspaceFolder | undefined, config: vscode.DebugConfiguration, token?: vscode.CancellationToken | undefined): vscode.ProviderResult<vscode.DebugConfiguration> {
		if (folder?.uri.authority) {
			config['workingDirectory'] = config['workingDirectory'].replace("AUTHORITY", folder?.uri.authority);
			config['sourceBasePath'] = config['sourceBasePath'].replace("AUTHORITY", folder?.uri.authority);
		}

		return config;        
    }
}