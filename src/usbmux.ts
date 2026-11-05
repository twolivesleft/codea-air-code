import * as net from 'net';

// usbmuxd, the service through which Finder, Xcode and iproxy reach a device over USB. Apple's
// device support runs it on Windows too, listening on a local port.
const muxAddress: net.NetConnectOpts = process.platform === 'win32'
    ? { host: '127.0.0.1', port: 27015 }
    : { path: '/var/run/usbmuxd' };

// lockdownd, which answers a device's name without pairing
const lockdownPort = 62078;
const timeout = 3000;

export interface UsbDevice {
    // usbmuxd's id for this connection, which changes when the device is plugged in again
    id: number;
    udid: string;
}

export type PlistValue = string | number | boolean | PlistValue[] | { [key: string]: PlistValue };

// A codea:// host for Codea on a device over USB, e.g. usb-00008140-000270D210E3C01C:18513
export function usbHost(udid: string, port: number): string {
    return `usb-${udid}:${port}`;
}

export function parseUsbHost(host: string): { udid: string, port: number } | undefined {
    const match = host.match(/^usb-([0-9A-Fa-f-]+):(\d+)$/);
    return match === null ? undefined : { udid: match[1], port: parseInt(match[2]) };
}

const escapes: { [entity: string]: string } = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function plistXml(dict: { [key: string]: string | number }): string {
    const escape = (text: string) => text.replace(/[&<>]/g, c => `&${Object.keys(escapes).find(entity => escapes[entity] === c)};`);
    const entries = Object.entries(dict).map(([key, value]) => `<key>${escape(key)}</key>`
        + (typeof value === 'number' ? `<integer>${value}</integer>` : `<string>${escape(value)}</string>`));
    return `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict>${entries.join('')}</dict></plist>`;
}

// Reads the XML property lists usbmuxd and lockdownd answer with
export function parsePlist(xml: string): PlistValue | undefined {
    const tokens = [...xml.matchAll(/<(\/?)(\w+)(\/?)>([^<]*)/g)]
        .filter(token => token[2] !== 'plist')
        .map(token => ({ closing: token[1] === '/', name: token[2], empty: token[3] === '/', text: token[4] }));
    let index = 0;
    const unescape = (text: string) => text.replace(/&(\w+);/g, (entity, name) => escapes[name] ?? entity);
    const value = (): PlistValue | undefined => {
        const token = tokens[index++];
        if (token === undefined || token.closing) {
            return undefined;
        }
        switch (token.name) {
            case 'true': case 'false':
                if (!token.empty) {
                    index++;
                }
                return token.name === 'true';
            case 'string': case 'data': case 'date':
                if (token.empty) {
                    return '';
                }
                index++;
                return unescape(token.text);
            case 'integer': case 'real':
                index++;
                return Number(token.text);
            case 'array': {
                const array: PlistValue[] = [];
                while (!token.empty && tokens[index] !== undefined && !tokens[index].closing) {
                    const item = value();
                    if (item !== undefined) {
                        array.push(item);
                    }
                }
                if (!token.empty) {
                    index++;
                }
                return array;
            }
            case 'dict': {
                const dict: { [key: string]: PlistValue } = {};
                while (!token.empty && tokens[index]?.name === 'key' && !tokens[index].closing) {
                    const key = unescape(tokens[index].text);
                    index += 2;
                    const item = value();
                    if (item !== undefined) {
                        dict[key] = item;
                    }
                }
                if (!token.empty) {
                    index++;
                }
                return dict;
            }
        }
        return undefined;
    };
    return value();
}

export function muxPacket(message: { [key: string]: string | number }): Buffer {
    const body = Buffer.from(plistXml({ ...message, ProgName: 'codea-air-code', ClientVersionString: 'codea-air-code' }));
    const header = Buffer.alloc(16);
    header.writeUInt32LE(header.length + body.length, 0);
    // Version 1 with plist messages, which usbmuxd answers in kind
    header.writeUInt32LE(1, 4);
    header.writeUInt32LE(8, 8);
    header.writeUInt32LE(1, 12);
    return Buffer.concat([header, body]);
}

