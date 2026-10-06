import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MobileNav, Sidebar } from './Shell.js';
import { OperatorDenied } from './OperatorParts.js';

const base = { active: null, attentionCount: 0, currentHref: '/purchases', onSignOut: null } as const;

describe('operator navigation', () => {
  it('leaves Treasury and Connections out of the sidebar and mobile nav without operator access', () => {
    const html = renderToStaticMarkup(<Sidebar {...base} operator={false} />) + renderToStaticMarkup(<MobileNav {...base} operator={false} />);
    expect(html).not.toContain('Treasury');
    expect(html).not.toContain('Connections');
    expect(html).not.toContain('Operator');
    // The primary judge flow is intact.
    expect(html).toContain('Current purchase');
    expect(html).toContain('Purchases');
    expect(html).toContain('Needs attention');
  });

  it('adds them as a separate, labelled group with operator access', () => {
    const html = renderToStaticMarkup(<Sidebar {...base} operator />);
    expect(html).toContain('Operator');
    expect(html).toContain('Treasury');
    expect(html).toContain('Connections');
    expect(html.indexOf('Needs attention')).toBeLessThan(html.indexOf('Treasury'));
    expect(renderToStaticMarkup(<MobileNav {...base} operator />)).toContain('Treasury');
  });

  it('marks the open operator screen as current', () => {
    const html = renderToStaticMarkup(<Sidebar {...base} active="treasury" operator />);
    const current = /<button[^>]*aria-current="page"[^>]*>([\s\S]*?)<\/button>/.exec(html);
    expect(current?.[1]).toContain('Treasury');
  });
});

describe('operator gate', () => {
  it('shows a plain refusal and names no data', () => {
    const html = renderToStaticMarkup(<OperatorDenied />);
    expect(html).toContain('Operator access required');
    for (const word of ['$', 'USD', 'SGD', 'OCBC', 'balance', 'capacity', 'Cardano']) expect(html).not.toContain(word);
  });
});
