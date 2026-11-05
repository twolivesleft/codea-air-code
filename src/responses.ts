import * as vscode from 'vscode';
import { Enum } from './enum';

enum ErrorType {
    fileNotFound = "fileNotFound",
    unableToReadFile = "unableToReadFile",
    unableToDeleteFile = "unableToDeleteFile",
    unableToRenameFile = "unableToRenameFile",
    connectionLost = "connectionLost",
    fileAlreadyExists = "fileAlreadyExists",
    unableToCreateFolder = "unableToCreateFolder",
}

export type StartHostResponse = {
}

export type GetInformationResponse = {
    version: string;
    hasHost: boolean;
    textExtensions: string[];
    watchesFiles?: boolean;
    listsFileVersions?: boolean;
    listsSubfolders?: boolean;
    hasModernReference?: boolean;
    capturesFrames?: boolean;
    builtInCollections?: string[];
}

// A JPEG of the running project or of the whole screen, in base64; no data when the
// project was asked for and none runs. The size in points is the captured view's.
export type Frame = {
    data?: string;
    width: number;
    height: number;
    pointWidth: number;
    pointHeight: number;
}

export type FileVersion = {
    name: string;
    mtime: number;
    size: number;
}

export type AddDependencyResponse = {
    isFirstDependency: boolean;
};

export type GetAssetKeyResponse = {
    assetKey: string;
};

export type ReadFileResponse = {
    isText: boolean;
    content: string;
}

export type DeleteFileResponse = {
    wasLastDependency: boolean;
};

export type GetFunctionsResponse = {
    groups: string[];
    localGroups: { [key: string]: string };
    functions: any[];
}

export type FindReferenceResponse = {
    chapter: string;
    function: string;
}

export type Reference = FindReferenceResponse & { modern: boolean };

export type Response<T> = {
    id: number;
    project?: String;
    data?: T;
    error?: ErrorType;
};

export namespace Response {
    export function from(errorString: string): Error {
        const errorType = Enum.fromRawValue(ErrorType, errorString);

        if (errorType !== null) {
            switch (errorType) {
                case 'fileNotFound':
                    return vscode.FileSystemError.FileNotFound(errorString);
                case 'unableToReadFile':
                    return new vscode.FileSystemError(errorString);
                case 'unableToDeleteFile':
                    return vscode.FileSystemError.NoPermissions(errorString);
                case 'unableToRenameFile':
                    return vscode.FileSystemError.NoPermissions(errorString);
                case 'connectionLost':
                    return vscode.FileSystemError.Unavailable(errorString);
                case 'fileAlreadyExists':
                    return vscode.FileSystemError.FileExists(errorString);
                case 'unableToCreateFolder':
                    return vscode.FileSystemError.NoPermissions(errorString);
                }
        }

        return Error(errorString);
    }
}