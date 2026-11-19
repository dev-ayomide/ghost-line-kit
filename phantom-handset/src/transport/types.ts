import type { SendRequest, SendResponse, ServerConfig } from '../../shared/api';
import { handsetConfig } from '../config/handset-config';

export interface HandsetTransport {
  readonly mode: 'live' | 'scripted';
  getConfig(): Promise<ServerConfig>;
  /** Rejects with TransportError. */
  send(req: SendRequest): Promise<SendResponse>;
}

export type TransportErrorKind = 'offline' | 'rejected' | 'server';

/** `userMessage` is short copy from the config. It never holds stack traces or ids. */
export class TransportError extends Error {
  readonly kind: TransportErrorKind;
  readonly userMessage: string;

  constructor(kind: TransportErrorKind) {
    const userMessage = handsetConfig.copy.errors[kind];
    super(userMessage);
    this.name = 'TransportError';
    this.kind = kind;
    this.userMessage = userMessage;
  }
}
