import * as vscode from 'vscode';
import { AirCode } from './aircode';

// The next frame is asked for as soon as one arrives: on an iPhone, spacing frames out
// cost a running project more frames per second than capturing continuously
const FRAME_INTERVAL = 0;
const RETRY_INTERVAL = 1000;
const QUALITY = 0.6;

// What the panel shows, and the largest frame in device pixels it can use
type FrameRequest = { width: number, height: number, project: boolean };

// A panel showing the running project or the device's screen, refreshed while it is visible
export class DevicePreview {
    static readonly viewType = 'codea-air-code.devicePreview';
    private panel: vscode.WebviewPanel | undefined;
    private request: FrameRequest = { width: 0, height: 0, project: true };
    private running = false;
    // Set while files sync, which then has Air Code to itself
    private paused = false;
    private readonly onDidChangeEmitter = new vscode.EventEmitter<boolean>();
    readonly onDidChange = this.onDidChangeEmitter.event;

    constructor(private readonly airCode: AirCode, private readonly uri: () => vscode.Uri) {}

    get isOpen(): boolean {
        return this.panel !== undefined;
    }

    setPaused(paused: boolean) {
        this.paused = paused;
        this.run();
    }

    toggle() {
        if (this.panel) {
            this.panel.dispose();
        } else {
            this.open();
        }
    }

    // Brings back a panel left open when the window reloaded
    serializer(): vscode.WebviewPanelSerializer {
        return { deserializeWebviewPanel: async panel => this.adopt(panel) };
    }

    private open() {
        this.adopt(vscode.window.createWebviewPanel(DevicePreview.viewType, "Codea Device",
            { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
            { enableScripts: true, retainContextWhenHidden: true }));
    }

    private adopt(panel: vscode.WebviewPanel) {
        panel.webview.options = { enableScripts: true };
        panel.webview.html = this.html();
        panel.webview.onDidReceiveMessage(message => {
            if (message.type === 'request') {
                this.request = { width: message.width, height: message.height, project: message.project };
                this.run();
            }
        });
        panel.onDidChangeViewState(() => this.run());
        panel.onDidDispose(() => {
            this.panel = undefined;
            this.onDidChangeEmitter.fire(false);
        });
        this.panel = panel;
        this.onDidChangeEmitter.fire(true);
    }

    // Asks for one frame at a time, so a slow connection slows the preview rather than queuing frames
    private async run() {
        if (this.running) {
            return;
        }
        this.running = true;
        try {
            while (this.panel?.visible && !this.paused && this.request.width > 0 && this.request.height > 0) {
                const panel = this.panel;
                // The panel can close while a frame is on its way
                const post = (message: object) => {
                    if (this.panel === panel) {
                        panel.webview.postMessage(message);
                    }
                };
                const { width, height, project } = this.request;
                const started = Date.now();
                let wait = FRAME_INTERVAL;
                try {
                    if (!this.airCode.capturesFrames) {
                        // Connecting tells what this Codea supports
                        await this.airCode.getInformation(this.uri());
                    }
                    if (this.airCode.capturesFrames) {
                        const frame = await this.airCode.captureFrame(this.uri(), width, height, QUALITY, project);
                        post({ type: 'frame', ...frame });
                        if (frame.data === undefined) {
                            wait = RETRY_INTERVAL;
                        }
                    } else {
                        post({ type: 'message', text: "Update Codea to see the device's screen here." });
                        wait = RETRY_INTERVAL;
                    }
                } catch {
                    post({ type: 'message', text: "Waiting for Codea..." });
                    wait = RETRY_INTERVAL;
                }
                await new Promise(resolve => setTimeout(resolve, Math.max(0, wait - (Date.now() - started))));
            }
        } finally {
            this.running = false;
        }
    }

    private html(): string {
        const nonce = Array.from({ length: 32 }, () => Math.floor(Math.random() * 36).toString(36)).join('');
        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">
	html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; }
	body { display: flex; flex-direction: column; font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); }
	#toolbar { display: flex; gap: 6px; align-items: center; padding: 4px 8px; border-bottom: 1px solid var(--vscode-panel-border); }
	#toolbar button, #toolbar select { font: inherit; color: var(--vscode-foreground); background: transparent; border: 1px solid var(--vscode-button-border, transparent); border-radius: 3px; padding: 2px 8px; cursor: pointer; }
	#toolbar button[aria-pressed="true"] { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
	#toolbar select { background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground); border-color: var(--vscode-dropdown-border); }
	.spacer { flex: 1; }
	#stage { flex: 1; position: relative; overflow: auto; display: flex; }
	#frame { margin: auto; display: block; }
	#stage.fit #frame { max-width: 100%; max-height: 100%; object-fit: contain; }
	#frame.idle { opacity: 0.3; filter: grayscale(1); }
	#message { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: var(--vscode-descriptionForeground); pointer-events: none; }
</style>
</head>
<body>
<div id="toolbar">
	<button id="project" title="Only the running project">Project</button>
	<button id="screen" title="Everything on the device's screen">Screen</button>
	<span class="spacer"></span>
	<select id="zoom" title="Zoom">
		<option value="fit">Fit</option>
		<option value="0.5">50%</option>
		<option value="1">Actual Size</option>
		<option value="2">200%</option>
	</select>
</div>
<div id="stage" class="fit">
	<img id="frame" alt="">
	<div id="message">Connecting...</div>
</div>
<script nonce="${nonce}">
	const vscode = acquireVsCodeApi();
	const state = Object.assign({ project: true, zoom: 'fit' }, vscode.getState());
	const stage = document.getElementById('stage');
	const frame = document.getElementById('frame');
	const message = document.getElementById('message');
	const zoom = document.getElementById('zoom');
	const scopes = { project: document.getElementById('project'), screen: document.getElementById('screen') };
	// The size in points of what was last shown, which a zoom other than Fit is applied to
	let points;

