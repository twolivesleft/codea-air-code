import * as vscode from 'vscode';

import { AirCodePath } from './aircodepath';
import { TextDecoder, TextEncoder } from 'util';
import { WebSocket, Event, OPEN, MessageEvent, CloseEvent, CONNECTING } from 'ws';
import { Result } from './result';
import { 
    Response, 
    StartHostResponse, 
    GetInformationResponse, 
    AddDependencyResponse, 
    ReadFileResponse,
    DeleteFileResponse, 
    GetFunctionsResponse,
    FindReferenceResponse, 
    GetAssetKeyResponse,
    FileVersion,
    Frame} from './responses';
import { Command } from './commands';
import * as Parameters from './parameters';
import * as Reference from './reference';
import { getWorkspaceUri } from './extension';
import { Links } from './links';
import { CodeaStatus } from './status';
import {
	LanguageClient,
	LanguageClientOptions,
    RevealOutputChannelOn
} from 'vscode-languageclient/node';
import { LSPMessageReader, LSPMessageWriter } from './language_server';
import * as cp from 'child_process';
import find_process = require('find-process');
import tree_kill = require('tree-kill');

const isPortReachable = require('is-port-reachable')
const semver = require('semver');

const codeaVersion = "3.10";

enum CloseEventCode {
    None = 1000,
    IncompatibleVersion = 4001
}

enum VersionComparison {
    Compatible,
    UpdateCodea,
    UpdateExtension
}

export class AirCode implements vscode.FileSystemProvider {
    public static readonly rootFolder = 'Codea';

    webSockets = new Map<string, WebSocket>();
    closingSocket = false;
    checkingProxy = false;
    proxyProcess: cp.ChildProcess | undefined;
    commandId: number = 0;
    promises = new Map<number, (data: any) => void>();
    outputChannel: vscode.OutputChannel;
    parametersView: Parameters.ParametersViewProvider;
    referenceView: Reference.ReferenceViewProvider;
    debugEvents = new vscode.EventEmitter<string>();
    extensionVersion: string; 

    // Language Server Protocol
    debugLSP = false;
    messageReader: LSPMessageReader;
    messageWriter: LSPMessageWriter;
    languageClient: LanguageClient | undefined;

    status: CodeaStatus | undefined;

    textFileExtensions: string[] = [];

    links: Links | undefined;

    // Whether Codea sends filesChanged for the projects named with watchFiles
    watchesFiles = false;
    // Whether Codea lists a folder's files with their dates in one request
    listsFileVersions = false;
    // Whether Codea keeps files in folders inside a project, lists them, and creates the folders
    listsSubfolders = false;
    hasModernReference = false;
    // Whether Codea sends its screen as frames, for the device preview
    capturesFrames = false;
    // Whether Codea takes touches for the running project from the device preview
    takesTouches = false;
    // Collections that ship with Codea, which getting every project skips
    builtInCollections: string[] = ["Examples", "Craft"];
    private lastAnswer = 0;
    // Set when disconnected from the Codea menu, so nothing reconnects until asked to
    disconnected = false;
    private _onDidConnect = new vscode.EventEmitter<void>();
    onDidConnect = this._onDidConnect.event;
    private watchedPaths: string[] = [];
    filesChanged = new vscode.EventEmitter<{ path: string, files: string[] }>();

    constructor(outputChannel: vscode.OutputChannel,
                parametersView: Parameters.ParametersViewProvider,
                referenceView: Reference.ReferenceViewProvider,
                extensionVersion: string) {
        this.outputChannel = outputChannel;
        this.parametersView = parametersView;
        this.referenceView = referenceView;
        this.extensionVersion = extensionVersion;
        this.messageReader = new LSPMessageReader(this);
        this.messageWriter = new LSPMessageWriter(this);
    }

    deactivate() {
        this.webSockets.forEach(ws => {
            ws.close();
        });
        this.webSockets.clear();

        if (this.proxyProcess) {
            this.proxyProcess.kill();
            this.proxyProcess = undefined;
        }
    }

