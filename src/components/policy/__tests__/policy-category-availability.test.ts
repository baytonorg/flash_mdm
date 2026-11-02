import { describe, expect, it } from 'vitest';
import { isPolicyCategoryAvailable } from '@/components/policy/policy-category-availability';

describe('policy category scenario availability', () => {
  it.each([
    ['crossProfile', 'wp', true],
    ['crossProfile', 'fm', false],
    ['crossProfile', 'dedicated', false],
    ['personalUsage', 'wp', true],
    ['personalUsage', 'fm', false],
    ['personalUsage', 'dedicated', false],
    ['kioskMode', 'wp', false],
    ['kioskMode', 'fm', true],
    ['kioskMode', 'dedicated', true],
    ['crossDevice', 'wp', true],
    ['crossDevice', 'fm', true],
    ['crossDevice', 'dedicated', true],
  ])('%s in %s resolves to %s', (category, scenario, expected) => {
    expect(isPolicyCategoryAvailable(category, scenario)).toBe(expected);
  });
});
