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

use perspective_js::utils::{ApiResult, ToApiError, global};
use wasm_bindgen::prelude::*;
use web_sys::*;

macro_rules! iter_index {
    ($x:expr) => {
        (0..$x.length()).map(|x| $x.item(x))
    };
}

/// Search the document's `styleSheets` for rules which apply to `elem` and
/// provide the `--psp-theme-name` CSS custom property.
pub fn get_theme_names(elem: &HtmlElement) -> Result<Vec<String>, JsValue> {
    let sheets = global::document().style_sheets();
    let mut themes: Vec<String> = vec![];
    for sheet in iter_index!(sheets) {
        fill_sheet_theme_names(&mut themes, &sheet, elem)?;
    }

    Ok(themes)
}

fn fill_rule_theme_names(
    themes: &mut Vec<String>,
    rule: &Option<CssRule>,
    elem: &HtmlElement,
) -> ApiResult<()> {
    if let Some(rule) = rule.as_ref().into_apierror()?.dyn_ref::<CssStyleRule>() {
        let txt = rule.selector_text();
        if elem.matches(&txt)? {
            let style = rule.style();
            let x = (0..style.length()).map(|x| style.item(x));
            for property in x {
                if property == "--psp-theme-name" {
                    let name = style.get_property_value("--psp-theme-name")?;
                    let trimmed = name.trim();
                    let theme = &trimmed[1..trimmed.len() - 1];
                    if themes.iter().find(|x| x == &theme).is_none() {
                        themes.push(theme.to_owned());
                    }
                }
            }
        }
    }

    Ok(())
}

fn fill_sheet_theme_names(
    themes: &mut Vec<String>,
    sheet: &Option<StyleSheet>,
    elem: &HtmlElement,
) -> ApiResult<()> {
    let sheet = sheet
        .as_ref()
        .into_apierror()?
        .unchecked_ref::<CssStyleSheet>();

    if let Ok(rules) = sheet.css_rules() {
        for rule in iter_index!(&rules) {
            fill_rule_theme_names(themes, &rule, elem).unwrap_or_default();
        }
    }

    Ok(())
}
