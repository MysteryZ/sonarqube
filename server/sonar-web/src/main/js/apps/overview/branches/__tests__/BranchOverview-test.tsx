/*
 * SonarQube
 * Copyright (C) 2009-2023 SonarSource SA
 * mailto:info AT sonarsource DOT com
 *
 * This program is free software; you can redistribute it and/or
 * modify it under the terms of the GNU Lesser General Public
 * License as published by the Free Software Foundation; either
 * version 3 of the License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with this program; if not, write to the Free Software Foundation,
 * Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA.
 */
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';
import selectEvent from 'react-select-event';
import { getMeasuresWithPeriodAndMetrics } from '../../../../api/measures';
import { getProjectActivity } from '../../../../api/projectActivity';
import { getQualityGateProjectStatus } from '../../../../api/quality-gates';
import CurrentUserContextProvider from '../../../../app/components/current-user/CurrentUserContextProvider';
import { getActivityGraph, saveActivityGraph } from '../../../../components/activity-graph/utils';
import { isDiffMetric } from '../../../../helpers/measures';
import { mockMainBranch } from '../../../../helpers/mocks/branch-like';
import { mockComponent } from '../../../../helpers/mocks/component';
import { mockAnalysis } from '../../../../helpers/mocks/project-activity';
import { mockQualityGateProjectStatus } from '../../../../helpers/mocks/quality-gates';
import { mockLoggedInUser, mockPeriod } from '../../../../helpers/testMocks';
import { renderComponent } from '../../../../helpers/testReactTestingUtils';
import { ComponentQualifier } from '../../../../types/component';
import { MetricKey } from '../../../../types/metrics';
import { GraphType } from '../../../../types/project-activity';
import { Measure, Metric } from '../../../../types/types';
import BranchOverview, { BRANCH_OVERVIEW_ACTIVITY_GRAPH, NO_CI_DETECTED } from '../BranchOverview';

jest.mock('../../../../api/measures', () => {
  const { mockMeasure, mockMetric } = jest.requireActual('../../../../helpers/testMocks');
  return {
    getMeasuresWithPeriodAndMetrics: jest.fn((_, metricKeys: string[]) => {
      const metrics: Metric[] = [];
      const measures: Measure[] = [];
      metricKeys.forEach((key) => {
        if (key === 'unknown_metric') {
          return;
        }

        let type;
        if (/(coverage|duplication)$/.test(key)) {
          type = 'PERCENT';
        } else if (/_rating$/.test(key)) {
          type = 'RATING';
        } else {
          type = 'INT';
        }
        metrics.push(mockMetric({ key, id: key, name: key, type }));
        measures.push(
          mockMeasure({
            metric: key,
            ...(isDiffMetric(key) ? { leak: '1' } : { period: undefined }),
          })
        );
      });
      return Promise.resolve({
        component: {
          measures,
          name: 'foo',
        },
        metrics,
      });
    }),
  };
});

jest.mock('../../../../api/quality-gates', () => {
  const { mockQualityGateProjectStatus, mockQualityGateApplicationStatus } = jest.requireActual(
    '../../../../helpers/mocks/quality-gates'
  );
  const { MetricKey } = jest.requireActual('../../../../types/metrics');
  return {
    getQualityGateProjectStatus: jest.fn().mockResolvedValue(
      mockQualityGateProjectStatus({
        status: 'ERROR',
        conditions: [
          {
            actualValue: '2',
            comparator: 'GT',
            errorThreshold: '1',
            metricKey: MetricKey.new_reliability_rating,
            periodIndex: 1,
            status: 'ERROR',
          },
          {
            actualValue: '5',
            comparator: 'GT',
            errorThreshold: '2.0',
            metricKey: MetricKey.bugs,
            periodIndex: 0,
            status: 'ERROR',
          },
          {
            actualValue: '2',
            comparator: 'GT',
            errorThreshold: '1.0',
            metricKey: 'unknown_metric',
            periodIndex: 0,
            status: 'ERROR',
          },
        ],
      })
    ),
    getApplicationQualityGate: jest.fn().mockResolvedValue(mockQualityGateApplicationStatus()),
  };
});

