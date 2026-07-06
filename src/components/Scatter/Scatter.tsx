// Side-effect imports — the setup shim bridges window._Highcharts to the host's
// Highcharts and MUST evaluate before any design-sdk import (design-sdk's Chart
// pulls in highcharts/modules/exporting + export-data, bundled in prod).
// highcharts-more registers the 'polygon' series type (Scatter Zones); the
// exporting modules power the Download Type menu (SVG/PNG/JPEG/CSV/XLSX).
import './highcharts-setup';
import 'highcharts/highcharts-more';
import 'highcharts/modules/exporting';
import 'highcharts/modules/export-data';
import { useState, useEffect, useRef, useCallback } from 'react';
import { DatePicker } from '@faclon-labs/design-sdk/DatePicker';
import { LineChart } from '@faclon-labs/design-sdk/LineChart';
import { exportChart, type ChartExportFormat } from '@faclon-labs/design-sdk/Chart';
import { Tooltip } from '@faclon-labs/design-sdk/Tooltip';
import { Popover } from '@faclon-labs/design-sdk/Popover';
import { IconButton } from '@faclon-labs/design-sdk/IconButton';
import { DropdownMenu, ActionListItem } from '@faclon-labs/design-sdk/DropdownMenu';
import { ChevronDown, Info, Settings, Menu } from 'lucide-react';
import { DataEntry, WidgetEvent, ScatterUIConfig, ScatterChart, ScatterDataSource, ScatterOverlayPoint, ScatterStyling, StylingFontWeight, TimeTabUIConfig, SeriesPayload, GTPPreset } from '../../iosense-sdk/types';
import { getSeriesData } from '../../iosense-sdk/mini-engine';
import { timeConfigMode, computeDurationWindow } from '../../iosense-sdk/time-window';
import { WidgetEmptyState } from '../../iosense-sdk/WidgetEmptyState';
import { injectPopoverPanelStyles } from './popover-panel-styles';
import './Scatter.css';

// Popover panels portal to document.body, outside the widget's scoped
// stylesheet — their styling must be injected into the top document.
injectPopoverPanelStyles();

interface ScatterProps {
  config: ScatterUIConfig | undefined;
  data: DataEntry[];
  onEvent: (event: WidgetEvent) => void;
}

// The SDK's TimeTabConfiguration only materializes its preset list once it MOUNTS
// (i.e. the user opens the Time tab). A widget added and configured without ever
// visiting Time has an empty tc.allDurations — the DatePicker then has no presets to
// list ("No results found") and nothing to highlight, so it collapses to "Custom".
// These mirror the SDK's built-in calendar presets so a fresh widget shows a usable
// preset list and defaults its selection to "Today". Superseded the instant the user
// touches the Time tab, at which point tc.allDurations arrives from the SDK.
const DEFAULT_LOCAL_DURATIONS: GTPPreset[] = [
  { id: 'today', label: 'Today', calendarType: 'today', isBuiltIn: true, navigation: 'Current', x: 0, xPeriod: 'day', xEvent: 'Start', y: 0, yPeriod: 'day', yEvent: 'Now' },
  { id: 'yesterday', label: 'Yesterday', calendarType: 'yesterday', isBuiltIn: true, navigation: 'Previous', x: 1, xPeriod: 'day', xEvent: 'Start', y: 1, yPeriod: 'day', yEvent: 'End' },
  { id: 'current_week', label: 'Current Week', calendarType: 'current_week', isBuiltIn: true, navigation: 'Current', x: 0, xPeriod: 'week', xEvent: 'Start', y: 0, yPeriod: 'week', yEvent: 'Now' },
  { id: 'previous_7_days', label: 'Past 7 days', isBuiltIn: true, navigation: 'Previous', x: 7, xPeriod: 'day', xEvent: 'Start', y: 0, yPeriod: 'day', yEvent: 'Now' },
  { id: 'current_month', label: 'Current Month', calendarType: 'current_month', isBuiltIn: true, navigation: 'Current', x: 0, xPeriod: 'month', xEvent: 'Start', y: 0, yPeriod: 'month', yEvent: 'Now' },
  { id: 'previous_month', label: 'Previous Month', calendarType: 'previous_month', isBuiltIn: true, navigation: 'Previous', x: 1, xPeriod: 'month', xEvent: 'Start', y: 1, yPeriod: 'month', yEvent: 'End' },
  { id: 'previous_3_month', label: 'Previous 3 Month', isBuiltIn: true, navigation: 'Previous', x: 3, xPeriod: 'month', xEvent: 'Start', y: 0, yPeriod: 'month', yEvent: 'Now' },
  { id: 'previous_12_month', label: 'Previous 12 Month', isBuiltIn: true, navigation: 'Previous', x: 12, xPeriod: 'month', xEvent: 'Start', y: 0, yPeriod: 'month', yEvent: 'Now' },
  { id: 'current_year', label: 'Current Year', calendarType: 'current_year', isBuiltIn: true, navigation: 'Current', x: 0, xPeriod: 'year', xEvent: 'Start', y: 0, yPeriod: 'year', yEvent: 'Now' },
  { id: 'previous_year', label: 'Previous Year', calendarType: 'previous_year', isBuiltIn: true, navigation: 'Previous', x: 1, xPeriod: 'year', xEvent: 'Start', y: 1, yPeriod: 'year', yEvent: 'End' },
];

