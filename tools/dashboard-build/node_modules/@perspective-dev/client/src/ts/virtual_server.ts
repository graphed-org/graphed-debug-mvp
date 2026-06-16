// ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
// ┃ ██████ ██████ ██████       █      █      █      █      █ █▄  ▀███ █       ┃
// ┃ ▄▄▄▄▄█ █▄▄▄▄▄ ▄▄▄▄▄█  ▀▀▀▀▀█▀▀▀▀▀ █ ▀▀▀▀▀█ ████████▌▐███ ███▄  ▀█ █ ▀▀▀▀▀ ┃
// ┃ █▀▀▀▀▀ █▀▀▀▀▀ █▀██▀▀ ▄▄▄▄▄ █ ▄▄▄▄▄█ ▄▄▄▄▄█ ████████▌▐███ █████▄   █ ▄▄▄▄▄ ┃
// ┃ █      ██████ █  ▀█▄       █ ██████      █      ███▌▐███ ███████▄ █       ┃
// ┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┫
// ┃ Copyright (c) 2017, the Perspective Authors.                              ┃
// ┃ ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌ ┃
// ┃ This file is part of the Perspective library, distributed under the terms ┃
// ┃ of the [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0). ┃
// ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

import { ColumnType } from "./ts-rs/ColumnType.ts";
import { ViewConfig } from "./ts-rs/ViewConfig.ts";
import { ViewWindow } from "./ts-rs/ViewWindow.ts";

import type * as perspective from "../../dist/wasm/perspective-js.js";

/**
 * VirtualServer API for implementing custom data sources in JavaScript/WASM.
 *
 * The VirtualServer pattern allows you to create custom data sources that
 * integrate with Perspective's protocol. This is useful for:
 * - Connecting to external databases (DuckDB, PostgreSQL, etc.)
 * - Streaming data from APIs or message queues
 * - Implementing custom aggregation or transformation logic
 * - Creating data adapters without copying data into Perspective tables
 *
 * @module virtual_server
 */

export interface ServerFeatures {
    expressions?: boolean;
}

/**
 * Handler interface that you implement to provide custom data sources.
 *
 * All methods will be called by the VirtualServer when handling protocol
 * messages from Perspective clients. Methods can return values directly or
 * return Promises for asynchronous operations (e.g., database queries).
 */
export interface VirtualServerHandler {
    getHostedTables(): string[] | Promise<string[]>;
    tableSchema(
        tableId: string,
    ): Record<string, ColumnType> | Promise<Record<string, ColumnType>>;
    tableSize(tableId: string): number | Promise<number>;
    tableMakeView(
        tableId: string,
        viewId: string,
        config: ViewConfig,
    ): void | Promise<void>;
    viewDelete(viewId: string): void | Promise<void>;
    viewGetData(
        viewId: string,
        config: ViewConfig,
        schema: Record<string, ColumnType>,
        viewport: ViewWindow,
        dataSlice: perspective.VirtualDataSlice,
    ): void | Promise<void>;
    viewSchema?(
        viewId: string,
        config?: ViewConfig,
    ): Record<string, ColumnType> | Promise<Record<string, ColumnType>>;
    viewSize?(viewId: string): number | Promise<number>;
    tableValidateExpression?(
        tableId: string,
        expression: string,
    ): ColumnType | Promise<ColumnType>;
    viewGetMinMax?(
        viewId: string,
        columnName: string,
        config: ViewConfig,
    ): { min: any; max: any } | Promise<{ min: any; max: any }>;
    getFeatures?(): ServerFeatures | Promise<ServerFeatures>;
    makeTable?(
        tableId: string,
        data: string | Uint8Array,
    ): void | Promise<void>;
}

export function createMessageHandler(
    mod: typeof perspective,
    handler: VirtualServerHandler,
) {
    let virtualServer: perspective.VirtualServer;
    async function postMessage(port: MessagePort, msg: MessageEvent) {
        if (msg.data.cmd === "init") {
            try {
                virtualServer = new mod.VirtualServer(handler);
                if (msg.data.id !== undefined) {
                    port.postMessage({ id: msg.data.id });
                } else {
                    port.postMessage(null);
                }
            } catch (error) {
                console.error("Error initializing worker:", error);
                throw error;
            }
        } else {
            try {
                const requestBytes = new Uint8Array(msg.data);
                const responseBytes =
                    await virtualServer.handleRequest(requestBytes);
                const buffer = responseBytes.slice().buffer;
                port.postMessage(buffer, { transfer: [buffer] });
            } catch (error) {
                console.error("Error handling request in worker:", error);
                throw error;
            }
        }
    }

    const channel = new MessageChannel();
    channel.port1.onmessage = (message) => {
        postMessage(channel.port1, message);
    };

    return channel.port2;
}
