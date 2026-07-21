import { Bell, Search } from "lucide-react"

import { MobileSidebar } from "@/components/layout/mobile-sidebar"
import { UserMenu } from "@/components/layout/user-menu"
import { CURRENT_USER } from "@/lib/current-user"
import { Button } from "@/components/ui/button"

/**
 * Fixed top header. Stays put while the main content scrolls.
 * On mobile it hosts the navigation trigger; on all sizes it holds
 * search, notifications and the current user.
 */
export function Header() {
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background/80 px-4 backdrop-blur sm:gap-4 sm:px-6">
      <MobileSidebar />

      <div className="flex flex-1 items-center">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Rechercher…"
            aria-label="Rechercher"
            className="h-8 w-full rounded-lg border border-border bg-muted/40 pl-8 pr-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        </div>
      </div>

      <div className="flex items-center gap-1 sm:gap-2">
        <Button variant="ghost" size="icon" aria-label="Notifications">
          <Bell />
        </Button>
        <UserMenu name={CURRENT_USER} />
      </div>
    </header>
  )
}
