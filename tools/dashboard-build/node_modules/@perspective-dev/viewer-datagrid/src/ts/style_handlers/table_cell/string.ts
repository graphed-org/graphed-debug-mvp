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
    hslToRgb,
    infer_foreground_from_background,
    parseColor,
    rgbaToRgb,
    rgbToHex,
    rgbToHsl,
} from "../../color_utils.js";
import type { DatagridModel, ColumnConfig, ColorRecord } from "../../types.js";

interface CellMetaWithExtras {
    _is_hidden_by_aggregate_depth?: boolean;
    user?: string | null;
    column_header?: string[];
}

interface PluginWithColor extends Omit<ColumnConfig, "color"> {
    color?: ColorRecord;
}

export function cell_style_string(
    model: DatagridModel,
    plugin: PluginWithColor | undefined,
    td: HTMLElement,
    metadata: CellMetaWithExtras,
): void {
    const column_name = metadata.column_header?.[model._config.split_by.length];
    const colorRecord: ColorRecord = (() => {
        if (plugin?.color !== undefined) {
            return plugin.color;
        } else {
            return model._color;
        }
    })();

    const [hex, r, g, b] = colorRecord;

    if (metadata._is_hidden_by_aggregate_depth) {
        td.style.backgroundColor = "";
        td.style.color = "";
    } else if (
        plugin?.string_color_mode === "foreground" &&
        metadata.user !== null
    ) {
        td.style.color = hex;
        td.style.backgroundColor = "";
        if (plugin?.format === "link" && td.children[0]) {
            (td.children[0] as HTMLElement).style.color = hex;
        }
    } else if (
        plugin?.string_color_mode === "background" &&
        metadata.user !== null
    ) {
        const source = model._plugin_background as [number, number, number];
        const foreground = infer_foreground_from_background(
            rgbaToRgb([r, g, b, 1], source),
        );
        td.style.color = foreground;
        td.style.backgroundColor = hex;
    } else if (
        plugin?.string_color_mode === "series" &&
        metadata.user !== null &&
        column_name
    ) {
        if (!model._series_color_map.has(column_name)) {
            model._series_color_map.set(column_name, new Map());
            model._series_color_seed.set(column_name, 0);
        }

        const series_map = model._series_color_map.get(column_name)!;
        if (metadata.user && !series_map.has(metadata.user)) {
            const seed = model._series_color_seed.get(column_name) ?? 0;
            series_map.set(metadata.user, seed);
            model._series_color_seed.set(column_name, seed + 1);
        }

        const color_seed = series_map.get(metadata.user!) ?? 0;
        const [h, s, l] = rgbToHsl(parseColor(hex));
        const rotated = hslToRgb([h + ((color_seed * 150) % 360), s, l]);
        const [r2, g2, b2] = rotated;
        const hex2 = rgbToHex(rotated);
        const source = model._plugin_background as [number, number, number];
        const foreground = infer_foreground_from_background(
            rgbaToRgb([r2, g2, b2, 1], source),
        );
        td.style.color = foreground;
        td.style.backgroundColor = hex2;
    } else {
        td.style.backgroundColor = "";
        td.style.color = "";
    }
}
