/**
 * The handset hook (design sections 5, 7). The only place that touches transports and the
 * clock. The effect-running part is `executePlan`, a plain async function with no React.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { SendRequest, ServerConfig } from '../../shared/api';
import { handsetConfig } from '../config/handset-config';
import { loadFixtures } from '../fixtures/loader';
import type { Fixture } from '../fixtures/schema';
import { LiveTransport, readTokenFromHash } from '../transport/live';
import { ScriptedTransport } from '../transport/scripted';
import { TransportError, type HandsetTransport, type TransportErrorKind } from '../transport/types';
import { planForAction, type Plan } from './plan';
import { initialState, reduce, type HandsetAction, type HandsetState, type Mode } from './reducer';
import { selectLcdView, type LcdView } from './selectors';
import { useSessionTimer } from './useSessionTimer';

// ---------------------------------------------------------------- pure helpers

export interface UrlOptions {
  mode: Mode;
  splitView: boolean;
}

/** `?mode=scripted` and `?view=split`. Anything else gives the defaults. */
export function readUrlOptions(search: string): UrlOptions {
  const params = new URLSearchParams(search);
  return {
    mode: params.get('mode') === 'scripted' ? 'scripted' : 'live',
    splitView: params.get('view') === 'split',
  };
}

/** Actions whose `at` is optional for callers. The hook fills it from the clock. */
export type ActAction = HandsetAction extends infer A
  ? A extends { at: number }
    ? Omit<A, 'at'> & { at?: number }
    : A
  : never;

export interface ExecutePlanDeps {
  transport: Pick<HandsetTransport, 'send'>;
  dispatch: (action: HandsetAction) => void;
  now: () => number;
  /** Adjusts the request that goes over the wire. The reducer still sees the original. */
  prepare?: (request: SendRequest) => SendRequest;
}

/**
 * Runs a plan: dispatch the sent action, await the transport, then dispatch reply or error.
 * Resolves when the request completes. Returns the TransportError if there was one.
 */
export async function executePlan(
  plan: Plan,
  deps: ExecutePlanDeps,
): Promise<TransportError | undefined> {
  if (plan.kind !== 'ussd' && plan.kind !== 'sms') return undefined;
  const { request } = plan;
  const appId = request.appId;
  const isUssd = plan.kind === 'ussd';
  const { dispatch, now } = deps;

  dispatch(
    isUssd
      ? { type: 'ussd/sent', appId, request, at: now() }
      : { type: 'sms/sent', appId, request, at: now() },
  );
  try {
    const response = await deps.transport.send(deps.prepare ? deps.prepare(request) : request);
    if (isUssd) {
      dispatch({ type: 'ussd/reply', appId, response, at: now() });
    } else {
      const deleted = request.text.trim().toUpperCase() === 'DELETE';
      dispatch({ type: 'sms/reply', appId, response, at: now(), ...(deleted ? { deleted: true } : {}) });
    }
    return undefined;
  } catch (e) {
    const err = e instanceof TransportError ? e : new TransportError('server');
    dispatch(
      isUssd
        ? { type: 'ussd/error', appId, message: err.userMessage }
        : { type: 'sms/error', appId, message: err.userMessage },
    );
    return err;
  }
}

/**
 * Fixtures key the dial step by the full code (`*384#`), while live mode sends the app's
 * open text for a bare code. In scripted mode, send the code so the fixture matches.
 */
export function toScriptedRequest(req: SendRequest): SendRequest {
  if (req.channel !== 'ussd') return req;
  const app = handsetConfig.apps.find((a) => a.id === req.appId);
  if (app && req.text === app.ussdOpenText) return { ...req, text: app.ussdCode };
  return req;
}

function withAt(action: ActAction, now: () => number): HandsetAction {
  switch (action.type) {
    case 'key':
    case 'type':
    case 'softLeft':
    case 'softRight':
    case 'call':
      return { ...action, at: action.at ?? now() } as HandsetAction;
    default:
      return action as HandsetAction;
  }
}

// ---------------------------------------------------------------- hook

export interface HandsetError {
  kind: TransportErrorKind;
  message: string;
}

