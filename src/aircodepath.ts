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

// Codea names a project's chunks by their path with everything outside Swift's urlPathAllowed
// percent-encoded, and the debugger matches breakpoints to chunks by that name
export function encodeChunkPath(path: string): string {
    return path.replace(/[^A-Za-z0-9\-._~!$&'()*+,;=:@/]/gu, encodeURIComponent);
}

export function decodeChunkPath(path: string): string {
    try {
        return decodeURIComponent(path);
    } catch {
        return path;
    }
}
