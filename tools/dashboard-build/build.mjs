// Produce the vendored, self-contained Perspective bundle (+ theme CSS) the dashboard serves.
// Pin must match `perspective-python` in ../../pyproject.toml (shared wire protocol).
import * as esbuild from "esbuild";
import { copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const vendor = path.resolve(here, "../../src/graphed_debug/dashboard/static/vendor");

await esbuild.build({
  entryPoints: [path.join(here, "entry.mjs")],
  bundle: true,
  format: "esm",
  minify: true,
  outfile: path.join(vendor, "perspective-dashboard.js"),
  loader: { ".ttf": "dataurl", ".woff": "dataurl", ".woff2": "dataurl" },
});
copyFileSync(
  path.join(here, "node_modules/@perspective-dev/viewer/dist/css/themes.css"),
  path.join(vendor, "themes.css"),
);
console.log("wrote", path.join(vendor, "perspective-dashboard.js"), "+ themes.css");
