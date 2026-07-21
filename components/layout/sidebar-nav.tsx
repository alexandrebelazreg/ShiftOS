"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import { configurationItem, navItems } from "@/components/layout/nav-config"
import { cn } from "@/lib/utils"

/**
 * Shared sidebar content (brand + navigation + footer).
 * Rendered by both the desktop rail and the mobile drawer so the
 * navigation stays defined in a single place.
 *
 * @param onNavigate - optional callback fired on link click (used by the
 *   mobile drawer to close itself after navigating).
 */
export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname()

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      {/* Brand */}
      <div className="flex h-14 shrink-0 items-center gap-2 px-4">
        <div className="flex size-7 items-center justify-center rounded-md bg-sidebar-primary text-sm font-bold text-sidebar-primary-foreground">
          S
        </div>
        <span className="text-sm font-semibold tracking-tight">ShiftOS</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2">
        {navItems.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(`${item.href}/`)
          const Icon = item.icon

          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
              )}
            >
              <Icon className="size-4 shrink-0" />
              {item.title}
            </Link>
          )
        })}
      </nav>

      {/* Footer / workspace */}
      <div className="shrink-0 border-t border-sidebar-border p-3">
        <NavigationLink item={configurationItem} pathname={pathname} onNavigate={onNavigate} />
        <div className="flex items-center gap-2.5 rounded-md px-2.5 py-2">
          <div className="flex size-7 items-center justify-center rounded-full bg-sidebar-accent text-xs font-medium">
            SO
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">ShiftOS</p>
            <p className="truncate text-xs text-sidebar-foreground/60">
              Espace de travail
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

function NavigationLink({ item, pathname, onNavigate }: { item: (typeof navItems)[number]; pathname: string; onNavigate?: () => void }) {
  const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
  const Icon = item.icon
  return <Link href={item.href} onClick={onNavigate} aria-current={active ? "page" : undefined} className={cn("mb-2 flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors", active ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground")}><Icon className="size-4 shrink-0" />{item.title}</Link>
}
