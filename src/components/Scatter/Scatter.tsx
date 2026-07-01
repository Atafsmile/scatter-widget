import { useState } from 'react';
import { DatePicker } from '@faclon-labs/design-sdk/DatePicker';
import { LineChart } from '@faclon-labs/design-sdk/LineChart';
import { DataEntry, WidgetEvent, ScatterUIConfig, ScatterStyling, StylingFontWeight, TimeTabUIConfig } from '../../iosense-sdk/types';
import { getSeriesData } from '../../iosense-sdk/mini-engine';
import { timeConfigMode } from '../../iosense-sdk/time-window';
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

function isConfigured(config: ScatterUIConfig | undefined): boolean {
  return Boolean(config?.xField && config?.yField);
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

function NoDataScreen({ style }: { style: ScatterStyling }) {
  return (
    <div className="widget-template widget-template__empty" style={styleToCssVars(style)}>
      <WidgetEmptyState state="data-not-available" />
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

  if (!config) return <NoConfigScreen style={SAFE_STYLING} />;
  if (!isConfigured(config)) return <NoConfigScreen style={style} />;

  const xSeries = getSeriesData('xField', data);
  const ySeries = getSeriesData('yField', data);

  if (!xSeries || !ySeries || xSeries.slots.length === 0 || ySeries.slots.length === 0) {
    return <NoDataScreen style={style} />;
  }

  const pointCount = Math.min(xSeries.slots.length, ySeries.slots.length);
  const points: Array<[number, number]> = [];
  for (let i = 0; i < pointCount; i++) {
    const xv = xSeries.slots[i].value;
    const yv = ySeries.slots[i].value;
    if (xv !== null && yv !== null) points.push([xv, yv]);
  }

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

  return (
    <div className="widget-template" style={styleToCssVars(style)}>
      <LineChart
        bare={!style.card.wrapInCard}
        title={style.hideElements.title ? undefined : 'Scatter'}
        duration={durationSlot}
        showSettings={style.hideElements.settingsIcon !== true}
        showInfo={false}
        showMore={style.hideElements.exportIcon !== true}
        categories={[]}
        series={[]}
        showLegend
        colors={[advanced ? style.xAxis.dataPointColor : SAFE_STYLING.xAxis.dataPointColor]}
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
          chart: { type: 'scatter' },
          xAxis: {
            type: 'linear',
            title: { text: 'X', style: advanced ? { color: style.xAxis.textColor } : undefined },
            labels: { style: advanced ? { color: style.xAxis.textColor } : undefined },
            lineColor: advanced ? style.xAxis.lineColor : undefined,
            gridLineColor: advanced ? style.misc.gridLineColor : undefined,
          },
          yAxis: {
            title: { text: 'Y', style: advanced ? { color: style.yAxis.textColor } : undefined },
            labels: { style: advanced ? { color: style.yAxis.textColor } : undefined },
            gridLineColor: advanced ? style.misc.gridLineColor : undefined,
          },
          legend: { itemStyle: advanced ? { color: style.misc.legendTextColor } : undefined },
          series: [
            {
              type: 'scatter',
              name: 'X vs Y',
              data: points,
              color: advanced ? style.xAxis.dataPointColor : undefined,
              dataLabels: advanced
                ? {
                    style: {
                      fontSize: `${style.pointLabel.fontSize}px`,
                      color: style.pointLabel.fontColor,
                      fontWeight: String(fontWeightToCss(style.pointLabel.fontWeight)),
                    },
                  }
                : undefined,
            },
          ],
        }}
      />
    </div>
  );
}
