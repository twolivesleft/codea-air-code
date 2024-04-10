export class AirCodePath {
    collection: string;
    project: string;
    isCloud: boolean;

    // /Codea/Collection/Project/...
    // /Codea/iCloud/Collection/Project/...
    constructor(path: string) {
        const parts = path.split('/');

        if (parts[2] === "iCloud") {
            this.isCloud = true;
            this.collection = parts[3];
            this.project = parts[4];
        } else {
            this.isCloud = false;
            this.collection = parts[2];
            this.project = parts[3];
        }
    }
}
