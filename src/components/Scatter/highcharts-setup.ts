// Highcharts v12 UMD modules (highcharts-more, modules/exporting,
// modules/export-data), when evaluated in a CommonJS/webpack context, read the
// core instance from `window._Highcharts` — a global the core only sets when
// it was itself loaded as CJS. The host platform loads highcharts.min.js via a
// <script> tag, which sets only `window.Highcharts`. Bridge the two BEFORE any
// bundled highcharts module evaluates — including modules/exporting and
// modules/export-data, which design-sdk's Chart imports internally — or their
// factories dereference `undefined.AST` / `undefined.SeriesRegistry` and crash.
// That is why this file must stay the FIRST import of the widget, ahead of
// every '@faclon-labs/design-sdk' import.
//
// In prod `highcharts` is externalized to the host global; in dev it's the
// npm CJS build, which sets `_Highcharts` itself — the guard keeps this a no-op.
import Highcharts from 'highcharts';

const g = (typeof window !== 'undefined' ? window : globalThis) as any;
if (!g._Highcharts) {
  g._Highcharts = Highcharts;
}
