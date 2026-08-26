import { Bell } from "lucide-react"

import { MobileSidebar } from "@/components/layout/mobile-sidebar"
import { UserMenu } from "@/components/layout/user-menu"
import { CURRENT_USER } from "@/lib/current-user"
import { Button } from "@/components/ui/button"

/**
 * Fixed top header. Stays put while the main content scrolls.
 * On mobile it hosts the navigation trigger; on all sizes it holds
 * notifications and the current user.
 *
 * LA RECHERCHE A ÉTÉ RETIRÉE. C'était un `<input>` sans état, sans écouteur et
 * sans destination : taper dedans ne cherchait rien. Un champ qui promet une
 * fonction inexistante coûte plus qu'il ne rapporte — on l'essaie, il ne
 * répond pas, et on doute du reste de l'écran. Il reviendra le jour où il y
 * aura quelque chose à chercher.
 */
export function Header() {
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background/80 px-4 backdrop-blur sm:gap-4 sm:px-6">
      <MobileSidebar />

      <div className="flex-1" />

      <div className="flex items-center gap-1 sm:gap-2">
        <Button variant="ghost" size="icon" aria-label="Notifications">
          <Bell />
        </Button>
        <UserMenu name={CURRENT_USER} />
      </div>
    </header>
  )
}
