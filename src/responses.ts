import * as vscode from 'vscode';
import { Enum } from './enum';

enum ErrorType {
    fileNotFound = "fileNotFound",
    unableToReadFile = "unableToReadFile",
    unableToDeleteFile = "unableToDeleteFile",
    unableToRenameFile = "unableToRenameFile",
    connectionLost = "connectionLost"
}

export type StartHostResponse = {
    alreadyStarted: boolean;
}

export type GetInformationResponse = {
    version: string;
    hasHost: boolean;
}

export type AddDependencyResponse = {
    isFirstDependency: boolean;
};

export type DeleteFileResponse = {
    wasLastDependency: boolean;
};

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
                }
        }

        return Error(errorString);
    }
}