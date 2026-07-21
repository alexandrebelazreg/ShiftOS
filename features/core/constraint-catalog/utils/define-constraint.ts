import type { Constraint } from "@/features/core/constraint-engine/models"

import type {
  ConstraintConfig,
  ConstraintDefinition,
  ConstraintSpec,
} from "@/features/core/constraint-catalog/types"

/**
 * Builds a `ConstraintDefinition` from a spec.
 *
 * Metadata is declared once in the spec; both the definition and the runtime
 * `Constraint` produced by `create()` derive from it — so classification and
 * metadata are never duplicated. Each constraint file calls this once and thus
 * owns its own metadata.
 */
export function defineConstraint(spec: ConstraintSpec): ConstraintDefinition {
  return {
    id: spec.id,
    name: spec.name,
    category: spec.category,
    description: spec.description,
    priority: spec.priority,
    type: spec.type,
    enabledByDefault: spec.enabledByDefault,
    configurable: spec.configurable,
    parameters: spec.parameters,
    tags: spec.tags,
    version: spec.version,

    create(config: ConstraintConfig = {}): Constraint {
      const evaluate = spec.evaluate(config)
      return {
        id: spec.id,
        category: spec.category,
        type: spec.type,
        priority: spec.priority,
        enabled: spec.enabledByDefault,
        metadata: { label: spec.name, description: spec.description },
        evaluate,
      }
    },
  }
}
