import { ScatterEnvelope, ScatterUIConfig, DataEntry, SeriesPayload, GTPGlobalTimepicker } from './types';
import { resolveAndCompute } from './api';
import { computeTimeWindow } from './time-window';

interface MiniEngineCtx {
  authentication: string;
  override?: { startTime: number; endTime: number };
  // Host-injected dashboard timepicker list — required to resolve a Global-mode
  // window (the envelope only stores the link id, never the inherited data).
  globalTimepickers?: GTPGlobalTimepicker[];
}

export async function resolve(
  envelope: ScatterEnvelope,
  ctx: MiniEngineCtx,
): Promise<{ config: ScatterUIConfig; data: DataEntry[]; error: boolean }> {
  const { startTime, endTime } = computeTimeWindow(
    envelope.timeConfig,
    ctx.override,
    Date.now(),
    ctx.globalTimepickers ?? [],
  );
  const bindings = envelope.dynamicBindingPathList ?? [];

  if (bindings.length === 0) return { config: envelope.uiConfig, data: [], error: false };

  const UNS_TOPIC_RE = /^uns:[^/]+:\/\//;
  const validBindings = bindings.filter(({ topic }) => {
    if (!UNS_TOPIC_RE.test(topic)) {
      console.error(
        `[MiniEngine] Invalid topic format: "${topic}". ` +
        `Expected "uns:wsId://path". ` +
        `Check that Angular's resolveUNSValue returns {{uns:wsId://path}} ` +
        `and that this.meta is keyed by workspace NAME.`
      );
      return false;
    }
    return true;
  });

  // A malformed binding is a configuration problem, not a fetch failure — still
  // resolves to an empty (non-error) result, matching an empty API response.
  if (validBindings.length === 0 && bindings.length > 0) {
    return { config: envelope.uiConfig, data: [], error: false };
  }

  try {
    const items = await resolveAndCompute(
      ctx.authentication,
      validBindings.map((binding) =>
        'type' in binding && binding.type === 'series'
          ? { key: binding.key, topic: binding.topic, type: 'series' as const }
          : { key: binding.key, topic: binding.topic }
      ),
      startTime,
      endTime,
    );
    const data: DataEntry[] = items.map((item) => ({ key: item.key, value: item.value }));
    return { config: envelope.uiConfig, data, error: false };
  } catch {
    // error:true ONLY when resolveAndCompute itself throws — an empty data
    // array from a successful call is NOT an error, just "no data yet".
    return { config: envelope.uiConfig, data: [], error: true };
  }
}

export function getSeriesData(key: string, data: DataEntry[]): SeriesPayload | null {
  const entry = data.find((d) => d.key === key);
  if (!entry) return null;
  const v = entry.value;
  if (v !== null && typeof v === 'object' && (v as SeriesPayload).__type === 'series') {
    return v as SeriesPayload;
  }
  return null;
}

