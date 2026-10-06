import type { Page } from 'playwright-core';

/** Test-only passive capture. Never persist URLs, request bodies, tokens, or field values. */
export function attachPaymentDiagnostics(page: Page, emit: (kind: string, data: Record<string, unknown>) => void) {
  const failures = new Set<string>();
  page.on('requestfailed', request => {
    const key = [new URL(request.url()).hostname, request.method(), request.resourceType(), request.failure()?.errorText].join('|');
    if (failures.has(key)) return;
    failures.add(key);
    emit('browser_request_failed', { host: new URL(request.url()).hostname, method: request.method(),
      resource: request.resourceType(), failure: request.failure()?.errorText?.replace(/[^a-zA-Z0-9_: .-]/g, '').slice(0, 80) });
  });
  page.on('response', response => {
    if (response.request().method() !== 'POST' || !/json/.test(response.headers()['content-type'] ?? '')) return;
    void response.json().then(body => {
      const codes = new Set<string>();
      const visit = (value: unknown, depth = 0): void => {
        if (!value || typeof value !== 'object' || depth > 12) return;
        for (const [key, child] of Object.entries(value)) {
          if (['code', 'status'].includes(key) && typeof child === 'string' && /^[A-Z][A-Z_]{2,100}$/.test(child)) codes.add(child);
          if (key === '__typename' && typeof child === 'string' && /^[A-Za-z]{3,100}$/.test(child) && /error|fail|success|receipt|submit|reject/i.test(child)) codes.add(child);
          if (typeof child === 'object') visit(child, depth + 1);
        }
      };
      visit(body);
      if (codes.size) emit('browser_response_codes', { host: new URL(response.url()).hostname, status: response.status(), codes: [...codes].slice(0, 60) });
    }).catch(() => undefined);
  });
}

export async function paymentFieldDiagnostics(page: Page) {
  const frames = [];
  for (const frame of page.frames()) {
    const field = /^card-fields-(number|name|expiry|verification_value)-/.exec(frame.name())?.[1];
    if (!field) continue;
    const fields = await frame.locator(`input[name="${field}"]`).evaluateAll(inputs => inputs.map(input => ({
      name: input.getAttribute('name'), type: input.getAttribute('type'),
      length: (input as unknown as { value: string }).value.length,
      invalid: input.getAttribute('aria-invalid') === 'true',
      valid: (input as unknown as { validity: { valid: boolean } }).validity.valid,
      validity: Object.fromEntries(['valueMissing','typeMismatch','patternMismatch','tooLong','tooShort','rangeUnderflow','rangeOverflow','stepMismatch','badInput','customError'].map(key => [key, (input as unknown as { validity: Record<string, boolean> }).validity[key]])),
      pattern: input.getAttribute('pattern'),
      maxLength: input.getAttribute('maxlength'),
      visible: (input as unknown as { offsetWidth: number }).offsetWidth > 0,
    }))).catch(() => []);
    frames.push({ field, fields });
  }
  return { frames };
}
