import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import GroupedMultiSelect from './GroupedMultiSelect';
import type { TaxonomyGroup } from '@/lib/profileTaxonomy';

const GROUPS: TaxonomyGroup[] = [
  { group: 'Fruits', items: ['Apple', 'Banana'] },
  { group: 'Vegetables', items: ['Carrot', 'Other'] },
];

function setup(initial: string[] = [], max?: number) {
  const onChange = vi.fn();
  render(<GroupedMultiSelect groups={GROUPS} value={initial} onChange={onChange} max={max} />);
  return onChange;
}

describe('GroupedMultiSelect', () => {
  it('selecting and unselecting calls onChange with the right arrays', () => {
    const onChange = setup(['Apple']);
    // the Fruits group is already open because it contains the selected "Apple"
    fireEvent.click(screen.getByRole('checkbox', { name: 'Banana' }));
    expect(onChange).toHaveBeenLastCalledWith(['Apple', 'Banana']);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Apple' }));
    expect(onChange).toHaveBeenLastCalledWith(['Banana']);
  });

  it('search hides non-matching groups', () => {
    setup();
    fireEvent.change(screen.getByLabelText('Search…'), { target: { value: 'carr' } });
    expect(screen.queryByText('Fruits')).toBeNull();
    expect(screen.getByText('Vegetables')).toBeTruthy();
  });

  it('Other adds typed text once, trimmed, duplicates ignored', () => {
    const onChange = setup(['Custom thing']);
    fireEvent.click(screen.getByText('Vegetables'));
    const input = screen.getByLabelText('Other (type and press Add)');
    fireEvent.change(input, { target: { value: '  New entry  ' } });
    fireEvent.click(screen.getByRole('button', { name: /Add/ }));
    expect(onChange).toHaveBeenLastCalledWith(['Custom thing', 'New entry']);
    fireEvent.change(input, { target: { value: 'custom THING' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('Other limits typed text to 120 characters', () => {
    const onChange = setup();
    fireEvent.click(screen.getByText('Vegetables'));
    const input = screen.getByLabelText('Other (type and press Add)') as HTMLInputElement;
    expect(input.maxLength).toBe(120);
    fireEvent.change(input, { target: { value: 'x'.repeat(120) } });
    fireEvent.click(screen.getByRole('button', { name: /Add/ }));
    expect(onChange).toHaveBeenLastCalledWith(['x'.repeat(120)]);
  });

  it('enforces the max and shows the limit sentence', () => {
    const onChange = setup(['Apple', 'Banana'], 2);
    expect(screen.getByText('You can choose up to 2 entries.')).toBeTruthy();
    fireEvent.click(screen.getByText('Vegetables'));
    const carrot = screen.getByRole('checkbox', { name: 'Carrot' }) as HTMLInputElement;
    expect(carrot.disabled).toBe(true);
    fireEvent.click(carrot);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('removing a badge works', () => {
    const onChange = setup(['Apple', 'Typed value']);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Typed value' }));
    expect(onChange).toHaveBeenLastCalledWith(['Apple']);
  });
});