    logLsp(message: String) {
        if (this.debugLSP) {
            console.warn(message);
        }
    }

    startDebugging() {
        const folder = vscode.workspace.workspaceFolders?.[0];
        const connectionUri = this.links?.connectionUri();

        if (folder === undefined || connectionUri === undefined || vscode.debug.activeDebugSession !== undefined) {
            return;
        }

        vscode.debug.startDebugging(folder, {
            name: "Play in Codea",
            type: "luaInline",
            request: "attach",
            sourceBasePath: `codea://${connectionUri.authority}/${AirCode.rootFolder}/`,
            listenPublicly: false,
            listenPort: 56789,
            encoding: "UTF-8"
        });
    }

    // Web Socket

    async waitForSocket(ws: WebSocket, showError: boolean = true) : Promise<boolean> {
        return new Promise((resolve, reject) => {
            const maxNumberOfAttempts = 10;
            const intervalTime = 200;

            let currentAttempt = 0;
            const interval = setInterval(() => {
                if (ws.readyState === ws.OPEN) {
                    clearInterval(interval);
                    resolve(true);
                    return;
                }
                else if (currentAttempt > maxNumberOfAttempts - 1 || ws.readyState !== CONNECTING) {
                    clearInterval(interval);
                    resolve(false);
                    return;
                }
                currentAttempt++;
            }, intervalTime);
        });
    }

    async waitForClosingSocket() : Promise<boolean> {
        return new Promise((resolve, reject) => {
            const maxNumberOfAttempts = 10;
            const intervalTime = 200;

            let currentAttempt = 0;
            const interval = setInterval(() => {
                if (!this.closingSocket) {
                    resolve(true);
                    return;
                }
                else if (currentAttempt > maxNumberOfAttempts - 1) {
                    clearInterval(interval);
                    resolve(false);
                    return;
                }
                currentAttempt++;
            }, intervalTime);            
        });
    }

    compareVersions(airCodeVersion: string): VersionComparison {
        let diff = semver.diff(airCodeVersion, this.extensionVersion);
        if (diff == null || diff == 'patch') {
            return VersionComparison.Compatible;
        }

        if (semver.lt(airCodeVersion, this.extensionVersion)) {
            return VersionComparison.UpdateCodea;
        }

        return VersionComparison.UpdateExtension;
    }

    setStatusConnected() {
        this.status?.setConnection('connected');
    }

    async waitForProxy() {
        while (this.checkingProxy) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }

    async waitForLocalPort(port: number) {
        // Wait up to 5 seconds for the port to be reachable
        let attempts = 0;
        while (attempts < 50) {
            if (await isPortReachable(port, {host: 'localhost'})) {
                return true;
            }
            await new Promise(resolve => setTimeout(resolve, 100));
            attempts++;
        }
        return false;
    }

