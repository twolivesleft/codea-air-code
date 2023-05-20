import * as vscode from 'vscode';

import { TextDecoder, TextEncoder } from 'util';
import { WebSocket, Event, OPEN, MessageEvent, CONNECTING } from 'ws';
import { Result } from './result';
import { Response, AddDependencyResponse, DeleteFileResponse } from './responses';
import { Command } from './commands';
import * as Parameters from './parameters';
import { getWorkspaceUri } from './extension';

export class AirCode implements vscode.FileSystemProvider {
    public static readonly rootFolder = 'Codea';

    webSockets = new Map<string, WebSocket>();
    commandId: number = 0;
    promises = new Map<number, (data: any) => void>();
    outputChannel: vscode.OutputChannel;
    parametersView: Parameters.ParametersViewProvider;
    debugEvents = new vscode.EventEmitter<string>();

    constructor(outputChannel: vscode.OutputChannel, parametersView: Parameters.ParametersViewProvider) {
        this.outputChannel = outputChannel;
        this.parametersView = parametersView;
    }

    // Internal Files

    launchContent = `{
        "version": "0.2.0",
        "configurations": [
            {
                "name": "Attach to Codea",
                "type": "luaInline",
                "request": "attach",
                "sourceBasePath": "codea://AUTHORITY/",
                "listenPublicly": false,
                "listenPort": 56789,
                "encoding": "UTF-8"
            }
        ]
    }`;

    internalFiles: Map<string, [string, vscode.FileStat]> = new Map([
        [`/${AirCode.rootFolder}/.vscode`, ["", {
            type: vscode.FileType.Directory,
            ctime: Date.now(),
            mtime: Date.now(),
            size: 0,
            permissions: vscode.FilePermission.Readonly
        }]],
        [`/${AirCode.rootFolder}/.vscode/launch.json`, [this.launchContent, {
            type: vscode.FileType.File,
            ctime: Date.now(),
            mtime: Date.now(),
            size: 1,
            permissions: vscode.FilePermission.Readonly
        }]]
    ]);

    internalDirectoryContents(path: string): [string, vscode.FileType][] {
        const directoryEntries: [string, vscode.FileType][] = [];

        for (const [key, [content, fileStat]] of this.internalFiles) {
            if (key.startsWith(path) && key !== path) {
                const relativePath = key.slice(path.length + 1);
                if (relativePath.includes('/')) {
                    continue;
                }
                directoryEntries.push([relativePath, fileStat.type]);
            }
        }

        return directoryEntries;
    }

    // Web Socket

    async waitForSocket(ws: WebSocket, showError: boolean = true) {
        return new Promise((resolve, reject) => {
            const maxNumberOfAttempts = 10;
            const intervalTime = 200;

            let currentAttempt = 0;
            const interval = setInterval(() => {
                if (ws.readyState === ws.OPEN) {
                    clearInterval(interval);
                    resolve(ws);
                    return;
                }
                else if (currentAttempt > maxNumberOfAttempts - 1 || ws.readyState !== CONNECTING) {
                    clearInterval(interval);
                    if (showError) {
                        vscode.window.showErrorMessage(`Failed connecting to ${ws.url}.`);
                    }
                    reject();
                    return;
                }
                currentAttempt++;
            }, intervalTime);
        });
    }

