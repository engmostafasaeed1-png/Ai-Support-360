import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  approveReadReason, markSectionOpened, onGoto, onReadChange, progressFor, readProgress, registerSections, requestGoto, requiredSectionKeys,
} from './brdSectionsRead';
import { describeBlocked } from './blockedReasons';

beforeEach(() => window.localStorage.clear());

describe('Approve BRD: every section must be opened first', () => {
  it('requires every visible section except hidden ones and the change log', () => {
    expect(requiredSectionKeys([
      { key: 'purpose' }, { key: 'scope', hidden: true }, { key: 'functional' }, { key: 'change_log' },
    ])).toEqual(['purpose', 'functional']);
  });

  it('stays blocked until the last section is opened, then unblocks', () => {
    const req = ['purpose', 'scope', 'functional'];
    expect(readProgress(req, []).complete).toBe(false);
    const two = readProgress(req, ['purpose', 'functional']);
    expect(two).toMatchObject({ total: 3, done: 2, nextKey: 'scope', complete: false });
    expect(approveReadReason(two)).toMatchObject({ key: 'brd_sections_unread', params: { done: 2, total: 3 } });
    expect(approveReadReason(readProgress(req, req))).toBeNull();
  });

  it('blocks while this version has not been shown in the reader yet', () => {
    expect(approveReadReason(readProgress(null, []))?.key).toBe('brd_sections_not_opened');
  });

  it('explains the block in English and Arabic with the counts', () => {
    const r = approveReadReason(readProgress(['a', 'b', 'c', 'd'], ['a']), () => {});
    expect(describeBlocked(r, 'en')?.first.message).toBe('Open every BRD section before approving (1 of 4 opened).');
    expect(describeBlocked(r, 'ar')?.first.message).toBe('افتح كل أقسام مستند المتطلبات قبل الاعتماد (فُتح 1 من 4).');
    expect(describeBlocked(r, 'en')?.first.nextLabel).toBe('Go to the next section');
  });

  it('remembers opened sections per ticket and version only', () => {
    registerSections('t1', 2, ['purpose', 'scope']);
    markSectionOpened('t1', 2, 'purpose');
    expect(progressFor('t1', 2)).toMatchObject({ done: 1, total: 2, nextKey: 'scope' });
    expect(progressFor('t1', 3).total).toBeNull(); // a new version starts from zero
    expect(progressFor('t2', 2).total).toBeNull();
    markSectionOpened('t1', 2, 'scope');
    expect(progressFor('t1', 2).complete).toBe(true);
  });

  it('keeps opened sections when the reader registers the same version again, drops removed ones', () => {
    registerSections('t1', 1, ['a', 'b']);
    markSectionOpened('t1', 1, 'a');
    registerSections('t1', 1, ['a', 'b']);
    expect(progressFor('t1', 1).done).toBe(1);
    registerSections('t1', 1, ['b', 'c']);
    expect(progressFor('t1', 1)).toMatchObject({ done: 0, total: 2 });
  });

  it('announces changes and "go to section" requests', () => {
    const changed = vi.fn();
    const goto = vi.fn();
    const off1 = onReadChange(changed);
    const off2 = onGoto(goto);
    markSectionOpened('t1', 1, 'a');
    requestGoto('t1', 1, 'b');
    expect(changed).toHaveBeenCalledWith({ ticketId: 't1', version: 1 });
    expect(goto).toHaveBeenCalledWith({ ticketId: 't1', version: 1, key: 'b' });
    off1(); off2();
  });
});
