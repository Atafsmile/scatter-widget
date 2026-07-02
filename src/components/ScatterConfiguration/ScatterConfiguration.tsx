import { useState, useEffect, useRef } from 'react';
import type { ComponentProps } from 'react';
import { UNSPathInput } from '@faclon-labs/design-sdk/UNSPathInput';
import { Divider } from '@faclon-labs/design-sdk/Divider';
import { Tabs, TabItem } from '@faclon-labs/design-sdk/Tabs';
import { ColorInput } from '@faclon-labs/design-sdk/ColorPicker';
import { TextInput } from '@faclon-labs/design-sdk/TextInput';
import { Switch } from '@faclon-labs/design-sdk/Switch';
import { Checkbox } from '@faclon-labs/design-sdk/Checkbox';
import { SelectInput } from '@faclon-labs/design-sdk/SelectInput';
import { DropdownMenu, ActionListItem } from '@faclon-labs/design-sdk/DropdownMenu';
import { TimeTabConfiguration } from '@faclon-labs/design-sdk/TimeTabConfiguration';
import { Modal, ModalHeader, ModalBody, ModalFooter, ModalLeadingItem } from '@faclon-labs/design-sdk/Modal';
import { Button } from '@faclon-labs/design-sdk/Button';
import { CounterInput } from '@faclon-labs/design-sdk/CounterInput';
import { IconButton } from '@faclon-labs/design-sdk/IconButton';
import { ListCard } from '@faclon-labs/design-sdk/ListCard';
import { Badge } from '@faclon-labs/design-sdk/Badge';
import { Tooltip } from '@faclon-labs/design-sdk/Tooltip';
import { Plus, Trash2, ChevronDown, ChevronUp, Pencil } from 'lucide-react';
import type { TimeTabUIConfig as SdkTimeTabUIConfig } from '@faclon-labs/design-sdk';
import {
  BindingEntry,
  ScatterEnvelope,
  ScatterUIConfig,
  ScatterChart,
  ScatterDataSource,
  ScatterStyling,
  StylingFontWeight,
  TimeTabUIConfig,
  GTPGlobalTimepicker,
  GTPTimeType,
  GTPCycleTimeConfig,
} from '../../iosense-sdk/types';
import { useUNSTree } from '../../iosense-sdk/useUNSTree';
import type { UNSTree } from '../../iosense-sdk/useUNSTree';
import { computeTimeWindow } from '../../iosense-sdk/time-window';
import { GLOBAL_TIMEPICKER_FALLBACK } from '../../iosense-sdk/global-timepickers';
import './ScatterConfiguration.css';

// GTPGlobalTimepicker isn't a named export anywhere in the package — derive its
// shape structurally from the component's own prop type instead of guessing a path.
type SdkGTPGlobalTimepicker = NonNullable<ComponentProps<typeof TimeTabConfiguration>['globalTimepickers']>[number];

interface ScatterConfigurationProps {
  config: ScatterEnvelope | undefined;
  authentication?: string;
  onChange: (config: ScatterEnvelope) => void;

  // Host supplies the selected dashboard's global timepickers; falls back to a
  // dev-only stand-in when absent.
  globalTimepickers?: GTPGlobalTimepicker[];

  // Angular injection surface — pass all three functional props or none.
  unsTree?: UNSTree;
  isLoadingTree?: boolean;
  onLoadWorkspaces?: () => void;
  resolveUNSValue?: (rawValue: string) => string;
}

const VARIABLE_REGEX = /^\{\{(.+)\}\}$/;

function buildDynamicBindingPathList(
  scanTarget: unknown,
  seriesKeys: string[] = [],
): Array<BindingEntry> {
  const seriesKeySet = new Set(seriesKeys);
  const paths: BindingEntry[] = [];

  function walk(obj: unknown, currentPath: string): void {
    if (obj === null || obj === undefined) return;
    if (typeof obj === 'string') {
      const match = VARIABLE_REGEX.exec(obj.trim());
      if (match) {
        const topic = match[1];
        paths.push(seriesKeySet.has(currentPath) ? { key: currentPath, topic, type: 'series' } : { key: currentPath, topic });
      }
      return;
    }
    if (Array.isArray(obj)) {
      obj.forEach((item, index) => walk(item, `${currentPath}[${index}]`));
      return;
    }
    if (typeof obj === 'object') {
      Object.entries(obj as Record<string, unknown>).forEach(([key, val]) => {
        walk(val, currentPath ? `${currentPath}.${key}` : key);
      });
    }
  }

  walk(scanTarget, '');
  return paths;
}

const FONT_WEIGHTS: StylingFontWeight[] = ['Regular', 'Medium', 'Semi-Bold', 'Bold'];

const DEFAULT_STYLING: ScatterStyling = {
  card: { wrapInCard: true, backgroundColor: '#FFFFFF', borderColor: '#EEEEEE', borderWidth: 1, borderRadius: 8 },
  hideElements: { settingsIcon: false, exportIcon: false, title: false }, // false = visible
  advancedEnabled: false,
  title: { fontSize: 18, fontColor: '#050505', fontWeight: 'Semi-Bold' },
  pointLabel: { fontSize: 12, fontColor: '#050505', fontWeight: 'Regular' },
  xAxis: { textColor: '#050505', dataPointColor: '#050505', lineColor: '#DEE1E3' },
  yAxis: { textColor: '#050505', dataPointColor: '#050505' },
  misc: { gridLineColor: '#DEE1E3', legendTextColor: '#292F2E' },
};

