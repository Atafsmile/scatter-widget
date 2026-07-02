import { useState, useEffect, useRef } from 'react';
import { DatePicker } from '@faclon-labs/design-sdk/DatePicker';
import { LineChart } from '@faclon-labs/design-sdk/LineChart';
import { exportChart, type ChartExportFormat } from '@faclon-labs/design-sdk/Chart';
import { Tooltip } from '@faclon-labs/design-sdk/Tooltip';
import { Popover } from '@faclon-labs/design-sdk/Popover';
import { IconButton } from '@faclon-labs/design-sdk/IconButton';
import { DropdownMenu, ActionListItem } from '@faclon-labs/design-sdk/DropdownMenu';
import { ChevronDown, Info, Settings, Menu } from 'lucide-react';
import { DataEntry, WidgetEvent, ScatterUIConfig, ScatterChart, ScatterDataSource, ScatterStyling, StylingFontWeight, TimeTabUIConfig } from '../../iosense-sdk/types';
import { getSeriesData } from '../../iosense-sdk/mini-engine';
import { timeConfigMode, computeDurationWindow } from '../../iosense-sdk/time-window';
import { WidgetEmptyState } from '../../iosense-sdk/WidgetEmptyState';
import './Scatter.css';

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
  return (
    <div className="scatter-chart-switcher">
      <div className="scatter-chart-switcher__trigger BodyLargeSemibold" onClick={() => setIsOpen((o) => !o)}>
        {active?.title || 'Scatter'} <ChevronDown size={14} />
      </div>
      {isOpen && (
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
      )}
    </div>
  );
}

function futureMaxMs(tc: TimeTabUIConfig | undefined, now: number): number | null {
  const raw = tc?.futureDaysAllowed;
  if (raw === undefined || raw === null || raw.trim() === '') return null;
  const days = Number(raw);
  return Number.isFinite(days) ? now + days * 86_400_000 : null;
}

function clampToFutureLimit(
  range: { start: Date; end: Date },
  maxMs: number | null,
): { start: Date; end: Date } {
  if (maxMs === null) return range;
  return {
    start: new Date(Math.min(range.start.getTime(), maxMs)),
    end: new Date(Math.min(range.end.getTime(), maxMs)),
  };
}

