import * as assert from 'assert';

import { dependenciesIn, dependencyFile } from '../../dependencies';

suite('dependenciesIn', () => {
	test('lists a project\'s dependencies as collection and project', () => {
		const plist = `<dict>
	<key>Buffer Order</key>
	<array>
		<string>Main</string>
	</array>
	<key>Dependencies</key>
	<array>
		<string>Secrets:Secrets</string>
		<string>iPad Projects:Common</string>
	</array>
</dict>`;
		assert.deepStrictEqual(dependenciesIn(plist), [
			{ collection: 'Secrets', project: 'Secrets' },
			{ collection: 'iPad Projects', project: 'Common' },
		]);
	});

	test('a dependency added over Air Code is named by its project alone', () => {
		assert.deepStrictEqual(dependenciesIn('<key>Dependencies</key>\n\t<array>\n\t\t<string>DepLib</string>\n\t</array>'), [
			{ collection: undefined, project: 'DepLib' },
		]);
	});

	test('none when the key is missing', () => {
		assert.deepStrictEqual(dependenciesIn('<dict><key>Buffer Order</key><array></array></dict>'), []);
	});
});

suite('dependencyFile', () => {
	test('a file of a dependency, as the debugger names it', () => {
		assert.deepStrictEqual(dependencyFile('/Codea/iPad Projects/Game/Dependencies/Common/Util.lua'),
			{ dependent: 'iPad Projects/Game', dependency: 'Common', file: 'Util.lua' });
		assert.deepStrictEqual(dependencyFile('codea://host:18513/Codea/iCloud/Shared/Game/Dependencies/Common/sub/Util.lua'),
			{ dependent: 'iCloud/Shared/Game', dependency: 'Common', file: 'sub/Util.lua' });
	});

	test('other files are not', () => {
		assert.strictEqual(dependencyFile('/Codea/iPad Projects/Game/Util.lua'), undefined);
		assert.strictEqual(dependencyFile('/Codea/Documents/Dependencies/Util.lua'), undefined);
	});
});

