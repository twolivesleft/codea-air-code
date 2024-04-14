import { AirCodePath } from './aircodepath';
import { CancellationToken, Event, FileDecoration, FileDecorationProvider, ProviderResult, Uri } from "vscode";

export class CodeaDecorationProvider implements FileDecorationProvider {
    onDidChangeFileDecorations?: Event<Uri | Uri[] | undefined> | undefined;

    provideFileDecoration(uri: Uri, token: CancellationToken): ProviderResult<FileDecoration> {
        const airCodePath = new AirCodePath(uri.path);

        if (airCodePath.isCloud) {
            return {
                badge: '☁️',
                tooltip: 'iCloud'
            };
        }

        return undefined;
    }
}