const SAFE_STYLING: ScatterStyling = {
  card: { wrapInCard: true, backgroundColor: '#FFFFFF', borderColor: '#EEEEEE', borderWidth: 1, borderRadius: 8 },
  hideElements: { settingsIcon: false, exportIcon: false, title: false },
  advancedEnabled: false,
  title: { fontSize: 18, fontColor: '#050505', fontWeight: 'Semi-Bold' },
  pointLabel: { fontSize: 12, fontColor: '#050505', fontWeight: 'Regular' },
  xAxis: { textColor: '#050505', dataPointColor: '#050505', lineColor: '#DEE1E3' },
  yAxis: { textColor: '#050505', dataPointColor: '#050505' },
  misc: { gridLineColor: '#DEE1E3', legendTextColor: '#292F2E' },
};

// An empty-string color must fall through to the default so Advanced Title/point
// colors reflect WITHOUT first opening Advanced Settings.
function safeColor(value: string | undefined, fallback: string): string {
  return value && value.trim() !== '' ? value : fallback;
}

// Defensive read — never assume the object exists; missing keys fall back to SAFE_STYLING.
function normalizeStyling(style: ScatterStyling | undefined): ScatterStyling {
  if (!style) return SAFE_STYLING;
  return {
    card: {
      ...SAFE_STYLING.card,
      ...style.card,
      backgroundColor: safeColor(style.card?.backgroundColor, SAFE_STYLING.card.backgroundColor),
      borderColor: safeColor(style.card?.borderColor, SAFE_STYLING.card.borderColor),
    },
    hideElements: { ...SAFE_STYLING.hideElements, ...style.hideElements },
    advancedEnabled: style.advancedEnabled ?? SAFE_STYLING.advancedEnabled,
    title: {
      ...SAFE_STYLING.title,
      ...style.title,
      fontColor: safeColor(style.title?.fontColor, SAFE_STYLING.title.fontColor),
    },
    pointLabel: {
      ...SAFE_STYLING.pointLabel,
      ...style.pointLabel,
      fontColor: safeColor(style.pointLabel?.fontColor, SAFE_STYLING.pointLabel.fontColor),
    },
    xAxis: {
      ...SAFE_STYLING.xAxis,
      ...style.xAxis,
      textColor: safeColor(style.xAxis?.textColor, SAFE_STYLING.xAxis.textColor),
      dataPointColor: safeColor(style.xAxis?.dataPointColor, SAFE_STYLING.xAxis.dataPointColor),
      lineColor: safeColor(style.xAxis?.lineColor, SAFE_STYLING.xAxis.lineColor),
    },
    yAxis: {
      ...SAFE_STYLING.yAxis,
      ...style.yAxis,
      textColor: safeColor(style.yAxis?.textColor, SAFE_STYLING.yAxis.textColor),
      dataPointColor: safeColor(style.yAxis?.dataPointColor, SAFE_STYLING.yAxis.dataPointColor),
    },
    misc: {
      gridLineColor: safeColor(style.misc?.gridLineColor, SAFE_STYLING.misc.gridLineColor),
      legendTextColor: safeColor(style.misc?.legendTextColor, SAFE_STYLING.misc.legendTextColor),
    },
  };
}

// Zone fill — the configured color at low opacity so scatter points stay readable.
function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// Two points are read as opposite rectangle corners; three or more are polygon
// vertices in the order the user entered them.
function zonePolygon(points: ScatterOverlayPoint[]): Array<[number, number]> {
  if (points.length === 2) {
    const [a, b] = points;
    return [[a.x, a.y], [b.x, a.y], [b.x, b.y], [a.x, b.y]];
  }
  return points.map((p) => [p.x, p.y]);
}

function fontWeightToCss(weight: StylingFontWeight): number {
  switch (weight) {
    case 'Regular': return 400;
    case 'Medium': return 500;
    case 'Semi-Bold': return 600;
    case 'Bold': return 700;
    default: return 400;
  }
}

function styleToCssVars(style: ScatterStyling): React.CSSProperties {
  return {
    '--scatter-card-bg': style.card.wrapInCard ? style.card.backgroundColor : 'transparent',
    '--scatter-card-border-color': style.card.wrapInCard ? style.card.borderColor : 'transparent',
    '--scatter-card-border-width': `${style.card.wrapInCard ? style.card.borderWidth : 0}px`,
    '--scatter-card-border-radius': `${style.card.borderRadius}px`,
    '--scatter-title-font-size': `${style.title.fontSize}px`,
    '--scatter-title-color': style.title.fontColor,
    '--scatter-title-weight': String(fontWeightToCss(style.title.fontWeight)),
    // The SDK renders the legend as DOM (.fds-chart-legend), not Highcharts SVG —
    // legend.itemStyle in highchartsOptions never reaches it, so the color has to
    // travel via CSS. Only advanced mode overrides the token default.
    ...(style.advancedEnabled ? { '--scatter-legend-color': style.misc.legendTextColor } : {}),
  } as React.CSSProperties;
}

