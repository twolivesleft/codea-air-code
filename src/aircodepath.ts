export class AirCodePath {
    collection: string;
    project: string;

    // codea://ip:port/Codea/Collection/Project/...
    constructor(path: string) {
        const parts = path.split('/');

        this.collection = parts[2];
        this.project = parts[3];
    }
}
