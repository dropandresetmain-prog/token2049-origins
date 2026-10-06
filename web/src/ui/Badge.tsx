import type { ReactNode } from 'react';
import type { StatusVM, Tone } from '../model/types.js';
import { Icon, type IconKey } from './Icon.js';

/** Tone to the prototype's badge class. */
export function toneClass(tone: Tone): string {
  switch (tone) {
    case 'progress': return 'progress';
    case 'positive': return 'complete';
    case 'attention': return 'review';
    case 'pending': return 'pending';
    case 'neutral': return 'outline';
  }
}

export function Badge({ tone, icon, children }: { tone: Tone; icon?: IconKey; children: ReactNode }) {
  return (
    <span className={`badge ${toneClass(tone)}`}>
      {tone === 'progress' ? <span className="spinner" aria-hidden="true" /> : null}
      {icon ? <Icon name={icon} /> : null}
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: StatusVM }) {
  return <Badge tone={status.tone}>{status.label}</Badge>;
}
