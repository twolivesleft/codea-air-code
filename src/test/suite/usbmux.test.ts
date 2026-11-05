import * as assert from 'assert';

import { muxPacket, parsePlist, parseUsbHost, plistXml, usbHost } from '../../usbmux';

suite('usbmux', () => {
	test('reads the devices usbmuxd lists', () => {
		const reply = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>DeviceList</key>
	<array>
		<dict>
			<key>DeviceID</key>
			<integer>37</integer>
			<key>MessageType</key>
			<string>Attached</string>
			<key>Properties</key>
			<dict>
				<key>ConnectionType</key>
				<string>USB</string>
				<key>SerialNumber</key>
				<string>00008140-000270D210E3C01C</string>
			</dict>
		</dict>
	</array>
	<key>Empty</key>
	<array/>
	<key>Flag</key>
	<true/>
</dict>
</plist>`;

		assert.deepStrictEqual(parsePlist(reply), {
			DeviceList: [{
				DeviceID: 37,
				MessageType: 'Attached',
				Properties: { ConnectionType: 'USB', SerialNumber: '00008140-000270D210E3C01C' },
			}],
			Empty: [],
			Flag: true,
		});
	});

	test('escapes and unescapes text', () => {
		assert.deepStrictEqual(parsePlist(plistXml({ Value: 'Tom & Jerry <3', Number: 7 })), { Value: 'Tom & Jerry <3', Number: 7 });
	});

	test('frames a message with its length, version and type', () => {
		const packet = muxPacket({ MessageType: 'ListDevices' });

		assert.strictEqual(packet.readUInt32LE(0), packet.length);
		assert.strictEqual(packet.readUInt32LE(4), 1);
		assert.strictEqual(packet.readUInt32LE(8), 8);
		assert.deepStrictEqual(parsePlist(packet.subarray(16).toString()), {
			MessageType: 'ListDevices',
			ProgName: 'codea-air-code',
			ClientVersionString: 'codea-air-code',
		});
	});

	test('names a device over USB as a host', () => {
		const host = usbHost('00008140-000270D210E3C01C', 18513);

		assert.strictEqual(host, 'usb-00008140-000270D210E3C01C:18513');
		assert.deepStrictEqual(parseUsbHost(host), { udid: '00008140-000270D210E3C01C', port: 18513 });
		assert.strictEqual(parseUsbHost('10.0.0.134:18513'), undefined);
		assert.strictEqual(parseUsbHost('18513:18514'), undefined);
	});
});
