// The Codea collection a folder in the workspace stands for, by the layout projects are kept in
// (see localProjectUri): the workspace folder itself and its projects are Documents, a folder
// at the top is a collection, and iCloud's collections are inside "iCloud". The path is relative
// to the workspace folder, "" for the folder itself; undefined when the folder is no collection.
export function collectionOfFolder(relativePath: string): string | undefined {
    const parts = relativePath === '' ? [] : relativePath.split('/');
    // A project's folder stands for the collection it is in
    if (parts.length > 0 && parts[parts.length - 1].endsWith('.codea')) {
        parts.pop();
    }
    if (parts.length === 0) {
        return 'Documents';
    }
    return isCollection(parts) ? parts.join('/') : undefined;
}

function isCollection(parts: string[]): boolean {
    if (parts.some(part => part.startsWith('.') || part.endsWith('.codea'))) {
        return false;
    }
    return parts[0] === 'iCloud' ? parts.length === 2 : parts.length === 1;
}