	function request() {
		let width = stage.clientWidth, height = stage.clientHeight;
		if (state.zoom !== 'fit' && points) {
			width = points.width * Number(state.zoom);
			height = points.height * Number(state.zoom);
		}
		vscode.postMessage({ type: 'request', project: state.project,
			width: Math.round(width * devicePixelRatio), height: Math.round(height * devicePixelRatio) });
	}

	function layout() {
		stage.classList.toggle('fit', state.zoom === 'fit');
		if (state.zoom !== 'fit' && points) {
			frame.style.width = points.width * Number(state.zoom) + 'px';
			frame.style.height = points.height * Number(state.zoom) + 'px';
		} else {
			frame.style.width = frame.style.height = '';
		}
	}

	function apply() {
		vscode.setState(state);
		scopes.project.setAttribute('aria-pressed', String(state.project));
		scopes.screen.setAttribute('aria-pressed', String(!state.project));
		zoom.value = state.zoom;
		layout();
		request();
	}

	scopes.project.addEventListener('click', () => { state.project = true; points = undefined; apply(); });
	scopes.screen.addEventListener('click', () => { state.project = false; points = undefined; apply(); });
	zoom.addEventListener('change', () => { state.zoom = zoom.value; apply(); });
	new ResizeObserver(request).observe(stage);

	window.addEventListener('message', event => {
		const data = event.data;
		if (data.type === 'frame' && data.data) {
			frame.src = 'data:image/jpeg;base64,' + data.data;
			frame.classList.remove('idle');
			message.textContent = '';
			const changed = !points || points.width !== data.pointWidth || points.height !== data.pointHeight;
			points = { width: data.pointWidth, height: data.pointHeight };
			if (changed) {
				layout();
				request();
			}
		} else if (data.type === 'frame') {
			frame.classList.add('idle');
			message.textContent = 'No project running';
		} else if (data.type === 'message') {
			frame.classList.add('idle');
			message.textContent = data.text;
		}
	});

	apply();
</script>
</body>
</html>`;
    }
}
