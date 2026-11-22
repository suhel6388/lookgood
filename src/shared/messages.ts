import type { LookSettings } from './settings';

/** Unique channel so we never confuse our messages with the host page's. */
export const CHANNEL = 'lookgood-live:channel';

export type EngineState = 'idle' | 'active' | 'bypassed' | 'error';
export type AiState = 'off' | 'loading' | 'ready' | 'unavailable';

export interface EngineStatus {
  state: EngineState;
  /** Number of live camera pipelines in this frame. */
  streams: number;
  ai: AiState;
  fps: number;
  width: number;
  height: number;
  deviceLabel: string;
  error?: string;
}

export const IDLE_STATUS: EngineStatus = {
  state: 'idle',
  streams: 0,
  ai: 'off',
  fps: 0,
  width: 0,
  height: 0,
  deviceLabel: '',
};

export interface ConfigPayload {
  assetBase: string;
  settings: LookSettings;
}

export interface BridgeToPageMessage {
  channel: typeof CHANNEL;
  dir: 'to-page';
  type: 'config';
  payload: ConfigPayload;
}

export interface PageHelloMessage {
  channel: typeof CHANNEL;
  dir: 'to-bridge';
  type: 'hello';
}

export interface PageStatusMessage {
  channel: typeof CHANNEL;
  dir: 'to-bridge';
  type: 'status';
  payload: EngineStatus;
}

export type PageToBridgeMessage = PageHelloMessage | PageStatusMessage;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isBridgeToPageMessage(
  data: unknown,
): data is BridgeToPageMessage {
  if (!isRecord(data) || data.channel !== CHANNEL) return false;
  if (data.dir !== 'to-page' || data.type !== 'config') return false;
  const payload = data.payload;
  return isRecord(payload) && typeof payload.assetBase === 'string';
}

export function isPageToBridgeMessage(data: unknown): data is PageToBridgeMessage {
  if (!isRecord(data) || data.channel !== CHANNEL) return false;
  if (data.dir !== 'to-bridge') return false;
  if (data.type === 'hello') return true;
  return data.type === 'status' && isRecord(data.payload);
}

/* ------------------------------------------------------------------ */
/* chrome.runtime messages (popup <-> content bridge <-> service worker) */
/* ------------------------------------------------------------------ */

export const RUNTIME = {
  queryStatus: 'lookgood:query-status',
  reportStatus: 'lookgood:report-status',
} as const;

export interface QueryStatusRequest {
  type: typeof RUNTIME.queryStatus;
}

export interface QueryStatusResponse {
  status: EngineStatus;
  settings: LookSettings;
}

export interface ReportStatusMessage {
  type: typeof RUNTIME.reportStatus;
  status: EngineStatus;
}

export function isQueryStatusRequest(
  message: unknown,
): message is QueryStatusRequest {
  return isRecord(message) && message.type === RUNTIME.queryStatus;
}

export function isReportStatusMessage(
  message: unknown,
): message is ReportStatusMessage {
  return (
    isRecord(message) &&
    message.type === RUNTIME.reportStatus &&
    isRecord(message.status)
  );
}
