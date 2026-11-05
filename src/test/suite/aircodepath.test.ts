import * as assert from 'assert';

import { chunkLinesIn, decodeChunkPath, encodeChunkPath } from '../../aircodepath';

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

suite('chunk lines', () => {
	test('find the file and line of an error', () => {
		const text = 'ERROR: Error in call to draw():\niPad%20Projects/EmuTests/CPU.lua:416: attempt to index a nil value';
		assert.deepStrictEqual(chunkLinesIn(text.split('\n')[1]), [
			{ start: 0, end: 36, chunk: 'iPad%20Projects/EmuTests/CPU.lua', line: 416 },
		]);
	});

	test('find every one in a traceback', () => {
		assert.deepStrictEqual(chunkLinesIn("\tMy%20Games/Emu/GPU.lua:12: in function 'step' (Mine/Emu/Dependencies/Utils/Bits.lua:3)").map(found => found.chunk), [
			'My%20Games/Emu/GPU.lua',
			'Mine/Emu/Dependencies/Utils/Bits.lua',
		]);
	});

	test('leave text without one alone', () => {
		assert.deepStrictEqual(chunkLinesIn('PRINT: score 12: high.lua is the best'), []);
	});
});
