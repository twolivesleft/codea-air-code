import * as vscode from 'vscode';

export type ConnectionState = 'notConnected' | 'connecting' | 'connected' | 'lost' | 'failed' | 'disconnected';

// The Codea items of the status bar: the connection, and Play or Stop for the project in focus
export class CodeaStatus {
    private connectionItem: vscode.StatusBarItem;
    private playItem: vscode.StatusBarItem;
    private previewItem: vscode.StatusBarItem;

    private state: ConnectionState = 'notConnected';
    private host: string | undefined;
    private syncing = false;
    private project: string | undefined;
    private running = false;
    // The project started from here, shown instead of the one in focus while it runs
    private startedProject: string | undefined;
    private visible = false;
    private previewOpen = false;

    constructor(context: vscode.ExtensionContext) {
        this.connectionItem = vscode.window.createStatusBarItem('codea-air-code.connection', vscode.StatusBarAlignment.Left, 100);
        this.connectionItem.name = "Codea Connection";
        this.connectionItem.command = "codea-air-code.showMenu";
        context.subscriptions.push(this.connectionItem);

        this.previewItem = vscode.window.createStatusBarItem('codea-air-code.preview', vscode.StatusBarAlignment.Left, 99.5);
        this.previewItem.name = "Codea Device Preview";
        this.previewItem.command = "codea-air-code.toggleDevicePreview";
        context.subscriptions.push(this.previewItem);

        this.playItem = vscode.window.createStatusBarItem('codea-air-code.play', vscode.StatusBarAlignment.Left, 99);
        this.playItem.name = "Codea Play";
        context.subscriptions.push(this.playItem);

        this.render();
    }

    // Only Codea and linked workspaces show the items
    setVisible(visible: boolean) {
        this.visible = visible;
        this.render();
    }

    setConnection(state: ConnectionState, host?: string) {
        this.state = state;
        this.host = host ?? this.host;
        if (state !== 'connected') {
            this.running = false;
            this.startedProject = undefined;
        }
        this.render();
    }

    setPreviewOpen(open: boolean) {
        this.previewOpen = open;
        this.render();
    }

    setSyncing(syncing: boolean) {
        this.syncing = syncing;
        this.render();
    }

    setProject(project: string | undefined) {
        this.project = project;
        this.render();
    }

    setStartedProject(project: string) {
        this.startedProject = project;
        this.render();
    }

    setRunning(running: boolean) {
        this.running = running;
        if (!running) {
            this.startedProject = undefined;
        }
        this.render();
    }

    private render() {
        const connection = this.connectionItem;
        connection.backgroundColor = undefined;

        switch (this.state) {
            case 'connected':
                connection.text = this.syncing ? "$(sync~spin) Codea" : "$(codea-logo) Codea";
                connection.tooltip = this.syncing ? "Syncing linked folders with Codea..." : `Connected to Codea${this.host ? ` at ${this.host}` : ""}`;
                break;
            case 'connecting':
                connection.text = "$(sync~spin) Codea";
                connection.tooltip = "Connecting to Codea...";
                break;
            case 'disconnected':
                connection.text = "$(debug-disconnect) Codea";
                connection.tooltip = `Disconnected from Codea${this.host ? ` at ${this.host}` : ""}. Click to connect.`;
                break;
            default:
                connection.text = "$(debug-disconnect) Codea";
                connection.tooltip = {
                    notConnected: "Not connected to Codea",
                    lost: "The connection to Codea was lost",
                    failed: "Could not connect to Codea",
                }[this.state];
                connection.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
                break;
        }

        const play = this.playItem;
        const project = this.running ? this.startedProject ?? this.project : this.project;
        if (project !== undefined) {
            play.text = `${this.running ? "$(debug-stop)" : "$(play)"} ${project}`;
            play.tooltip = this.running ? `Stop ${project} in Codea` : `Play ${project} in Codea`;
            play.command = this.running ? "workbench.action.debug.disconnect" : "workbench.action.debug.start";
        }

        if (this.visible) {
            connection.show();
        } else {
            connection.hide();
        }

        const preview = this.previewItem;
        preview.text = "$(device-mobile)";
        preview.tooltip = this.previewOpen ? "Hide the device's screen" : "Show the device's screen";
        preview.backgroundColor = this.previewOpen ? new vscode.ThemeColor("statusBarItem.prominentBackground") : undefined;
        if (this.visible && (this.state === 'connected' || this.previewOpen)) {
            preview.show();
        } else {
            preview.hide();
        }

        if (this.visible && project !== undefined) {
            play.show();
        } else {
            play.hide();
        }
    }
}