// Merge saved configs against defaults so keys added later never come back undefined.
function normalizeStyling(raw: unknown): ScatterStyling {
  const obj = (raw && typeof raw === 'object') ? (raw as Record<string, any>) : {};
  return {
    ...DEFAULT_STYLING,
    ...obj,
    card: { ...DEFAULT_STYLING.card, ...(obj.card ?? {}), wrapInCard: obj.card?.wrapInCard !== false },
    hideElements: { ...DEFAULT_STYLING.hideElements, ...(obj.hideElements ?? {}) },
    title: { ...DEFAULT_STYLING.title, ...(obj.title ?? {}) },
    pointLabel: { ...DEFAULT_STYLING.pointLabel, ...(obj.pointLabel ?? {}) },
    xAxis: { ...DEFAULT_STYLING.xAxis, ...(obj.xAxis ?? {}) },
    yAxis: { ...DEFAULT_STYLING.yAxis, ...(obj.yAxis ?? {}) },
    misc: { ...DEFAULT_STYLING.misc, ...(obj.misc ?? {}) },
  };
}

// Derives mode from the SDK's `linkTimeWith` (older `timeType` accepted as fallback).
// In Fixed mode, pins the resolved window — the production host fetches with
// startTime/endTime directly and does NOT recompute from fixed.duration. Local/Global
// stay null: they derive their window live (Global's inherited data — duration list,
// timezone, cycleTime — is never stored here, only looked up by id via the
// host-injected `globalTimepickers` list at resolve time).
// `sdkValue` crosses the design-sdk boundary — cast once here rather than maintaining
// a structurally-identical duplicate of the SDK's own TimeTabUIConfig type.
function adoptSdkTimeConfig(sdkValue: SdkTimeTabUIConfig): TimeTabUIConfig {
  const sdk = sdkValue as unknown as TimeTabUIConfig;
  const mode: GTPTimeType = sdk.linkTimeWith ?? sdk.timeType ?? 'local';
  const adopted: TimeTabUIConfig = { ...sdk, linkTimeWith: mode, timeType: mode };

  if (mode === 'fixed') {
    const { startTime, endTime } = computeTimeWindow({ ...adopted, startTime: null, endTime: null });
    adopted.startTime = startTime;
    adopted.endTime = endTime;
  } else {
    adopted.startTime = null;
    adopted.endTime = null;
  }

  return adopted;
}

const DEFAULT_CYCLE_TIME: GTPCycleTimeConfig = {
  cycleTimeType: 'calendar',
  identifier: 'start',
  hour: '00',
  minute: '00',
  dayOfWeek: 0,
  date: '01',
  month: 'January',
  year: '',
};

// Seeds Cycle Time defaults for both the Local (top-level cycleTime) and Fixed
// (fixed.cycleTime) scopes so the accordion isn't blank on a fresh widget, and
// defaults a brand-new widget's picker mode to Local (matches the mode
// adoptSdkTimeConfig itself falls back to once the user interacts with the tab).
function withCycleTimeDefaults(tc?: TimeTabUIConfig): TimeTabUIConfig {
  const base = (tc ?? {}) as TimeTabUIConfig;
  const mode: GTPTimeType = base.linkTimeWith ?? base.timeType ?? 'local';
  return {
    ...base,
    linkTimeWith: mode,
    timeType: mode,
    cycleTime: { ...DEFAULT_CYCLE_TIME, ...(base.cycleTime ?? {}) },
    fixed: {
      ...(base.fixed as object | undefined),
      cycleTime: { ...DEFAULT_CYCLE_TIME, ...(base.fixed?.cycleTime ?? {}) },
    } as TimeTabUIConfig['fixed'],
  };
}

// Switch has no `label` prop in the installed design-sdk version — wrap it with our
// own label row, matching the visual row layout the other design-sdk inputs use.
function LabeledSwitch({
  label,
  isChecked,
  onChange,
}: {
  label: string;
  isChecked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="wt-config__field">
      <span className="wt-config__label BodySmallSemibold">{label}</span>
      <Switch isChecked={isChecked} accessibilityLabel={label} onChange={({ isChecked: v }) => onChange(v)} />
    </div>
  );
}

function FontWeightSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: StylingFontWeight;
  onChange: (v: StylingFontWeight) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <SelectInput label={label} value={value} isOpen={isOpen} onOpenChange={setIsOpen} onClick={() => setIsOpen((o) => !o)}>
      {isOpen && (
        <DropdownMenu>
          {FONT_WEIGHTS.map((w) => (
            <ActionListItem
              key={w}
              title={w}
              selectionType="Single"
              isSelected={value === w}
              onClick={() => {
                onChange(w);
                setIsOpen(false);
              }}
            />
          ))}
        </DropdownMenu>
      )}
    </SelectInput>
  );
}

let dataSourceSeq = 0;
function makeDataSourceId(): string {
  dataSourceSeq += 1;
  return `ds_${Date.now()}_${dataSourceSeq}`;
}

function makeEmptyDataSource(): ScatterDataSource {
  return {
    id: makeDataSourceId(),
    label: '',
    xField: '',
    xPrecision: 2,
    yField: '',
    yPrecision: 2,
    color: '#3B82F6',
    frequency: 60,
  };
}

let chartSeq = 0;
function makeChartId(): string {
  chartSeq += 1;
  return `chart_${Date.now()}_${chartSeq}`;
}

// Sentinel id for a brand-new chart's live WIDGET PREVIEW only — never persisted to
// `charts` state (see previewChartDraft), so it never leaks into a saved envelope.
const DRAFT_PREVIEW_ID = '__draft_preview__';

