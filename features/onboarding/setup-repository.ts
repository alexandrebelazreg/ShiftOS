import type { SetupSector } from "@/features/onboarding/setup-readiness"
import { createSectorRepository } from "@/features/sectors"

/** Compatibility adapter retained for onboarding and employee assignment screens. */
export function createSetupRepository(storage: Storage) {
  const repository = createSectorRepository(storage)
  return { listSectors: (): SetupSector[] => repository.list(), saveSectors: (sectors: readonly SetupSector[]) => repository.save(sectors) }
}
