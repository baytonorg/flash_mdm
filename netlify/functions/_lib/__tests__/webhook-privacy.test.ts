import { expect, it } from 'vitest';
import { safeWebhookDestination, safeWebhookDeliveryError } from '../outbound-webhook';

it.each([
  ['https://user:password@hooks.example.test/private-token?signature=query-token#fragment-token', 'https://hooks.example.test'],
  ['https://hooks.example.test:8443/private-token', 'https://hooks.example.test:8443'],
  ['https://hooks.example.test/', 'https://hooks.example.test'],
  ['https://' + 'a'.repeat(400) + '.example.test/path', '[redacted]'],
  ['http://hooks.example.test/path', '[redacted]'],
  ['not a URL secret', '[redacted]'],
  [null, '[redacted]'],
])('summarises a destination without its credential-bearing components', (value, expected) => {
  expect(safeWebhookDestination(value)).toBe(expected);
});
it('keeps only bounded transport error categories without message or cause', () => {
  expect(safeWebhookDeliveryError(new Error('synthetic-sensitive-url', { cause: new Error('synthetic-cause') }))).toBe('Webhook delivery failed');
  expect(safeWebhookDeliveryError(Object.assign(new Error('synthetic-sensitive-url'), { name: 'AbortError' }))).toBe('Webhook delivery timed out');
  expect(safeWebhookDeliveryError('synthetic-sensitive-url')).toBe('Webhook delivery failed');
});