// Gates the OUTER "Widget not configured" empty state — once a chart exists, the
// header/title/actions render regardless of whether its data sources are wired up
// yet; the canvas-level "No data found" state (status="not-configured" on LineChart)
// handles that finer-grained case while keeping the header interactive.
function isConfigured(config: ScatterUIConfig | undefined): boolean {
  return Boolean(config?.charts && config.charts.length > 0);
}

// LineChart's title accepts a ReactNode — a clickable label + DropdownMenu composed
// by the consumer, per the SDK's own documented "Custom Title Slot" pattern.
function ChartTitleSwitcher({
  charts,
  activeId,
  onSelect,
}: {
  charts: ScatterChart[];
  activeId?: string;
  onSelect: (id: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const active = charts.find((c) => c.id === activeId);
  // Same anchored-Popover pattern as the settings/export menus — the panel is
  // portaled and pinned to the trigger, so it floats over the widget content
  // instead of shifting with the in-flow layout.
  return (
    <div className="scatter-chart-switcher">
      <Popover
        placement="Bottom Start"
        id="scatter-chart-title-menu"
        isOpen={isOpen}
        onOpenChange={setIsOpen}
        trigger={
          <div className="scatter-chart-switcher__trigger BodyLargeSemibold">
            {active?.title || 'Scatter'} <ChevronDown size={14} />
          </div>
        }
      >
        <DropdownMenu>
          {charts.map((c) => (
            <ActionListItem
              key={c.id}
              title={c.title || 'Untitled'}
              selectionType="Single"
              isSelected={c.id === activeId}
              onClick={() => { onSelect(c.id); setIsOpen(false); }}
            />
          ))}
        </DropdownMenu>
      </Popover>
    </div>
  );
}

// "Future Days Allowed" (Time tab) — the picker may reach N calendar days ahead,
// through the END of the Nth day. Day boundaries follow the configured timezone +
// cycle-time anchor, same as every preset window (NOT now + N×24h, which cut the
// allowance mid-day). Unset/blank/invalid = 0: future dates are blocked by
// default, not allowed by default.
function futureMaxMs(tc: TimeTabUIConfig | undefined, now: number): number {
  const days = Number(tc?.futureDaysAllowed);
  const n = Number.isFinite(days) && days > 0 ? Math.floor(days) : 0;
  const { endTime } = computeDurationWindow(
    { navigation: 'Next', x: 0, xPeriod: 'day', xEvent: 'Start', y: n, yPeriod: 'day', yEvent: 'End' },
    now,
    tc?.timezone,
    tc?.cycleTime,
  );
  return endTime;
}

function clampToFutureLimit(
  range: { start: Date; end: Date },
  maxMs: number,
): { start: Date; end: Date } {
  return {
    start: new Date(Math.min(range.start.getTime(), maxMs)),
    end: new Date(Math.min(range.end.getTime(), maxMs)),
  };
}

function formatFixedDurationLabel(tc: TimeTabUIConfig | undefined): string | undefined {
  const name = tc?.fixed?.duration?.name?.trim();
  if (name) return name;
  if (tc?.startTime == null || tc?.endTime == null) return undefined;
  return `${new Date(tc.startTime).toLocaleString()} – ${new Date(tc.endTime).toLocaleString()}`;
}

// GTPGlobalSettings only stores the link id + per-widget overlay fields — the
// inherited display data (name, duration, timezone) lives on the host-injected
// `globalTimepickers` list, which the widget never receives. Nothing precise to
// show here without it.
function formatGlobalDurationLabel(tc: TimeTabUIConfig | undefined): string | undefined {
  return tc?.global?.globalTimepickerId ? 'Linked to dashboard time' : undefined;
}

function NoConfigScreen({ style }: { style: ScatterStyling }) {
  return (
    <div className="widget-template widget-template__empty" style={styleToCssVars(style)}>
      <WidgetEmptyState state="widget-not-configured" />
    </div>
  );
}

export function Scatter({ config, data, onEvent }: ScatterProps) {
  const style = normalizeStyling(config?.style);
  const tc = config?.timeConfig;
  const mode = timeConfigMode(tc);

  // Fall back to the built-in preset list when the Time tab was never opened (empty
  // allDurations) so the DatePicker has presets to show and a "Today" to select —
  // see DEFAULT_LOCAL_DURATIONS. Once the SDK provides its own list, use that.
  const effectiveDurations =
    tc?.allDurations && tc.allDurations.length > 0 ? tc.allDurations : DEFAULT_LOCAL_DURATIONS;

  // DatePicker state lives at widget level (not inside a keyed/remounted child) so
  // selection doesn't snap back to default on data-driven remount.
  const [localRange, setLocalRange] = useState<{ start: Date; end: Date } | null>(null);
  const [localPreset, setLocalPreset] = useState<string | undefined>(tc?.defaultDurationId);

  // Patch the DatePicker to the configured default duration whenever the Time tab
  // config actually changes. Keyed on the SERIALIZED timeConfig, not the config
  // object identity — the configurator emits a fresh config object on every style/
  // title keystroke, and keying on identity made each keystroke snap a manually
  // selected range back to the default.
  const tcKey = JSON.stringify(tc ?? null);
  // Announce the default window via applyRange (TIME_CHANGE), not bare
  // setLocalRange — the host's own initial fetch derives timeFrame from
  // defaultPeriodicity (falling back to "day" on envelopes that lack it), which
  // returns nothing plottable while every user interaction refetches hourly.
  // Emitting on mount makes initial load take the exact interaction path.
  // Gated on config being present: before the host delivers it, tc is undefined
  // and the emit would push a meaningless "today" window.
  const hasConfig = config !== undefined;
  useEffect(() => {
    if (!hasConfig) return;
    // The host drops its TIME_CHANGE override on a Time-tab change, so the last
    // emitted window no longer reflects what the chart shows — clear the dedupe
    // ref or re-clicking the same boundary-anchored preset (e.g. "Yesterday")
    // would be swallowed as a duplicate and never refetch.
    lastWindowRef.current = null;

    // Fixed mode: the window is PINNED in the envelope (tc.startTime/endTime) at
    // save time by the configurator's adoptSdkTimeConfig — a fixed pair of absolute
    // boundaries, never a live "now" window. Announce it here so the host refetches
    // with the fixed boundaries. Without this the host keeps whatever window was
    // last emitted in the PRIOR mode (a live "…→ now" window), which is exactly the
    // "last selected time before switching to fixed" the user sees.
    if (mode === 'fixed') {
      if (tc?.startTime != null && tc?.endTime != null) {
        applyRange({ start: new Date(tc.startTime), end: new Date(tc.endTime) });
      }
      return;
    }

    // Global mode is resolved host-side from the linked dashboard timepicker (the
    // widget isn't handed the globalTimepickers list) — nothing to announce here.
    if (mode !== 'local') return;

    const preset = effectiveDurations.find((d) => d.id === tc?.defaultDurationId);
    if (preset) {
      setLocalPreset(preset.id);
      const { startTime, endTime } = computeDurationWindow(preset, Date.now(), tc?.timezone, tc?.cycleTime);
      applyRange({ start: new Date(startTime), end: new Date(endTime) });
      return;
    }
    // No default duration configured yet (fresh chart, Time tab never touched) —
    // default to "Today". Prefer the real preset entry from effectiveDurations (so the
    // DatePicker highlights the "Today" button AND the window matches it exactly),
    // which — thanks to DEFAULT_LOCAL_DURATIONS — always exists even before the SDK
    // has populated its own list. The literal-window branch is a defensive last resort.
    const todayPreset =
      effectiveDurations.find((d) => d.calendarType === 'today') ??
      effectiveDurations.find((d) => d.id?.toLowerCase() === 'today');
    if (todayPreset) {
      setLocalPreset(todayPreset.id);
      const { startTime, endTime } = computeDurationWindow(todayPreset, Date.now(), tc?.timezone, tc?.cycleTime);
      applyRange({ start: new Date(startTime), end: new Date(endTime) });
      return;
    }
    setLocalPreset(undefined);
    const { startTime, endTime } = computeDurationWindow(
      { navigation: 'Current', x: 0, xPeriod: 'day', xEvent: 'Start', y: 0, yPeriod: 'day', yEvent: 'Now' },
      Date.now(),
      tc?.timezone,
    );
    applyRange({ start: new Date(startTime), end: new Date(endTime) });
  }, [tcKey, hasConfig]);

  // Active chart — one of several independent chart panels, switchable via the
  // title-slot dropdown. Declared before any early return (Rules of Hooks).
  // Keyed on the chart id list so per-keystroke config emits (new object, same
  // charts) don't churn the effect.
  const charts = config?.charts ?? [];
  const chartIdsKey = charts.map((c) => c.id).join('|');
  const [activeChartId, setActiveChartId] = useState<string | undefined>(charts[0]?.id);
  useEffect(() => {
    if (!charts.some((c) => c.id === activeChartId)) setActiveChartId(charts[0]?.id);
  }, [chartIdsKey]);

  // Chart Control — view-time-only toggles, not persisted config. Defaults mirror the
  // proto's dropdown states. Highcharts instance ref feeds exportChart from the
  // Download Type menu.
  const [showLegend, setShowLegend] = useState(true);
  const [connectPoints, setConnectPoints] = useState(false);
  const [benchmarkPoints, setBenchmarkPoints] = useState(false);
  const [benchmarkLegends, setBenchmarkLegends] = useState(true);
  const [zonePoints, setZonePoints] = useState(true);
  const [zoneLegends, setZoneLegends] = useState(true);
  const chartInstanceRef = useRef<unknown>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Highcharts sizes itself to the container's measured dimensions at render time and
  // only auto-reflows on WINDOW resize — it never sees the dashboard grid resizing the
  // widget's own container (which is why a full page refresh, re-measuring at the final
  // size, "fixes" the squashed first render). Observe the container and reflow on any
  // size change. A callback ref (not a useEffect) so it re-targets correctly across the
  // no-source → chart branch swap without running afoul of the early returns' hook order.
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const attachContainer = useCallback((el: HTMLDivElement | null) => {
    containerRef.current = el;
    resizeObserverRef.current?.disconnect();
    resizeObserverRef.current = null;
    if (el && typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => {
        (chartInstanceRef.current as { reflow?: () => void } | null)?.reflow?.();
      });
      ro.observe(el);
      resizeObserverRef.current = ro;
    }
  }, []);
  useEffect(() => () => resizeObserverRef.current?.disconnect(), []);
  // Last window emitted via TIME_CHANGE — a preset click applies the window in
  // handlePresetSelect, and the SDK DatePicker may fire onRangeChange right after
  // in the same tick (state not yet flushed), so dedupe through a ref, not state.
  const lastWindowRef = useRef<{ start: number; end: number } | null>(null);
  // When the last preset click happened — its onRangeChange echo must be swallowed
  // entirely (see handleRangeChange); the exact-ms dedupe above can't catch it.
  const presetSelectedAtRef = useRef(0);

  if (!config) return <NoConfigScreen style={SAFE_STYLING} />;
  if (!isConfigured(config)) return <NoConfigScreen style={style} />;

  const activeChart = charts.find((c) => c.id === activeChartId) ?? charts[0];
  const activeChartIndex = charts.findIndex((c) => c.id === activeChart?.id);

  interface ScatterSeriesEntry {
    source: ScatterDataSource;
    points: Array<[number, number]>;
  }

  // resolveAndCompute dedupes identical topics — when X and Y (or two sources)
  // share a UNS path, the response has ONE entry keyed by whichever binding came
  // first. Index every resolved series by its uiConfig binding string so a key
  // with no entry of its own can reuse the series resolved under the sibling key.
  const activeSources = activeChart?.dataSources ?? [];
  const seriesByBinding = new Map<string, SeriesPayload>();
  activeSources.forEach((source, j) => {
    const xs = getSeriesData(`charts[${activeChartIndex}].dataSources[${j}].xField`, data);
    if (xs && source.xField) seriesByBinding.set(source.xField, xs);
    const ys = getSeriesData(`charts[${activeChartIndex}].dataSources[${j}].yField`, data);
    if (ys && source.yField) seriesByBinding.set(source.yField, ys);
  });
  const seriesFor = (key: string, binding: string): SeriesPayload | null =>
    getSeriesData(key, data) ?? seriesByBinding.get(binding) ?? null;

  const seriesEntries: ScatterSeriesEntry[] = activeSources
    .map((source, j) => {
      if (!source.xField || !source.yField) return null;
      const xSeries = seriesFor(`charts[${activeChartIndex}].dataSources[${j}].xField`, source.xField);
      const ySeries = seriesFor(`charts[${activeChartIndex}].dataSources[${j}].yField`, source.yField);
      if (!xSeries || !ySeries || xSeries.slots.length === 0 || ySeries.slots.length === 0) {
        // Both axes are bound but one resolved to nothing — a data problem, not a
        // config problem. Say so instead of silently rendering an empty canvas,
        // and distinguish "no entry for this key" from "entry present but not
        // series-shaped" (host/engine contract drift) vs "series with zero slots".
        const describe = (axis: 'X' | 'Y', field: 'xField' | 'yField', series: SeriesPayload | null) => {
          if (series) return series.slots.length === 0 ? `${axis} axis series has zero slots` : null;
          const key = `charts[${activeChartIndex}].dataSources[${j}].${field}`;
          const entry = data.find((d) => d.key === key);
          return entry
            ? `${axis} axis entry "${key}" exists but is not series-shaped (no slots)`
            : `${axis} axis has no data entry for key "${key}" (keys present: ${data.map((d) => d.key).join(', ') || 'none'})`;
        };
        const reason = describe('X', 'xField', xSeries) ?? describe('Y', 'yField', ySeries);
        console.warn(
          `[Scatter] source "${source.label || j}" not plotted — ${reason}. ` +
          `Check the UNS path and time window.`,
        );
        return null;
      }
      // Pair by slot timestamp, not array index — the two topics resolve on the
      // same slot grid, but a missing leading/trailing slot on one side would
      // shift every pair if matched by index.
      const yByFrom = new Map(ySeries.slots.map((s) => [s.from, s.value]));
      const points: Array<[number, number]> = [];
      for (const slot of xSeries.slots) {
        const yv = yByFrom.get(slot.from);
        if (slot.value !== null && yv !== null && yv !== undefined) points.push([slot.value, yv]);
      }
      return points.length > 0 ? { source, points } : null;
    })
    .filter((e): e is ScatterSeriesEntry => e !== null);

  const hasData = seriesEntries.length > 0;
  // "Configured" = at least one source with both axes bound — decides between the
  // "Data Source not configured" and "No data found" empty states below.
  const hasConfiguredSource = (activeChart?.dataSources ?? []).some((s) => s.xField && s.yField);

  // Static overlays — zones render beneath the scatter points, benchmarks above.
  // Both merge BY INDEX into the LineChart `series` prop (name/color for the legend)
  // and `highchartsOptions.series` (type/data), so the three lists below must stay
  // in the same order: zones, data sources, benchmarks.
  const zoneOverlays = (activeChart?.zones ?? []).filter((z) => z.points.length >= 2);
  const benchmarkOverlays = (activeChart?.benchmarks ?? []).filter((b) => b.points.length >= 1);

  // showInLegend on the PROP entry, not just the highchartsOptions series — the
  // SDK's DOM legend is built from the prop list and never sees Highcharts options.
  const legendSeries = [
    ...zoneOverlays.map((z) => ({ name: z.label || 'Zone', data: [], color: z.color, showInLegend: zoneLegends })),
    ...seriesEntries.map(({ source }) => ({ name: source.label || 'Series', data: [], color: source.color })),
    ...benchmarkOverlays.map((b) => ({ name: b.label || 'Benchmark', data: [], color: b.color, showInLegend: benchmarkLegends })),
  ];
  const legendColors = [
    ...zoneOverlays.map((z) => z.color),
    ...seriesEntries.map(({ source }) => source.color),
    ...benchmarkOverlays.map((b) => b.color),
  ];

  function applyRange(range: { start: Date; end: Date }) {
    const clamped = clampToFutureLimit(range, futureMaxMs(tc, Date.now()));
    const start = clamped.start.getTime();
    const end = clamped.end.getTime();
    if (lastWindowRef.current?.start === start && lastWindowRef.current?.end === end) return;
    lastWindowRef.current = { start, end };
    setLocalRange(clamped);
    onEvent({
      type: 'TIME_CHANGE',
      payload: {
        startTime: String(start),
        endTime: String(end),
        periodicity: tc?.defaultPeriodicity ?? 'hourly',
      },
    });
  }

  function handleRangeChange(range: { start: Date; end: Date } | null) {
    // The SDK DatePicker fires onRangeChange right after onPresetSelect for preset
    // ids it recognizes, with ITS OWN idea of the window (browser clock/timezone) —
    // off by milliseconds, or hours when the widget timezone differs, from the
    // computeDurationWindow result already applied, so applyRange's exact-ms dedupe
    // misses it and a duplicate TIME_CHANGE (= duplicate resolveAndCompute) goes
    // out. The preset's window is authoritative — swallow anything arriving on its
    // heels. Never clear the preset here either; that would reset it to "Custom".
    if (performance.now() - presetSelectedAtRef.current < 500) return;
    if (range) applyRange(range);
  }

  // The preset list comes from tc.allDurations (custom ids the SDK DatePicker
  // knows nothing about), so it cannot compute the window itself and will not
  // follow up with an onRangeChange — resolve the duration expression here.
  function handlePresetSelect(value: string) {
    presetSelectedAtRef.current = performance.now();
    setLocalPreset(value);
    const preset = effectiveDurations.find((d) => d.id === value);
    if (!preset) return;
    const { startTime, endTime } = computeDurationWindow(preset, Date.now(), tc?.timezone, tc?.cycleTime);
    applyRange({ start: new Date(startTime), end: new Date(endTime) });
  }

  const durationSlot =
    mode === 'fixed'
      ? formatFixedDurationLabel(tc)
      : mode === 'global'
        ? formatGlobalDurationLabel(tc)
        : undefined;

  // Chart exists but no data source is wired up yet — the canonical
  // "Data Source not configured" state, NOT the chart's built-in "No data found"
  // (that copy is reserved for a configured source that resolved to nothing).
  if (!hasConfiguredSource) {
    return (
      <div className="widget-template scatter-no-source" style={styleToCssVars(style)} ref={attachContainer}>
        {!style.hideElements.title && (
          <div className="scatter-no-source__header">
            {charts.length > 1 ? (
              <ChartTitleSwitcher charts={charts} activeId={activeChart?.id} onSelect={setActiveChartId} />
            ) : (
              <span className="BodyLargeSemibold">{activeChart?.title || 'Scatter'}</span>
            )}
          </div>
        )}
        <div className="scatter-no-source__body">
          <WidgetEmptyState state="data-source-not-configured" />
        </div>
      </div>
    );
  }

  const presets = effectiveDurations.map((d) => ({
    label: d.label ?? `Last ${d.x ?? 1} ${d.xPeriod}`,
    value: d.id,
  }));

  const advanced = style.advancedEnabled;

  function handleFullScreen() {
    containerRef.current?.requestFullscreen?.();
  }

  function handleDownload(format: ChartExportFormat) {
    exportChart({ instance: chartInstanceRef.current, engine: 'highcharts', format, fileName: activeChart?.title || 'chart' });
  }

  return (
    <div className="widget-template" style={styleToCssVars(style)} ref={attachContainer}>
      <LineChart
        title={
          style.hideElements.title
            ? undefined
            : charts.length > 1
              ? <ChartTitleSwitcher charts={charts} activeId={activeChart?.id} onSelect={setActiveChartId} />
              : (activeChart?.title || 'Scatter')
        }
        duration={durationSlot}
        // Static overlays (benchmarks/zones) must stay visible even while the
        // series data hasn't resolved yet — only fall to the "No data found"
        // canvas state when there is nothing at all to draw.
        status={hasData || zoneOverlays.length > 0 || benchmarkOverlays.length > 0 ? undefined : 'not-configured'}
        onChartReady={(instance) => {
          chartInstanceRef.current = instance;
          // The container may have reached its final grid size before the instance
          // existed (so the observe-time reflow was a no-op) — reflow once now.
          (instance as { reflow?: () => void } | null)?.reflow?.();
        }}
        actions={
          <div className="scatter-chart-actions">
            {activeChart?.description && (
              // Description only — the chart title already sits in the header,
              // repeating it as the tooltip heading reads as duplication.
              <Tooltip bodyText={activeChart.description}>
                <IconButton icon={<Info size={16} />} size="Small" accessibilityLabel="Description" />
              </Tooltip>
            )}
            {style.hideElements.settingsIcon !== true && (
              // Tooltip wraps the whole Popover (not just the trigger) so the
              // Popover's click-to-open wiring on its trigger stays intact.
              <Tooltip bodyText="Chart settings" placement="Top">
              <Popover
                placement="Bottom"
                // The panel is portaled to document.body — className never reaches
                // it, but the id lands on the panel div. CSS keys off this id.
                id="scatter-chart-control-menu"
                trigger={<IconButton icon={<Settings size={16} />} size="Small" accessibilityLabel="Chart settings" />}
              >
                <DropdownMenu>
                  <ActionListItem contentType="SectionHeading" title="Chart Control" />
                  <ActionListItem
                    title="Legends"
                    selectionType="Multiple"
                    isSelected={showLegend}
                    onClick={() => setShowLegend((v) => !v)}
                  />
                  <ActionListItem
                    title="Connect Points"
                    selectionType="Multiple"
                    isSelected={connectPoints}
                    onClick={() => setConnectPoints((v) => !v)}
                  />
                  <ActionListItem contentType="SectionHeading" title="Benchmarks" />
                  <ActionListItem
                    title="Point"
                    selectionType="Multiple"
                    isSelected={benchmarkPoints}
                    onClick={() => setBenchmarkPoints((v) => !v)}
                  />
                  <ActionListItem
                    title="Legends"
                    selectionType="Multiple"
                    isSelected={benchmarkLegends}
                    onClick={() => setBenchmarkLegends((v) => !v)}
                  />
                  <ActionListItem contentType="SectionHeading" title="Scatter Zone Area" />
                  <ActionListItem
                    title="Point"
                    selectionType="Multiple"
                    isSelected={zonePoints}
                    onClick={() => setZonePoints((v) => !v)}
                  />
                  <ActionListItem
                    title="Legends"
                    selectionType="Multiple"
                    isSelected={zoneLegends}
                    onClick={() => setZoneLegends((v) => !v)}
                  />
                </DropdownMenu>
              </Popover>
              </Tooltip>
            )}
            {style.hideElements.exportIcon !== true && (
              <Tooltip bodyText="Export" placement="Top">
              <Popover
                placement="Bottom"
                id="scatter-chart-export-menu"
                trigger={<IconButton icon={<Menu size={16} />} size="Small" accessibilityLabel="More options" />}
              >
                <DropdownMenu>
                  <ActionListItem title="View in full screen" onClick={handleFullScreen} />
                  <ActionListItem contentType="Separator" />
                  <ActionListItem contentType="SectionHeading" title="Download Type" />
                  {(['SVG', 'PNG', 'JPEG', 'CSV', 'XLSX'] as const).map((format) => (
                    <ActionListItem key={format} title={format} onClick={() => handleDownload(format)} />
                  ))}
                </DropdownMenu>
              </Popover>
              </Tooltip>
            )}
          </div>
        }
        categories={[]}
        series={legendSeries}
        showLegend={showLegend}
        colors={legendColors}
        filters={
          mode === 'local' ? (
            <DatePicker
              mode="range"
              placeholder="Select range"
              rangeValue={localRange}
              onRangeChange={handleRangeChange}
              presets={presets as unknown as never}
              selectedPreset={localPreset}
              onPresetSelect={handlePresetSelect}
            />
          ) : (
            // MUST be an empty node, never undefined — the SDK chart substitutes
            // its own built-in date-range + periodicity toolbar whenever `filters`
            // is undefined (LineChart hardcodes timeFilter "range+periodicity"),
            // which put an interactive "Custom / Select range" picker on Fixed and
            // Global widgets that are not user-adjustable.
            <></>
          )
        }
        highchartsOptions={{
          // Transparent canvas — the card background (Wrap Into Card + color) is
          // owned by .widget-template; the theme's own white must not sit on top.
          chart: { type: 'scatter', backgroundColor: 'transparent' },
          // The SDK installs a chart-level shared tooltip formatter, which makes
          // Highcharts ignore per-series pointFormat entirely — precision has to
          // be applied inside a replacement formatter. Per-series precision and
          // axis labels travel via the series' `custom` options bag.
          tooltip: {
            shared: false,
            useHTML: true,
            formatter: function (this: unknown) {
              const ctx = this as {
                x?: number | string;
                y?: number | null;
                series?: { name?: string; userOptions?: { custom?: Record<string, unknown> } };
              };
              const fmt = (v: number | string | null | undefined, precision: number) => {
                const n = typeof v === 'string' ? Number(v) : v;
                return n === null || n === undefined || !Number.isFinite(n) ? '-' : n.toFixed(precision);
              };
              const c = (ctx.series?.userOptions?.custom ?? {}) as {
                xLabel?: string; yLabel?: string; xPrecision?: number; yPrecision?: number;
              };
              if (c.xLabel !== undefined) {
                return (
                  `${c.xLabel}: <b>${fmt(ctx.x, c.xPrecision ?? 2)}</b><br/>` +
                  `${c.yLabel ?? 'Y'}: <b>${fmt(ctx.y, c.yPrecision ?? 2)}</b>`
                );
              }
              // Benchmarks and any other non-scatter series.
              return `${ctx.series?.name ?? ''}: <b>${fmt(ctx.y, 2)}</b>`;
            },
          },
          // NEVER pass explicit `undefined` style objects here — the SDK deep-merges
          // these over its theme with Highcharts merge(), which copies undefined and
          // wipes the theme's style defaults; axis/legend render then crashes on
          // `undefined.whiteSpace` and the whole widget unmounts. Omit keys instead.
          xAxis: {
            type: 'linear',
            title: {
              text: activeChart?.xAxisLabel || 'X',
              ...(advanced ? { style: { color: style.xAxis.textColor } } : {}),
            },
            ...(advanced
              ? {
                  labels: { style: { color: style.xAxis.textColor } },
                  lineColor: style.xAxis.lineColor,
                  gridLineColor: style.misc.gridLineColor,
                }
              : {}),
          },
          yAxis: {
            title: {
              text: activeChart?.yAxisLabel || 'Y',
              ...(advanced ? { style: { color: style.yAxis.textColor } } : {}),
            },
            ...(advanced
              ? {
                  labels: { style: { color: style.yAxis.textColor } },
                  gridLineColor: style.misc.gridLineColor,
                }
              : {}),
          },
          // Legend text color is NOT set here — the SDK disables the Highcharts
          // legend and renders its own DOM legend; see --scatter-legend-color.
          // Merged BY INDEX into the `series` prop entries above (the SDK's documented
          // escape-hatch pattern) — same zones → data sources → benchmarks order as
          // legendSeries. Name/color live on the prop entry.
          series: [
            ...zoneOverlays.map((zone) => ({
              type: 'polygon' as const,
              data: zonePolygon(zone.points),
              color: hexToRgba(zone.color, 0.25),
              lineWidth: 1,
              enableMouseTracking: false,
              marker: { enabled: zonePoints, radius: 3, fillColor: zone.color },
              showInLegend: zoneLegends,
              zIndex: 0,
            })),
            ...seriesEntries.map(({ source, points }) => ({
              type: 'scatter' as const,
              data: points,
              zIndex: 1,
              // Connect Points (Chart Control) — draws a joining line through the series.
              lineWidth: connectPoints ? 1.5 : 0,
              marker: { enabled: true, radius: 4 },
              // Read by the chart-level tooltip formatter above — per-series
              // tooltip.pointFormat is dead once a chart formatter exists.
              custom: {
                xLabel: activeChart?.xAxisLabel || 'X',
                yLabel: activeChart?.yAxisLabel || 'Y',
                xPrecision: source.xPrecision ?? 2,
                yPrecision: source.yPrecision ?? 2,
              },
              dataLabels: {
                format: `{point.y:.${source.yPrecision ?? 2}f}`,
                ...(advanced
                  ? {
                      style: {
                        fontSize: `${style.pointLabel.fontSize}px`,
                        color: style.pointLabel.fontColor,
                        fontWeight: String(fontWeightToCss(style.pointLabel.fontWeight)),
                      },
                    }
                  : {}),
              },
            })),
            // Sorted ascending by x — Highcharts requires ordered line data (#15).
            ...benchmarkOverlays.map((benchmark) => ({
              type: 'line' as const,
              data: [...benchmark.points].sort((p, q) => p.x - q.x).map((p) => [p.x, p.y] as [number, number]),
              // Absent on envelopes saved before the fields existed — 'Solid' / 1px.
              dashStyle: benchmark.dashStyle ?? ('Solid' as const),
              lineWidth: benchmark.lineWidth ?? 1,
              marker: { enabled: benchmarkPoints, radius: 3 },
              showInLegend: benchmarkLegends,
              zIndex: 2,
              dataLabels: { enabled: false },
            })),
          ],
        }}
      />
    </div>
  );
}