jest.mock('../../../../api/time-machine', () => {
  const { MetricKey } = jest.requireActual('../../../../types/metrics');
  return {
    getAllTimeMachineData: jest.fn().mockResolvedValue({
      measures: [
        { metric: MetricKey.bugs, history: [{ date: '2019-01-05', value: '2.0' }] },
        { metric: MetricKey.vulnerabilities, history: [{ date: '2019-01-05', value: '0' }] },
        { metric: MetricKey.sqale_index, history: [{ date: '2019-01-01', value: '1.0' }] },
        {
          metric: MetricKey.duplicated_lines_density,
          history: [{ date: '2019-01-02', value: '1.0' }],
        },
        { metric: MetricKey.ncloc, history: [{ date: '2019-01-03', value: '10000' }] },
        { metric: MetricKey.coverage, history: [{ date: '2019-01-04', value: '95.5' }] },
      ],
    }),
  };
});

jest.mock('../../../../api/projectActivity', () => {
  const { mockAnalysis } = jest.requireActual('../../../../helpers/mocks/project-activity');
  return {
    getProjectActivity: jest.fn().mockResolvedValue({
      analyses: [
        mockAnalysis({ detectedCI: 'Cirrus CI' }),
        mockAnalysis(),
        mockAnalysis(),
        mockAnalysis(),
        mockAnalysis(),
      ],
    }),
  };
});

jest.mock('../../../../api/application', () => ({
  getApplicationDetails: jest.fn().mockResolvedValue({
    branches: [],
    key: 'key-1',
    name: 'app',
    projects: [
      {
        branch: 'foo',
        key: 'KEY-P1',
        name: 'P1',
      },
    ],
    visibility: 'Private',
  }),
  getApplicationLeak: jest.fn().mockResolvedValue([
    {
      date: '2017-01-05',
      project: 'foo',
      projectName: 'Foo',
    },
  ]),
}));

jest.mock('../../../../components/activity-graph/utils', () => {
  const { MetricKey } = jest.requireActual('../../../../types/metrics');
  const { GraphType } = jest.requireActual('../../../../types/project-activity');
  const original = jest.requireActual('../../../../components/activity-graph/utils');
  return {
    ...original,
    getActivityGraph: jest.fn(() => ({ graph: GraphType.coverage })),
    saveActivityGraph: jest.fn(),
    getHistoryMetrics: jest.fn(() => [MetricKey.lines_to_cover, MetricKey.uncovered_lines]),
  };
});

beforeEach(jest.clearAllMocks);

describe('project overview', () => {
  it('should show a successful QG', async () => {
    const user = userEvent.setup();
    jest
      .mocked(getQualityGateProjectStatus)
      .mockResolvedValueOnce(mockQualityGateProjectStatus({ status: 'OK' }));
    renderBranchOverview();

    // QG panel
    expect(await screen.findByText('metric.level.OK')).toBeInTheDocument();
    expect(screen.getByText('overview.quality_gate_all_conditions_passed')).toBeInTheDocument();
    expect(
      screen.queryByText('overview.quality_gate.conditions.cayc.warning')
    ).not.toBeInTheDocument();

    //Measures panel
    expect(screen.getByText('metric.new_vulnerabilities.name')).toBeInTheDocument();

    // go to overall
    await user.click(screen.getByText('overview.overall_code'));

    expect(screen.getByText('metric.vulnerabilities.name')).toBeInTheDocument();
  });

  it('should show a successful non-compliant QG', async () => {
    jest
      .mocked(getQualityGateProjectStatus)
      .mockResolvedValueOnce(
        mockQualityGateProjectStatus({ status: 'OK', isCaycCompliant: false })
      );

    renderBranchOverview();

    expect(await screen.findByText('metric.level.OK')).toBeInTheDocument();
    expect(screen.getByText('overview.quality_gate.conditions.cayc.warning')).toBeInTheDocument();
  });

  it('should show a failed QG', async () => {
    renderBranchOverview();

    expect(await screen.findByText('metric.level.ERROR')).toBeInTheDocument();
    expect(screen.getByText('overview.X_conditions_failed.2')).toBeInTheDocument();

    expect(
      screen.queryByText('overview.quality_gate.conditions.cayc.passed')
    ).not.toBeInTheDocument();
  });

  it('should show a failed QG with passing CAYC conditions', async () => {
    jest.mocked(getQualityGateProjectStatus).mockResolvedValueOnce(
      mockQualityGateProjectStatus({
        status: 'ERROR',
        conditions: [
          {
            actualValue: '12',
            comparator: 'GT',
            errorThreshold: '10',
            metricKey: MetricKey.new_bugs,
            periodIndex: 1,
            status: 'ERROR',
          },
        ],
      })
    );
    renderBranchOverview();

    expect(await screen.findByText('metric.level.ERROR')).toBeInTheDocument();
    expect(screen.getByText('overview.quality_gate.conditions.cayc.passed')).toBeInTheDocument();
  });

  it('should correctly show a project as empty', async () => {
    jest.mocked(getMeasuresWithPeriodAndMetrics).mockResolvedValueOnce({
      component: { key: '', name: '', qualifier: ComponentQualifier.Project, measures: [] },
      metrics: [],
      period: mockPeriod(),
    });

    renderBranchOverview();

    expect(await screen.findByText('overview.project.main_branch_empty')).toBeInTheDocument();
  });
});

