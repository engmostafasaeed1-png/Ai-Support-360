import { describe, it, expect } from 'vitest';
import { certificateKey, jobKey, onlyNew, projectKey, skillKey, slotKey, studyKey } from './onboardingDedupe';

describe('onlyNew', () => {
  const key = (row: { m: string }) => skillKey(row.m);

  it('leaves out what the consultant already has', () => {
    const wanted = [{ m: 'SAP FI' }, { m: 'SAP CO' }, { m: 'SAP MM' }];
    const have = [{ sap_module: 'SAP FI' }, { sap_module: 'SAP CO' }];
    expect(onlyNew(wanted, have, key, e => skillKey(e.sap_module))).toEqual([{ m: 'SAP MM' }]);
  });

  it('adds nothing when everything is already there, and everything when nothing is', () => {
    const wanted = [{ m: 'SAP FI' }, { m: 'SAP CO' }];
    expect(onlyNew(wanted, [{ sap_module: 'sap fi ' }, { sap_module: 'SAP CO' }], key, e => skillKey(e.sap_module))).toEqual([]);
    expect(onlyNew(wanted, [] as { sap_module: string }[], key, e => skillKey(e.sap_module))).toEqual(wanted);
  });

  it('adds a row that is repeated in the form only once', () => {
    const wanted = [{ m: 'SAP FI' }, { m: ' sap fi' }, { m: 'SAP CO' }];
    expect(onlyNew(wanted, [], key, () => '').map(r => r.m)).toEqual(['SAP FI', 'SAP CO']);
  });

  it('leaves out an empty form row', () => {
    expect(onlyNew([{ m: '' }, { m: '   ' }, { m: 'SAP FI' }], [], key, () => '').map(r => r.m)).toEqual(['SAP FI']);
  });

  it('keeps the order of the form', () => {
    expect(onlyNew([{ m: 'C' }, { m: 'A' }, { m: 'B' }], [{ sap_module: 'A' }], key, e => skillKey(e.sap_module)).map(r => r.m)).toEqual(['C', 'B']);
  });
});

describe('keys', () => {
  it('skillKey and projectKey ignore capitals and spaces around the text', () => {
    expect(skillKey('  SAP S/4HANA ')).toBe('sap s/4hana');
    expect(projectKey('Rollout Cairo')).toBe(projectKey(' rollout cairo '));
    expect(skillKey(null)).toBe('');
    expect(skillKey(undefined)).toBe('');
  });

  it('certificateKey is the name, the issuer and the date, and empty without a name', () => {
    expect(certificateKey('SAP Certified', 'SAP SE', '2021-05-15')).toBe(certificateKey(' sap certified', 'sap se ', '2021-05-15'));
    expect(certificateKey('SAP Certified', 'SAP SE', '2021-05-15')).not.toBe(certificateKey('SAP Certified', 'SAP SE', '2022-03-15'));
    expect(certificateKey('SAP Certified', null, null)).toBe('sap certified||');
    expect(certificateKey('', 'SAP SE', '2021-05-15')).toBe('');
  });

  it('jobKey needs the company and the title', () => {
    expect(jobKey('Acme', 'Consultant', '2020-01-01')).toBe('acme|consultant|2020-01-01');
    expect(jobKey('Acme', '', '2020-01-01')).toBe('');
    expect(jobKey('', 'Consultant', null)).toBe('');
  });

  it('studyKey needs the institution and accepts numbers and empty values', () => {
    expect(studyKey('Cairo University', 'BSc', 'Commerce', 2010)).toBe('cairo university|bsc|commerce|2010');
    expect(studyKey('Cairo University', null, null, null)).toBe('cairo university|||');
    expect(studyKey('', 'BSc', 'Commerce', 2010)).toBe('');
  });

  it('slotKey treats 09:00:00 and 09:00 as the same time', () => {
    expect(slotKey(1, '09:00:00', '17:00:00')).toBe(slotKey('1', '09:00', '17:00'));
    expect(slotKey(1, '09:00', '17:00')).not.toBe(slotKey(2, '09:00', '17:00'));
    expect(slotKey(0, '09:00', '17:00')).toBe('0|09:00|17:00');
  });
});

describe('running the onboarding twice', () => {
  it('adds the rows of the second run only if they are new', () => {
    const firstRun = [{ day: 1, s: '09:00', e: '17:00' }, { day: 2, s: '09:00', e: '17:00' }];
    const savedByFirstRun = firstRun.map(r => ({ day_of_week: r.day, start_time: `${r.s}:00`, end_time: `${r.e}:00` }));
    const secondRun = [...firstRun, { day: 3, s: '10:00', e: '14:00' }];
    const toAdd = onlyNew(secondRun, savedByFirstRun, r => slotKey(r.day, r.s, r.e), r => slotKey(r.day_of_week, r.start_time, r.end_time));
    expect(toAdd).toEqual([{ day: 3, s: '10:00', e: '14:00' }]);
  });
});
