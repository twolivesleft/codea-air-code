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
        | "loadString"
        | "startHost"
        | "stopHost"
        | "restart"
        | "listProjects"
        | "listUnimportedProjects"
        | "addDependency"
        | "getParameters"
        | "setParameter"
        | "debugMessage";

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

    export interface AddDependency extends Command {
        command: 'addDependency';
        path: string;
        dependency: string;
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

    export namespace AddDependency {
        export function from(path: string, dependency: string): AddDependency {
            return { command: 'addDependency', path, dependency };
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
}