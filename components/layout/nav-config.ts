import {
  LayoutDashboard,
  CalendarDays,
  Printer,
  CalendarHeart,
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
  // Juste après le planning, parce que c'est ce qui vient après : on planifie,
  // on publie, on affiche. L'écran ne connaît que les semaines publiées.
  { title: "Affichage", href: "/affichage", icon: Printer },
  // Avant les congés : un férié se règle pour toute l'année, alors qu'un congé
  // se traite au fil de l'eau.
  { title: "Jours fériés", href: "/feries", icon: CalendarHeart },
  { title: "Congés", href: "/conges", icon: Palmtree },
  { title: "Absences", href: "/absences", icon: UserRoundX },
]

export const configurationItem: NavItem = {
  title: "Configuration",
  href: "/configuration",
  icon: Settings,
}
