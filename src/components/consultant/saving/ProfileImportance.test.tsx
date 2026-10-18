import { beforeEach, describe, expect, it } from 'vitest';
import { claimSavePrompt } from './ProfileImportance';
describe('manual save guidance frequency', () => {
  beforeEach(() => sessionStorage.clear());
  it('appears once per user session for an incomplete profile', () => {
    expect(claimSavePrompt('u1', false, true, false)).toBe(true);
    expect(claimSavePrompt('u1', false, true, false)).toBe(false);
  });
  it('autosaving never consumes or shows the dialog', () => {
    expect(claimSavePrompt('u1', true, true, false)).toBe(false);
    expect(claimSavePrompt('u1', false, true, false)).toBe(true);
  });
  it('complete profiles with completed interviews need no dialog', () => {
    expect(claimSavePrompt('u1', false, false, true)).toBe(false);
  });
});
