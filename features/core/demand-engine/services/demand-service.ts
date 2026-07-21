import type { DateRange, StoreId } from "@/features/core/models"

import type { Demand } from "@/features/core/demand-engine/models"

/**
 * DemandService — provides the workforce demand for a store over a period.
 * Contract only (no implementation); the source of demand (config, forecast, …)
 * is out of scope here.
 */
export interface DemandService {
  getDemand(storeId: StoreId, period: DateRange): Promise<Demand>
}
