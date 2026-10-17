import { describe, it, expect } from 'vitest';
import { activeAward, nextFoundingNumber, shouldAutomaticallyAward, foundingTieBreak, type FoundingAward } from './foundingConsultants';
const award: FoundingAward = { consultant_id:'a',founding_number:17,awarded_at:'2026-10-17T22:51:00Z',revoked_at:null };
describe('Founding Consultant rules',()=>{
 it('allocates numbers 1 to 100 and stops at the default limit',()=>{
  expect(nextFoundingNumber(true,100,[])).toBe(1);
  expect(nextFoundingNumber(true,100,Array.from({length:99},(_,i)=>i+1))).toBe(100);
  expect(nextFoundingNumber(true,100,Array.from({length:100},(_,i)=>i+1))).toBeNull();
 });
 it('honours enabled and editable limit',()=>{expect(nextFoundingNumber(false,100,[])).toBeNull();expect(nextFoundingNumber(true,2,[1,2])).toBeNull();});
 it('awards only on verification, without re-awarding revoked history',()=>{
  expect(shouldAutomaticallyAward('verified','pending',false)).toBe(true);
  expect(shouldAutomaticallyAward('pending',null,false)).toBe(false);
  expect(shouldAutomaticallyAward('verified','verified',false)).toBe(false);
  expect(shouldAutomaticallyAward('verified','pending',true)).toBe(false);
 });
 it('never hides a permanent award merely because time passed',()=>{expect(activeAward(award)).toBe(true);expect(activeAward({...award,revoked_at:'2026-10-18'})).toBe(false);});
 it('default zero leaves tie order unchanged',()=>{expect(foundingTieBreak(award,undefined,0,Date.parse('2026-10-18'))).toBe(0);});
 it('three-month boost expires at its exact anniversary',()=>{
  expect(foundingTieBreak(award,undefined,3,Date.parse('2027-01-17T22:50:59Z'))).toBe(-1);
  expect(foundingTieBreak(award,undefined,3,Date.parse('2027-01-17T22:51:00Z'))).toBe(0);
 });
 it('revoked awards do not boost',()=>{expect(foundingTieBreak({...award,revoked_at:'2026-10-18'},undefined,3,Date.parse('2026-10-19'))).toBe(0);});
});