describe('application overview', () => {
  const component = mockComponent({
    breadcrumbs: [mockComponent({ key: 'foo', qualifier: ComponentQualifier.Application })],
    qualifier: ComponentQualifier.Application,
  });

  it('should show failed conditions for every project', async () => {
    renderBranchOverview({ component });
    expect(await screen.findByText('Foo')).toBeInTheDocument();
    expect(screen.getByText('Bar')).toBeInTheDocument();
  });

  it('should correctly show an app as empty', async () => {
    jest.mocked(getMeasuresWithPeriodAndMetrics).mockResolvedValueOnce({
      component: { key: '', name: '', qualifier: ComponentQualifier.Application, measures: [] },
      metrics: [],
      period: mockPeriod(),
    });

    renderBranchOverview({ component });

    expect(await screen.findByText('portfolio.app.empty')).toBeInTheDocument();
  });
});

it.each([
  ['no analysis', [], true],
  ['1 analysis, no CI data', [mockAnalysis()], false],
  ['1 analysis, no CI detected', [mockAnalysis({ detectedCI: NO_CI_DETECTED })], false],
  ['1 analysis, CI detected', [mockAnalysis({ detectedCI: 'Cirrus CI' })], true],
])(
  "should correctly flag a project that wasn't analyzed using a CI (%s)",
  async (_, analyses, expected) => {
    (getProjectActivity as jest.Mock).mockResolvedValueOnce({ analyses });

    renderBranchOverview();

    // wait for loading
    await screen.findByText('overview.quality_gate');

    expect(screen.queryByText('overview.project.next_steps.set_up_ci') === null).toBe(expected);
  }
);

it('should correctly handle graph type storage', async () => {
  renderBranchOverview();
  expect(getActivityGraph).toHaveBeenCalledWith(BRANCH_OVERVIEW_ACTIVITY_GRAPH, 'foo');

  const select = await screen.findByLabelText('project_activity.graphs.choose_type');
  await selectEvent.select(select, `project_activity.graphs.${GraphType.issues}`);

  expect(saveActivityGraph).toHaveBeenCalledWith(
    BRANCH_OVERVIEW_ACTIVITY_GRAPH,
    'foo',
    GraphType.issues
  );
});

function renderBranchOverview(props: Partial<BranchOverview['props']> = {}) {
  renderComponent(
    <CurrentUserContextProvider currentUser={mockLoggedInUser()}>
      <BranchOverview
        branch={mockMainBranch()}
        component={mockComponent({
          breadcrumbs: [mockComponent({ key: 'foo' })],
          key: 'foo',
          name: 'Foo',
        })}
        {...props}
      />
    </CurrentUserContextProvider>
  );
}
