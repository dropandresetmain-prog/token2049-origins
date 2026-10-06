import { describe, expect, it } from 'vitest';
import { parseHash, routeKey } from './route.js';

describe('console routes', () => {
  it('keeps the purchase routes unchanged', () => {
    expect(parseHash('')).toEqual({ kind: 'home' });
    expect(parseHash('#/')).toEqual({ kind: 'home' });
    expect(parseHash('#/purchases')).toEqual({ kind: 'list', filter: 'all' });
    expect(parseHash('#/purchases?filter=attention')).toEqual({ kind: 'list', filter: 'attention' });
    expect(parseHash('#/purchases/pur_123')).toEqual({ kind: 'detail', id: 'pur_123' });
  });

  it('routes the operator screens', () => {
    expect(parseHash('#/treasury')).toEqual({ kind: 'treasury' });
    expect(parseHash('#/connections')).toEqual({ kind: 'connections' });
    expect(parseHash('#/treasury/')).toEqual({ kind: 'treasury' });
  });

  it('does not treat deeper or unknown paths as operator screens', () => {
    expect(parseHash('#/treasury/extra')).toEqual({ kind: 'home' });
    expect(parseHash('#/connections/ocbc')).toEqual({ kind: 'home' });
    expect(parseHash('#/operator')).toEqual({ kind: 'home' });
    expect(parseHash('#/bank/refresh')).toEqual({ kind: 'home' });
  });

  it('gives each screen its own key, so focus moves when the screen changes', () => {
    const keys = ['#/', '#/purchases', '#/purchases/a', '#/treasury', '#/connections'].map((h) => routeKey(parseHash(h)));
    expect(new Set(keys).size).toBe(keys.length);
  });
});
