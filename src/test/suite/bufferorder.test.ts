import * as assert from 'assert';

import { renameInBufferOrder } from '../../bufferorder';

const plist = (...tabs: string[]) => `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
	<key>Buffer Order</key>
	<array>
${tabs.map(tab => `		<string>${tab}</string>`).join('\n')}
	</array>
	<key>Runtime Type</key>
	<string>Ship</string>
</dict>
</plist>
`;

suite('renameInBufferOrder', () => {
	test('a renamed tab keeps its place', () => {
		assert.strictEqual(renameInBufferOrder(plist('Main', 'Ship', 'Rock'), 'Ship.lua', 'Player.lua'), plist('Main', 'Player', 'Rock'));
	});

	test('entries written with their extension keep it', () => {
		assert.strictEqual(renameInBufferOrder(plist('Main.lua', 'Ship.lua'), 'Ship.lua', 'Player.lua'), plist('Main.lua', 'Player.lua'));
	});

	test('only the Buffer Order changes', () => {
		assert.strictEqual(renameInBufferOrder(plist('Main', 'Rock'), 'Ship.lua', 'Player.lua'), undefined);
	});

	test('names are matched whole, and escaped as XML', () => {
		assert.strictEqual(renameInBufferOrder(plist('Main', 'Ship2', 'Ship'), 'Ship.lua', 'A&B.lua'), plist('Main', 'Ship2', 'A&amp;B'));
	});
});
