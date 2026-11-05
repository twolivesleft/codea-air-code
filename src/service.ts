import * as bonjour from 'bonjour';
import * as vscode from 'vscode';
import * as ipaddr from 'ipaddr.js';
import { deviceName, isListening, usbDevices, usbHost } from './usbmux';

const codeaPort = 18513;

class CustomServiceItem implements vscode.QuickPickItem {
	label: string;
    description = '';
	detail: string;

	constructor(public text: string) {
		let defaultPort = "18513";
		let defaultHost = `127.0.0.1:${defaultPort}`;

        if (text === "") {
            text = defaultHost;
        }

        if (!text.includes(":")) {
            text = `${text}:${defaultPort}`;
        }

        this.label = text;
		this.detail = `Connect to '${text}'...`;
	}
}

class FoundServiceItem implements vscode.QuickPickItem {

	label: string;
	description = '';
	detail: string;

	constructor(public name: string, public address: string, public port: number) {
		this.label = `${address}:${port}`;
		this.detail = name;
	}
}

class UsbServiceItem implements vscode.QuickPickItem {
	label: string;
	description = 'USB';
	detail: string;

	constructor(public host: string, name: string) {
		this.label = `$(plug) ${name}`;
		this.detail = `Connect to Codea over USB`;
	}
}

// Codea on each device connected over USB
async function findUsbServices(): Promise<UsbServiceItem[]> {
	const items: UsbServiceItem[] = [];
	for (const device of await usbDevices()) {
		if (await isListening(device, codeaPort)) {
			items.push(new UsbServiceItem(usbHost(device.udid, codeaPort), await deviceName(device) ?? device.udid));
		}
	}
	return items;
}

// This class is used to browse and keep track of active codea-air-code services.
export class AirCodeService {
    private bonjour: bonjour.Bonjour;

    public services: bonjour.RemoteService[];

    constructor() {
        this.bonjour = bonjour();
        this.services = [];
    }

    // Start browsing for codea-air-code services.
    start() {
        let browser = this.bonjour.find({ type: 'codea-air-code' });

        browser.on('up', (service) => {
            console.log('Codea Air Code Service Up:', service);
            this.services.push(service);
        });

        browser.on('down', (service) => {
            console.log('Codea Air Code Service Down:', service);
            this.services = this.services.filter((s) => s.name !== service.name);
        });
    }

    isIPv4(address: string) {
        return ipaddr.IPv4.isValid(address);
    }

    getIPv4(service: bonjour.RemoteService) {
        return service.addresses.find((address) => this.isIPv4(address)) || service.addresses[0];
    }

    async pickService() {
        const disposables: vscode.Disposable[] = [];
        try {
            return await new Promise<string | undefined>((resolve, reject) => {
                const input = vscode.window.createQuickPick<CustomServiceItem | UsbServiceItem | FoundServiceItem>();
                input.placeholder = "Select a device, or enter its IP and port.";
                let usbItems: UsbServiceItem[] = [];
                // A device on USB comes first until an address is typed
                const update = () => {
                    const found = this.services.map((service) => new FoundServiceItem(service.name, this.getIPv4(service), service.port));
                    const custom = new CustomServiceItem(input.value);
                    input.items = input.value === '' && usbItems.length > 0
                        ? [...usbItems, custom, ...found]
                        : [custom, ...usbItems, ...found];
                };
                update();
                input.busy = true;
                findUsbServices().then(items => {
                    usbItems = items;
                    input.busy = false;
                    update();
                });
                disposables.push(
                    input.onDidChangeValue(() => update()),
                    input.onDidChangeSelection(items => {
                        input.onDidHide(() => {});
                        input.hide();
                        if (items[0] instanceof FoundServiceItem) {
                            const item = items[0] as FoundServiceItem;
                            resolve(`${item.address}:${item.port}`);
                        } else if (items[0] instanceof UsbServiceItem) {
                            resolve(items[0].host);
                        } else {
                            const item = items[0] as CustomServiceItem;
                            resolve(item.text);
                        }
                    }),
                    input.onDidHide(() => {
                        resolve(undefined);
                    })
                );
                input.show();
            });
        } finally {
            disposables.forEach(d => d.dispose());
        }
    }
}
