// Commands

export interface Command {
    id?: number;
    command: Command.Type;
}

export namespace Command {

    export type Type =
        | "getInformation"
        | "listFiles"
        | "readFile"
        | "statFile"
        | "writeFile"
        | "deleteFile"
        | "renameFile"
        | "copyFile"
        | "loadString"
        | "startHost"
        | "stopHost"
        | "restart"
        | "listProjects"
        | "listUnimportedProjects"
        | "createFolder"
        | "addDependency"
        | "getAssetKey"
        | "getParameters"
        | "setParameter"
        | "debugMessage"
        | "lspMessage"
        | "probeGetChapters"
        | "probeGetChapterImage"
        | "probeGetFunctions"
        | "probeGetCategoryImage"
        | "probeGetFunctionDetails"
        | "probeFindReference"
        | "findInFiles";

    export interface GetInformation extends Command {
        command: 'getInformation';
    }

    export interface ListFiles extends Command {
        command: 'listFiles';
        path: string;
    }

    export interface ReadFile extends Command {
        command: 'readFile';
        path: string;
    }

    export interface StatFile extends Command {
        command: 'statFile';
        path: string;
    }

    export interface WriteFile extends Command {
        command: 'writeFile';
        path: string;
        content: string;
    }

    export interface DeleteFile extends Command {
        command: 'deleteFile';
        path: string;
    }

    export interface RenameFile extends Command {
        command: 'renameFile';
        from: string;
        path: string;
    }

    export interface CopyFile extends Command {
        command: 'copyFile';
        from: string;
        path: string;
    }

    export interface LoadString extends Command {
        command: 'loadString';
        content: string;
    }

    export interface StartHost extends Command {
        command: 'startHost'
        path: string;
    }

    export interface StopHost extends Command {
        command: 'stopHost'
    }

    export interface Restart extends Command {
        command: 'restart';
    }

    export interface ListProjects extends Command {
        command: 'listProjects';
    }

    export interface ListUnimportedProjects extends Command {
        command: 'listUnimportedProjects';
        path: string;
    }

    export interface CreateFolder extends Command {
        command: 'createFolder';
        path: string;
    }

    export interface AddDependency extends Command {
        command: 'addDependency';
        path: string;
        dependency: string;
    }

    export interface GetAssetKey extends Command {
        command: 'getAssetKey';
        from: string;
        path: string;
    }

    export interface GetParameters extends Command {
        command: 'getParameters';
    }

    export interface SetParameter extends Command {
        command: 'setParameter';
        content: string;
    }

    export interface DebugMessage extends Command {
        command: 'debugMessage';
        content: string;
    }

    export interface LSPMessage extends Command {
        command: 'lspMessage';
        content: string;
    }

    export interface GetChapters extends Command {
        command: 'probeGetChapters';
    }

    export interface GetChapterImage extends Command {
        command: 'probeGetChapterImage';
        chapter: string;
    }

    export interface GetFunctions extends Command {
        command: 'probeGetFunctions';
        chapter: string;
    }

    export interface GetCategoryImage extends Command {
        command: 'probeGetCategoryImage';
        category: string;
    }

    export interface GetFunctionDetails extends Command {
        command: 'probeGetFunctionDetails';
        chapter: string;
        function: string;
    }

    export interface FindReference extends Command {
        command: 'probeFindReference';
        text: string;
    }    

    export interface FindInFiles extends Command {
        command: 'findInFiles';
        path: string;
        text: string;
        caseSensitive: boolean;
        wholeWord: boolean;
        isRegex: boolean;
    }    

    // Convenience Initializers

    export namespace GetInformation {
        export function from(): GetInformation {
            return { command: 'getInformation' };
        }
    }

    export namespace ListFiles {
        export function from(path: string): ListFiles {
            return { command: 'listFiles', path };
        }
    }

    export namespace ReadFile {
        export function from(path: string): ReadFile {
            return { command: 'readFile', path };
        }
    }

    export namespace StatFile {
        export function from(path: string): StatFile {
            return { command: 'statFile', path };
        }
    }

    export namespace WriteFile {
        export function from(path: string, content: string): WriteFile {
            return { command: 'writeFile', path, content };
        }
    }

    export namespace DeleteFile {
        export function from(path: string): DeleteFile {
            return { command: 'deleteFile', path };
        }
    }

    export namespace RenameFile {
        export function from(from: string, path: string): RenameFile {
            return { command: 'renameFile', from, path };
        }
    }

    export namespace CopyFile {
        export function from(from: string, path: string): CopyFile {
            return { command: 'copyFile', from, path };
        }
    }

    export namespace LoadString {
        export function from(content: string): LoadString {
            return { command: 'loadString', content };
        }
    }

    export namespace StartHost {
        export function from(path: string): StartHost {
            return { command: 'startHost', path };
        }
    }

    export namespace StopHost {
        export function from(): StopHost {
            return { command: 'stopHost' };
        }
    }

    export namespace Restart {
        export function from(): Restart {
            return { command: 'restart' };
        }
    }

    export namespace ListProjectsCommand {
        export function from(): ListProjects {
            return { command: 'listProjects' };
        }
    }

    export namespace ListUnimportedProjects {
        export function from(path: string): ListUnimportedProjects {
            return { command: 'listUnimportedProjects', path };
        }
    }

    export namespace CreateFolder {
        export function from(path: string): CreateFolder {
            return { command: 'createFolder', path };
        }
    }

    export namespace AddDependency {
        export function from(path: string, dependency: string): AddDependency {
            return { command: 'addDependency', path, dependency };
        }
    }

    export namespace GetAssetKey {
        export function from(from: string, path: string): GetAssetKey {
            return { command: 'getAssetKey', from, path };
        }
    }

    export namespace GetParameters {
        export function from(): GetParameters {
            return { command: 'getParameters' };
        }
    }

    export namespace SetParameter {
        export function from(content: string): SetParameter {
            return { command: 'setParameter', content };
        }
    }

    export namespace DebugMessage {
        export function from(content: string): DebugMessage {
            return { command: 'debugMessage', content };
        }
    }

    export namespace LSPMessage {
        export function from(content: string): LSPMessage {
            return { command: 'lspMessage', content };
        }
    }

    export namespace GetChapters {
        export function from(): GetChapters {
            return { command: 'probeGetChapters' };
        }
    }

    export namespace GetChapterImage {
        export function from(chapter: string): GetChapterImage {
            return { command: 'probeGetChapterImage', chapter };
        }
    }

    export namespace GetFunctions {
        export function from(chapter: string): GetFunctions {
            return { command: 'probeGetFunctions', chapter };
        }
    }

    export namespace GetCategoryImage {
        export function from(category: string): GetCategoryImage {
            return { command: 'probeGetCategoryImage', category };
        }
    }

    export namespace GetFunctionDetails {
        export function from(chapter: string, functionId: string): GetFunctionDetails {
            return { command: 'probeGetFunctionDetails', chapter, function: functionId };
        }
    }

    export namespace FindReference {
        export function from(text: string): FindReference {
            return { command: 'probeFindReference', text };
        }
    }

    export namespace FindInFiles {
        export function from(path: string, text: string, caseSensitive: boolean, wholeWord: boolean, isRegex: boolean): FindInFiles {
            return { command: 'findInFiles', path, text, caseSensitive, wholeWord, isRegex };
        }
    }
}
