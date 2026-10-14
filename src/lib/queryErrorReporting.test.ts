import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

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
