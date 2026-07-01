import { useState, useEffect } from 'react';
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
import type { TimeTabUIConfig as SdkTimeTabUIConfig } from '@faclon-labs/design-sdk';
import {
  BindingEntry,
  ScatterEnvelope,
  ScatterUIConfig,
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
// (fixed.cycleTime) scopes so the accordion isn't blank on a fresh widget.
function withCycleTimeDefaults(tc?: TimeTabUIConfig): TimeTabUIConfig {
  const base = (tc ?? {}) as TimeTabUIConfig;
  return {
    ...base,
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

// Coerces the TextInput's raw string value ('' when cleared) to a number.
function toPx(raw: string, fallback: number): number {
  if (raw.trim() === '') return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
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
            <TextInput
              label="Border Width"
              type="number"
              labelPosition="top"
              suffix="px"
              value={String(value.card.borderWidth)}
              onChange={({ value: v }) => update('card', { borderWidth: toPx(v, value.card.borderWidth) })}
            />
            <TextInput
              label="Border Radius"
              type="number"
              labelPosition="top"
              suffix="px"
              value={String(value.card.borderRadius)}
              onChange={({ value: v }) => update('card', { borderRadius: toPx(v, value.card.borderRadius) })}
            />
          </>
        )}
      </div>

      <Divider variant="Muted" />

      <div className="wt-config__section">
        <span className="wt-config__section-title BodySmallSemibold">Hide Widget Element</span>
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
          label="Title"
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
            <TextInput
              label="Font Size"
              type="number"
              labelPosition="top"
              suffix="px"
              value={String(value.title.fontSize)}
              onChange={({ value: v }) => update('title', { fontSize: toPx(v, value.title.fontSize) })}
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
            <TextInput
              label="Font Size"
              type="number"
              labelPosition="top"
              suffix="px"
              value={String(value.pointLabel.fontSize)}
              onChange={({ value: v }) => update('pointLabel', { fontSize: toPx(v, value.pointLabel.fontSize) })}
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
  const [xField, setXField] = useState<string>(config?.uiConfig.xField ?? '');
  const [yField, setYField] = useState<string>(config?.uiConfig.yField ?? '');
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

  useEffect(() => {
    if (!config) return;
    setXField(config.uiConfig.xField ?? '');
    setYField(config.uiConfig.yField ?? '');
    setStyling(normalizeStyling(config.uiConfig.style));
    setTimeTabConfig(withCycleTimeDefaults(config.uiConfig.timeConfig));
  }, [config?._id]);

  function emit(overrides?: {
    xField?: string;
    yField?: string;
    styling?: ScatterStyling;
    timeTabConfig?: TimeTabUIConfig;
  }) {
    const resolvedXField = overrides?.xField ?? xField;
    const resolvedYField = overrides?.yField ?? yField;
    const resolvedStyling = overrides?.styling ?? styling;
    const resolvedTimeConfig = overrides?.timeTabConfig ?? timeTabConfig;

    const uiConfig: ScatterUIConfig = {
      xField: resolvedXField,
      yField: resolvedYField,
      timeConfig: resolvedTimeConfig,
      style: resolvedStyling,
    };

    const envelope: ScatterEnvelope = {
      _id: config?._id ?? `widget_${Date.now()}`,
      type: 'Scatter',
      general: config?.general ?? { title: '' },
      timeConfig: resolvedTimeConfig,
      uiConfig,
      // Only the data-source fields are ever scanned — style/time are static, never bindable.
      dynamicBindingPathList: buildDynamicBindingPathList(
        { xField: resolvedXField, yField: resolvedYField },
        ['xField', 'yField'],
      ),
    };

    onChange(envelope);
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
    <div className="wt-config">
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
            <UNSPathInput
              label="X Field"
              placeholder="Type / to browse UNS or paste {{topic}} directly"
              value={xField}
              tree={unsTree}
              isLoading={isLoadingTree}
              onChange={(value: string) => {
                const resolved = resolveUNSValue(value);
                setXField(resolved);
                emit({ xField: resolved });
              }}
              onOpen={() => loadWorkspaces()}
            />
            <UNSPathInput
              label="Y Field"
              placeholder="Type / to browse UNS or paste {{topic}} directly"
              value={yField}
              tree={unsTree}
              isLoading={isLoadingTree}
              onChange={(value: string) => {
                const resolved = resolveUNSValue(value);
                setYField(resolved);
                emit({ yField: resolved });
              }}
              onOpen={() => loadWorkspaces()}
            />
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
