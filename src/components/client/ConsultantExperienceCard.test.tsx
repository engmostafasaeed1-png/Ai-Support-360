import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ConsultantExperienceCard, { languageLines } from './ConsultantExperienceCard';

describe('ConsultantExperienceCard', () => {
  it('shows only the non-empty lists and the language levels', () => {
    render(<ConsultantExperienceCard data={{
      industries: ['Retail - grocery & convenience'], customer_segments: [], vertical_solutions: null,
      localization_countries: ['Saudi Arabia'], project_scale: 'Large (100-300 people)', working_week: '',
      languages: ['en', 'ar'], language_levels: { en: 'Fluent (business)', ar: 'Native' },
    }} />);
    expect(screen.getByText('Experience')).toBeInTheDocument();
    expect(screen.getByText('Industries')).toBeInTheDocument();
    expect(screen.getByText('Localization countries')).toBeInTheDocument();
    expect(screen.getByText('Largest project')).toBeInTheDocument();
    expect(screen.queryByText('Customer segments')).toBeNull();
    expect(screen.queryByText('Vertical solutions')).toBeNull();
    expect(screen.queryByText('Working week')).toBeNull();
    expect(screen.getByText('English - Fluent (business)')).toBeInTheDocument();
    expect(screen.getByText('Arabic - Native')).toBeInTheDocument();
  });
  it('shows nothing when every list is empty', () => {
    const { container } = render(<ConsultantExperienceCard data={{}} />);
    expect(container).toBeEmptyDOMElement();
  });
  it('names a language without level by its name', () => {
    expect(languageLines(['de'], {})).toEqual(['German']);
  });
});
