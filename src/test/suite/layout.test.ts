import * as assert from 'assert';

import { collectionOfFolder } from '../../layout';

suite('collectionOfFolder', () => {
	test('the workspace folder and its projects are Documents', () => {
		assert.strictEqual(collectionOfFolder(''), 'Documents');
		assert.strictEqual(collectionOfFolder('Game.codea'), 'Documents');
	});

	test('a folder at the top is a collection, and so is its projects\' parent', () => {
		assert.strictEqual(collectionOfFolder('iPad Projects'), 'iPad Projects');
		assert.strictEqual(collectionOfFolder('iPad Projects/Game.codea'), 'iPad Projects');
	});

	test('iCloud collections are one level down', () => {
		assert.strictEqual(collectionOfFolder('iCloud/Shared'), 'iCloud/Shared');
		assert.strictEqual(collectionOfFolder('iCloud/Shared/Game.codea'), 'iCloud/Shared');
		assert.strictEqual(collectionOfFolder('iCloud'), undefined);
	});

	test('other folders are no collection', () => {
		assert.strictEqual(collectionOfFolder('.vscode'), undefined);
		assert.strictEqual(collectionOfFolder('Game.codea/Assets'), undefined);
		assert.strictEqual(collectionOfFolder('iPad Projects/Notes'), undefined);
		assert.strictEqual(collectionOfFolder('a/b/c'), undefined);
	});
});
