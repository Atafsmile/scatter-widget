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
import { DataEntry, WidgetEvent, ScatterUIConfig, ScatterChart, ScatterDataSource, ScatterOverlayPoint, ScatterStyling, StylingFontWeight, TimeTabUIConfig, SeriesPayload } from '../../iosense-sdk/types';
import { getSeriesData } from '../../iosense-sdk/mini-engine';
import { timeConfigMode, computeDurationWindow, DEFAULT_LOCAL_DURATIONS } from '../../iosense-sdk/time-window';
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

// Collinear vertices make a zero-area polygon, which paints as a bare line —
// testers enter a diagonal of points as a "boundary" and expect a shaded layer
// (feedback: "a layer of zone with opaque color is supposed to come"). Such
// zones render as an area band under the polyline instead (see zone series
// below). Two points are exempt: they read as rectangle corners.
function isCollinearZone(points: ScatterOverlayPoint[]): boolean {
  if (points.length <= 2) return false;
  const [p0] = points;
  // Coordinates are user data of arbitrary magnitude — epsilon must scale with it.
  let scale = 0;
  for (const p of points) scale = Math.max(scale, Math.abs(p.x - p0.x), Math.abs(p.y - p0.y));
  if (scale === 0) return true;
  const p1 = points.find((p) => p.x !== p0.x || p.y !== p0.y) ?? p0;
  const eps = scale * scale * 1e-9;
  return points.every(
    (p) => Math.abs((p1.x - p0.x) * (p.y - p0.y) - (p1.y - p0.y) * (p.x - p0.x)) <= eps,
  );
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
  // Force the chart to match its container box. NEVER route this through
  // chart.reflow(): Highcharts reflow() silently DROPS the call while a previous
  // setSize is still in flight (chart.isResizing) — and in that branch it also
  // skips updating its cached containerBox, so when the dashboard grid's FINAL
  // resize lands inside that window, no further ResizeObserver event ever comes
  // and the chart stays at the stale size until a full refresh re-creates it at
  // the settled layout. (A chart created while its box measures ≤1px also falls
  // back to Highcharts' 400px default height — the "chart taller than the card"
  // variant.)
  //
  // The container box alone is NOT a trustworthy target, though: an oversized
  // chart can wedge its own flex chain open (anywhere the host resolves a
  // percentage height against an auto-height parent), and then
  // renderTo.clientHeight simply equals the chart's wrong height — the compare
  // says "in sync" and every observer and settle-tail call no-ops forever while
  // the x-axis labels/legend clip at the card edge. Break the circularity with a
  // top-down clamp: the widget root's box comes from the host grid (never from
  // chart content — it's height:100% + overflow:hidden), so the chart may be at
  // most (root inner bottom − plot top − everything below the plot). Explicit
  // px setSize (not undefined/undefined) so Highcharts can't re-derive a wedged
  // measurement back out of the DOM.
  const syncChartSize = useCallback(() => {
    const chart = chartInstanceRef.current as {
      container?: HTMLElement;
      chartWidth?: number;
      chartHeight?: number;
      setSize?: (w?: number, h?: number, anim?: boolean) => void;
    } | null;
    // container = .highcharts-container; its parent is the renderTo div
    // (.fds-line-chart, height:100% of the SDK's flex plot box) — the box the
    // chart is supposed to fill. Gone once the chart is destroyed → no-op.
    const renderTo = chart?.container?.parentElement;
    if (!chart || !renderTo || !renderTo.isConnected) return;
    const w = renderTo.clientWidth;
    let h = renderTo.clientHeight;
    // Skip transient 0/1px boxes mid grid relayout — sizing to them squashes the
    // chart; the ResizeObserver fires again when the box lands on its real size.
    if (w < 2 || h < 2) return;
    const root = containerRef.current;
    if (root && root.contains(renderTo)) {
      const innerBottomOf = (el: Element) => {
        const cs = window.getComputedStyle(el);
        return (
          el.getBoundingClientRect().bottom -
          (parseFloat(cs.borderBottomWidth) || 0) -
          (parseFloat(cs.paddingBottom) || 0)
        );
      };
      let innerBottom = innerBottomOf(root);
      // The root's own bottom is only a trustworthy ceiling while the HOST
      // gives it a definite height. The dashboard host sizes the grid cell on
      // a WRAPPER with overflow:hidden while the widget root resolves
      // height:100% against an auto-height parent — the root then grows WITH
      // the oversized chart, its bottom sits below the cell's crop line, and
      // the clamp sees "plenty of room" forever (the "card cropped at the
      // cell edge below ~500px" bug: Highcharts' 400px default + header +
      // filters). The element doing the cropping is the real ceiling — take
      // the NEAREST overflow hidden/clip ancestor, nearby only (a distant
      // app-shell crop belongs to page layout, not this cell), and clamp to
      // the tighter of the two bounds. Observe it too: with the root
      // content-sized, a later cell resize never fires the root observer.
      for (
        let anc = root.parentElement, depth = 0;
        anc && depth < 4;
        anc = anc.parentElement, depth++
      ) {
        const ov = window.getComputedStyle(anc).overflowY;
        if (ov === 'hidden' || ov === 'clip') {
          innerBottom = Math.min(innerBottom, innerBottomOf(anc));
          resizeObserverRef.current?.observe(anc);
          break;
        }
      }
      // Space reserved below the plot inside the viewport: the DOM legend (and
      // shift legend) are later siblings of .fds-line-chart__plot. Measured
      // live — width is unchanged by a height clamp, so their height is stable.
      let below = 0;
      for (let el = renderTo.parentElement?.nextElementSibling; el; el = el.nextElementSibling) {
        below += (el as HTMLElement).getBoundingClientRect().height;
      }
      // Bottom chrome between the plot and the root — the card's own bottom
      // padding/border on every ancestor in between. Without it the clamp
      // lands ~12px too tall and the legend row stays half-cropped.
      let chrome = 0;
      for (let el = renderTo.parentElement; el && el !== root; el = el.parentElement) {
        const cs = window.getComputedStyle(el);
        chrome += (parseFloat(cs.paddingBottom) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
      }
      const available = Math.floor(
        innerBottom - renderTo.getBoundingClientRect().top - below - chrome,
      );
      // Shrink-only clamp — growth flows through the normal container-box path
      // once the flex chain is healthy, so this can never oscillate.
      if (available >= 2 && available < h - 1) h = available;
    }
    if (Math.abs((chart.chartWidth ?? 0) - w) > 1 || Math.abs((chart.chartHeight ?? 0) - h) > 1) {
      chart.setSize?.(w, h, false);
    }
    // The SDK's DOM legend (LegendPager) measures itself ONCE in a layout
    // effect and re-measures only when its own row resizes. When that first
    // measure lands while the row has a transient near-zero width (host grid
    // mid relayout — exactly when the chart mounts), it wedges into paged mode
    // with a ~1px viewport and two disabled arrows: the legend row looks
    // empty. If the row is back at its real width before its ResizeObserver
    // reports again, nothing ever re-measures — the "legend randomly missing
    // until reload" bug. A paged viewport this narrow can never come from a
    // real measure of a normally sized row, so treat it as the wedge and nudge
    // the row's inline width for one frame; the pager's own observer fires and
    // re-measures against the settled box. No-op when the legend is healthy.
    const legend = root?.querySelector<HTMLElement>('.fds-chart-legend');
    const pagedViewport = legend?.querySelector<HTMLElement>('.fds-legend-pager__viewport') ?? null;
    if (
      legend &&
      pagedViewport &&
      legend.clientWidth > 120 &&
      pagedViewport.clientWidth < 30 &&
      !legend.style.width
    ) {
      legend.style.width = `${legend.clientWidth - 1}px`;
      window.requestAnimationFrame(() => {
        legend.style.width = '';
      });
    }
  }, []);
  // The widget never sees the dashboard grid resizing its container (Highcharts
  // only auto-reflows on WINDOW resize), so observe the container ourselves. Also
  // load-bearing for a second reason: the SDK LineChart's own resize observer
  // attaches ONCE on mount — and on first load the chart mounts showing the
  // status="not-configured" empty state (data not yet arrived), so the plot div
  // doesn't exist, the SDK observer binds to nothing, and it stays dead for the
  // lifetime of the widget. A callback ref (not a useEffect) so it re-targets
  // correctly across the no-source → chart branch swap without running afoul of
  // the early returns' hook order.
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const attachContainer = useCallback((el: HTMLDivElement | null) => {
    containerRef.current = el;
    resizeObserverRef.current?.disconnect();
    resizeObserverRef.current = null;
    if (el && typeof ResizeObserver !== 'undefined') {
      // Defer to the next animation frame: a synchronous read inside the observer
      // callback can see a stale/intermediate box during a grid relayout.
      // Coalesce bursts through a single pending frame — syncChartSize compares
      // before resizing, so redundant fires are free.
      let rafId = 0;
      const ro = new ResizeObserver(() => {
        if (rafId) return;
        rafId = window.requestAnimationFrame(() => {
          rafId = 0;
          syncChartSize();
        });
      });
      ro.observe(el);
      resizeObserverRef.current = ro;
    }
  }, [syncChartSize]);
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
        // The source still renders as an EMPTY series (not dropped) so its legend
        // entry stays visible — a configured source must appear in the legend even
        // while its data hasn't resolved (testing feedback #10).
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
        return { source, points: [] };
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
      return { source, points };
    })
    .filter((e): e is ScatterSeriesEntry => e !== null);

  const hasData = seriesEntries.some((e) => e.points.length > 0);
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
          // The chart may have been created mid grid relayout (or at a ≤1px box,
          // where Highcharts falls back to a 400px default height) — sync now and
          // across the next two frames to land on the settled size.
          syncChartSize();
          window.requestAnimationFrame(() => {
            syncChartSize();
            window.requestAnimationFrame(syncChartSize);
          });
          // Settle tail — catches a host grid/font-load layout that lands after
          // the frame tail above without changing any observed box (each call is
          // a compare-first no-op once the size matches).
          [250, 700, 1500].forEach((ms) => window.setTimeout(syncChartSize, ms));
          // Also watch the canvas box the chart actually sizes against. The root
          // observer above only sees the WIDGET resizing — inner layout shifts at a
          // constant widget size (the DOM legend mounting once data arrives, the
          // filter row wrapping) shrink the canvas without firing it, leaving a
          // too-tall chart whose x-axis title/legend clip at the card edge.
          // observe() also delivers an initial notification, giving one more
          // deferred sync right after chart creation.
          const canvasBox = (instance as { container?: HTMLElement } | null)?.container
            ?.parentElement;
          if (canvasBox) resizeObserverRef.current?.observe(canvasBox);
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
                  `${c.xLabel}: <b>${fmt(ctx.x, c.xPrecision ?? 0)}</b><br/>` +
                  `${c.yLabel ?? 'Y'}: <b>${fmt(ctx.y, c.yPrecision ?? 0)}</b>`
                );
              }
              // Benchmarks and any other non-scatter series.
              return `${ctx.series?.name ?? ''}: <b>${fmt(ctx.y, 0)}</b>`;
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
            ...zoneOverlays.map((zone) =>
              isCollinearZone(zone.points)
                ? {
                    // Collinear vertices = zero-area polygon (paints as a bare
                    // line). Read them as a boundary polyline instead and fill
                    // down to the axis floor so a shaded layer always shows.
                    type: 'area' as const,
                    data: zone.points
                      .map((p) => [p.x, p.y] as [number, number])
                      .sort((a, b) => a[0] - b[0]),
                    color: zone.color,
                    fillColor: hexToRgba(zone.color, 0.15),
                    // null = extend the fill to the Y-axis minimum, not just y=0.
                    threshold: null,
                    lineWidth: 1,
                    enableMouseTracking: false,
                    marker: { enabled: zonePoints, radius: 3, fillColor: zone.color },
                    showInLegend: zoneLegends,
                    zIndex: 0,
                    dataLabels: { enabled: false },
                  }
                : {
                    type: 'polygon' as const,
                    data: zonePolygon(zone.points),
                    // Polygon forces fillColor = series color (see PolygonSeries.drawGraph),
                    // so `color` carries the 15%-opacity fill while `lineColor` keeps the
                    // outline stroke at full strength — the stroke must stay visible.
                    color: hexToRgba(zone.color, 0.15),
                    lineColor: zone.color,
                    lineWidth: 1,
                    enableMouseTracking: false,
                    marker: { enabled: zonePoints, radius: 3, fillColor: zone.color },
                    showInLegend: zoneLegends,
                    zIndex: 0,
                  },
            ),
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
                xPrecision: source.xPrecision ?? 0,
                yPrecision: source.yPrecision ?? 0,
              },
              dataLabels: {
                format: `{point.y:.${source.yPrecision ?? 0}f}`,
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