export interface UseHandset {
  state: HandsetState;
  view: LcdView;
  serverConfig: ServerConfig | undefined;
  configError: string | undefined;
  transportMode: Mode;
  /** The single entry point for the UI and Autoplay. Resolves when any request completes. */
  act: (action: ActAction) => Promise<void>;
  getState: () => HandsetState;
  fixtures: Fixture[];
  switchMode: (mode: Mode) => void;
  /** `kind === 'offline'` means the UI should offer a switch to scripted mode. */
  lastError: HandsetError | undefined;
}

const now = (): number => performance.now();
const reducer = (s: HandsetState, a: HandsetAction): HandsetState => reduce(s, a, handsetConfig);

export function useHandset(): UseHandset {
  const [boot] = useState(() => {
    const search = typeof window === 'undefined' ? '' : window.location.search;
    const hash = typeof window === 'undefined' ? '' : window.location.hash;
    const opts = readUrlOptions(search);
    const loaded = loadFixtures();
    return {
      fixtures: loaded.fixtures,
      token: readTokenFromHash(hash),
      initial: initialState(handsetConfig, { ...opts, fixtureErrors: loaded.errors }),
    };
  });

  const [state, rawDispatch] = useReducer(reducer, boot.initial);
  // The reducer is pure, so running it here as well keeps `getState` current between renders.
  const stateRef = useRef(boot.initial);
  const dispatch = useCallback((a: HandsetAction) => {
    stateRef.current = reducer(stateRef.current, a);
    rawDispatch(a);
  }, []);

  const transports = useRef<{ live?: LiveTransport; scripted?: ScriptedTransport }>({});
  const getTransport = useCallback(
    (mode: Mode): HandsetTransport => {
      if (mode === 'scripted') {
        return (transports.current.scripted ??= new ScriptedTransport(boot.fixtures));
      }
      return (transports.current.live ??= new LiveTransport(
        boot.token === undefined ? {} : { token: boot.token },
      ));
    },
    [boot],
  );

  const [serverConfig, setServerConfig] = useState<ServerConfig | undefined>(undefined);
  const [configError, setConfigError] = useState<string | undefined>(undefined);
  const [lastError, setLastError] = useState<HandsetError | undefined>(undefined);

  const mode = state.mode;
  useEffect(() => {
    let cancelled = false;
    setServerConfig(undefined);
    setConfigError(undefined);
    getTransport(mode)
      .getConfig()
      .then((cfg) => {
        if (cancelled) return;
        setServerConfig(cfg);
        setLastError((e) => (e?.kind === 'offline' ? undefined : e));
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const err = e instanceof TransportError ? e : new TransportError('server');
        setConfigError(err.userMessage);
        if (err.kind === 'offline') setLastError({ kind: 'offline', message: err.userMessage });
      });
    return () => {
      cancelled = true;
    };
  }, [mode, getTransport]);

  const act = useCallback(
    async (input: ActAction): Promise<void> => {
      const action = withAt(input, now);
      const plan = planForAction(stateRef.current, action, handsetConfig);
      dispatch(action);
      if (plan.kind !== 'ussd' && plan.kind !== 'sms') return;
      const transportMode = stateRef.current.mode;
      const err = await executePlan(plan, {
        transport: getTransport(transportMode),
        dispatch,
        now,
        ...(transportMode === 'scripted' ? { prepare: toScriptedRequest } : {}),
      });
      setLastError(err ? { kind: err.kind, message: err.userMessage } : undefined);
    },
    [dispatch, getTransport],
  );

  const switchMode = useCallback(
    (next: Mode) => {
      dispatch({ type: 'setMode', mode: next });
      setLastError(undefined);
    },
    [dispatch],
  );

  const getState = useCallback(() => stateRef.current, []);
  const view = useMemo(() => selectLcdView(state, handsetConfig), [state]);

  useSessionTimer(state, serverConfig?.limits.ussd.sessionTimeoutMs, dispatch);

  return {
    state,
    view,
    serverConfig,
    configError,
    transportMode: state.mode,
    act,
    getState,
    fixtures: boot.fixtures,
    switchMode,
    lastError,
  };
}
