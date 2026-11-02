import * as bonjour from 'bonjour';
import * as vscode from 'vscode';
import * as ipaddr from 'ipaddr.js';

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
                const input = vscode.window.createQuickPick<CustomServiceItem | FoundServiceItem>();
                input.placeholder = "Select a device from the list, or enter the IP and port to connect to.";
                input.items = [
                    new CustomServiceItem(""),
                    ...this.services.map((service) => new FoundServiceItem(service.name, this.getIPv4(service), service.port))
                ];
                disposables.push(
                    input.onDidChangeValue(value => {
                        const customItem = new CustomServiceItem(value);
                        input.items = [
                            customItem,
                            ...this.services.map((service) => new FoundServiceItem(service.name, this.getIPv4(service), service.port))
                        ];
                    }),
                    input.onDidChangeSelection(items => {
                        input.onDidHide(() => {});
                        input.hide();
                        if (items[0] instanceof FoundServiceItem) {
                            const item = items[0] as FoundServiceItem;
                            resolve(`${item.address}:${item.port}`);
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
