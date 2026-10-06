import * as copy from '../copy/en.js';
import { ConsoleError } from '../contracts/source.js';

export interface ErrorInfo {
  code: string;
  message: string;
  requestId?: string;
}

/** Map any failure to user-facing copy. Raw error messages never reach the screen. */
export function errorInfo(e: unknown): ErrorInfo {
  if (!(e instanceof ConsoleError)) return { code: 'generic', message: copy.errors.generic };
  const requestId = e.requestId;
  switch (e.code) {
    case 'unauthenticated': return { code: e.code, message: copy.errors.unauthenticated, requestId };
    case 'forbidden': return { code: e.code, message: copy.errors.forbidden, requestId };
    case 'not_found': return { code: e.code, message: copy.errors.not_found, requestId };
    case 'network': return { code: e.code, message: copy.errors.network, requestId };
    case 'invalid_response': return { code: e.code, message: copy.errors.invalid_response, requestId };
    default: return { code: 'generic', message: copy.errors.generic, requestId };
  }
}

export const isAuthLost = (e: unknown): boolean => e instanceof ConsoleError && e.code === 'unauthenticated';
