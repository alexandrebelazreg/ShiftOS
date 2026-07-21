import { SidebarNav } from "@/components/layout/sidebar-nav"

/**
 * Fixed left sidebar (desktop only). Hidden below `lg`, where navigation
 * is served by the `MobileSidebar` drawer instead.
 */
export function Sidebar() {
  return (
    <aside className="hidden w-60 shrink-0 border-r border-sidebar-border lg:block">
      <SidebarNav />
    </aside>
  )
}
