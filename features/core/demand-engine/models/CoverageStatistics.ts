/**
 * CoverageStatistics — aggregate metrics over a whole demand's coverage.
 */
export interface CoverageStatistics {
  readonly totalRequirements: number
  readonly covered: number
  readonly underCovered: number
  readonly overCovered: number
  readonly requirementsWithMissingCapabilities: number
  /** Sum of every requirement's `minEmployees`. */
  readonly totalRequiredMin: number
  /** Sum of every requirement's covering head-count. */
  readonly totalAssigned: number
  /** Share of requirements meeting their minimum, in `[0, 1]`. */
  readonly overallCoveragePercentage: number
}
