export interface UNSNode {
  id: string;
  type: string;
  name?: string;
  path: string | null;
  parentId: string | null;
}

export interface SeriesSlot {
  from: number;
  to: number;
  label: string;
  value: number | null;
  quality: string;
  isPartial?: boolean;
}

export interface SeriesAggregation {
  operator: string;
  downscale: number;
  resolution: string;
}

export interface SeriesMeta {
  type: string;
  key: string;
  unit: string | null;
  dataPrecision: number | null;
  aggregation: SeriesAggregation;
  devID: string;
  sensor: string;
}

export interface SeriesPayload {
  __type: 'series';
  path: string;
  meta: SeriesMeta;
  range: { from: number; to: number };
  slots: SeriesSlot[];
}

export interface ScalarBinding { key: string; topic: string; }
export interface SeriesBinding  { key: string; topic: string; type: 'series'; }
export type BindingEntry = ScalarBinding | SeriesBinding;

export interface DataEntry {
  key: string;
  value: string | number | null | SeriesPayload;
}

export interface Duration {
  id: string;
  label?: string;
  x?: number;
  xPeriod: string; // "minute" | "hour" | "day" | "week" | "month" | "year"
}

export interface TimeConfig {
  timezone: string;
  type: 'local' | 'fixed' | string;
  startTime: number | null;
  endTime: number | null;
  defaultDurationId: string;
  allDurations: Duration[];
  defaultPeriodicity: 'minute' | 'hourly' | 'daily' | 'weekly' | 'monthly';
}

export type WidgetEvent =
  | { type: 'TIME_CHANGE'; payload: { startTime: string; endTime: string; periodicity: string } }
  | { type: 'FILTER_CHANGE'; payload: Record<string, unknown> };

// ---------------------------------------------------------------------------
// Time Tab config — mirrors the design-sdk TimeTabConfiguration's emitted shape.
// STATIC envelope config — NEVER bindable, never added to dynamicBindingPathList.
// ---------------------------------------------------------------------------

// These mirror the SDK's own TimeTabConfiguration types
// (node_modules/@faclon-labs/design-sdk — components/product/TimeTabConfiguration/types.d.ts)
// as closely as TS allows, plus the startTime/endTime pin fields WE add at adopt-time
// (the SDK's own TimeTabUIConfig carries no absolute timestamps at all).

export type GTPPeriod = 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year';
export type GTPTimeType = 'fixed' | 'local' | 'global';
export type GTPNavigation = 'Previous' | 'Current' | 'Next';
export type GTPEvent = 'Start' | 'Now' | 'End';
export type GTPDeviationPattern = 'green-up-positive' | 'red-up-positive';

export interface GTPPreset {
  id: string;
  label: string;
  x?: number;
  xPeriod?: GTPPeriod;
  calendarType?: 'today' | 'yesterday' | 'current_week' | 'previous_week' | 'current_month' | 'previous_month' | 'current_year' | 'previous_year';
  isBuiltIn?: boolean;
  navigation?: GTPNavigation;
  xEvent?: GTPEvent;
  y?: number;
  yPeriod?: GTPPeriod;
  yEvent?: GTPEvent;
  periodicities?: string[];
  hidden?: boolean;
}

export interface GTPShift {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  color: string;
}

// First field on the Cycle Time form — Calendar Year, Financial Year, Custom.
export type GTPCycleTimeType = 'calendar' | 'financial' | 'custom';

// Cycle-time (shift) anchoring — redefines where each period BEGINS, e.g. a
// "day" that starts at 06:00 instead of 00:00, a "week" that starts on Wednesday.
export interface GTPCycleTimeConfig {
  cycleTimeType: GTPCycleTimeType;
  identifier: 'start' | 'end';
  hour: string;
  minute: string;
  dayOfWeek: number | null;
  date: string;
  month: string;
  year: string;
}

