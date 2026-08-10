import { expect, it } from "vitest"

import { validatedPaidLeaveAbsences } from "@/features/paid-leave/dashboard/validated-paid-leave"
import type { PaidLeaveCampaign } from "@/features/paid-leave/models/paid-leave-campaign"

it("uses the validated snapshot and merges consecutive weeks", () => {
  const campaign = {
    id: "summer",
    validatedSnapshot: {
      validatedAt: "2026-04-01T10:00:00.000Z",
      grants: { alice: ["2026-W20", "2026-W21"] },
      reinforcementAllocations: [],
      fullFirstChoiceEmployeeIds: ["alice"],
    },
    grants: { alice: ["2026-W30"] },
  } as unknown as PaidLeaveCampaign

  expect(validatedPaidLeaveAbsences([campaign])).toEqual([
    expect.objectContaining({
      employeeId: "alice",
      start: "2026-05-11",
      end: "2026-05-24",
      type: "paid_leave",
    }),
  ])
})

it("ignores campaigns that have never been validated", () => {
  const campaign = {
    id: "draft",
    validatedSnapshot: null,
    grants: { alice: ["2026-W20"] },
  } as unknown as PaidLeaveCampaign

  expect(validatedPaidLeaveAbsences([campaign])).toEqual([])
})
