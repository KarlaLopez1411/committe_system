import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

/**
 * Foundation smoke tests: verify the test runner and the property-based testing
 * library (fast-check) are wired up correctly before feature work begins.
 */
describe('project foundation', () => {
  it('runs unit tests', () => {
    expect(1 + 1).toBe(2);
  });

  it('runs property-based tests with fast-check (min 100 runs)', () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer(), (a, b) => {
        return a + b === b + a;
      }),
      { numRuns: 100 },
    );
  });
});
