"use client"

import { useState } from "react"
import { Menu } from "lucide-react"

import { SidebarNav, type SidebarIdentity } from "@/components/layout/sidebar-nav"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"

/**
 * Mobile navigation: a menu button that opens the sidebar in a left drawer.
 * Visible below `lg` only. Closes automatically after navigating.
 */
export function MobileSidebar({ identity }: { readonly identity: SidebarIdentity }) {
  const [open, setOpen] = useState(false)

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            aria-label="Open navigation"
          />
        }
      >
        <Menu />
      </SheetTrigger>
      <SheetContent side="left" className="w-64 p-0" showCloseButton={false}>
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        <SidebarNav identity={identity} onNavigate={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  )
}