function formatFixedDurationLabel(tc: TimeTabUIConfig | undefined): string | undefined {
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

  // DatePicker state lives at widget level (not inside a keyed/remounted child) so
  // selection doesn't snap back to default on data-driven remount.
  const [localRange, setLocalRange] = useState<{ start: Date; end: Date } | null>(null);
  const [localPreset, setLocalPreset] = useState<string | undefined>(tc?.defaultDurationId);

  // Patch the DatePicker to the configured default duration whenever the Time tab
  // config actually changes (config only changes on a real configurator edit, never
  // on a data-only re-resolve, so this never clobbers a manual in-widget selection).
  // Previously localRange only ever started at null and was never (re)computed from
  // tc.defaultDurationId, so the picker always showed a blank "Custom" range.
  useEffect(() => {
    if (mode !== 'local') return;
    const preset = tc?.allDurations?.find((d) => d.id === tc?.defaultDurationId);
    if (preset) {
      setLocalPreset(preset.id);
      const { startTime, endTime } = computeDurationWindow(preset, Date.now(), tc?.timezone, tc?.cycleTime);
      setLocalRange({ start: new Date(startTime), end: new Date(endTime) });
      return;
    }
    // No duration configured yet (fresh chart, Time tab never touched) — default to
    // literal calendar "Today" (midnight in the configured timezone → now), computed
    // directly rather than depending on the SDK having already populated its own
    // preset list, so this is correct even before that list exists. Still highlight a
    // matching "Today" preset button if the SDK's list happens to already have one.
    const todayPresetId = tc?.allDurations?.find((d) => d.id?.toLowerCase() === 'today')?.id;
    setLocalPreset(todayPresetId);
    const { startTime, endTime } = computeDurationWindow(
      { navigation: 'Current', x: 0, xPeriod: 'day', xEvent: 'Start', y: 0, yPeriod: 'day', yEvent: 'Now' },
      Date.now(),
      tc?.timezone,
    );
    setLocalRange({ start: new Date(startTime), end: new Date(endTime) });
  }, [config]);

  // Active chart — one of several independent chart panels, switchable via the
  // title-slot dropdown. Declared before any early return (Rules of Hooks).
  const charts = config?.charts ?? [];
  const [activeChartId, setActiveChartId] = useState<string | undefined>(charts[0]?.id);
  useEffect(() => {
    if (!charts.some((c) => c.id === activeChartId)) setActiveChartId(charts[0]?.id);
  }, [config]);

  // Chart Control — view-time-only toggles, not persisted config. Highcharts instance
  // ref feeds exportChart from the Download Type menu.
  const [showLegend, setShowLegend] = useState(true);
  const [showDataLabels, setShowDataLabels] = useState(false);
  const [zoomable, setZoomable] = useState(false);
  const chartInstanceRef = useRef<unknown>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  if (!config) return <NoConfigScreen style={SAFE_STYLING} />;
  if (!isConfigured(config)) return <NoConfigScreen style={style} />;

  const activeChart = charts.find((c) => c.id === activeChartId) ?? charts[0];
  const activeChartIndex = charts.findIndex((c) => c.id === activeChart?.id);

  interface ScatterSeriesEntry {
    source: ScatterDataSource;
    points: Array<[number, number]>;
  }

  const seriesEntries: ScatterSeriesEntry[] = (activeChart?.dataSources ?? [])
    .map((source, j) => {
      if (!source.xField || !source.yField) return null;
      const xSeries = getSeriesData(`charts[${activeChartIndex}].dataSources[${j}].xField`, data);
      const ySeries = getSeriesData(`charts[${activeChartIndex}].dataSources[${j}].yField`, data);
      if (!xSeries || !ySeries || xSeries.slots.length === 0 || ySeries.slots.length === 0) return null;
      const pointCount = Math.min(xSeries.slots.length, ySeries.slots.length);
      const points: Array<[number, number]> = [];
      for (let i = 0; i < pointCount; i++) {
        const xv = xSeries.slots[i].value;
        const yv = ySeries.slots[i].value;
        if (xv !== null && yv !== null) points.push([xv, yv]);
      }
      return points.length > 0 ? { source, points } : null;
    })
    .filter((e): e is ScatterSeriesEntry => e !== null);

  const hasData = seriesEntries.length > 0;

  function handleRangeChange(range: { start: Date; end: Date } | null) {
    if (!range) return;
    const clamped = clampToFutureLimit(range, futureMaxMs(tc, Date.now()));
    // Never clear the preset here — the SDK DatePicker fires onRangeChange right
    // after onPresetSelect for its built-in preset ids; clearing would reset to "Custom".
    setLocalRange(clamped);
    onEvent({
      type: 'TIME_CHANGE',
      payload: {
        startTime: String(clamped.start.getTime()),
        endTime: String(clamped.end.getTime()),
        periodicity: tc?.defaultPeriodicity ?? 'hourly',
      },
    });
  }

  function handlePresetSelect(value: string) {
    setLocalPreset(value);
  }

  const durationSlot =
    mode === 'fixed'
      ? formatFixedDurationLabel(tc)
      : mode === 'global'
        ? formatGlobalDurationLabel(tc)
        : undefined;

  const presets = (tc?.allDurations ?? []).map((d) => ({
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
    <div className="widget-template" style={styleToCssVars(style)} ref={containerRef}>
      <LineChart
        bare={!style.card.wrapInCard}
        title={
          style.hideElements.title
            ? undefined
            : charts.length > 1
              ? <ChartTitleSwitcher charts={charts} activeId={activeChart?.id} onSelect={setActiveChartId} />
              : (activeChart?.title || 'Scatter')
        }
        duration={durationSlot}
        status={hasData ? undefined : 'not-configured'}
        onChartReady={(instance) => { chartInstanceRef.current = instance; }}
        actions={
          <div className="scatter-chart-actions">
            {activeChart?.description && (
              <Tooltip heading={activeChart.title || undefined} bodyText={activeChart.description}>
                <IconButton icon={<Info size={16} />} size="Small" accessibilityLabel="Description" />
              </Tooltip>
            )}
            {style.hideElements.settingsIcon !== true && (
              <Popover
                placement="Bottom"
                className="scatter-chart-control-popover"
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
                    title="Data Labels"
                    selectionType="Multiple"
                    isSelected={showDataLabels}
                    onClick={() => setShowDataLabels((v) => !v)}
                  />
                  <ActionListItem
                    title="Zoom"
                    selectionType="Multiple"
                    isSelected={zoomable}
                    onClick={() => setZoomable((v) => !v)}
                  />
                </DropdownMenu>
              </Popover>
            )}
            {style.hideElements.exportIcon !== true && (
              <Popover
                placement="Bottom"
                className="scatter-chart-export-popover"
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
            )}
          </div>
        }
        categories={[]}
        series={[]}
        showLegend={showLegend}
        showDataLabels={showDataLabels}
        colors={seriesEntries.map(({ source }) => source.color)}
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
          ) : undefined
        }
        highchartsOptions={{
          chart: { type: 'scatter', zooming: { type: zoomable ? 'xy' : undefined } },
          xAxis: {
            type: 'linear',
            title: { text: activeChart?.xAxisLabel || 'X', style: advanced ? { color: style.xAxis.textColor } : undefined },
            labels: { style: advanced ? { color: style.xAxis.textColor } : undefined },
            lineColor: advanced ? style.xAxis.lineColor : undefined,
            gridLineColor: advanced ? style.misc.gridLineColor : undefined,
          },
          yAxis: {
            title: { text: activeChart?.yAxisLabel || 'Y', style: advanced ? { color: style.yAxis.textColor } : undefined },
            labels: { style: advanced ? { color: style.yAxis.textColor } : undefined },
            gridLineColor: advanced ? style.misc.gridLineColor : undefined,
          },
          legend: { itemStyle: advanced ? { color: style.misc.legendTextColor } : undefined },
          series: seriesEntries.map(({ source, points }) => ({
            type: 'scatter' as const,
            name: source.label || 'Series',
            data: points,
            color: source.color,
            dataLabels: advanced
              ? {
                  style: {
                    fontSize: `${style.pointLabel.fontSize}px`,
                    color: style.pointLabel.fontColor,
                    fontWeight: String(fontWeightToCss(style.pointLabel.fontWeight)),
                  },
                }
              : undefined,
          })),
        }}
      />
    </div>
  );
}
