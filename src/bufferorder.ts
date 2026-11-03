// A project's Info.plist with a tab renamed in its Buffer Order, the order of Codea's tabs, so
// the tab keeps its place; undefined when the tab is not listed. Entries are written either
// with or without ".lua", and keep how they were written.
export function renameInBufferOrder(plist: string, oldName: string, newName: string): string | undefined {
    const order = /(<key>Buffer Order<\/key>\s*<array>)([\s\S]*?)(<\/array>)/.exec(plist);
    if (order === null) {
        return undefined;
    }
    const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const withoutLua = (name: string) => name.replace(/\.lua$/, '');

    let renamed = false;
    const entries = order[2].replace(/<string>([^<]*)<\/string>/g, (entry, name: string) => {
        if (name === escape(oldName)) {
            renamed = true;
            return `<string>${escape(newName)}</string>`;
        }
        if (name === escape(withoutLua(oldName))) {
            renamed = true;
            return `<string>${escape(withoutLua(newName))}</string>`;
        }
        return entry;
    });
    if (!renamed) {
        return undefined;
    }
    return plist.slice(0, order.index) + order[1] + entries + order[3] + plist.slice(order.index + order[0].length);
}