// A "Global Time Picker" registered in the host environment — when linked, its full
// configuration is READ-ONLY here; only per-widget display settings remain editable.
export interface GTPGlobalTimepicker {
  id: string;
  name: string;
  timezone?: string;
  cycleTime?: GTPCycleTimeConfig;
  allDurations?: GTPPreset[];
  defaultDurationId?: string;
  shifts?: GTPShift[];
  shiftAggregator?: string;
  comparisonMode?: boolean;
  futureDaysAllowed?: string;
}

// Per-widget settings when the picker is set to Global — the rest is inherited from
// the selected GTPGlobalTimepicker, looked up via `globalTimepickers`, never stored here.
export interface GTPGlobalSettings {
  globalTimepickerId: string;
  comparisonMode: boolean;
  deviationPattern: GTPDeviationPattern;
  allowPerSourceIndicator: boolean;
  sourceDeviationOverrides: Record<string, GTPDeviationPattern>;
  futureDaysAllowed: string;
}

// Inline "Set Duration" form values used by the Fixed Time Picker — ONE duration
// configured directly (unlike Local's managed list of presets).
export interface GTPFixedDuration {
  name: string;
  navigation: GTPNavigation;
  x: string;
  xPeriod: GTPPeriod;
  xEvent: GTPEvent;
  y: string;
  yPeriod: GTPPeriod;
  yEvent: GTPEvent;
  periodicity: string;
}

export interface GTPFixedSettings {
  timezone: string;
  cycleTime: GTPCycleTimeConfig;
  duration: GTPFixedDuration;
  disablePeriodicities: boolean;
  shifts: GTPShift[];
  shiftAggregator: string;
  comparisonMode: boolean;
  deviationPattern: GTPDeviationPattern;
  allowPerSourceIndicator: boolean;
  sourceDeviationOverrides: Record<string, GTPDeviationPattern>;
  futureDaysAllowed: string;
}

export interface TimeTabUIConfig {
  linkTimeWith?: GTPTimeType;
  timezone: string;
  /** @deprecated superseded by linkTimeWith — kept for back-compat with older saves. */
  timeType?: GTPTimeType;
  defaultDurationId: string;
  allDurations: GTPPreset[];
  defaultPeriodicity: 'minute' | 'hourly' | 'daily' | 'weekly' | 'monthly';
  disablePeriodicities?: boolean;
  comparisonMode?: boolean;
  deviationPattern?: GTPDeviationPattern;
  allowPerSourceIndicator?: boolean;
  sourceDeviationOverrides?: Record<string, GTPDeviationPattern>;
  futureDaysAllowed?: string;
  shifts?: GTPShift[];
  shiftAggregator?: string;
  cycleTime?: GTPCycleTimeConfig;
  fixed?: GTPFixedSettings;
  global?: GTPGlobalSettings;
  // WIDGET/ENGINE-OWNED — the SDK's own TimeTabUIConfig has no absolute timestamps.
  // Pinned by adoptSdkTimeConfig() at save time for fixed mode so the host fetch isn't
  // zero-width; null for local/global, which derive their window live.
  startTime?: number | null;
  endTime?: number | null;
}

// ---------------------------------------------------------------------------
// Style config — STATIC, never bindable, never in dynamicBindingPathList.
// Shared shape across widgets — do not redefine per-widget; add only the
// widget-specific advanced blocks (title / axis / pointLabel / etc.).
// ---------------------------------------------------------------------------

export type StylingFontWeight = 'Regular' | 'Medium' | 'Semi-Bold' | 'Bold';

export interface ScatterStyling {
  card: {
    wrapInCard: boolean;
    backgroundColor: string;
    borderColor: string;
    borderWidth: number;
    borderRadius: number;
  };
  hideElements: { settingsIcon: boolean; exportIcon: boolean; title: boolean };
  advancedEnabled: boolean;

