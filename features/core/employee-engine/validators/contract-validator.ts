import type { Contract } from "@/features/core/models"

import type { ValidationResult } from "@/features/core/employee-engine/types"

/**
 * ContractValidator — checks a core `Contract` for internal consistency
 * (e.g. daily bounds vs weekly hours). Contract only; no validation logic.
 */
export interface ContractValidator {
  validate(contract: Contract): ValidationResult
}
