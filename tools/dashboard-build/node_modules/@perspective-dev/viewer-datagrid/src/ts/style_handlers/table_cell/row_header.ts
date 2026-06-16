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

import {
    CellMetadata,
    CellMetadataRowHeader,
} from "regular-table/dist/esm/types.js";
import type { DatagridModel } from "../../types.js";
import { RegularTableElement } from "regular-table";

export function cell_style_row_header(
    model: DatagridModel,
    regularTable: RegularTableElement,
    td: HTMLElement,
    metadata: CellMetadataRowHeader,
): void {
    const is_not_empty =
        metadata.value !== undefined &&
        metadata.value !== null &&
        metadata.value?.toString()?.trim().length > 0;
    const is_leaf =
        (metadata.row_header_x ?? 0) >= model._config.group_by.length;
    const next = regularTable.getMeta({
        dx: 0,
        dy: (metadata.y ?? 0) - (metadata.y0 ?? 0) + 1,
    } as CellMetadata);

    const is_collapse =
        next &&
        next.row_header &&
        typeof next.row_header[(metadata.row_header_x ?? 0) + 1] !==
            "undefined";

    td.classList.toggle("psp-tree-label", is_not_empty && !is_leaf);
    td.classList.toggle(
        "psp-tree-label-expand",
        is_not_empty && !is_leaf && !is_collapse,
    );

    td.classList.toggle(
        "psp-tree-label-collapse",
        is_not_empty && !is_leaf && is_collapse,
    );
    td.classList.toggle("psp-tree-leaf", is_not_empty && is_leaf);
}