  // ── WIDGET-SPECIFIC ADVANCED BLOCKS ────────────────────────────────────
  title: { fontSize: number; fontColor: string; fontWeight: StylingFontWeight };
  pointLabel: { fontSize: number; fontColor: string; fontWeight: StylingFontWeight };
  xAxis: { textColor: string; dataPointColor: string; lineColor: string };
  yAxis: { textColor: string; dataPointColor: string };
  // No dataTable block — Scatter has no embedded table.
  // ────────────────────────────────────────────────────────────────────

  misc: { gridLineColor: string; legendTextColor: string };
}

// ---------------------------------------------------------------------------
// Scatter widget config + envelope
// ---------------------------------------------------------------------------

export interface ScatterDataSource {
  id: string;          // client-generated, never bindable
  label: string;        // static display string, never bindable
  xField: string;       // bindable — "" or "{{uns:wsId://...}}"
  xPrecision: number;
  yField: string;       // bindable — "" or "{{uns:wsId://...}}"
  yPrecision: number;
  color: string;
  frequency: number;    // seconds
}

// How the X/Y points of a benchmark/zone were captured — "multiple" = typed into
// the Axes rows, "upload" = parsed from a validated .csv/.xlsx/.xls file.
export type ScatterPointsMode = 'multiple' | 'upload';

// Highcharts dashStyle values — stored verbatim; the configurator shows the
// spaced English label ("Short Dash Dot") but persists the Highcharts name.
export type ScatterDashStyle =
  | 'Solid'
  | 'ShortDash'
  | 'ShortDot'
  | 'ShortDashDot'
  | 'ShortDashDotDot'
  | 'Dot'
  | 'Dash'
  | 'LongDash'
  | 'DashDot'
  | 'LongDashDot'
  | 'LongDashDotDot';

export interface ScatterOverlayPoint { x: number; y: number; }

// Shared shape for the two chart overlays. STATIC config — labels/colors/points are
// literal values, never bindable, never in dynamicBindingPathList.
export interface ScatterOverlay {
  id: string;              // client-generated, never bindable
  label: string;
  color: string;
  pointsMode: ScatterPointsMode;
  points: ScatterOverlayPoint[];
  fileName?: string;       // set when pointsMode === 'upload'
  fileSize?: string;       // human-readable ("1.3 MB") — display-only, upload mode
  // Benchmark line styling only (zones ignore both). Optional — absent on saves
  // that predate the fields; the widget defaults to 1px / 'Solid'.
  lineWidth?: number;
  dashStyle?: ScatterDashStyle;
}

// Benchmark — reference line drawn over the scatter, connecting its points.
export type ScatterBenchmark = ScatterOverlay;
// Scatter Zone — shaded region drawn under the scatter points.
export type ScatterZone = ScatterOverlay;

export interface ScatterChart {
  id: string;              // client-generated, never bindable
  title: string;
  description?: string;
  xAxisLabel?: string;
  yAxisLabel?: string;
  // One scatter series per data source — each source's xField/yField is bindable,
  // resolved as series data (paired by timestamp).
  dataSources: ScatterDataSource[];
  // Optional (absent on saves that predate the feature) — static overlays.
  benchmarks?: ScatterBenchmark[];
  zones?: ScatterZone[];
}

export interface ScatterUIConfig {
  // Independent chart panels — the widget renders one at a time, switchable.
  charts: ScatterChart[];
  // Mirror of envelope.timeConfig — the widget only ever receives `config` (=uiConfig),
  // never the envelope root, so the Time tab's config must be duplicated here. Shared
  // across all charts, not per-chart.
  timeConfig?: TimeTabUIConfig;
  style: ScatterStyling;
}

export interface ScatterEnvelope {
  _id: string;
  type: 'Scatter';
  general: { title: string };
  timeConfig?: TimeTabUIConfig;
  uiConfig: ScatterUIConfig;
  dynamicBindingPathList: Array<BindingEntry>;
}
