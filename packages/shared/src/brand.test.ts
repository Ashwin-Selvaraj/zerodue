import { describe, expect, it } from 'vitest';
import { APP_NAME, APP_TAGLINE } from './brand';

describe('brand', () => {
  it('uses the ZeroDue name and tagline', () => {
    expect(APP_NAME).toBe('ZeroDue');
    expect(APP_TAGLINE).toBe('Track every rupee. Clear every loan.');
  });
});
