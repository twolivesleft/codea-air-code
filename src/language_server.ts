import * as vscode from 'vscode';

import { AirCode } from './aircode';
import { getWorkspaceUri } from './extension';

import {
    DataCallback,
    Disposable,
    Event,
	Message,
	MessageReader,
    MessageWriter,
    PartialMessageInfo
} from 'vscode-jsonrpc/node';

export class LSPMessageReader implements MessageReader {
    airCode: AirCode;

    protected callback: DataCallback | undefined;

    errorEmitter = new vscode.EventEmitter<Error>();
    onError: Event<Error> = this.errorEmitter.event;

    closeEmitter = new vscode.EventEmitter<void>();
    onClose: Event<void> = this.closeEmitter.event;

    partialMessageEmitter = new vscode.EventEmitter<PartialMessageInfo>();
    onPartialMessage: Event<PartialMessageInfo> = this.partialMessageEmitter.event;

    constructor(airCode: AirCode) {
        this.airCode = airCode;
    }

    listen(callback: DataCallback): Disposable {
        this.callback = callback;

        this.airCode.logLsp("LSPMessageReader listening");

        return {
            dispose: () => {
                if (this.callback === callback) {
                    this.callback = undefined;
                }

                this.airCode.logLsp("LSPMessageReader disposed.")
            }
        }
    }

    // TODO Call this when we receive an lsp message from Codea?
    onMessage(data: Message) {
        this.callback!(data);
    }

    dispose(): void {
        this.callback = undefined;
        this.airCode.logLsp("LSPMessageReader disposed.")
    }
}

export class LSPMessageWriter implements MessageWriter {
    airCode: AirCode;

    errorEmitter = new vscode.EventEmitter<[Error, Message | undefined, number | undefined]>();
    onError: Event<[Error, Message | undefined, number | undefined]> = this.errorEmitter.event;

    closeEmitter = new vscode.EventEmitter<void>();
    onClose: Event<void> = this.closeEmitter.event;

    constructor(airCode: AirCode) {
        this.airCode = airCode;
    }

    async write(msg: Message): Promise<void> {
        let jsonMessage = JSON.stringify(msg);

        let likelyId = this.airCode.commandId + 1
        this.airCode.logLsp(`LSPMessageWriter write id ${likelyId} ${jsonMessage}.`);

        this.airCode.lspMessage(jsonMessage);
    }

    end(): void {
        this.airCode.logLsp("LSPMessageWriter end.");
    }
    
    dispose(): void {
        this.airCode.logLsp("LSPMessageWriter disposed.");
    }
}
