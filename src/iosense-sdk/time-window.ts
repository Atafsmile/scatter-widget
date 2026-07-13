import {
  TimeTabUIConfig,
  GTPPreset,
  GTPCycleTimeConfig,
  GTPGlobalTimepicker,
  GTPPeriod,
  GTPEvent,
  GTPNavigation,
  GTPTimeType,
} from './types';

// ---------------------------------------------------------------------------
// Timezone-aware wall-clock <-> epoch-ms conversion via Intl.
// The mini-engine host runs on UTC, so naive `Date` field math would snap
// "start of day" on the wrong calendar day for any non-UTC widget timezone.
// ---------------------------------------------------------------------------

interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;   // 1-31
  hour: number;  // 0-23
  minute: number;
  second: number;
}

function getTimeZoneOffsetMs(ms: number, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const map: Record<string, string> = {};
  for (const part of dtf.formatToParts(new Date(ms))) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }
  const asUtc = Date.UTC(
    Number(map.year), Number(map.month) - 1, Number(map.day),
    Number(map.hour), Number(map.minute), Number(map.second),
  );
  return asUtc - ms;
}

function getZonedParts(ms: number, timeZone: string): ZonedParts & { weekday: number } {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short',
  });
  const map: Record<string, string> = {};
  for (const part of dtf.formatToParts(new Date(ms))) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }
  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return {
    year: Number(map.year), month: Number(map.month), day: Number(map.day),
    hour: Number(map.hour), minute: Number(map.minute), second: Number(map.second),
    weekday: WEEKDAYS.indexOf(map.weekday),
  };
}

// Field values may be out-of-range (e.g. month: 13) — Date.UTC normalizes them,
// which is exactly what addPeriods() below relies on for calendar-aware stepping.
function zonedPartsToUtcMs(parts: ZonedParts, timeZone: string): number {
  const guess = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  const offset = getTimeZoneOffsetMs(guess, timeZone);
  return guess - offset;
}

