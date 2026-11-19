import { expect, it } from 'vitest';
import { safeWebhookDeliveryError } from '../outbound-webhook';

it('keeps only bounded transport error categories without message or cause', () => {
  expect(safeWebhookDeliveryError(new Error('synthetic-sensitive-url', { cause: new Error('synthetic-cause') }))).toBe('Webhook delivery failed');
  expect(safeWebhookDeliveryError(Object.assign(new Error('synthetic-sensitive-url'), { name: 'AbortError' }))).toBe('Webhook delivery timed out');
  expect(safeWebhookDeliveryError('synthetic-sensitive-url')).toBe('Webhook delivery failed');
});
