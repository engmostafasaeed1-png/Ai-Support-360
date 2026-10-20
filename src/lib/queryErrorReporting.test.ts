import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const sessionMock = vi.hoisted(() => ({ active: true }));
vi.mock('@/lib/sessionState', () => ({ hasActiveSession: () => sessionMock.active }));

import { logger } from '@/lib/logger';
import { describeError, isExpectedFailure, reportQueryFailure } from '@/lib/queryErrorReporting';

const edgeFunctionError = (status: number) =>
  Object.assign(new Error('Edge Function returned a non-2xx status code'), { context: { status } });

describe('describeError', () => {
  it('reads an Error, a Supabase error object, an edge-function error and a string', () => {
    expect(describeError(new Error('boom'))).toEqual({ message: 'boom', code: undefined, status: undefined, details: undefined });
    expect(describeError({ message: 'invalid input syntax for type uuid: "x"', code: '22P02', details: 'd', hint: null })).toEqual({
      message: 'invalid input syntax for type uuid: "x"',
      code: '22P02',
      status: undefined,
      details: 'd',
    });
    expect(describeError(edgeFunctionError(502)).status).toBe(502);
    expect(describeError('plain text')).toEqual({ message: 'plain text' });
    expect(describeError(undefined).message).toBe('Unknown error');
  });
});

describe('isExpectedFailure', () => {
  it('treats bad requests, missing permission, 4xx answers and lost connections as expected', () => {
    for (const code of ['22P02', '23505', '23503', '42501', 'P0001', 'PGRST116', 'PGRST301']) {
      expect(isExpectedFailure({ message: 'x', code }), code).toBe(true);
    }
    for (const status of [400, 401, 403, 404, 409, 429]) {
      expect(isExpectedFailure({ message: 'x', status }), String(status)).toBe(true);
    }
    for (const message of ['Failed to fetch', 'AbortError: The operation was aborted', 'JWT expired', 'Failed to send a request to the Edge Function']) {
      expect(isExpectedFailure({ message }), message).toBe(true);
    }
  });

  it('treats the missing-bank-details business rule as expected, not a bug', () => {
    expect(isExpectedFailure({ message: 'The consultant has not entered bank details for payouts yet', code: '22023' })).toBe(true);
    expect(isExpectedFailure({ message: 'The consultant has not entered bank details for payouts yet' })).toBe(true);
  });

  it('treats the bank-details input rules as expected, even without a database code', () => {
    for (const message of [
      'The account number must have 4 to 34 letters, digits or dashes',
      'The IBAN is not valid: check the letters and digits',
      'The SWIFT / BIC must have 8 or 11 letters and digits',
      'The account holder and the bank name need 2 to 120 characters',
      'Enter an IBAN or an account number',
      'Please read the disclaimer and confirm it before saving your bank details',
    ]) {
      expect(isExpectedFailure({ message }), message).toBe(true);
    }
  });

  it('never sends a bank-details input message to the error reports', () => {
    vi.clearAllMocks();
    reportQueryFailure('Mutation failed', new Error('The account number must have 4 to 34 letters, digits or dashes'));
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('keeps server errors and code mistakes as real failures', () => {
    for (const code of ['42703', '42P01', '57014', 'PGRST100']) {
      expect(isExpectedFailure({ message: 'x', code }), code).toBe(false);
    }
    expect(isExpectedFailure({ message: 'x', status: 500 })).toBe(false);
    expect(isExpectedFailure({ message: 'x', status: 502 })).toBe(false);
    expect(isExpectedFailure({ message: 'something unexpected happened' })).toBe(false);
  });
});

describe('reportQueryFailure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('only writes expected failures to the console', () => {
    reportQueryFailure('Query failed', { message: 'permission denied for table x', code: '42501' }, ['admin-users']);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('reports a server error with its real message, status and query name', () => {
    reportQueryFailure('Mutation failed', edgeFunctionError(502));
    expect(logger.error).toHaveBeenCalledTimes(1);
    const [what, error, context] = vi.mocked(logger.error).mock.calls[0];
    expect(what).toBe('Mutation failed');
    expect((error as Error).message).toBe('Edge Function returned a non-2xx status code');
    expect(context).toMatchObject({ status: 502 });
  });

  it('wraps an error object that is not an Error and names the query', () => {
    reportQueryFailure('Query failed', { message: 'column "nope" does not exist', code: '42703' }, ['ai-match-consultants', 'abc']);
    const [, error, context] = vi.mocked(logger.error).mock.calls[0];
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('column "nope" does not exist');
    expect(context).toMatchObject({ code: '42703', query: 'ai-match-consultants' });
  });
});

describe('reportQueryFailure: sign-in race', () => {
  beforeEach(() => vi.clearAllMocks());

  it('ignores "Not signed in yet" and "Not signed in"', () => {
    reportQueryFailure('Query failed', new Error('Not signed in yet'), ['my-consultant-availability']);
    reportQueryFailure('Query failed', new Error('Not signed in'), ['my-availability-slots']);
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('still reports "relation does not exist"', () => {
    reportQueryFailure('Query failed', { message: 'relation "x" does not exist', code: '42P01' }, ['q']);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});

describe('reportQueryFailure: no session', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does not report a refused call without a session, reports it with one', () => {
    sessionMock.active = false;
    reportQueryFailure('Query failed', { message: 'permission denied for function critical_my_alerts', code: '42501' }, ['critical-my-alerts']);
    reportQueryFailure('Query failed', { message: 'permission denied for function critical_my_alerts' }, ['critical-my-alerts']);
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();

    sessionMock.active = true;
    reportQueryFailure('Query failed', { message: 'permission denied for function critical_my_alerts' }, ['critical-my-alerts']);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('never reports "Not signed in yet", with or without a session', () => {
    for (const active of [true, false]) {
      sessionMock.active = active;
      reportQueryFailure('Query failed', new Error('Not signed in yet'));
    }
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