    async checkForProxy(host: string, showError: boolean = true): Promise<string> {
        // Check if this is a USB connection (e.g. codea://18513:18514, i.e. codea://codeaPort:localPort)
        // Try to parse both parts as numbers
        const parts = host.split(':');
        if (parts.length == 2) {
            // Check if both parts are digits only. If so, this is a USB connection.
            if (parts[0].match(/^\d+$/) && parts[1].match(/^\d+$/)) {
                if (this.checkingProxy) {
                    await this.waitForProxy();
                }
        
                this.checkingProxy = true;
        
                const codeaPort = parseInt(parts[0]);
                const localPort = parseInt(parts[1]);

                const isRunning = await isPortReachable(localPort, {host: 'localhost'});
                if (isRunning && this.proxyProcess) {
                    host = `localhost:${localPort}`;
                }
                else {
                    // Kill any existing iproxy processes since they might not match the current ports
                    if (this.proxyProcess) {
                        this.proxyProcess.kill();
                        this.proxyProcess = undefined;
                    }
                    
                    // On non-Windows platforms, the spawned processes are not killed when the extension is killed
                    // Use find_process to check if iproxy processes are running, and kill them using tree-kill
                    const processes = await find_process('name', 'iproxy');
                    for (const process of processes) {
                        tree_kill(process.pid, 'SIGKILL');
                    }

                    this.proxyProcess = cp.spawn('iproxy', [`${localPort}:${codeaPort}`]);
                    this.proxyProcess?.on('error', (err: any) => {
                        if (showError) {
                            if (err.code === 'ENOENT') {
                                vscode.window.showErrorMessage(`iproxy not found. Please install libusbmuxd to connect over USB.`,
                                ...["Documentation"]).then(selection => {
                                    if (selection) {
                                        vscode.env.openExternal(vscode.Uri.parse('https://twolivesleft.github.io/codea-air-code/#usb-connection'));
                                    }
                                });
                            }
                            else {
                                vscode.window.showErrorMessage(`Failed to start iproxy: ${err}`);
                            }
                        }
                    });
                    this.proxyProcess?.on('exit', (code: any) => {
                        if (showError) {
                            vscode.window.showErrorMessage(`iproxy exited with code ${code}`);
                        }
                        this.proxyProcess = undefined;
                    });

                    let reachable = await this.waitForLocalPort(localPort);
                    if (reachable) {
                        host = `localhost:${localPort}`;
                    }
                    else {
                        if (showError) {
                            vscode.window.showErrorMessage(`Failed to connect using iproxy.`);
                        }
                        this.proxyProcess.kill();
                        this.proxyProcess = undefined;
                    }
                }

                this.checkingProxy = false;
            }
        }

        return host;
    }

