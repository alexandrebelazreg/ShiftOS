export {
  demandedMinutesOn,
  structuralSurplusOf,
  validatePlanningSolutionV3,
} from "@/features/core/planning-v3/validator/validate-solution"
export {
  MAXIMUM_SECTORS_PER_DAY,
  MAXIMUM_SECTOR_SWITCHES_PER_DAY,
  MINIMUM_SECTOR_ASSIGNMENT_MINUTES,
  normalizedSectorAssignments,
  validateSectorAssignments,
} from "@/features/core/planning-v3/validator/sector-assignment-invariants"
export {
  fingerprintProblem,
  fingerprintSolution,
} from "@/features/core/planning-v3/validator/fingerprint"