    async getSocketForUri(uri: vscode.Uri, showError: boolean = true): Promise<WebSocket | undefined> {
        const host = uri.authority;
        if (host === undefined) {
            return undefined;
        }

        if (this.webSockets.has(host)) {
            let ws = this.webSockets.get(host);

            if (ws?.readyState === CONNECTING) {
                await this.waitForSocket(ws, showError);
            }

            if (ws?.readyState === OPEN) {
                return ws;
            }
        }

        let ws = new WebSocket(`ws://${host}/`);

        this.webSockets.set(host, ws);

        let airCode = this;

        ws.onopen = async function () {
            vscode.window.showInformationMessage(`Connected to ${host}.`);

            let parameters = await airCode.getParameters(uri);

            airCode.parametersView.setParameters(parameters);
        };

        let parent = this;

        ws.onmessage = function (evt: MessageEvent) {
            let result = JSON.parse(evt.data as string);
            if (result.id !== undefined) {
                let id = result.id as number;
                let data = result;
                let promise = parent.promises.get(id);
                if (promise) {
                    promise(data);
                    parent.promises.delete(id);
                }
            }
            else {
                const keys = Object.keys(result);
                if (keys.length === 1) {
                    const command = keys[0];
                    const data = result[command];
                    switch (command) {
                        case "print":
                            {
                                switch (data.style) {
                                    case "print":
                                        {
                                            parent.outputChannel.appendLine(`PRINT: ${data.text}`);
                                            break;
    
                                        }
                                    case "warning":
                                        {
                                            parent.outputChannel.appendLine(`WARNING: ${data.text}`);
                                            break;
    
                                        }
                                    case "error":
                                        {
                                            parent.outputChannel.appendLine(`ERROR: ${data.text}`);
                                            break;
                                        }
                                }
    
                                break;
                            }
                        case "updateParameter":
                            {
                                const parameter = JSON.parse(data.parameter);
    
                                parent.parametersView.setParameter(parameter);
    
                                break;
                            }
                        case "clearParameters":
                        case "projectStopped":
                            {
                                parent.parametersView.clearParameters();
                                break;
                            }
                        case "projectClosed":
                            {
                                
                                vscode.commands.executeCommand("workbench.action.closeAllEditors");
                                vscode.commands.executeCommand("workbench.files.action.refreshFilesExplorer");
                                break;
                            }
                        case "projectOpened":
                            {
                                vscode.commands.executeCommand("workbench.files.action.refreshFilesExplorer");
                                break;
                            }
                        case "debugResponse":
                            {
                                airCode.debugEvents.fire(data.message);
                                break;
                            }
                    }
                }
                
            }
        };

        ws.onclose = function () {
            vscode.window.showErrorMessage(`Connection lost to ${host}.`);
            vscode.debug.stopDebugging();
            parent.parametersView.clearParameters();
        };

        await this.waitForSocket(ws, showError);

        return ws;
    }

    // Sending Commands

    send<T>(ws: WebSocket, command: Command, promise: (response: Response<T>) => void) {
        this.commandId++;
        command.id = this.commandId;
        ws.send(JSON.stringify(command));
        this.promises.set(this.commandId, promise);
    }

    sendCommandMapResponse<R, T>(uri: vscode.Uri, command: Command, map: (response: R | Error) => Result<T, Error>): T | Thenable<T> {
        return new Promise((resolve, reject) => {
            this.getSocketForUri(uri).then(ws => {
                if (ws === undefined) {
                    reject();
                    return;
                }

                this.send<R>(ws, command, response => {
                    if (response.error !== null && response.error !== undefined) {
                        const error = Response.from(response.error);
                        reject(error);
                    } else if (response.data !== null && response.data !== undefined) {
                        const result = map(response.data);
                        if (result.success) {
                            resolve(result.value);
                        } else {
                            reject(result.error);
                        }
                    }
                });
            }).then(undefined, error => {
                reject(error);
            });
        });
    }

    sendCommand<T>(uri: vscode.Uri, command: Command): T | Thenable<T> {
        return this.sendCommandMapResponse<T, T>(uri, command, response => {
            if (response instanceof Error) {
                return Result.error(response);
            } else {
                return Result.success(response);
            }
        });
    }

    // AirCode Commands

    restart(uri: vscode.Uri) {
        this.sendCommand(uri, Command.Restart.from());
    }

    listUnimportedProjects(uri: vscode.Uri): string[] | Thenable<string[]> {
        return this.sendCommand(uri, Command.ListUnimportedProjects.from());
    }

    loadString(uri: vscode.Uri, content: string) {
        this.sendCommand(uri, Command.LoadString.from(content));
    }

    async addDependency(uri: vscode.Uri, path: string) : Promise<AddDependencyResponse> {
        return this.sendCommand<AddDependencyResponse>(uri, Command.AddDependency.from(path));
    }

    getParameters(uri: vscode.Uri): any[] | Thenable<any[]> {
        return this.sendCommandMapResponse<String, any[]>(uri, Command.GetParameters.from(), response => {
            if (response instanceof Error) {
                return Result.error(response);
            } else {
                let parameters = JSON.parse(response as string);
                return Result.success(parameters);
            }
        });
    }

    setParameter(uri: vscode.Uri, parameter: string) {
        this.sendCommand(uri, Command.SetParameter.from(parameter));
    }

