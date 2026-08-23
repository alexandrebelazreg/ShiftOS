import type { SetupSector } from "@/features/onboarding/setup-readiness"
import { sectorStore } from "@/features/sectors/sector.store"

/** Compatibility adapter retained for onboarding and employee assignment screens. */
export function createSetupRepository() {
  // Le stockage n'est plus choisi ici : `sectorStore` décide entre la base et
  // le navigateur. L'argument reste accepté pour ne pas toucher aux appelants,
  // et est délibérément ignoré.
  return {
    listSectors: (): Promise<SetupSector[]> => sectorStore.list(),
    saveSectors: (sectors: readonly SetupSector[]): Promise<void> => sectorStore.save(sectors),
  }
}