interface ChartDraft {
  title: string;
  description: string;
  xAxisLabel: string;
  yAxisLabel: string;
}

function makeEmptyChartDraft(): ChartDraft {
  return { title: '', description: '', xAxisLabel: '', yAxisLabel: '' };
}

function chartToDraft(chart: ScatterChart): ChartDraft {
  return { title: chart.title, description: chart.description ?? '', xAxisLabel: chart.xAxisLabel ?? '', yAxisLabel: chart.yAxisLabel ?? '' };
}

// Read-only "Chart Title" doubles as the chart switcher once ≥1 chart is saved and
// nothing is being edited — same SelectInput+DropdownMenu composition as
// FontWeightSelect/FrequencySelect.
function ChartTitlePicker({
  charts,
  activeId,
  onSelect,
}: {
  charts: ScatterChart[];
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const active = charts.find((c) => c.id === activeId);
  return (
    <SelectInput label="Chart Title" value={active?.title ?? ''} isOpen={isOpen} onOpenChange={setIsOpen} onClick={() => setIsOpen((o) => !o)}>
      {isOpen && (
        <DropdownMenu>
          {charts.map((c) => (
            <ActionListItem
              key={c.id}
              title={c.title || 'Untitled chart'}
              selectionType="Single"
              isSelected={c.id === activeId}
              onClick={() => { onSelect(c.id); setIsOpen(false); }}
            />
          ))}
        </DropdownMenu>
      )}
    </SelectInput>
  );
}

// Plain standard TextInput — a real numeric field the user can type into directly,
// no custom combo/dropdown.
function FrequencyInput({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const invalid = value <= 30;
  return (
    <TextInput
      label="Frequency (in sec)"
      type="number"
      isRequired
      necessityIndicator="required"
      placeholder="Enter frequency"
      value={String(value)}
      validationState={invalid ? 'error' : 'none'}
      helpText={invalid ? undefined : 'Frequency must be greater than 30 Sec'}
      errorText={invalid ? 'Frequency must be greater than 30 Sec' : undefined}
      onChange={({ value: v }) => onChange(Number(v) || 0)}
    />
  );
}

// AccordionItem's header has no slot for a trailing "+" action independent of the
// expand toggle, so Data-tab sections use plain custom headers (matching the existing
// .wt-config__section / .wt-config__section-title convention) instead of the SDK Accordion.
function SectionHeader({
  title,
  count,
  isOpen,
  onToggle,
  onAdd,
  addLabel,
  extra,
  showChevron = true,
  isDisabled = false,
}: {
  title: string;
  count?: number;
  isOpen: boolean;
  onToggle?: () => void;
  onAdd?: (e: React.MouseEvent) => void;
  addLabel: string;
  extra?: React.ReactNode;
  showChevron?: boolean;
  isDisabled?: boolean;
}) {
  return (
    <div
      className={`wt-config__section-header${isDisabled ? ' is-disabled' : ''}`}
      onClick={() => onToggle?.()}
    >
      <div className="wt-config__section-header-left">
        <span className="wt-config__section-title BodySmallSemibold">{title}</span>
        {count !== undefined && <Badge size="Small" color="Neutral" label={String(count)} />}
      </div>
      <div className="wt-config__section-header-right">
        {extra}
        {onAdd && (
          <Tooltip bodyText={addLabel}>
            <IconButton
              icon={<Plus size={16} />}
              size="Small"
              isDisabled={isDisabled}
              onClick={onAdd}
              accessibilityLabel={addLabel}
            />
          </Tooltip>
        )}
        {showChevron && (
          <Tooltip bodyText={isOpen ? `Collapse ${title}` : `Expand ${title}`}>
            <IconButton
              icon={isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              size="Small"
              isDisabled={isDisabled}
              onClick={(e) => { e.stopPropagation(); onToggle?.(); }}
              accessibilityLabel={isOpen ? `Collapse ${title}` : `Expand ${title}`}
            />
          </Tooltip>
        )}
      </div>
    </div>
  );
}

function StylingSection({
  value,
  onChange,
}: {
  value: ScatterStyling;
  onChange: (next: ScatterStyling) => void;
}) {
  function update<K extends keyof ScatterStyling>(key: K, patch: Partial<ScatterStyling[K]>) {
    const current = value[key];
    const merged = current && typeof current === 'object' ? { ...current, ...patch } : patch;
    onChange({ ...value, [key]: merged });
  }

  return (
    <>
      <div className="wt-config__section">
        <LabeledSwitch
          label="Wrap Into Card"
          isChecked={value.card.wrapInCard}
          onChange={(wrapInCard) => update('card', { wrapInCard })}
        />
        {value.card.wrapInCard && (
          <>
            <ColorInput
              label="Background Color"
              placeholder="Select color"
              value={value.card.backgroundColor}
              onChange={(backgroundColor) => update('card', { backgroundColor })}
            />
            <ColorInput
              label="Border Color"
              placeholder="Select color"
              value={value.card.borderColor}
              onChange={(borderColor) => update('card', { borderColor })}
            />
            <CounterInput
              label="Border Width"
              leadingLabel="px"
              min={0}
              value={value.card.borderWidth}
              onChange={({ value: v }) => update('card', { borderWidth: v ?? 0 })}
            />
            <CounterInput
              label="Border Radius"
              leadingLabel="px"
              min={0}
              value={value.card.borderRadius}
              onChange={({ value: v }) => update('card', { borderRadius: v ?? 0 })}
            />
          </>
        )}
      </div>

      <Divider variant="Muted" />

      <div className="wt-config__section">
        <span className="wt-config__section-title BodySmallSemibold">Hide Widget Elements</span>
        <Checkbox
          label="Setting Icon"
          checked={value.hideElements.settingsIcon}
          onChange={(e) => update('hideElements', { settingsIcon: e.target.checked })}
        />
        <Checkbox
          label="Export Icon"
          checked={value.hideElements.exportIcon}
          onChange={(e) => update('hideElements', { exportIcon: e.target.checked })}
        />
        <Checkbox
          label="Chart Title"
          checked={value.hideElements.title}
          onChange={(e) => update('hideElements', { title: e.target.checked })}
        />
      </div>

      <Divider variant="Muted" />

      <LabeledSwitch
        label="Advanced Settings"
        isChecked={value.advancedEnabled}
        onChange={(advancedEnabled) => onChange({ ...value, advancedEnabled })}
      />

      {value.advancedEnabled && (
        <>
          <Divider variant="Muted" />

          <div className="wt-config__section">
            <span className="wt-config__section-title BodySmallSemibold">Title</span>
            <CounterInput
              label="Font Size"
              leadingLabel="px"
              min={1}
              value={value.title.fontSize}
              onChange={({ value: v }) => update('title', { fontSize: v ?? value.title.fontSize })}
            />
            <ColorInput
              label="Font Color"
              placeholder="Select color"
              value={value.title.fontColor}
              onChange={(fontColor) => update('title', { fontColor })}
            />
            <FontWeightSelect
              label="Font Weight"
              value={value.title.fontWeight}
              onChange={(fontWeight) => update('title', { fontWeight })}
            />
          </div>

          <Divider variant="Muted" />

          <div className="wt-config__section">
            <span className="wt-config__section-title BodySmallSemibold">Point Label</span>
            <CounterInput
              label="Font Size"
              leadingLabel="px"
              min={1}
              value={value.pointLabel.fontSize}
              onChange={({ value: v }) => update('pointLabel', { fontSize: v ?? value.pointLabel.fontSize })}
            />
            <ColorInput
              label="Font Color"
              placeholder="Select color"
              value={value.pointLabel.fontColor}
              onChange={(fontColor) => update('pointLabel', { fontColor })}
            />
            <FontWeightSelect
              label="Font Weight"
              value={value.pointLabel.fontWeight}
              onChange={(fontWeight) => update('pointLabel', { fontWeight })}
            />
          </div>

          <Divider variant="Muted" />

          <div className="wt-config__section">
            <span className="wt-config__section-title BodySmallSemibold">X Axis</span>
            <ColorInput
              label="Axis Text Color"
              placeholder="Select color"
              value={value.xAxis.textColor}
              onChange={(textColor) => update('xAxis', { textColor })}
            />
            <ColorInput
              label="Axis Data Points"
              placeholder="Select color"
              value={value.xAxis.dataPointColor}
              onChange={(dataPointColor) => update('xAxis', { dataPointColor })}
            />
            <ColorInput
              label="Axis Line Color"
              placeholder="Select color"
              value={value.xAxis.lineColor}
              onChange={(lineColor) => update('xAxis', { lineColor })}
            />
          </div>

          <Divider variant="Muted" />

          <div className="wt-config__section">
            <span className="wt-config__section-title BodySmallSemibold">Y Axis</span>
            <ColorInput
              label="Axis Text Color"
              placeholder="Select color"
              value={value.yAxis.textColor}
              onChange={(textColor) => update('yAxis', { textColor })}
            />
            <ColorInput
              label="Axis Data Points"
              placeholder="Select color"
              value={value.yAxis.dataPointColor}
              onChange={(dataPointColor) => update('yAxis', { dataPointColor })}
            />
          </div>

          <Divider variant="Muted" />

          <div className="wt-config__section">
            <span className="wt-config__section-title BodySmallSemibold">Others</span>
            <ColorInput
              label="Grid Line Color"
              placeholder="Select color"
              value={value.misc.gridLineColor}
              onChange={(gridLineColor) => update('misc', { gridLineColor })}
            />
            <ColorInput
              label="Legend Text Color"
              placeholder="Select color"
              value={value.misc.legendTextColor}
              onChange={(legendTextColor) => update('misc', { legendTextColor })}
            />
          </div>
        </>
      )}
    </>
  );
}

export function ScatterConfiguration(props: ScatterConfigurationProps) {
  const { config, authentication, onChange, globalTimepickers } = props;

  const [activeTab, setActiveTab] = useState<'data' | 'time' | 'style'>('data');

  // Charts — each chart owns its own Chart Settings fields + data sources.
  const [charts, setCharts] = useState<ScatterChart[]>(config?.uiConfig.charts ?? []);
  const [activeChartId, setActiveChartId] = useState<string | null>(charts[0]?.id ?? null);

  // Inline Chart Settings edit state — Save/Cancel committed, mirrors the Data Source
  // add/edit pattern (editingChartId null = adding new) but inline instead of modal.
  const [isEditingChart, setIsEditingChart] = useState<boolean>(charts.length === 0);
  const [editingChartId, setEditingChartId] = useState<string | null>(null);
  const [chartDraft, setChartDraft] = useState<ChartDraft>(
    charts[0] ? chartToDraft(charts[0]) : makeEmptyChartDraft(),
  );

  // Delete confirmation — shared between chart delete and data-source delete.
  const [deleteTarget, setDeleteTarget] = useState<
    { kind: 'chart'; id: string } | { kind: 'dataSource'; id: string } | null
  >(null);

  // Add/Edit Data Source modal — editingSourceId === null means "add new". Operates on
  // the active chart's dataSources.
  const [isSourceModalOpen, setIsSourceModalOpen] = useState(false);
  const [editingSourceId, setEditingSourceId] = useState<string | null>(null);
  const [draftSource, setDraftSource] = useState<ScatterDataSource>(makeEmptyDataSource());

  // Collapsible Data-tab sections.
  const [isDataSourceOpen, setIsDataSourceOpen] = useState(true);
  const [isBenchmarkingOpen, setIsBenchmarkingOpen] = useState(false);
  const [isScatterZoneOpen, setIsScatterZoneOpen] = useState(false);

  // Overlay ref + position (Configurator Overlay Pattern).
  const configRef = useRef<HTMLDivElement>(null);
  const [modalX, setModalX] = useState(0);
  const [modalY, setModalY] = useState(0);

  // The exact envelope object last passed to onChange — lets the resync effect below
  // tell "this config update is just our own echo" apart from a genuine external one.
  const lastEmittedEnvelope = useRef<ScatterEnvelope | null>(null);

  const [styling, setStyling] = useState<ScatterStyling>(normalizeStyling(config?.uiConfig.style));
  const [timeTabConfig, setTimeTabConfig] = useState<TimeTabUIConfig | undefined>(
    withCycleTimeDefaults(config?.uiConfig.timeConfig),
  );

  const effectiveGlobalTimepickers = globalTimepickers ?? GLOBAL_TIMEPICKER_FALLBACK;

  // UNS tree — injected by Angular in production; hook used as fallback in dev harness.
  const hasInjectedUNS =
    props.unsTree !== undefined &&
    props.onLoadWorkspaces !== undefined &&
    props.resolveUNSValue !== undefined;

  const hookResult = useUNSTree(hasInjectedUNS ? undefined : authentication);

  const unsTree         = hasInjectedUNS ? props.unsTree!          : hookResult.unsTree;
  const isLoadingTree   = hasInjectedUNS ? (props.isLoadingTree ?? false) : hookResult.isLoadingTree;
  const loadWorkspaces  = hasInjectedUNS ? props.onLoadWorkspaces! : hookResult.loadWorkspaces;
  const resolveUNSValue = hasInjectedUNS ? props.resolveUNSValue!  : hookResult.resolveUNSValue;

  // `config` echoes straight back as a prop the instant we call onChange (App.tsx's
  // onChange is just setEnvelope) — including for a PREVIEW-only emit while adding a
  // brand-new chart, which assigns config._id for the very first time (undefined →
  // real id) and would otherwise re-trigger this resync, pulling the still-unsaved
  // preview draft back in as if it had been committed. Comparing against the exact
  // envelope reference we last emitted distinguishes "this is just our own echo" from
  // "the host handed us a genuinely different/reloaded config" (e.g. switching to a
  // different saved widget instance), which is the only case this effect should act on.
  useEffect(() => {
    if (!config || config === lastEmittedEnvelope.current) return;
    const nextCharts = config.uiConfig.charts ?? [];
    setCharts(nextCharts);
    const fallback = nextCharts[0] ?? null;
    setActiveChartId(fallback?.id ?? null);
    setChartDraft(fallback ? chartToDraft(fallback) : makeEmptyChartDraft());
    setIsEditingChart(nextCharts.length === 0);
    setEditingChartId(null);
    setStyling(normalizeStyling(config.uiConfig.style));
    setTimeTabConfig(withCycleTimeDefaults(config.uiConfig.timeConfig));
  }, [config]);

  const activeChart = charts.find((c) => c.id === activeChartId);
  const activeChartIndex = charts.findIndex((c) => c.id === activeChartId);
  const dataSources = activeChart?.dataSources ?? [];
  // Data Source / Benchmarking / Scatter Zone stay locked until a chart is saved, and
  // re-lock while Chart Settings is mid-edit (so the section they'd operate on can't
  // shift out from under them).
  const chartScopedSectionsEnabled = charts.length > 0 && !isEditingChart;

  function emit(overrides?: {
    charts?: ScatterChart[];
    styling?: ScatterStyling;
    timeTabConfig?: TimeTabUIConfig;
  }) {
    const resolvedCharts = overrides?.charts ?? charts;
    const resolvedStyling = overrides?.styling ?? styling;
    const resolvedTimeConfig = overrides?.timeTabConfig ?? timeTabConfig;

    const uiConfig: ScatterUIConfig = {
      charts: resolvedCharts,
      timeConfig: resolvedTimeConfig,
      style: resolvedStyling,
    };

    // charts[i].dataSources[j].xField / .yField — one seriesKey pair per data source,
    // nested by chart index then data-source index. title/description/axis labels/
    // label/color/precision/frequency are static and never wrapped in {{}}, so scanning
    // { charts } only picks up literal {{...}} strings regardless of which field.
    const seriesKeys = resolvedCharts.flatMap((chart, i) =>
      chart.dataSources.flatMap((_, j) => [
        `charts[${i}].dataSources[${j}].xField`,
        `charts[${i}].dataSources[${j}].yField`,
      ]),
    );

    const envelope: ScatterEnvelope = {
      _id: config?._id ?? `widget_${Date.now()}`,
      type: 'Scatter',
      general: config?.general ?? { title: '' },
      timeConfig: resolvedTimeConfig,
      uiConfig,
      dynamicBindingPathList: buildDynamicBindingPathList({ charts: resolvedCharts }, seriesKeys),
    };

    lastEmittedEnvelope.current = envelope;
    onChange(envelope);
  }

  function commitCharts(next: ScatterChart[]) {
    setCharts(next);
    emit({ charts: next });
  }

  function openAddChart(e: React.MouseEvent) {
    e.stopPropagation();
    setEditingChartId(null);
    setChartDraft(makeEmptyChartDraft());
    setIsEditingChart(true);
  }

  function openEditChart(id: string) {
    const chart = charts.find((c) => c.id === id);
    if (!chart) return;
    setEditingChartId(id);
    setChartDraft(chartToDraft(chart));
    setIsEditingChart(true);
  }

  function selectChartForView(id: string) {
    if (isEditingChart) return;
    const chart = charts.find((c) => c.id === id);
    if (!chart) return;
    setActiveChartId(id);
    setChartDraft(chartToDraft(chart));
  }

  // Called on every keystroke while editing so the WIDGET reflects changes
  // immediately — but this only re-emits a preview envelope, it never touches the
  // committed `charts` state, so nothing shows up in the chart list/picker (and
  // Data Source stays correctly locked) until Save is actually clicked.
  function updateChartDraftField(patch: Partial<ChartDraft>) {
    setChartDraft((prev) => {
      const next = { ...prev, ...patch };
      previewChartDraft(next);
      return next;
    });
  }

  function previewChartDraft(draft: ChartDraft) {
    const previewCharts = editingChartId
      ? charts.map((c) => (c.id === editingChartId ? { ...c, ...draft } : c))
      : [...charts, { id: DRAFT_PREVIEW_ID, ...draft, dataSources: [] }];
    emit({ charts: previewCharts });
  }

  function cancelChartEdit() {
    // Nothing was ever committed to `charts` during editing — just re-emit the
    // untouched committed array so the widget's live preview reverts.
    emit({ charts });
    const chart = charts.find((c) => c.id === activeChartId) ?? charts[0];
    setChartDraft(chart ? chartToDraft(chart) : makeEmptyChartDraft());
    setIsEditingChart(charts.length === 0);
    setEditingChartId(null);
  }

  function saveChartDraft() {
    if (!chartDraft.title.trim() || !chartDraft.xAxisLabel.trim() || !chartDraft.yAxisLabel.trim()) return;
    let next: ScatterChart[];
    let savedId: string;
    if (editingChartId) {
      savedId = editingChartId;
      next = charts.map((c) => (c.id === editingChartId ? { ...c, ...chartDraft } : c));
    } else {
      savedId = makeChartId();
      next = [...charts, { id: savedId, ...chartDraft, dataSources: [] }];
    }
    commitCharts(next);
    setActiveChartId(savedId);
    setIsEditingChart(false);
    setEditingChartId(null);
  }

  function deleteChart(id: string) {
    const next = charts.filter((c) => c.id !== id);
    commitCharts(next);
    const fallback = next[0] ?? null;
    setActiveChartId(fallback?.id ?? null);
    setChartDraft(fallback ? chartToDraft(fallback) : makeEmptyChartDraft());
    setIsEditingChart(next.length === 0);
    setEditingChartId(null);
  }

  function commitDataSources(nextSources: ScatterDataSource[]) {
    if (activeChartIndex < 0) return;
    const nextCharts = charts.map((c, i) => (i === activeChartIndex ? { ...c, dataSources: nextSources } : c));
    commitCharts(nextCharts);
  }

  function openAddSourceModal(e: React.MouseEvent) {
    e.stopPropagation();
    if (configRef.current) {
      const rect = configRef.current.getBoundingClientRect();
      setModalX(rect.right + 30);
      setModalY(rect.top);
    }
    setEditingSourceId(null);
    setDraftSource(makeEmptyDataSource());
    setIsSourceModalOpen(true);
  }

  function openEditSourceModal(source: ScatterDataSource) {
    if (configRef.current) {
      const rect = configRef.current.getBoundingClientRect();
      setModalX(rect.right + 30);
      setModalY(rect.top);
    }
    setEditingSourceId(source.id);
    setDraftSource({ ...source });
    setIsSourceModalOpen(true);
  }

  function closeSourceModal() {
    setIsSourceModalOpen(false);
  }

  function handleDeleteSource(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    setDeleteTarget({ kind: 'dataSource', id });
  }

  function handleSubmitSource() {
    if (!draftSource.label.trim() || !draftSource.xField.trim() || !draftSource.yField.trim()) return;
    const next = editingSourceId
      ? dataSources.map((s) => (s.id === editingSourceId ? draftSource : s))
      : [...dataSources, draftSource];
    commitDataSources(next);
    setIsSourceModalOpen(false);
  }

  function confirmDelete() {
    if (!deleteTarget) return;
    if (deleteTarget.kind === 'chart') deleteChart(deleteTarget.id);
    else commitDataSources(dataSources.filter((s) => s.id !== deleteTarget.id));
    setDeleteTarget(null);
  }

  function handleStylingChange(next: ScatterStyling) {
    setStyling(next);
    emit({ styling: next });
  }

  function handleTimeChange(value: SdkTimeTabUIConfig) {
    const adopted = adoptSdkTimeConfig(value);
    // The SDK fires onChange once on mount with an unchanged value — dedupe so
    // merely opening the tab doesn't emit a spurious envelope change.
    if (JSON.stringify(adopted) === JSON.stringify(timeTabConfig)) return;
    setTimeTabConfig(adopted);
    emit({ timeTabConfig: adopted });
  }

  return (
    <div className="wt-config" ref={configRef}>
      <div className="wt-config__header">
        <span className="wt-config__title BodyLargeSemibold">Scatter</span>
      </div>

      <Tabs
        variant="Bordered"
        size="Medium"
        isFullWidthTabItem
        value={activeTab}
        onChange={(value) => setActiveTab(value as 'data' | 'time' | 'style')}
      >
        <TabItem value="data" label="Data" />
        <TabItem value="time" label="Time" />
        <TabItem value="style" label="Style" />
      </Tabs>

      <div className="wt-config__body">
        {activeTab === 'data' && (
          <>
            {/* ---- Chart Settings ---- */}
            <div className="wt-config__section">
              <SectionHeader
                title="Chart Settings"
                isOpen
                showChevron={false}
                onAdd={isEditingChart ? undefined : openAddChart}
                addLabel="Add Chart"
                extra={
                  isEditingChart ? (
                    editingChartId ? (
                      <Tooltip bodyText="Delete chart">
                        <IconButton
                          icon={<Trash2 size={16} />}
                          size="Small"
                          style={{ color: 'var(--text-negative-default, #d92d20)' }}
                          onClick={(e) => { e.stopPropagation(); setDeleteTarget({ kind: 'chart', id: editingChartId }); }}
                          accessibilityLabel="Delete chart"
                        />
                      </Tooltip>
                    ) : undefined
                  ) : (
                    <Tooltip bodyText="Edit chart">
                      <IconButton
                        icon={<Pencil size={16} />}
                        size="Small"
                        isDisabled={!activeChartId}
                        onClick={(e) => { e.stopPropagation(); if (activeChartId) openEditChart(activeChartId); }}
                        accessibilityLabel="Edit chart"
                      />
                    </Tooltip>
                  )
                }
              />

              {!isEditingChart && charts.length > 0 ? (
                <ChartTitlePicker charts={charts} activeId={activeChartId} onSelect={selectChartForView} />
              ) : (
                <TextInput
                  label="Chart Title"
                  isRequired
                  necessityIndicator="required"
                  placeholder="Enter chart title"
                  isDisabled={!isEditingChart}
                  value={chartDraft.title}
                  onChange={({ value }) => updateChartDraftField({ title: value })}
                />
              )}
              <TextInput
                label="Chart Description"
                placeholder="Enter description"
                isDisabled={!isEditingChart}
                value={chartDraft.description}
                onChange={({ value }) => updateChartDraftField({ description: value })}
              />
              <TextInput
                label="X Axis Label"
                isRequired
                necessityIndicator="required"
                placeholder="Enter X axis label"
                isDisabled={!isEditingChart}
                value={chartDraft.xAxisLabel}
                onChange={({ value }) => updateChartDraftField({ xAxisLabel: value })}
              />
              <TextInput
                label="Y Axis Label"
                isRequired
                necessityIndicator="required"
                placeholder="Enter Y axis label"
                isDisabled={!isEditingChart}
                value={chartDraft.yAxisLabel}
                onChange={({ value }) => updateChartDraftField({ yAxisLabel: value })}
              />

              {isEditingChart && (
                <div className="wt-config__chart-actions">
                  <Button variant="Gray" label="Cancel" onClick={cancelChartEdit} />
                  <Button variant="Primary" label="Save" onClick={saveChartDraft} />
                </div>
              )}
            </div>

            <Divider variant="Muted" />

            {/* ---- Data Source (scoped to the active chart; locked until one exists) ---- */}
            <div className="wt-config__section">
              <SectionHeader
                title="Data Source"
                count={dataSources.length > 0 ? dataSources.length : undefined}
                isOpen={isDataSourceOpen}
                onToggle={chartScopedSectionsEnabled ? () => setIsDataSourceOpen((o) => !o) : undefined}
                onAdd={chartScopedSectionsEnabled ? openAddSourceModal : undefined}
                showChevron={dataSources.length > 0}
                isDisabled={!chartScopedSectionsEnabled}
                addLabel="Add Data Source"
              />
              {chartScopedSectionsEnabled && isDataSourceOpen && (
                <div className="wt-config__ds-list">
                  {dataSources.length === 0 && (
                    <span className="wt-config__ds-empty BodySmallRegular">No data sources yet — click + to add one.</span>
                  )}
                  {dataSources.map((source, index) => (
                    <ListCard
                      key={source.id}
                      title={source.label || `Data Source ${index + 1}`}
                      leadingItem={<span className="wt-config__ds-swatch" style={{ backgroundColor: source.color }} />}
                      trailingItems={
                        <Tooltip bodyText="Delete">
                          <IconButton
                            icon={<Trash2 size={16} />}
                            size="Small"
                            style={{ color: 'var(--text-negative-default, #d92d20)' }}
                            onClick={(e) => handleDeleteSource(source.id, e)}
                            accessibilityLabel="Delete data source"
                          />
                        </Tooltip>
                      }
                      onClick={() => openEditSourceModal(source)}
                    />
                  ))}
                </div>
              )}
            </div>

            <Divider variant="Muted" />

            {/* ---- Benchmarking (placeholder, locked until a chart exists) ---- */}
            <div className="wt-config__section">
              <SectionHeader
                title="Benchmarking"
                isOpen={isBenchmarkingOpen}
                onToggle={chartScopedSectionsEnabled ? () => setIsBenchmarkingOpen((o) => !o) : undefined}
                onAdd={chartScopedSectionsEnabled ? (e) => e.stopPropagation() : undefined}
                isDisabled={!chartScopedSectionsEnabled}
                addLabel="Add Benchmark"
              />
              {chartScopedSectionsEnabled && isBenchmarkingOpen && (
                <span className="wt-config__ds-empty BodySmallRegular">Coming soon.</span>
              )}
            </div>

            <Divider variant="Muted" />

            {/* ---- Scatter Zone (placeholder, locked until a chart exists) ---- */}
            <div className="wt-config__section">
              <SectionHeader
                title="Scatter Zone"
                isOpen={isScatterZoneOpen}
                onToggle={chartScopedSectionsEnabled ? () => setIsScatterZoneOpen((o) => !o) : undefined}
                onAdd={chartScopedSectionsEnabled ? (e) => e.stopPropagation() : undefined}
                isDisabled={!chartScopedSectionsEnabled}
                addLabel="Add Zone"
              />
              {chartScopedSectionsEnabled && isScatterZoneOpen && (
                <span className="wt-config__ds-empty BodySmallRegular">Coming soon.</span>
              )}
            </div>

            {/* ---- Delete confirmation (shared: chart / data source) ---- */}
            {deleteTarget && (
              <Modal
                isOpen
                size="Small"
                onClose={() => setDeleteTarget(null)}
                header={
                  <ModalHeader
                    title={deleteTarget.kind === 'chart' ? 'Delete chart?' : 'Delete data source?'}
                    leadingItem={
                      <ModalLeadingItem leading="Icon" icon={<Trash2 size={20} />} className="wt-config__delete-icon" />
                    }
                    onClose={() => setDeleteTarget(null)}
                  />
                }
                footer={
                  <ModalFooter
                    primaryAction={<Button variant="Primary" color="Negative" label="Delete" onClick={confirmDelete} />}
                    secondaryAction={<Button variant="Gray" label="Cancel" onClick={() => setDeleteTarget(null)} />}
                  />
                }
              >
                <ModalBody
                  bodyText={
                    deleteTarget.kind === 'chart'
                      ? 'This will permanently remove the active chart and its configuration. Other charts in this widget will not be affected.'
                      : 'This will remove the configured data source and its UNS binding from this chart. You can add a new data source afterwards.'
                  }
                />
              </Modal>
            )}

            {/* ---- Add/Edit Data Source modal (Configurator Overlay Pattern) ---- */}
            {isSourceModalOpen && (
              <Modal
                {...({ transparent: true } as any)}
                isOpen={isSourceModalOpen}
                positionX={modalX}
                positionY={modalY}
                className="wt-config-ds-modal"
                onClose={closeSourceModal}
                header={
                  <ModalHeader
                    title={editingSourceId ? 'Edit Data Source' : 'Add Data Source'}
                    onClose={closeSourceModal}
                  />
                }
                footer={
                  <ModalFooter
                    stacking="Vertical"
                    primaryAction={
                      <Button
                        variant="Primary"
                        label={editingSourceId ? 'Update Source' : 'Add Source'}
                        onClick={handleSubmitSource}
                        isFullWidth
                      />
                    }
                  />
                }
              >
                <ModalBody>
                  <div className="wt-config-ds-modal__body">
                    <TextInput
                      label="Label"
                      isRequired
                      necessityIndicator="required"
                      placeholder="Enter configuration label"
                      value={draftSource.label}
                      onChange={({ value }) => setDraftSource((d) => ({ ...d, label: value }))}
                    />
                    <UNSPathInput
                      label="X Axis UNS Path"
                      placeholder="Type / to browse UNS or paste {{topic}} directly"
                      value={draftSource.xField}
                      tree={unsTree}
                      isLoading={isLoadingTree}
                      onChange={(value: string) => {
                        const resolved = resolveUNSValue(value);
                        setDraftSource((d) => ({ ...d, xField: resolved }));
                      }}
                      onOpen={() => loadWorkspaces()}
                    />
                    <CounterInput
                      label="X Axis Data Precision"
                      value={draftSource.xPrecision}
                      min={0}
                      onChange={({ value }) => setDraftSource((d) => ({ ...d, xPrecision: value ?? 2 }))}
                    />
                    <UNSPathInput
                      label="Y Axis UNS Path"
                      placeholder="Type / to browse UNS or paste {{topic}} directly"
                      value={draftSource.yField}
                      tree={unsTree}
                      isLoading={isLoadingTree}
                      onChange={(value: string) => {
                        const resolved = resolveUNSValue(value);
                        setDraftSource((d) => ({ ...d, yField: resolved }));
                      }}
                      onOpen={() => loadWorkspaces()}
                    />
                    <CounterInput
                      label="Y Axis Data Precision"
                      value={draftSource.yPrecision}
                      min={0}
                      onChange={({ value }) => setDraftSource((d) => ({ ...d, yPrecision: value ?? 2 }))}
                    />
                    <ColorInput
                      label="Scatter Point Color"
                      placeholder="Select color"
                      value={draftSource.color}
                      onChange={(color) => setDraftSource((d) => ({ ...d, color }))}
                    />
                    <FrequencyInput
                      value={draftSource.frequency}
                      onChange={(frequency) => setDraftSource((d) => ({ ...d, frequency }))}
                    />
                  </div>
                </ModalBody>
              </Modal>
            )}
          </>
        )}

        {activeTab === 'time' && (
          <div className="wt-time-tab">
            <TimeTabConfiguration
              mode="series"
              onChange={handleTimeChange}
              value={timeTabConfig as unknown as Partial<SdkTimeTabUIConfig> | undefined}
              globalTimepickers={effectiveGlobalTimepickers as unknown as SdkGTPGlobalTimepicker[]}
            />
          </div>
        )}

        {activeTab === 'style' && <StylingSection value={styling} onChange={handleStylingChange} />}
      </div>
    </div>
  );
}
