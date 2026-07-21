import type { DateRange } from "@/features/core/models"

/**
 * A period over which availability, statistics and history are scoped.
 *
 * It is exactly a core `DateRange` (inclusive `[start, end]`). Kept as a named
 * alias so call sites read as "period", while the shape stays defined once in
 * the core — no duplication.
 */
export type Period = DateRange