function addPeriods(ms: number, period: GTPPeriod, count: number, tz: string): number {
  const p = getZonedParts(ms, tz);
  const base: ZonedParts = { year: p.year, month: p.month, day: p.day, hour: p.hour, minute: p.minute, second: p.second };
  switch (period) {
    case 'minute': return zonedPartsToUtcMs({ ...base, minute: base.minute + count }, tz);
    case 'hour':   return zonedPartsToUtcMs({ ...base, hour: base.hour + count }, tz);
    case 'day':    return zonedPartsToUtcMs({ ...base, day: base.day + count }, tz);
    case 'week':   return zonedPartsToUtcMs({ ...base, day: base.day + count * 7 }, tz);
    case 'month':  return zonedPartsToUtcMs({ ...base, month: base.month + count }, tz);
    case 'year':   return zonedPartsToUtcMs({ ...base, year: base.year + count }, tz);
    default:       return ms;
  }
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Calendar Year → January. Financial Year → April (the common IN/UK FY start).
// Custom → the picked month.
function cycleYearStartMonth(cycleTime: GTPCycleTimeConfig | undefined): number {
  if (!cycleTime) return 1;
  if (cycleTime.cycleTimeType === 'financial') return 4;
  if (cycleTime.cycleTimeType === 'custom') {
    const idx = MONTH_NAMES.indexOf(cycleTime.month);
    return idx >= 0 ? idx + 1 : 1;
  }
  return 1;
}

// `identifier: 'start' | 'end'` only changes how the user framed the configured
// time (“the day starts at 06:00” vs “the day ends at 06:00”) — both describe the
// same modular boundary point, so it doesn't change the computed anchor itself.
function startOfPeriod(
  ms: number,
  period: GTPPeriod,
  tz: string,
  cycleTime: GTPCycleTimeConfig | undefined,
): number {
  const p = getZonedParts(ms, tz);
  const anchorHour = cycleTime ? Number(cycleTime.hour) || 0 : 0;
  const anchorMinute = cycleTime ? Number(cycleTime.minute) || 0 : 0;

  switch (period) {
    case 'minute':
      return zonedPartsToUtcMs({ year: p.year, month: p.month, day: p.day, hour: p.hour, minute: p.minute, second: 0 }, tz);
    case 'hour':
      return zonedPartsToUtcMs({ year: p.year, month: p.month, day: p.day, hour: p.hour, minute: 0, second: 0 }, tz);
    case 'day': {
      let candidate = zonedPartsToUtcMs({ year: p.year, month: p.month, day: p.day, hour: anchorHour, minute: anchorMinute, second: 0 }, tz);
      if (candidate > ms) candidate = addPeriods(candidate, 'day', -1, tz);
      return candidate;
    }
    case 'week': {
      const anchorDow = cycleTime?.dayOfWeek ?? 0;
      let candidate = zonedPartsToUtcMs({ year: p.year, month: p.month, day: p.day, hour: anchorHour, minute: anchorMinute, second: 0 }, tz);
      const diff = (getZonedParts(candidate, tz).weekday - anchorDow + 7) % 7;
      if (diff > 0) candidate = addPeriods(candidate, 'day', -diff, tz);
      if (candidate > ms) candidate = addPeriods(candidate, 'week', -1, tz);
      return candidate;
    }
    case 'month': {
      const anchorDate = cycleTime ? Number(cycleTime.date) || 1 : 1;
      let candidate = zonedPartsToUtcMs({ year: p.year, month: p.month, day: anchorDate, hour: anchorHour, minute: anchorMinute, second: 0 }, tz);
      if (candidate > ms) candidate = addPeriods(candidate, 'month', -1, tz);
      return candidate;
    }
    case 'year': {
      const anchorMonth = cycleYearStartMonth(cycleTime);
      const anchorDate = cycleTime ? Number(cycleTime.date) || 1 : 1;
      let candidate = zonedPartsToUtcMs({ year: p.year, month: anchorMonth, day: anchorDate, hour: anchorHour, minute: anchorMinute, second: 0 }, tz);
      if (candidate > ms) candidate = addPeriods(candidate, 'year', -1, tz);
      return candidate;
    }
    default:
      return ms;
  }
}

function endOfPeriod(
  ms: number,
  period: GTPPeriod,
  tz: string,
  cycleTime: GTPCycleTimeConfig | undefined,
): number {
  return addPeriods(startOfPeriod(ms, period, tz, cycleTime), period, 1, tz);
}

function resolveBound(
  referenceMs: number,
  count: number | undefined,
  period: GTPPeriod | undefined,
  event: GTPEvent | undefined,
  direction: -1 | 0 | 1,
  tz: string,
  cycleTime: GTPCycleTimeConfig | undefined,
): number {
  const p = period ?? 'day';
  const shifted = addPeriods(referenceMs, p, direction * (count ?? 0), tz);
  switch (event) {
    case 'Now': return shifted;
    case 'End': return endOfPeriod(shifted, p, tz, cycleTime);
    case 'Start':
    default: return startOfPeriod(shifted, p, tz, cycleTime);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface DurationExpr {
  navigation?: GTPNavigation;
  x?: number;
  xPeriod?: GTPPeriod;
  xEvent?: GTPEvent;
  y?: number;
  yPeriod?: GTPPeriod;
  yEvent?: GTPEvent;
}

export function timeConfigMode(tc: TimeTabUIConfig | undefined): GTPTimeType {
  const mode = tc?.linkTimeWith ?? tc?.timeType ?? 'local';
  return mode === 'fixed' || mode === 'global' ? mode : 'local';
}

// The SDK's TimeTabConfiguration only materializes its preset list once it MOUNTS
// (i.e. the user opens the Time tab) — a widget configured without ever visiting
// Time has an empty tc.allDurations. That breaks two consumers:
//   1. The widget's DatePicker has no presets to list and nothing to highlight.
//   2. The HOST DataLayer computes its fetch window by looking up defaultDurationId
//      in allDurations and reading the preset's duration expression WITHOUT a guard
//      — every query then dies with "Cannot read properties of undefined (reading
//      'xPeriod')".
// These mirror the SDK's built-in calendar presets ID-FOR-ID (verified against
// TimeTabConfiguration's own list), so envelopes seeded with them round-trip
// cleanly: on reload the Time tab absorbs them as its built-in selections instead
// of duplicating them. Superseded the instant the user touches the Time tab.
export const DEFAULT_LOCAL_DURATIONS: GTPPreset[] = [
  { id: 'today', label: 'Today', calendarType: 'today', isBuiltIn: true, navigation: 'Current', x: 0, xPeriod: 'day', xEvent: 'Start', y: 0, yPeriod: 'day', yEvent: 'Now' },
  { id: 'yesterday', label: 'Yesterday', calendarType: 'yesterday', isBuiltIn: true, navigation: 'Previous', x: 1, xPeriod: 'day', xEvent: 'Start', y: 1, yPeriod: 'day', yEvent: 'End' },
  { id: 'current_week', label: 'Current Week', calendarType: 'current_week', isBuiltIn: true, navigation: 'Current', x: 0, xPeriod: 'week', xEvent: 'Start', y: 0, yPeriod: 'week', yEvent: 'Now' },
  { id: 'previous_7_days', label: 'Previous 7 Days', isBuiltIn: true, navigation: 'Previous', x: 7, xPeriod: 'day', xEvent: 'Start', y: 0, yPeriod: 'day', yEvent: 'Now' },
  { id: 'current_month', label: 'Current Month', calendarType: 'current_month', isBuiltIn: true, navigation: 'Current', x: 0, xPeriod: 'month', xEvent: 'Start', y: 0, yPeriod: 'month', yEvent: 'Now' },
  { id: 'previous_month', label: 'Previous Month', calendarType: 'previous_month', isBuiltIn: true, navigation: 'Previous', x: 1, xPeriod: 'month', xEvent: 'Start', y: 1, yPeriod: 'month', yEvent: 'End' },
  { id: 'previous_3_month', label: 'Previous 3 Month', isBuiltIn: true, navigation: 'Previous', x: 3, xPeriod: 'month', xEvent: 'Start', y: 0, yPeriod: 'month', yEvent: 'Now' },
  { id: 'previous_12_month', label: 'Previous 12 Month', isBuiltIn: true, navigation: 'Previous', x: 12, xPeriod: 'month', xEvent: 'Start', y: 0, yPeriod: 'month', yEvent: 'Now' },
  { id: 'current_year', label: 'Current Year', calendarType: 'current_year', isBuiltIn: true, navigation: 'Current', x: 0, xPeriod: 'year', xEvent: 'Start', y: 0, yPeriod: 'year', yEvent: 'Now' },
  { id: 'previous_year', label: 'Previous Year', calendarType: 'previous_year', isBuiltIn: true, navigation: 'Previous', x: 1, xPeriod: 'year', xEvent: 'Start', y: 1, yPeriod: 'year', yEvent: 'End' },
];

// A duration is a RELATIVE expression, never absolute timestamps: start bound
// (x, xPeriod, xEvent) + end bound (y, yPeriod, yEvent), each resolved from `nowMs`.
// `navigation` is the DIRECTION of the x/y offsets, not an extra shift: the SDK's
// built-in presets encode "Yesterday" as { navigation: Previous, x: 1 day Start,
// y: 1 day End } and "Previous Month" as { Previous, x: 1 month Start, y: 1 month
// End } — the offsets already position the window fully. Shifting again by the
// window span (the old behaviour) returned "Today" as yesterday and pinned the
// Fixed picker's default month one month too early.
export function computeDurationWindow(
  expr: DurationExpr | GTPPreset,
  nowMs: number,
  tz: string = 'UTC',
  cycleTime?: GTPCycleTimeConfig,
): { startTime: number; endTime: number } {
  const nav = expr.navigation ?? 'Previous';
  const direction = nav === 'Next' ? 1 : nav === 'Current' ? 0 : -1;
  let startTime = resolveBound(nowMs, expr.x, expr.xPeriod, expr.xEvent, direction, tz, cycleTime);
  let endTime = resolveBound(nowMs, expr.y, expr.yPeriod, expr.yEvent, direction, tz, cycleTime);
  if (endTime < startTime) {
    const tmp = startTime;
    startTime = endTime;
    endTime = tmp;
  }
  return { startTime, endTime };
}

export function computeTimeWindow(
  tc: TimeTabUIConfig | undefined,
  override?: { startTime: number; endTime: number },
  nowMs: number = Date.now(),
  globalTimepickers: GTPGlobalTimepicker[] = [],
): { startTime: number; endTime: number } {
  if (override) return override;
  if (!tc) return { startTime: nowMs - 86_400_000, endTime: nowMs };

  const mode = timeConfigMode(tc);

  if (mode === 'fixed') {
    // Pinned at save time by adoptSdkTimeConfig — the host fetches with this
    // directly, never recomputing from fixed.duration.
    if (tc.startTime != null && tc.endTime != null) {
      return { startTime: tc.startTime, endTime: tc.endTime };
    }
    const fixed = tc.fixed;
    if (fixed?.duration) {
      const tz = fixed.timezone || tc.timezone || 'UTC';
      const d = fixed.duration;
      return computeDurationWindow(
        {
          navigation: d.navigation,
          x: d.x !== '' ? Number(d.x) : undefined,
          xPeriod: d.xPeriod,
          xEvent: d.xEvent,
          y: d.y !== '' ? Number(d.y) : undefined,
          yPeriod: d.yPeriod,
          yEvent: d.yEvent,
        },
        nowMs, tz, fixed.cycleTime,
      );
    }
    return { startTime: nowMs - 86_400_000, endTime: nowMs };
  }

  if (mode === 'global') {
    const linked = globalTimepickers.find((g) => g.id === tc.global?.globalTimepickerId);
    const preset = linked?.allDurations?.find((d) => d.id === linked.defaultDurationId);
    if (linked && preset) {
      return computeDurationWindow(preset, nowMs, linked.timezone ?? tc.timezone, linked.cycleTime);
    }
    // Unresolved global link (dev harness, or picker removed) — fall back to local default.
  }

  // local (and the global fallback above)
  const preset = tc.allDurations?.find((d) => d.id === tc.defaultDurationId);
  if (preset) return computeDurationWindow(preset, nowMs, tc.timezone, tc.cycleTime);
  return { startTime: nowMs - 86_400_000, endTime: nowMs };
}
