import * as assert from 'assert';

import { planSync } from '../../syncplan';

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
