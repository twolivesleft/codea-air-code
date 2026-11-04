import * as assert from 'assert';
import { CancellationTokenSource, EventEmitter, FileDecoration, Uri } from 'vscode';

import { CodeaDecorationProvider } from '../../decorator';
import { Links } from '../../links';

suite('CodeaDecorationProvider', () => {
	const projects = [
		{ localUri: Uri.file('/work/Game.codea'), remotePath: 'Documents/Game' },
		{ localUri: Uri.file('/work/Shared.codea'), remotePath: 'iCloud/Shared' },
	];
	const links = { projects: () => projects, onDidChange: new EventEmitter<void>().event } as unknown as Links;
	const provider = new CodeaDecorationProvider(links);
	const decoration = (uri: Uri) => provider.provideFileDecoration(uri, new CancellationTokenSource().token) as FileDecoration | undefined;

	test('a linked folder shows a link, named after its project', () => {
		assert.deepStrictEqual(decoration(Uri.file('/work/Game.codea')), { badge: '🔗', tooltip: 'Linked to Documents/Game' });
	});

	test('a linked iCloud project shows a cloud', () => {
		assert.deepStrictEqual(decoration(Uri.file('/work/Shared.codea')), { badge: '☁️', tooltip: 'Linked to iCloud/Shared' });
	});

	test('other folders and the files in a linked one are left alone', () => {
		assert.strictEqual(decoration(Uri.file('/work/Other.codea')), undefined);
		assert.strictEqual(decoration(Uri.file('/work/Game.codea/Main.lua')), undefined);
	});
});
