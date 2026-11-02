import * as assert from 'assert';

import { guardDeletion, planSync, shortList } from '../../syncplan';

suite('planSync', () => {
	test('first sync copies a file that exists on one side only', () => {
		assert.strictEqual(planSync('a', undefined, undefined), 'push');
		assert.strictEqual(planSync(undefined, 'a', undefined), 'pull');
	});

	test('first sync of a file that differs is a conflict', () => {
		assert.strictEqual(planSync('a', 'b', undefined), 'conflict');
	});

	test('identical sides are recorded once', () => {
		assert.strictEqual(planSync('a', 'a', undefined), 'record');
		assert.strictEqual(planSync('a', 'a', 'old'), 'record');
		assert.strictEqual(planSync('a', 'a', 'a'), 'none');
	});

	test('a change on one side goes to the other', () => {
		assert.strictEqual(planSync('new', 'base', 'base'), 'push');
		assert.strictEqual(planSync('base', 'new', 'base'), 'pull');
	});

	test('a change on both sides is a conflict', () => {
		assert.strictEqual(planSync('mine', 'theirs', 'base'), 'conflict');
	});

	test('a deletion goes to the other side when it was unchanged there', () => {
		assert.strictEqual(planSync(undefined, 'base', 'base'), 'deleteRemote');
		assert.strictEqual(planSync('base', undefined, 'base'), 'deleteLocal');
	});

	test('a deletion against a change is a conflict', () => {
		assert.strictEqual(planSync(undefined, 'new', 'base'), 'conflict');
		assert.strictEqual(planSync('new', undefined, 'base'), 'conflict');
	});

	test('a file gone on both sides is forgotten', () => {
		assert.strictEqual(planSync(undefined, undefined, 'base'), 'forget');
		assert.strictEqual(planSync(undefined, undefined, undefined), 'none');
	});
});

suite('guardDeletion', () => {
	test('a local deletion seen happening is passed on to Codea', () => {
		assert.strictEqual(guardDeletion('deleteRemote', 'local'), 'deleteRemote');
	});

	test('a full sync brings back a file missing locally', () => {
		assert.strictEqual(guardDeletion('deleteRemote', 'full'), 'pull');
	});

	test('a change reported by Codea leaves a file missing locally alone', () => {
		assert.strictEqual(guardDeletion('deleteRemote', 'remote'), 'none');
	});

	test('a deletion Codea reported is passed on locally', () => {
		assert.strictEqual(guardDeletion('deleteLocal', 'remote'), 'deleteLocal');
	});

	test('a file missing in Codea is sent back unless Codea reported its deletion', () => {
		assert.strictEqual(guardDeletion('deleteLocal', 'full'), 'push');
		assert.strictEqual(guardDeletion('deleteLocal', 'local'), 'push');
	});

	test('other actions are left alone', () => {
		for (const action of ['none', 'record', 'forget', 'push', 'pull', 'conflict'] as const) {
			for (const source of ['local', 'remote', 'full'] as const) {
				assert.strictEqual(guardDeletion(action, source), action);
			}
		}
	});
});

suite('shortList', () => {
	test('a short list is shown whole', () => {
		assert.strictEqual(shortList(['a', 'b'], 2), 'a\nb');
	});

	test('a long list shows its first items and how many more', () => {
		const items = Array.from({ length: 219 }, (_, i) => `Project ${i + 1}`);
		const lines = shortList(items, 12).split('\n');
		assert.strictEqual(lines.length, 13);
		assert.deepStrictEqual(lines.slice(0, 12), items.slice(0, 12));
		assert.strictEqual(lines[12], 'and 207 more, all listed in the Codea output');
	});
});
