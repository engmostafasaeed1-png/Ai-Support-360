import { describe, expect, it } from 'vitest';
import { friendlyErrorMessage, functionErrorMessage, isNetworkError } from './friendlyError';

describe('friendlyErrorMessage', () => {
  it('hides the row-level security text', () => {
    expect(friendlyErrorMessage({ message: 'new row violates row-level security policy for table "tickets"' })).toBe(
      'You do not have permission to do this.',
    );
  });

  it('explains a failed edge function call', () => {
    expect(friendlyErrorMessage({ name: 'FunctionsHttpError', message: 'Edge Function returned a non-2xx status code' })).toBe(
      'The service could not finish this request. Please try again in a moment.',
    );
    expect(friendlyErrorMessage({ name: 'FunctionsFetchError', message: 'Failed to send a request to the Edge Function' })).toBe(
      'We could not reach the server. Please check your connection and try again.',
    );
  });

  it('recognises a lost connection', () => {
    expect(isNetworkError(new TypeError('Failed to fetch'))).toBe(true);
    expect(isNetworkError({ message: 'TypeError: Failed to fetch' })).toBe(true);
    expect(isNetworkError({ name: 'TimeoutError', message: 'No answer after 45 seconds' })).toBe(true);
    expect(isNetworkError({ message: 'duplicate key value violates unique constraint "tickets_pkey"' })).toBe(false);
  });

  it('keeps a short readable message that was written on purpose', () => {
    expect(friendlyErrorMessage({ message: 'Please check the title (up to 300 characters).' })).toBe(
      'Please check the title (up to 300 characters).',
    );
  });

  it('uses the fallback for unknown technical text, empty text and very long text', () => {
    expect(friendlyErrorMessage({ message: 'relation "x" does not exist' }, 'Could not save')).toBe('Could not save');
    expect(friendlyErrorMessage(null, 'Could not save')).toBe('Could not save');
    expect(friendlyErrorMessage('x'.repeat(300), 'Could not save')).toBe('Could not save');
  });
});

describe('functionErrorMessage', () => {
  it('prefers the reason in the answer of the function', async () => {
    expect(await functionErrorMessage(null, { error: 'The AI service is busy. Please try again in a minute.' })).toBe(
      'The AI service is busy. Please try again in a minute.',
    );
  });

  it('reads the reason from the body of a failed call', async () => {
    const error = {
      name: 'FunctionsHttpError',
      message: 'Edge Function returned a non-2xx status code',
      context: { clone: () => ({ json: async () => ({ error: 'The AI credits are used up. Please add credits.' }) }) },
    };
    expect(await functionErrorMessage(error, null)).toBe('The AI credits are used up. Please add credits.');
  });

  it('falls back to plain language when there is no readable reason', async () => {
    expect(
      await functionErrorMessage({ name: 'FunctionsHttpError', message: 'Edge Function returned a non-2xx status code' }, null),
    ).toBe('The service could not finish this request. Please try again in a moment.');
  });
});
