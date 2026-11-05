import * as assert from 'assert';

import { decodeChunkPath, encodeChunkPath } from '../../aircodepath';

suite('chunk paths', () => {
	test('encode a path as Codea names its chunks', () => {
		assert.strictEqual(encodeChunkPath('/Codea/iPad Projects/EmuTests/GPU.lua'), '/Codea/iPad%20Projects/EmuTests/GPU.lua');
		assert.strictEqual(encodeChunkPath("/Codea/Mine/Feed'em/Main.lua"), "/Codea/Mine/Feed'em/Main.lua");
		assert.strictEqual(encodeChunkPath('/Codea/Génies En Herbe/100%.lua'), '/Codea/G%C3%A9nies%20En%20Herbe/100%25.lua');
	});

	test('decode what Codea reports back', () => {
		assert.strictEqual(decodeChunkPath('/Codea/iPad%20Projects/EmuTests/GPU.lua'), '/Codea/iPad Projects/EmuTests/GPU.lua');
		assert.strictEqual(decodeChunkPath('/Codea/G%C3%A9nies%20En%20Herbe/100%25.lua'), '/Codea/Génies En Herbe/100%.lua');
	});

	test('leave a path that is not encoded as it is', () => {
		assert.strictEqual(decodeChunkPath('/Codea/Mine/100%.lua'), '/Codea/Mine/100%.lua');
	});
});
