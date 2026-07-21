import {
  LayoutDashboard,
  CalendarDays,
  Palmtree,
  UserRoundX,
  Settings,
  type LucideIcon,
} from "lucide-react"

/**
 * Single source of truth for the primary navigation.
 * Add a route here and it shows up in the sidebar automatically.
 */
export type NavItem = {
  title: string
  href: string
  icon: LucideIcon
}

/** Daily operations only. Configuration deliberately lives outside this list. */
export const navItems: NavItem[] = [
  { title: "Tableau de bord", href: "/dashboard", icon: LayoutDashboard },
  { title: "Planning", href: "/planning", icon: CalendarDays },
  { title: "Congés", href: "/conges", icon: Palmtree },
  { title: "Absences", href: "/absences", icon: UserRoundX },
]

export const configurationItem: NavItem = {
  title: "Configuration",
  href: "/configuration",
  icon: Settings,
}