    async getSocketForUri(uri: vscode.Uri, showError: boolean = true): Promise<WebSocket | undefined> {
        if (this.disconnected) {
            return undefined;
        }

        var host = uri.authority;
        if (host === undefined) {
            return undefined;
        }

        host = await this.checkForProxy(host, showError);

        if (this.closingSocket) {
            await this.waitForClosingSocket();
        }

        if (this.webSockets.has(host)) {
            let ws = this.webSockets.get(host);

            if (ws?.readyState === CONNECTING) {
                await this.waitForSocket(ws, showError);
            }

            if (ws?.readyState === OPEN) {
                this.setStatusConnected();

                return ws;
            }
        }

        this.status?.setConnection('connecting', host);

        let ws = new WebSocket(`ws://${host}/`);

        // Keep the pending request so new calls can wait for it.
        this.webSockets.set(host, ws);

        let airCode = this;

        ws.onopen = async function () {
            let information = await airCode.askInformation(ws);

            let version = information.version;
            let versionComparison = airCode.compareVersions(version);

            if (versionComparison != VersionComparison.Compatible) {
                if (versionComparison == VersionComparison.UpdateCodea) {
                    vscode.window.showErrorMessage(`Codea must be updated to version ${codeaVersion} or higher.`,
                        ...["App Store"]).then(selection => {
                            if (selection) {
                                vscode.env.openExternal(vscode.Uri.parse('https://apps.apple.com/us/app/codea/id439571171'));
                            }
                        });
                }
                else {
                    vscode.window.showErrorMessage(`The extension must be updated to version ${semver.major(version)}.${semver.minor(version)}.0 or higher.`,
                        ...["Show Updates"]).then(selection => {
                            if (selection) {
                                vscode.commands.executeCommand("workbench.extensions.action.extensionUpdates");
                            }
                        });    
                }
                airCode.webSockets.delete(host);
                ws.close(CloseEventCode.IncompatibleVersion);
                return;
            }

            airCode.textFileExtensions = information.textExtensions;

            parent.setStatusConnected();

            airCode.watchesFiles = information.watchesFiles === true;
            airCode.listsFileVersions = information.listsFileVersions === true;
            airCode.listsSubfolders = information.listsSubfolders === true;
            airCode.hasModernReference = information.hasModernReference === true;
            airCode.capturesFrames = information.capturesFrames === true;
            airCode.takesTouches = information.takesTouches === true;
            if (information.builtInCollections) {
                airCode.builtInCollections = information.builtInCollections;
            }
            airCode.sendWatchedPaths(uri);

            airCode.startLanguageClient();

            let parameters = await airCode.getParameters(uri);

            airCode.parametersView.setParameters(parameters);
            await airCode.referenceView.refresh();

            airCode.status?.setRunning(information.hasHost);
            if (information.hasHost) {
                airCode.startDebugging();
            }

            airCode._onDidConnect.fire();
        };

        let parent = this;

        ws.onmessage = function (evt: MessageEvent) {
            let result = JSON.parse(evt.data as string);
            airCode.lastAnswer = Date.now();

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
                        case "userMessage":
                            {
                                switch (data.style) {
                                    case "print":
                                        {
                                            vscode.window.showInformationMessage(data.text);
                                            break;
    
                                        }
                                    case "warning":
                                        {
                                            vscode.window.showWarningMessage(data.text);
                                            break;
    
                                        }
                                    case "error":
                                        {
                                            vscode.window.showErrorMessage(data.text);
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
                        case "projectStarted":
                            {
                                parent.status?.setRunning(true);
                                parent.startDebugging();
                                break;
                            }
                        case "clearParameters":
                            {
                                parent.parametersView.clearParameters();
                                break;
                            }
                        case "projectStopped":
                            {
                                parent.status?.setRunning(false);
                                parent.parametersView.clearParameters();
                                vscode.debug.stopDebugging();
                                break;
                            }
                        case "debugResponse":
                            {
                                airCode.debugEvents.fire(data.message);
                                break;
                            }
                        case "filesChanged":
                            {
                                airCode.filesChanged.fire(data);
                                for (const file of data.files as string[]) {
                                    airCode.fileChanged(uri.with({ path: `${data.path}/${file}` }));
                                }
                                break;
                            }
                        case "lspResponse":
                            {
                                airCode.logLsp(`lspResponse ${data.message}`)
                                const responseMessage = JSON.parse(data.message);
                                airCode.messageReader.onMessage(responseMessage);
                                break;
                            }
                    }
                }
                
            }
        };

        ws.onclose = async function (event: CloseEvent) {
            const current = airCode.webSockets.get(host);
            if (current !== undefined && current !== ws) {
                return;
            }

            airCode.closingSocket = true;

            airCode.logLsp("Stopping languageClient...");

            airCode.languageClient?.stop();
            airCode.languageClient?.outputChannel.dispose();
            airCode.languageClient = undefined;

            for (let [id, promise] of parent.promises) {
                promise({
                    error: "connectionLost"
                });
            }
            parent.promises.clear();

            parent.status?.setConnection('lost');

            await vscode.debug.stopDebugging();
            parent.parametersView.clearParameters();

            airCode.closingSocket = false;
        };

        let success = await this.waitForSocket(ws, showError);

        if (!success) {
            parent.status?.setConnection('failed');

            this.webSockets.clear();
            ws.close();
            return undefined;
        }

        return ws;
    }

    startLanguageClient() {
        this.languageClient?.stop();

        // Options to control the language client
        let clientOptions: LanguageClientOptions = {
            // Register the server for lua documents
            documentSelector: [
                { scheme: 'codea', language: 'lua' },
                ...(this.links?.projects() ?? []).map(project => ({
                    scheme: 'file', language: 'lua', pattern: `${project.localUri.fsPath}/**/*.lua`
                }))
            ],
            synchronize: {
                // Notify the server about file changes to '.clientrc files contained in the workspace
                fileEvents: vscode.workspace.createFileSystemWatcher('**/*.lua')
            },
            revealOutputChannelOn: RevealOutputChannelOn.Never
        };

        // Create the language client and start the client.
        this.languageClient = new LanguageClient(
            'codea-air-code.languageClient',
            'Codea Language Client',
            () => Promise.resolve({
                reader: this.messageReader,
                writer: this.messageWriter,
            }),
            clientOptions
        );

        this.languageClient.start();
    }

    // The language client only sees the linked folders it was started with
    restartLanguageClient() {
        if (this.languageClient !== undefined) {
            this.startLanguageClient();
        }
    }

