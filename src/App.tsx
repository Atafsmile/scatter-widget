import { useState, useEffect } from 'react';
import { Scatter } from './components/Scatter/Scatter';
import { ScatterConfiguration } from './components/ScatterConfiguration/ScatterConfiguration';
import { ScatterEnvelope, DataEntry, WidgetEvent } from './iosense-sdk/types';
import { validateSSOToken } from './iosense-sdk/api';
import { resolve } from './iosense-sdk/mini-engine';
import { WidgetEmptyState } from './iosense-sdk/WidgetEmptyState';
import { GLOBAL_TIMEPICKER_FALLBACK } from './iosense-sdk/global-timepickers';
import { Button } from '@faclon-labs/design-sdk/Button';
import '@faclon-labs/design-sdk/styles.css';
import './App.css';

// The dev harness stands in for the host — in production the dashboard injects the
// real list. Same list is handed to the configurator (so Global mode is selectable)
// and to the mini-engine (so it can resolve a linked Global window).
const globalTimepickers = GLOBAL_TIMEPICKER_FALLBACK;

export default function App() {
  const [envelope, setEnvelope] = useState<ScatterEnvelope | undefined>(undefined);
  const [data, setData] = useState<DataEntry[]>([]);
  const [fetchError, setFetchError] = useState(false);
  const [auth, setAuth] = useState<string>(localStorage.getItem('bearer_token') ?? '');
  const [timeOverride, setTimeOverride] = useState<{ startTime: number; endTime: number } | undefined>(undefined);
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ssoToken = params.get('token');
    if (ssoToken && !auth) {
      validateSSOToken(ssoToken)
        .then((jwt) => {
          if (jwt) {
            localStorage.setItem('bearer_token', jwt);
            setAuth(jwt);
            const url = new URL(window.location.href);
            url.searchParams.delete('token');
            window.history.replaceState({}, '', url.toString());
          }
        })
        .catch(console.error);
    }
  }, []);

  useEffect(() => {
    if (!envelope || !auth) return;
    console.log('[App] resolving envelope:', envelope.dynamicBindingPathList, 'override:', timeOverride);
    resolve(envelope, { authentication: auth, override: timeOverride, globalTimepickers }).then(({ data: resolved, error }) => {
      console.log('[App] resolved data:', resolved, 'error:', error);
      setData(resolved);
      setFetchError(error);
    });
  }, [envelope, auth, timeOverride, retryTick]);

  function handleEvent(event: WidgetEvent) {
    console.log('[Widget Event]', event);
    if (event.type === 'TIME_CHANGE') {
      setTimeOverride({
        startTime: Number(event.payload.startTime),
        endTime: Number(event.payload.endTime),
      });
    }
  }

  return (
    <div className="app">
      <div className="app__config">
        <ScatterConfiguration
          config={envelope}
          authentication={auth}
          onChange={setEnvelope}
          globalTimepickers={globalTimepickers}
        />
      </div>
      <div className="app__widget">
        {!envelope ? (
          <WidgetEmptyState state="widget-not-configured" />
        ) : fetchError ? (
          <WidgetEmptyState
            state="something-went-wrong"
            primaryAction={
              <Button variant="Primary" onClick={() => setRetryTick((t) => t + 1)}>
                Retry
              </Button>
            }
          />
        ) : (
          <Scatter config={envelope.uiConfig} data={data} onEvent={handleEvent} />
        )}
      </div>
    </div>
  );
}
