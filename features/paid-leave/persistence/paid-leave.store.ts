import { createSupabaseBrowserClient } from "@/features/auth/supabase/browser"
import { supabaseConfigured } from "@/features/auth/supabase/config"
import { browserStore } from "@/features/core/shared/key-value-store"
import {
  createPaidLeaveRepository,
  type PaidLeaveRepository,
} from "@/features/paid-leave/persistence/paid-leave-repository"
import { createSupabasePaidLeaveRepository } from "@/features/paid-leave/persistence/paid-leave.supabase-repository"

/** Les campagnes de congés, et le choix de leur source. */
function repository(): PaidLeaveRepository {
  if (supabaseConfigured() && typeof window !== "undefined") {
    return createSupabasePaidLeaveRepository(createSupabaseBrowserClient())
  }
  return createPaidLeaveRepository(browserStore())
}

export const paidLeaveStore: PaidLeaveRepository = {
  list: () => repository().list(),
  get: (id) => repository().get(id),
  save: (campaign) => repository().save(campaign),
  remove: (id) => repository().remove(id),
  activeId: () => repository().activeId(),
  setActiveId: (id) => repository().setActiveId(id),
}