    // Projects to hear about, as paths under /Codea, e.g. "/Codea/Documents/Project"
    setWatchedPaths(uri: vscode.Uri, paths: string[]) {
        const unchanged = paths.length === this.watchedPaths.length && paths.every((path, i) => path === this.watchedPaths[i]);
        this.watchedPaths = paths;
        if (!unchanged) {
            this.sendWatchedPaths(uri);
        }
    }

    private sendWatchedPaths(uri: vscode.Uri) {
        if (this.watchesFiles && uri.scheme === "codea") {
            this.sendCommand(uri, Command.WatchFiles.from(this.watchedPaths));
        }
    }

    // Sending Commands

    send<T>(ws: WebSocket, command: Command, promise: (response: Response<T>) => void): number {
        this.commandId++;
        const id = this.commandId;
        command.id = id;
        this.logLsp(`command ${command.id} - ${command.command}`);
        ws.send(JSON.stringify(command));
        this.promises.set(id, promise);

        // Codea can stop answering a connection, as when a newer one connects and leaves. The
        // command then fails and the connection is replaced, rather than waiting forever.
        const timeout = AirCode.slowCommands.includes(command.command) ? 60000 : 15000;
        setTimeout(() => {
            const pending = this.promises.get(id);
            if (pending === undefined) {
                return;
            }
            this.promises.delete(id);
            this.logLsp(`command ${id} - ${command.command} timed out`);
            pending({ id, error: "connectionLost" } as any);
            this.dropConnection(ws);
        }, timeout);
        return id;
    }

    // Codea before 3.20 can miss what is sent as a connection opens, so a connection's first
    // getInformation is sent again until one is answered
    private askInformation(ws: WebSocket): Promise<GetInformationResponse> {
        return new Promise((resolve, reject) => {
            const asked: number[] = [];
            let answered = false;
            const ask = () => {
                asked.push(this.send<GetInformationResponse>(ws, Command.GetInformation.from(), response => {
                    answered = true;
                    asked.forEach(id => this.promises.delete(id));
                    if (response.error !== null && response.error !== undefined) {
                        reject(Response.from(response.error));
                    } else {
                        resolve(response.data as GetInformationResponse);
                    }
                }));
                setTimeout(() => {
                    if (!answered && asked.length < 5 && ws.readyState === OPEN) {
                        ask();
                    }
                }, 3000);
            };
            ask();
        });
    }

    private static readonly slowCommands: Command.Type[] = ["readFile", "writeFile", "startHost"];

    // Forgets a connection that stopped answering, so the next command opens a new one
    private dropConnection(ws: WebSocket) {
        for (const [host, socket] of this.webSockets) {
            if (socket === ws) {
                this.webSockets.delete(host);
            }
        }
        ws.close();
    }

