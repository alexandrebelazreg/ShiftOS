import { describe, expect, it } from "vitest"

import {
  buildRegistry,
  coreConstraintPack,
  coverageConstraintDefinition,
  createConstraintCatalog,
  createDefaultCatalog,
  defineConstraint,
  loadPack,
  type ConstraintDefinition,
} from "@/features/core/constraint-catalog"
import { constraintEvaluator } from "@/features/core/constraint-engine"

import {
  ALL_DAYS,
  assignment,
  contract,
  dailyShift,
  employee,
  makeContext,
} from "@/features/core/constraint-engine/__tests__/fixtures"

const disabledDefinition: ConstraintDefinition = defineConstraint({
  id: "test.disabled",
  name: "Disabled test constraint",
  category: "legal",
  description: "Never loaded because it is disabled by default.",
  priority: "low",
  type: "soft",
  enabledByDefault: false,
  configurable: false,
  parameters: [],
  tags: ["test"],
  version: "1.0.0",
  evaluate: () => (context) => ({
    constraintId: "test.disabled",
    outcome: "pass",
    violations: [],
  }),
})

describe("ConstraintCatalog", () => {
  it("registers and retrieves a constraint definition", () => {
    const catalog = createConstraintCatalog()
    catalog.registerConstraint(coverageConstraintDefinition)

    expect(catalog.getConstraints()).toHaveLength(1)
    expect(catalog.getConstraint("coverage.shift_coverage")).toBe(
      coverageConstraintDefinition
    )
  })

  it("rejects duplicate ids", () => {
    const catalog = createConstraintCatalog()
    catalog.registerConstraint(coverageConstraintDefinition)
    expect(() =>
      catalog.registerConstraint(coverageConstraintDefinition)
    ).toThrow(/duplicate/i)
  })

  it("returns undefined for an unknown constraint", () => {
    const catalog = createDefaultCatalog()
    expect(catalog.getConstraint("does.not.exist")).toBeUndefined()
  })

  it("excludes a disabled constraint from the enabled set and the registry", () => {
    const catalog = createDefaultCatalog()
    catalog.registerConstraint(disabledDefinition)

    expect(catalog.getConstraints()).toHaveLength(4)
    expect(
      catalog.getEnabledConstraints().map((d) => d.id)
    ).not.toContain("test.disabled")

    const registry = buildRegistry(catalog)
    expect(registry.has("test.disabled")).toBe(false)
    expect(registry.all()).toHaveLength(3)
  })

  it("filters constraints by category", () => {
    const catalog = createDefaultCatalog()
    const coverage = catalog.getConstraintsByCategory("coverage")
    expect(coverage.map((d) => d.id)).toEqual(["coverage.shift_coverage"])
    expect(catalog.getConstraintsByCategory("availability")).toHaveLength(1)
    expect(catalog.getConstraintsByCategory("nonexistent")).toEqual([])
  })

  it("exposes every constraint's own metadata", () => {
    const definition = coverageConstraintDefinition
    expect(definition.name).toBe("Shift coverage")
    expect(definition.type).toBe("hard")
    expect(definition.priority).toBe("critical")
    expect(definition.enabledByDefault).toBe(true)
    expect(definition.configurable).toBe(true)
    expect(definition.version).toBe("1.0.0")
    expect(definition.parameters.map((p) => p.key)).toContain(
      "minAssignmentsPerShift"
    )
    expect(definition.tags).toContain("coverage")
  })

  it("loads packs — the core pack yields the three built-ins", () => {
    const catalog = createConstraintCatalog()
    loadPack(catalog, coreConstraintPack)
    expect(catalog.getConstraints().map((d) => d.id).sort()).toEqual([
      "availability.employee_availability",
      "coverage.shift_coverage",
      "workload.contract_hours",
    ])
  })

  it("Catalog → buildRegistry → Evaluator runs, honoring per-constraint config", () => {
    const catalog = createDefaultCatalog()
    // Require 2 employees per shift; a shift with a single assignment must fail.
    const registry = buildRegistry(catalog, {
      config: { "coverage.shift_coverage": { minAssignmentsPerShift: 2 } },
    })
    const shift = dailyShift("s1", "2026-07-06")
    const report = constraintEvaluator.evaluate(
      registry,
      makeContext({
        employees: [employee()],
        contracts: [contract(ALL_DAYS)],
        shifts: [shift],
        assignments: [assignment(shift.id)],
      })
    )

    expect(report.constraints).toHaveLength(3)
    expect(
      report.constraints.find((c) => c.constraintId === "coverage.shift_coverage")
        ?.outcome
    ).toBe("fail")
  })
})
