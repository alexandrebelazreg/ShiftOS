import type { PaidLeaveCampaign } from "@/features/paid-leave/models/paid-leave-campaign"

const INDEX_KEY = "shiftos_paid_leave_campaign_index"
const ACTIVE_KEY = "shiftos_paid_leave_active_campaign"
const KEY_PREFIX = "shiftos_paid_leave_campaign_"

export interface PaidLeaveRepository {
  list(): Promise<PaidLeaveCampaign[]>
  get(id: string): Promise<PaidLeaveCampaign | null>
  save(campaign: PaidLeaveCampaign): Promise<void>
  remove(id: string): Promise<void>
  activeId(): Promise<string | null>
  setActiveId(id: string): Promise<void>
}

export function createPaidLeaveRepository(
  storage: Pick<Storage, "getItem" | "removeItem" | "setItem">
): PaidLeaveRepository {
  const readIndex = (): string[] => {
    try {
      const value: unknown = JSON.parse(storage.getItem(INDEX_KEY) ?? "[]")
      return Array.isArray(value)
        ? value.filter((entry): entry is string => typeof entry === "string")
        : []
    } catch {
      return []
    }
  }

  const get = (id: string): PaidLeaveCampaign | null => {
    try {
      const value: unknown = JSON.parse(storage.getItem(`${KEY_PREFIX}${id}`) ?? "null")
      return isPaidLeaveCampaign(value) ? value : null
    } catch {
      return null
    }
  }

  return {
    async list() {
      return readIndex()
        .flatMap((id) => {
          const campaign = get(id)
          return campaign ? [campaign] : []
        })
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    },
    async get(id) {
      return get(id)
    },
    async save(campaign) {
      storage.setItem(`${KEY_PREFIX}${campaign.id}`, JSON.stringify(campaign))
      const index = readIndex()
      if (!index.includes(campaign.id)) {
        storage.setItem(INDEX_KEY, JSON.stringify([campaign.id, ...index]))
      }
    },
    async remove(id) {
      storage.removeItem(`${KEY_PREFIX}${id}`)
      storage.setItem(INDEX_KEY, JSON.stringify(readIndex().filter((entry) => entry !== id)))
      if (storage.getItem(ACTIVE_KEY) === id) storage.removeItem(ACTIVE_KEY)
    },
    async activeId() {
      return storage.getItem(ACTIVE_KEY)
    },
    async setActiveId(id) {
      storage.setItem(ACTIVE_KEY, id)
    },
  }
}

function isPaidLeaveCampaign(value: unknown): value is PaidLeaveCampaign {
  if (typeof value !== "object" || value === null) return false
  const record = value as Record<string, unknown>
  return (
    record.schemaVersion === 1 &&
    typeof record.id === "string" &&
    typeof record.name === "string" &&
    typeof record.year === "number" &&
    typeof record.period === "object" &&
    typeof record.employeeSettings === "object" &&
    typeof record.requests === "object" &&
    typeof record.coverage === "object" &&
    Array.isArray(record.reinforcementPools) &&
    typeof record.grants === "object" &&
    typeof record.createdAt === "string" &&
    typeof record.updatedAt === "string"
  )
}
