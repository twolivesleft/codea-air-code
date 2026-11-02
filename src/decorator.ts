import { AirCodePath } from './aircodepath';
import { CancellationToken, Event, EventEmitter, FileDecoration, FileDecorationProvider, ProviderResult, Uri } from "vscode";
import { Links } from './links';

// Marks iCloud projects: codea:// ones by their path, linked folders by the project they hold
export class CodeaDecorationProvider implements FileDecorationProvider {
    private _onDidChange = new EventEmitter<undefined>();
    onDidChangeFileDecorations: Event<undefined> = this._onDidChange.event;

    constructor(private readonly links: Links) {
        links.onDidChange(() => this._onDidChange.fire(undefined));
    }

    provideFileDecoration(uri: Uri, token: CancellationToken): ProviderResult<FileDecoration> {
        const isCloud = uri.scheme === 'file'
            ? this.links.projects().some(project => project.localUri.path === uri.path && project.remotePath.startsWith('iCloud/'))
            : new AirCodePath(uri.path).isCloud;

        if (isCloud) {
            return {
                badge: '☁️',
                tooltip: 'iCloud'
            };
        }

        return undefined;
    }
}