// Sends one message to usbmuxd and reads its answer, leaving the socket open: after a Connect,
// it is the connection to the device
function muxRequest(message: { [key: string]: string | number }): Promise<{ reply: PlistValue | undefined, socket: net.Socket }> {
    return new Promise((resolve, reject) => {
        const socket = net.connect(muxAddress);
        let received = Buffer.alloc(0);
        const fail = (error: Error) => {
            socket.destroy();
            reject(error);
        };
        const onData = (data: Buffer) => {
            received = Buffer.concat([received, data]);
            if (received.length < 4 || received.length < received.readUInt32LE(0)) {
                return;
            }
            const length = received.readUInt32LE(0);
            socket.off('data', onData);
            socket.off('error', fail);
            socket.setTimeout(0);
            if (received.length > length) {
                socket.unshift(received.subarray(length));
            }
            resolve({ reply: parsePlist(received.subarray(16, length).toString()), socket });
        };
        socket.on('data', onData);
        socket.on('error', fail);
        socket.setTimeout(timeout, () => fail(new Error('usbmuxd did not answer')));
        socket.write(muxPacket(message));
    });
}

// The devices connected over USB, none when usbmuxd is not there
export async function usbDevices(): Promise<UsbDevice[]> {
    try {
        const { reply, socket } = await muxRequest({ MessageType: 'ListDevices' });
        socket.destroy();
        const list = (reply as any)?.DeviceList;
        if (!Array.isArray(list)) {
            return [];
        }
        return list
            .map((entry: any) => entry?.Properties)
            .filter((properties: any) => properties?.ConnectionType === 'USB' && typeof properties.DeviceID === 'number' && typeof properties.SerialNumber === 'string')
            .map((properties: any) => ({ id: properties.DeviceID, udid: properties.SerialNumber }));
    } catch {
        return [];
    }
}

// A connection to a port on the device, which fails when nothing listens there
export async function connectToDevice(device: UsbDevice, port: number): Promise<net.Socket> {
    // The port goes in network byte order
    const { reply, socket } = await muxRequest({ MessageType: 'Connect', DeviceID: device.id, PortNumber: ((port & 0xff) << 8) | (port >> 8) });
    if ((reply as any)?.Number !== 0) {
        socket.destroy();
        throw new Error(`Nothing answers on port ${port} of the device`);
    }
    return socket;
}

// The name given to the device in its settings
export async function deviceName(device: UsbDevice): Promise<string | undefined> {
    let socket: net.Socket | undefined;
    try {
        socket = await connectToDevice(device, lockdownPort);
        const connected = socket;
        const request = Buffer.from(plistXml({ Label: 'codea-air-code', Request: 'GetValue', Key: 'DeviceName' }));
        const length = Buffer.alloc(4);
        length.writeUInt32BE(request.length);
        connected.write(Buffer.concat([length, request]));
        const reply = await new Promise<Buffer>((resolve, reject) => {
            let received = Buffer.alloc(0);
            connected.on('data', data => {
                received = Buffer.concat([received, data]);
                if (received.length >= 4 && received.length >= 4 + received.readUInt32BE(0)) {
                    resolve(received.subarray(4, 4 + received.readUInt32BE(0)));
                }
            });
            connected.on('error', reject);
            connected.setTimeout(timeout, () => reject(new Error('lockdownd did not answer')));
        });
        const value = (parsePlist(reply.toString()) as any)?.Value;
        return typeof value === 'string' ? value : undefined;
    } catch {
        return undefined;
    } finally {
        socket?.destroy();
    }
}

// Whether Codea's Air Code answers on the device
export async function isListening(device: UsbDevice, port: number): Promise<boolean> {
    try {
        (await connectToDevice(device, port)).destroy();
        return true;
    } catch {
        return false;
    }
}

// A local port forwarded to a port on a device, found by its udid at each connection so that
// plugging it in again keeps working
export function forwardToDevice(udid: string, port: number): Promise<net.Server> {
    const server = net.createServer(async client => {
        client.pause();
        const device = (await usbDevices()).find(found => found.udid.toLowerCase() === udid.toLowerCase());
        try {
            if (device === undefined) {
                throw new Error('The device is not connected');
            }
            const remote = await connectToDevice(device, port);
            client.pipe(remote).pipe(client);
            remote.on('error', () => client.destroy());
            remote.on('close', () => client.destroy());
            client.on('error', () => remote.destroy());
            client.on('close', () => remote.destroy());
            client.resume();
        } catch {
            client.destroy();
        }
    });
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => resolve(server));
    });
}
