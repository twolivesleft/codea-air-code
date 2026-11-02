import * as assert from 'assert';

import { dependenciesIn, dependencyFile, requiredAssets, requireOf, withoutDependency, withoutRequire } from '../../dependencies';

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

suite('requiredAssets', () => {
	test('reads the asset keys of require calls', () => {
		const source = `-- Game
require(asset.documents.Common)
require(asset.documents["iPad Projects"].Mouse_Support)
require (asset.icloud.Shared.Lib)
require(asset.Dependencies.Entity_Plus)
require("socket")
local ui = require(asset.documents.Vibe.vibe_ui)`;
		assert.deepStrictEqual(requiredAssets(source), [
			['documents', 'Common'],
			['documents', 'iPad Projects', 'Mouse_Support'],
			['icloud', 'Shared', 'Lib'],
			['Dependencies', 'Entity_Plus'],
			['documents', 'Vibe', 'vibe_ui'],
		]);
	});
});

suite('requireOf', () => {
	test('writes the asset key Codea writes', () => {
		assert.strictEqual(requireOf('Documents/Common'), 'require(asset.documents.Common)');
		assert.strictEqual(requireOf('iPad Projects/Common'), 'require(asset.documents["iPad Projects"].Common)');
		assert.strictEqual(requireOf('Documents/Mouse Support'), 'require(asset.documents["Mouse Support"])');
		assert.strictEqual(requireOf('iCloud/Shared/Lib'), 'require(asset.icloud.Shared.Lib)');
	});
});

suite('withoutRequire', () => {
	test('removes the require statements of a dependency, and only those', () => {
		const source = 'require(asset.documents.Common)\nrequire(asset.documents.CommonExtra)\n-- code\n  require( asset.documents.Common )  \n';
		assert.strictEqual(withoutRequire(source, ['documents', 'Common']), 'require(asset.documents.CommonExtra)\n-- code\n');
	});
});

suite('withoutDependency', () => {
	const plist = (...entries: string[]) => `<dict>
	<key>Dependencies</key>
	<array>
${entries.map(entry => `		<string>${entry}</string>`).join('\n')}
	</array>
</dict>`;

	test('removes a dependency written either way, and only it', () => {
		assert.strictEqual(withoutDependency(plist('AR', 'iPad Projects:Common'), 'iPad Projects', 'Common'), plist('AR'));
		assert.strictEqual(withoutDependency(plist('AR', 'Documents:ARX'), undefined, 'AR'), plist('Documents:ARX'));
	});
});
