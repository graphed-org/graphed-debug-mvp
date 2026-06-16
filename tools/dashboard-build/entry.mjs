// The dashboard's browser entry, bundled into one self-contained file by build.mjs.
// Importing the `/inline` builds inlines the wasm (no separate fetch); importing the datagrid
// registers the "Datagrid" plugin against the same viewer instance. Default export = the client.
import perspective from "@perspective-dev/client/inline";
import "@perspective-dev/viewer/inline";
import "@perspective-dev/viewer-datagrid";

export default perspective;
