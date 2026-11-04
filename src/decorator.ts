import { AirCodePath } from './aircodepath';
import { CancellationToken, Event, EventEmitter, FileDecoration, FileDecorationProvider, ProviderResult, Uri } from "vscode";
import { Links } from './links';

// Marks iCloud projects by their path, and linked folders by the project they hold
export class CodeaDecorationProvider implements FileDecorationProvider {
    private _onDidChange = new EventEmitter<undefined>();
    onDidChangeFileDecorations: Event<undefined> = this._onDidChange.event;

    constructor(private readonly links: Links) {
        links.onDidChange(() => this._onDidChange.fire(undefined));
    }

    provideFileDecoration(uri: Uri, token: CancellationToken): ProviderResult<FileDecoration> {
        if (uri.scheme !== 'file') {
            return new AirCodePath(uri.path).isCloud ? { badge: '☁️', tooltip: 'iCloud' } : undefined;
        }

        const linked = this.links.projects().find(project => project.localUri.path === uri.path);
        if (linked === undefined) {
            return undefined;
        }

        return {
            badge: linked.remotePath.startsWith('iCloud/') ? '☁️' : '🔗',
            tooltip: `Linked to ${linked.remotePath}`
        };
    }
}