    sendCommandMapResponse<R, T>(uri: vscode.Uri, command: Command, map: (response: R | Error) => Result<T, Error>): T | Thenable<T> {
        return new Promise((resolve, reject) => {
            this.getSocketForUri(uri).then(ws => {
                if (ws === undefined) {
                    const result = map(Response.from('connectionLost'));
                    if (result.success) {
                        resolve(result.value);
                    } else {
                        reject(result.error);
                    }    
                }
                else {
                    this.send<R>(ws, command, response => {
                        let responseData : any = Response.from('connectionLost');
                
                        if (response.error !== null && response.error !== undefined) {
                            responseData = Response.from(response.error);
                        } else if (response.data !== null && response.data !== undefined) {
                            responseData = response.data;
                        }

                        const result = map(responseData);
                        if (result.success) {
                            resolve(result.value);
                        } else {
                            reject(result.error);
                        }    
                    });    
                }
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

    async setRuntime(uri: vscode.Uri, runtime: string) {
        await this.sendCommand(uri, Command.SetRuntimeCommand.from(uri.path, runtime));
    }

    listUnimportedProjects(uri: vscode.Uri): string[] | Thenable<string[]> {
        return this.sendCommand(uri, Command.ListUnimportedProjects.from(uri.path));
    }

    createFolder(uri: vscode.Uri): void | Thenable<void> {
        return this.sendCommand(uri, Command.CreateFolder.from(uri.path));
    }

    loadString(uri: vscode.Uri, content: string) {
        this.sendCommand(uri, Command.LoadString.from(content));
    }

    async startHost(uri: vscode.Uri) : Promise<StartHostResponse> {
        const project = new AirCodePath(uri.path).project;
        if (project) {
            this.status?.setStartedProject(project);
        }
        return this.sendCommand<StartHostResponse>(uri, Command.StartHost.from(uri.path));
    }

    stopHost(uri: vscode.Uri) {
        this.sendCommand(uri, Command.StopHost.from());
    }

    async getInformation(uri: vscode.Uri) : Promise<GetInformationResponse> {
        return this.sendCommand<GetInformationResponse>(uri, Command.GetInformation.from());
    }

    // Codea sends its answers to the newest connection only, and older versions stop answering
    // altogether when any older connection closes, such as one from another VS Code window. A
    // connection that no longer answers is replaced. This also sets the text extensions writeFile
    // needs. The check is a stat: a getInformation would make Codea skip commands still queued.
    async ensureResponsive(uri: vscode.Uri) {
        if (Date.now() - this.lastAnswer < 3000 && this.textFileExtensions.length > 0) {
            return;
        }

        const root = uri.with({ path: `/${AirCode.rootFolder}` });
        for (let attempt = 0; attempt < 2; attempt++) {
            const timeout = new Promise<boolean>(resolve => setTimeout(() => resolve(false), 5000));
            const answered = Promise.resolve(this.sendCommand(root, Command.StatFile.from(root.path))).then(() => true, () => true);
            if (await Promise.race([answered, timeout])) {
                if (this.textFileExtensions.length === 0) {
                    this.textFileExtensions = (await this.getInformation(uri)).textExtensions;
                }
                return;
            }
            await this.closeConnection(uri);
        }
        throw new Error("Codea is not answering");
    }

    // Waits for the close to finish, so that it reaches Codea before any new connection does
    async closeConnection(uri: vscode.Uri) {
        const host = await this.checkForProxy(uri.authority, false);
        const ws = this.webSockets.get(host);
        this.webSockets.delete(host);
        if (ws === undefined || ws.readyState === ws.CLOSED) {
            return;
        }
        await new Promise<void>(resolve => {
            ws.once('close', () => resolve());
            setTimeout(resolve, 3000);
            ws.close();
        });
        await this.waitForClosingSocket();
    }

    async addDependency(uri: vscode.Uri, dependency: string) : Promise<AddDependencyResponse> {
        return this.sendCommand<AddDependencyResponse>(uri, Command.AddDependency.from(uri.path, dependency));
    }

    async getAssetKey(uri: vscode.Uri, targetUri: vscode.Uri) : Promise<GetAssetKeyResponse> {
        return this.sendCommand<GetAssetKeyResponse>(uri, Command.GetAssetKey.from(uri.path, targetUri.path));
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

    lspMessage(message: string) {
        this.sendCommand(getWorkspaceUri(), Command.LSPMessage.from(message));
    }

    getChapters(uri: vscode.Uri, modern: boolean): any[] | Thenable<any[]> {
        return this.sendCommandMapResponse<String, any[]>(uri, Command.GetChapters.from(modern), response => {
            if (response instanceof Error) {
                return Result.error(response);
            } else {
                return Result.success(response as any);
            }
        });
    }    

    getChapterImage(uri: vscode.Uri, chapter: string, modern: boolean): string | Thenable<string> {
        return this.sendCommandMapResponse<String, string>(uri, Command.GetChapterImage.from(chapter, modern), response => {
            if (response instanceof Error) {
                return Result.error(response);
            } else {
                return Result.success(response as string);
            }
        });
    }    

    async getFunctions(uri: vscode.Uri, chapter: string, modern: boolean) : Promise<GetFunctionsResponse> {
        return this.sendCommand<GetFunctionsResponse>(uri, Command.GetFunctions.from(chapter, modern));
    }    

    getCategoryImage(uri: vscode.Uri, category: string): string | Thenable<string> {
        return this.sendCommandMapResponse<String, string>(uri, Command.GetCategoryImage.from(category), response => {
            if (response instanceof Error) {
                return Result.error(response);
            } else {
                return Result.success(response as string);
            }
        });
    }

    getFunctionDetails(uri: vscode.Uri, chapter: string, functionId: string, modern: boolean): any[] | Thenable<any[]> {
        return this.sendCommandMapResponse<String, any[]>(uri, Command.GetFunctionDetails.from(chapter, functionId, modern), response => {
            if (response instanceof Error) {
                return Result.error(response);
            } else {
                return Result.success(response as any);
            }
        });
    }

    async findReference(uri: vscode.Uri, text: string, modern: boolean) : Promise<FindReferenceResponse> {
        return this.sendCommand<FindReferenceResponse>(uri, Command.FindReference.from(text, modern));
    }
    
    // The files of a folder with Codea's modification dates, in one request
    async listFileVersions(uri: vscode.Uri): Promise<FileVersion[]> {
        return this.sendCommand<FileVersion[]>(uri, Command.ListFileVersions.from(uri.path));
    }

    // A touch for the running project, in the points of the frames captureFrame sends of it
    async sendTouch(uri: vscode.Uri, touchId: number, phase: Command.TouchPhase, x: number, y: number, prevX: number, prevY: number): Promise<void> {
        await this.sendCommand(uri, Command.SendTouch.from(touchId, phase, x, y, prevX, prevY));
    }

    // The running project, or the device's whole screen, no larger than maxWidth by maxHeight pixels
    async captureFrame(uri: vscode.Uri, maxWidth: number, maxHeight: number, quality: number, project: boolean): Promise<Frame> {
        return this.sendCommand<Frame>(uri, Command.CaptureFrame.from(maxWidth, maxHeight, quality, project));
    }

    // VS Code FileSystemProvider Implementation

    watch(uri: vscode.Uri, options: { readonly recursive: boolean; readonly excludes: readonly string[]; }): vscode.Disposable {
        return new vscode.Disposable(() => { });
    }

    stat(uri: vscode.Uri): vscode.FileStat | Thenable<vscode.FileStat> {
        return this.sendCommand<vscode.FileStat>(uri, Command.StatFile.from(uri.path));
    }

    readDirectory(uri: vscode.Uri): [string, vscode.FileType][] | Thenable<[string, vscode.FileType][]> {
        return this.sendCommand<[string, vscode.FileType][]>(uri, Command.ListFiles.from(uri.path));
    }

    createDirectory(uri: vscode.Uri): void | Thenable<void> {
        return this.createFolder(uri);
    }

    readFile(uri: vscode.Uri): Uint8Array | Thenable<Uint8Array> {
        let enc = new TextEncoder();

        return this.sendCommandMapResponse<ReadFileResponse, Uint8Array>(uri, Command.ReadFile.from(uri.path), response => {
            if (response instanceof Error) {
                return Result.error(response);
            } else {
                if (response.isText) {
                    return Result.success(enc.encode(response.content));
                }
                else {
                    // Decode the base64 content to a Uint8Array
                    return Result.success(Buffer.from(response.content, 'base64'));
                }
            }
        });
    }

    writeFile(uri: vscode.Uri, content: Uint8Array, options: { readonly create: boolean; readonly overwrite: boolean; }): void | Thenable<void> {
        const path = uri.path;

        if (this.textFileExtensions.includes(path.split('.').pop() || "")) {
            let dec = new TextDecoder();
            return this.sendCommand(uri, Command.WriteFile.from(path, dec.decode(content)));
        }
        else {
            // Encode the Uint8Array to base64
            return this.sendCommand(uri, Command.WriteFile.from(path, Buffer.from(content).toString('base64')));
        }
    }

    delete(uri: vscode.Uri, options: { readonly recursive: boolean; }): void | Thenable<void> {
        return this.sendCommandMapResponse<DeleteFileResponse, void>(uri, Command.DeleteFile.from(uri.path), response =>
            response instanceof Error ? Result.error(response) : Result.success(undefined));
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
