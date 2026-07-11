import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ExperienceV3Root, MetricTrust } from '@alfanumrik/ui/v3';

describe('One Experience V3 metric trust', () => {
  it('exposes source, definition, missing freshness, retrieval and evidence separately', () => {
    render(
      <ExperienceV3Root role="school-admin">
        <MetricTrust
          source="School overview read model"
          definition="Active learner profiles in the authenticated school."
          freshness={null}
          retrievedAt="12 Jul 2026, 15:45"
          evidenceHref="/school-admin/students?schoolId=school-1"
        />
      </ExperienceV3Root>,
    );

    fireEvent.click(screen.getByText('Data details'));
    expect(screen.getByText('School overview read model')).toBeInTheDocument();
    expect(screen.getByText('Active learner profiles in the authenticated school.')).toBeInTheDocument();
    expect(screen.getByText('Source freshness').nextElementSibling).toHaveTextContent('—');
    expect(screen.getByText('Retrieved').nextElementSibling).toHaveTextContent('12 Jul 2026, 15:45');
    expect(screen.getByRole('link', { name: /View supporting evidence/i })).toHaveAttribute(
      'href',
      '/school-admin/students?schoolId=school-1',
    );
  });

  it('labels estimates and states when drill-down evidence is unavailable', () => {
    render(
      <ExperienceV3Root role="super-admin">
        <MetricTrust source="Forecast model" definition="Projected value." estimated />
      </ExperienceV3Root>,
    );

    expect(screen.getByText('Estimated')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Data details'));
    expect(screen.getByText('Supporting evidence —')).toBeInTheDocument();
  });

  it('localizes compact trust labels in Hindi', () => {
    render(
      <ExperienceV3Root role="student">
        <MetricTrust locale="hi" source="लर्निंग स्रोत" definition="लंबी प्रमाणित परिभाषा" freshness={null} estimated />
      </ExperienceV3Root>,
    );

    expect(screen.getByText('डेटा विवरण')).toBeInTheDocument();
    expect(screen.getByText('अनुमानित')).toBeInTheDocument();
    fireEvent.click(screen.getByText('डेटा विवरण'));
    expect(screen.getByText('स्रोत')).toBeInTheDocument();
    expect(screen.getByText('परिभाषा')).toBeInTheDocument();
    expect(screen.getByText('स्रोत की ताज़गी')).toBeInTheDocument();
    expect(screen.getByText('सहायक प्रमाण —')).toBeInTheDocument();
  });
});
