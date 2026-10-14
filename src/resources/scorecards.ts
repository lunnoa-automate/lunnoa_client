import type { HttpClient } from '../core/http';

export type ScorecardMeasureStatus = 'ON_TRACK' | 'AT_RISK' | 'OFF_TRACK' | 'NO_DATA';

export type ScorecardSummary = {
  id: string;
  name: string;
  periodLabel: string | null;
  description: string | null;
  FK_ownerId: string | null;
  createdAt: string;
  _count: { objectives: number };
};

export type ScorecardMeasure = {
  id: string;
  name: string;
  unit: string;
  currency: string | null;
  direction: 'HIGHER_IS_BETTER' | 'LOWER_IS_BETTER';
  kind: 'LEADING' | 'LAGGING';
  cadence: 'DAILY' | 'WEEKLY' | 'MONTHLY';
  sourceType: 'MANUAL' | 'API' | 'WORKFLOW' | 'BUILT_IN';
  builtInKey: string | null;
  target: number;
  atRiskThreshold: number | null;
  latest: { value: number; periodStart: string; createdAt: string } | null;
  previousValue: number | null;
  series: { periodStart: string; value: number }[];
  status: ScorecardMeasureStatus;
  stale: boolean;
};

export type ScorecardObjective = {
  id: string;
  perspective: 'FINANCIAL' | 'CUSTOMER' | 'PROCESS' | 'LEARNING';
  name: string;
  description: string | null;
  ownerLabel: string | null;
  drivesIds: string[];
  position: number;
  status: ScorecardMeasureStatus;
  measures: ScorecardMeasure[];
};

export type Scorecard = Omit<ScorecardSummary, '_count'> & {
  aiSpendUsdThisMonth: number;
  objectives: ScorecardObjective[];
};

export type ScorecardMeasureValue = {
  id: string;
  FK_measureId: string;
  periodStart: string;
  value: number;
  note: string | null;
  sourceType: ScorecardMeasure['sourceType'];
  supersededAt: string | null;
  createdAt: string;
};

export type RecordMeasureValueInput = {
  value: number;
  /** Any ISO date inside the target period; defaults to the current period. */
  period?: string;
  note?: string;
};

/**
 * Balanced Scorecard (workspace API). Pushing values needs `scorecard:record`.
 */
export class ScorecardsResource {
  constructor(private readonly http: HttpClient) {}

  /** Lists scorecards in the workspace. */
  list(): Promise<ScorecardSummary[]> {
    return this.http.get<ScorecardSummary[]>('/api/scorecards');
  }

  /** Returns a scorecard with objectives, measures, latest values and status. */
  get(scorecardId: string): Promise<Scorecard> {
    return this.http.get<Scorecard>(`/api/scorecards/${scorecardId}`);
  }

  /**
   * Records a measure value. A value for the same period replaces the current
   * one; the old value is kept as superseded history.
   */
  recordValue(
    measureId: string,
    data: RecordMeasureValueInput,
  ): Promise<ScorecardMeasureValue> {
    return this.http.post<ScorecardMeasureValue>(
      `/api/scorecards/measures/${measureId}/values`,
      { body: data },
    );
  }
}
