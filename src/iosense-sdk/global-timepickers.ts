import { GTPGlobalTimepicker, TimeTabUIConfig } from './types';

// Dev-harness fallback used when the host hasn't injected the selected dashboard's
// global timepickers — lets the Time tab render (and Global mode be selectable)
// even without a real dashboard registry. Production always supplies the real list
// via the `globalTimepickers` prop.
export const GLOBAL_TIMEPICKER_FALLBACK: GTPGlobalTimepicker[] = [
  { id: 'gtp_default', name: 'Default Global Timepicker' },
];

export function linkedGlobalTimepickerId(tc: TimeTabUIConfig | undefined): string | undefined {
  return tc?.global?.globalTimepickerId;
}

export function linkedGlobalTimepicker(
  tc: TimeTabUIConfig | undefined,
  globalTimepickers: GTPGlobalTimepicker[],
): GTPGlobalTimepicker | undefined {
  const id = linkedGlobalTimepickerId(tc);
  if (!id) return undefined;
  return globalTimepickers.find((g) => g.id === id);
}

export function globalDefaultDuration(gtp: GTPGlobalTimepicker | undefined) {
  if (!gtp) return undefined;
  return gtp.allDurations?.find((d) => d.id === gtp.defaultDurationId);
}