    debugMessage(uri: vscode.Uri, object: any) {
        const json = JSON.stringify(object).replace(/\\"/g, '"');
        this.sendCommand(uri, Command.DebugMessage.from(json));
    }

    // VS Code FileSystemProvider Implementation

    watch(uri: vscode.Uri, options: { readonly recursive: boolean; readonly excludes: readonly string[]; }): vscode.Disposable {
        return new vscode.Disposable(() => { });
    }

    stat(uri: vscode.Uri): vscode.FileStat | Thenable<vscode.FileStat> {
        const path = uri.path;
        const internal = this.internalFiles.get(path);

        if (internal !== undefined) {
            return internal[1];
        }

        return this.sendCommand<vscode.FileStat>(uri, Command.StatFile.from(path));
    }

    readDirectory(uri: vscode.Uri): [string, vscode.FileType][] | Thenable<[string, vscode.FileType][]> {
        const path = uri.path;
        const internal = this.internalFiles.get(path);

        if (internal !== undefined) {
            const contents = this.internalDirectoryContents(path);
            return contents;
        }

        return this.sendCommandMapResponse<[string, vscode.FileType][], [string, vscode.FileType][]>(uri, Command.ListFiles.from(path), response => {
            if (response instanceof Error) {
                return Result.error(response);
            } else {
                if (path === `/${AirCode.rootFolder}`) {
                    response.push([".vscode", vscode.FileType.Directory]);
                }
                return Result.success(response);
            }
        });
    }

    createDirectory(uri: vscode.Uri): void | Thenable<void> {
    }

    readFile(uri: vscode.Uri): Uint8Array | Thenable<Uint8Array> {
        const path = uri.path;
        const internal = this.internalFiles.get(path);
        let enc = new TextEncoder();

        if (internal !== undefined) {
            return enc.encode(internal[0]);
        }

        return this.sendCommandMapResponse<string, Uint8Array>(uri, Command.ReadFile.from(path), response => {
            if (response instanceof Error) {
                return Result.error(response);
            } else {
                return Result.success(enc.encode(response));
            }
        });
    }

    writeFile(uri: vscode.Uri, content: Uint8Array, options: { readonly create: boolean; readonly overwrite: boolean; }): void | Thenable<void> {
        const path = uri.path;

        let dec = new TextDecoder();

        return this.sendCommand(uri, Command.WriteFile.from(path, dec.decode(content)));
    }

    getDependenciesUri(): vscode.Uri {
        let path = `codea://${getWorkspaceUri().authority}/${AirCode.rootFolder}/Dependencies`;
        return vscode.Uri.parse(path);
    }

    onDependenciesCreated() {
        this.fileCreated(this.getDependenciesUri());
    }

    onDependenciesDeleted() {
        this.fileDeleted(this.getDependenciesUri());
    }

    delete(uri: vscode.Uri, options: { readonly recursive: boolean; }): void | Thenable<void> {
        return this.sendCommandMapResponse<DeleteFileResponse, void>(uri, Command.DeleteFile.from(uri.path), response => {
            if (response instanceof Error) {
                return Result.error(response);
            } else {
                if (response.wasLastDependency) {
                    this.onDependenciesDeleted();
                }
                return Result.success(undefined);
            }
        });
    }

    rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { readonly overwrite: boolean; }): void | Thenable<void> {
        const oldParts = oldUri.path.split('/');
        const newParts = newUri.path.split('/');

        if (oldParts[oldParts.length - 1] === "Main.lua") {
            throw vscode.FileSystemError.NoPermissions("Main.lua cannot be renamed.");
        }

        if (newParts[newParts.length - 1] === "Main.lua") {
            throw vscode.FileSystemError.NoPermissions("Cannot rename to Main.lua.");
        }

        return this.sendCommand(newUri, Command.RenameFile.from(oldUri.path, newUri.path));
    }

    copy?(source: vscode.Uri, destination: vscode.Uri, options: { readonly overwrite: boolean; }): void | Thenable<void> {
    }

    fileCreated(uri: vscode.Uri) {
        this._emitter.fire([{
            type: vscode.FileChangeType.Created,
            uri: uri
        }]);
    }

    fileChanged(uri: vscode.Uri) {
        this._emitter.fire([{
            type: vscode.FileChangeType.Changed,
            uri: uri
        }]);
    }

    fileDeleted(uri: vscode.Uri) {
        this._emitter.fire([{
            type: vscode.FileChangeType.Deleted,
            uri: uri
        }]);
    }

    private _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this._emitter.event;
}
