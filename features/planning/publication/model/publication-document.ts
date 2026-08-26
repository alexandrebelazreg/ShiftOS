import type { IsoDate } from "@/features/core/models"
import type {
  BoardShiftVM,
  PlanningBoardInput,
  PlanningBoardViewModel,
} from "@/features/planning/board"
import { buildPlanningBoard } from "@/features/planning/board"
import {
  durationLabel,
  formatDate,
  longDate,
  nameWithUppercaseFamily,
  WEEK_DAY_LABELS,
} from "@/features/planning/board/model/labels"
import { sectorBarPaint, type SectorBarPaint } from "@/features/planning/board/model/sector-paint"

import type { PublicationOptions } from "@/features/planning/publication/model/publication-options"
import { durationWithBreak } from "@/features/planning/publication/model/break-time"

/**
 * Le planning tel qu'il sera punaisé au mur.
 *
 * Ce module ne RECALCULE rien : il rappelle `buildPlanningBoard` avec les mêmes
 * données et une autre sélection, puis range le résultat en feuilles A4. C'est
 * délibéré et c'est la seule garantie qui compte ici — une feuille affichée qui
 * dirait autre chose que l'écran relu avant publication serait un document
 * faux, et personne ne s'en apercevrait avant que quelqu'un vienne travailler
 * un jour où il n'était pas attendu.
 *
 * Ce qui est écarté l'est tout aussi délibérément : ni couverture, ni déficit,
 * ni écart au contrat, ni nom de moteur. Une feuille d'affichage dit qui
 * travaille quand ; le reste est une conversation entre le gérant et son outil.
 */

// ── Ce que le document porte en tête ─────────────────────────────────────────

export interface PublicationContext {
  readonly storeName: string
  /** La ville, quand le magasin en déclare une. Sous le nom, en petit. */
  readonly storeCity: string | null
  /** Le planning est-il encore un brouillon ? La feuille le dit alors en clair. */
  readonly draft: boolean
  /** Quand la feuille a été éditée, déjà formaté par l'appelant. */
  readonly printedAtLabel: string
  /**
   * Le PREMIER rayon de chaque fiche salarié, par identifiant de salarié.
   *
   * Lu de la fiche et non du planning : le planning ne dit que ce qui a été
   * généré, alors que la question posée par une feuille de comptoir est
   * « qui appartient à ce rayon », y compris quelqu'un en vacances toute la
   * semaine. La fiche employé ordonne ses rayons avec des flèches ; le premier
   * est donc un choix délibéré, pas un hasard de saisie.
   */
  readonly primarySectorByEmployee?: Readonly<Record<string, string | null>>
  /**
   * Le nom de chaque salarié, par identifiant, lu de la FICHE.
   *
   * La feuille personnelle en a besoin pour une raison précise : quelqu'un
   * peut n'apparaître dans AUCUN planning des semaines demandées — il n'est
   * pas dans le périmètre généré, ou il est en congé tout le mois. Le board ne
   * connaît alors même pas son nom, et sa feuille disparaissait en silence
   * alors qu'on venait justement de le cocher. Avec son nom, elle sort, et
   * elle dit qu'il n'est attendu nulle part — ce qui est l'information.
   */
  readonly employeeNames?: Readonly<Record<string, string>>
}

// ── Les pièces communes aux trois mises en page ──────────────────────────────

/**
 * Une plage travaillée dans un rayon : la brique de toute feuille.
 *
 * Aucune mention d'ouverture ni de fermeture. Ce sont des notions de PILOTAGE —
 * elles disent au gérant comment la charge se répartit — et sur un mur elles ne
 * font qu'ajouter du texte au-dessus d'une heure qui, elle, se suffit : qui
 * commence à 06:00 ouvre, et n'a pas besoin qu'on le lui écrive.
 */
export interface PublicationSlotVM {
  readonly key: string
  /** `null` quand une seule couleur est affichée : le nommer serait du bruit. */
  readonly sectorName: string | null
  readonly label: string
  readonly durationLabel: string
  readonly paint: SectorBarPaint | null
}

export interface PublicationColumnVM {
  readonly date: IsoDate
  readonly dayLabel: string
  readonly dateLabel: string
  readonly closed: boolean
  /** Le nom du férié — « Fête Nationale » — quand ce jour en est un. */
  readonly holidayName: string | null
}

/** Une case de la grille, alignée sur sa colonne — jamais une recherche. */
export interface PublicationCellVM {
  readonly date: IsoDate
  /**
   * « Repos », « Fermé », ou le traitement du férié en toutes lettres.
   * `null` dès qu'une plage est dessinée.
   */
  readonly emptyLabel: string | null
  /** Vrai quand ce vide est celui d'un jour férié, pour le distinguer à l'œil. */
  readonly holiday: boolean
  readonly slots: readonly PublicationSlotVM[]
}

export interface PublicationRowVM {
  readonly key: string
  readonly name: string
  readonly initials: string
  readonly cells: readonly PublicationCellVM[]
  /** Les heures de la semaine, ou `null` quand les totaux sont masqués. */
  readonly totalLabel: string | null
}

// ── Les feuilles ─────────────────────────────────────────────────────────────

export interface PublicationGridPageVM {
  readonly kind: "grid"
  readonly key: string
  readonly title: string
  readonly subtitle: string | null
  /** L'en-tête de la colonne de gauche : « Salarié », ou « Semaine ». */
  readonly rowHeaderLabel: string
  readonly columns: readonly PublicationColumnVM[]
  readonly rows: readonly PublicationRowVM[]
  /** Le total du jour, aligné sur `columns`. `null` quand ils sont masqués. */
  readonly totals: readonly (string | null)[] | null
  /** Ce que dit la feuille quand elle n'a personne à montrer. */
  readonly emptyLabel: string | null
}

/** Une graduation de la frise du jour, partagée par toutes les barres. */
export interface PublicationHourVM {
  readonly key: number
  readonly label: string
  readonly widthPercent: number
}

export interface PublicationDayEntryVM {
  readonly key: string
  readonly name: string
  readonly initials: string
  readonly label: string
  readonly durationLabel: string
  /**
   * La place de la barre sur la frise, en pourcentage de la journée ouverte.
   *
   * C'est ce qui rend la feuille du jour lisible d'un coup d'œil : les
   * chevauchements, les relais et les creux se VOIENT, là où une liste de
   * « 06:00 – 14:00 » demandait de les reconstituer de tête.
   */
  readonly leftPercent: number
  readonly widthPercent: number
}

export interface PublicationDayGroupVM {
  readonly key: string
  readonly sectorName: string
  readonly paint: SectorBarPaint | null
  readonly entries: readonly PublicationDayEntryVM[]
  readonly totalLabel: string | null
}

export interface PublicationDayPageVM {
  readonly kind: "day"
  readonly key: string
  readonly title: string
  readonly subtitle: string | null
  /** Une seule règle des heures pour toute la feuille : sinon rien n'est comparable. */
  readonly hours: readonly PublicationHourVM[]
  readonly groups: readonly PublicationDayGroupVM[]
  /** « Repos : Marie DUPONT, Paul MARTIN » — la preuve de qui n'est pas attendu. */
  readonly restLabel: string | null
  readonly emptyLabel: string | null
}

export type PublicationPageVM = PublicationGridPageVM | PublicationDayPageVM

export interface PublicationDocumentVM {
  /** « Planning hebdomadaire ». Le même sur chaque feuille. */
  readonly title: string
  readonly storeLabel: string
  readonly storeSubLabel: string | null
  readonly weekLabel: string
  readonly rangeLabel: string
  /** Le bandeau du brouillon, ou `null` quand le planning est publié. */
  readonly draftLabel: string | null
  readonly printedAtLabel: string
  readonly pages: readonly PublicationPageVM[]
  /** Ce que le dialogue affiche à la place de l'aperçu quand il n'y a rien. */
  readonly emptyLabel: string | null
}

const DRAFT_LABEL = "Brouillon — ne pas afficher"

/**
 * Le document complet.
 *
 * Une passe par feuille, chacune obtenue en redemandant le board avec la
 * sélection de cette feuille : un rayon seul pour une feuille de rayon, une
 * journée pour une feuille de journée. C'est ce détour — plutôt qu'un second
 * calcul sur les shifts bruts — qui fait que les horaires d'ouverture propres à
 * un rayon, les blocs contigus recollés et les ouvertures marquées arrivent ici
 * déjà justes, sans qu'aucune de ces règles soit réécrite.
 */
export function buildPublicationDocument(
  input: PlanningBoardInput,
  options: PublicationOptions,
  context: PublicationContext
): PublicationDocumentVM {
  const sectorIds = options.sectorIds.filter((id) =>
    input.sectors.some((sector) => sector.id === id)
  )
  const dates = options.dates.filter((date) => input.days.some((day) => day.date === date))
  const board = buildPlanningBoard(input, {
    view: "sector",
    sectorIds,
    date: null,
    employeeId: null,
  })

  const pages =
    sectorIds.length === 0
      ? []
      : options.layout === "sector"
        ? sectorPages(input, sectorIds, options, context)
        : dates.map((date) => dayPage(input, sectorIds, date))

  return {
    title: "Planning hebdomadaire",
    storeLabel: context.storeName,
    storeSubLabel: context.storeCity,
    weekLabel: board.toolbar.weekTitle,
    rangeLabel: `du ${longDate(input.periodStart)} au ${longDate(input.periodEnd)}`,
    draftLabel: context.draft ? DRAFT_LABEL : null,
    printedAtLabel: context.printedAtLabel,
    pages,
    emptyLabel:
      sectorIds.length === 0
        ? "Aucun rayon sélectionné : il n’y a rien à afficher."
        : pages.length === 0
          ? "Aucune journée sélectionnée : choisissez au moins un jour à afficher."
          : null,
  }
}

// ── Par rayons ───────────────────────────────────────────────────────────────

/**
 * Une feuille par rayon, et le board redemandé rayon par rayon.
 *
 * Filtrer une grille multi-rayons déjà construite aurait gardé la fenêtre
 * horaire de l'union des rayons : un comptoir qui ouvre à 8h se serait affiché
 * sur l'amplitude du Drive, avec « ouverture » écrit sur la mauvaise barre.
 * Redemander le board pour un seul rayon lui rend ses propres horaires.
 */
function sectorPages(
  input: PlanningBoardInput,
  sectorIds: readonly string[],
  options: PublicationOptions,
  context: PublicationContext
): readonly PublicationGridPageVM[] {
  /**
   * LE BOARD DE TOUS LES RAYONS, construit une fois pour toutes les feuilles.
   *
   * C'est lui qui porte les heures faites AILLEURS : celle qui tient le poisson
   * mardi et la charcuterie jeudi doit voir ses deux journées sur la feuille du
   * poisson, sans quoi elle croit son jeudi libre. Le board d'un rayon seul ne
   * les connaît pas — il les a filtrées.
   */
  const wide = buildPlanningBoard(input, {
    view: "sector",
    sectorIds: input.sectors.map((sector) => sector.id),
    date: null,
    employeeId: null,
  })
  const primary = context.primarySectorByEmployee ?? {}

  return sectorIds.map((sectorId) => {
    const sector = input.sectors.find((entry) => entry.id === sectorId)
    return gridPage({
      input,
      sectorIds: [sectorId],
      key: `sector_${sectorId}`,
      title: sector?.name ?? sectorId,
      subtitle: "Horaires du rayon",
      rowHeaderLabel: "Salarié",
      // Un seul rayon en titre : ses cases ne le répètent pas, seules celles
      // d'un autre comptoir se nomment.
      nameSectors: true,
      impliedSectorId: sectorId,
      showTotals: options.showTotals,
      emptyLabel: "Aucun salarié planifié dans ce rayon cette semaine.",
      /**
       * QUI FIGURE, et pourquoi ces deux-là seulement.
       *
       * La feuille listait toute l'équipe rattachée au rayon, absents compris,
       * et devenait une liste où l'on ne trouvait plus les gens du jour. Elle
       * garde maintenant ceux qui y ont des heures cette semaine — ce qu'on
       * vient vérifier au comptoir — et ceux dont c'est le PREMIER rayon, qui
       * appartiennent à l'équipe même en vacances et dont l'absence est
       * justement une information.
       *
       * Quelqu'un venu dépanner une journée figure donc au premier titre, et
       * disparaît la semaine suivante s'il ne revient pas.
       */
      rowsFrom: wide,
      keepEmployee: (employeeId, worksInSector) =>
        worksInSector || primary[employeeId] === sectorId,
    })
  })
}

// ── La grille, commune aux deux mises en page hebdomadaires ──────────────────

function gridPage(spec: {
  readonly input: PlanningBoardInput
  readonly sectorIds: readonly string[]
  readonly key: string
  readonly title: string
  readonly subtitle: string | null
  readonly rowHeaderLabel: string
  readonly nameSectors: boolean
  /** Le rayon que le titre porte déjà : ses cases ne le répètent pas. */
  readonly impliedSectorId?: string | null
  readonly showTotals: boolean
  readonly emptyLabel: string
  /**
   * Le board d'où viennent les CELLULES, quand il diffère de celui des
   * colonnes. Une feuille de rayon prend ses colonnes du rayon — ce sont ses
   * horaires et ses fermetures — et ses cellules de tous les rayons, pour
   * montrer les heures faites ailleurs.
   */
  readonly rowsFrom?: PlanningBoardViewModel
  /** Qui garder. `worksInSector` dit s'il a des heures dans le rayon affiché. */
  readonly keepEmployee?: (employeeId: string, worksInSector: boolean) => boolean
}): PublicationGridPageVM {
  const board = buildPlanningBoard(spec.input, {
    view: "sector",
    sectorIds: spec.sectorIds,
    date: null,
    employeeId: null,
  })
  const columns: PublicationColumnVM[] = board.sectorView.columns.map((column) => ({
    date: column.date,
    dayLabel: dayLabelOf(spec.input, column.date),
    dateLabel: column.dateLabel,
    closed: column.closed,
    holidayName: column.holidayName,
  }))

  /**
   * Les heures du rayon décident QUI figure ; les heures de partout décident
   * CE QU'ON MONTRE de chacun.
   *
   * Deux lectures du même salarié, et il faut les deux : sans la première, la
   * feuille du poisson listerait des gens qui n'y mettent jamais les pieds ;
   * sans la seconde, elle cacherait à ceux qui y sont le jeudi qu'ils sont
   * ailleurs le mardi.
   */
  const worksHere = new Set(
    board.sectorView.rows
      .filter((row) => Object.values(row.shiftsByDate).some((shifts) => shifts.length > 0))
      .map((row) => String(row.employeeId))
  )
  const source = spec.rowsFrom ?? board
  const rows: PublicationRowVM[] = source.sectorView.rows
    .filter((row) =>
      spec.keepEmployee
        ? spec.keepEmployee(String(row.employeeId), worksHere.has(String(row.employeeId)))
        : true
    )
    .map((row) => ({
      key: String(row.employeeId),
      name: nameWithUppercaseFamily(row.name),
      initials: row.initials,
      cells: columns.map((column) => {
        const shifts = row.shiftsByDate[column.date] ?? []
        // Sur le mur, « Repos » et « Férié non travaillé » ne veulent pas dire
        // la même chose à celui qui cherche son nom : le second explique
        // pourquoi il ne vient pas, et il a le droit de le savoir de loin.
        const holiday = row.holidayLabelByDate[column.date] ?? null
        return {
          date: column.date,
          emptyLabel: column.closed
            ? "Fermé"
            : shifts.length === 0
              ? holiday ?? "Repos"
              : null,
          holiday: holiday !== null && shifts.length === 0 && !column.closed,
          slots: shifts.flatMap((shift) =>
          slotsOfShift(shift, spec.nameSectors, spec.impliedSectorId ?? null)
        ),
        }
      }),
      totalLabel: spec.showTotals ? row.plannedLabel : null,
    }))

  return {
    kind: "grid",
    key: spec.key,
    title: spec.title,
    subtitle: spec.subtitle,
    rowHeaderLabel: spec.rowHeaderLabel,
    columns,
    rows,
    totals: spec.showTotals ? board.sectorView.columns.map((column) => column.totalLabel) : null,
    emptyLabel: rows.length === 0 ? spec.emptyLabel : null,
  }
}

// ── Par jour ─────────────────────────────────────────────────────────────────

/**
 * Une journée, comptoir par comptoir, dans l'ordre des prises de poste.
 *
 * C'est la feuille du matin même : on veut savoir qui tient quel comptoir et à
 * partir de quand, pas retrouver une barre dans une grille de sept colonnes.
 */
function dayPage(
  input: PlanningBoardInput,
  sectorIds: readonly string[],
  date: IsoDate
): PublicationDayPageVM {
  const board = buildPlanningBoard(input, {
    view: "day",
    sectorIds,
    date,
    employeeId: null,
  })
  const title = `${dayLabelOf(input, date)} ${formatDate(date)}`

  if (board.dayView.closed) {
    // Fermé pour les rayons publiés — ce qui n'est pas la même chose que fermé
    // pour le magasin, et c'est bien la première qui décide de cette feuille.
    return {
      kind: "day",
      key: `day_${date}`,
      title,
      subtitle: null,
      hours: [],
      groups: [],
      restLabel: null,
      emptyLabel: "Fermé ce jour.",
    }
  }

  // Les blocs de la journée, tous rayons confondus, chacun encore attaché à la
  // personne qui le tient. C'est le seul endroit où les deux se rencontrent.
  const blocks = board.dayView.rows.flatMap((row) =>
    row.shifts.flatMap((shift) =>
      shift.sectorBlocks.map((block) => ({ row, shift, block }))
    )
  )

  const groups: PublicationDayGroupVM[] = input.sectors
    .filter((sector) => sectorIds.includes(sector.id))
    .map((sector) => {
      const entries = blocks
        .filter((entry) => entry.block.sectorId === sector.id)
        .sort(
          (left, right) =>
            left.block.startMinutes - right.block.startMinutes
            || left.row.name.localeCompare(right.row.name, "fr")
        )
      return {
        key: sector.id,
        sectorName: sector.name,
        paint: sectorBarPaint(sector.color, FLAT),
        entries: entries.map(({ row, shift, block }, index) => ({
          key: `${shift.id}_${block.sectorId}_${index}`,
          name: nameWithUppercaseFamily(row.name),
          initials: row.initials,
          label: `${block.startLabel} – ${block.endLabel}`,
          durationLabel: block.durationLabel,
          leftPercent: block.leftPercent,
          widthPercent: block.widthPercent,
        })),
        totalLabel: entries.length === 0
          ? null
          : durationLabel(
              entries.reduce(
                (sum, entry) => sum + entry.block.endMinutes - entry.block.startMinutes,
                0
              )
            ),
      }
    })
    .filter((group) => group.entries.length > 0)

  const resting = board.dayView.rows.filter((row) => row.shifts.length === 0)

  return {
    kind: "day",
    key: `day_${date}`,
    title,
    subtitle: board.dayView.windowLabel ? `Ouvert ${board.dayView.windowLabel}` : null,
    hours: board.dayView.hours.map((hour) => ({
      key: hour.startMinutes,
      label: hour.label,
      widthPercent: hour.widthPercent,
    })),
    groups,
    restLabel:
      resting.length === 0
        ? null
        : `Repos : ${resting.map((row) => nameWithUppercaseFamily(row.name)).join(", ")}`,
    emptyLabel: groups.length === 0 ? "Aucun salarié planifié ce jour." : null,
  }
}

// ── Traductions ──────────────────────────────────────────────────────────────

/**
 * Une journée de travail → ses plages, une par rayon servi.
 *
 * Même découpage que la grille à l'écran, pour la même raison : quelqu'un qui
 * passe de la charcuterie au poisson tient deux comptoirs, et une barre unique
 * cacherait précisément ce que la feuille du rayon vient dire.
 */
/**
 * Les cases d'une vacation.
 *
 * `impliedSectorId` est le rayon que la feuille porte DÉJÀ en titre : ses cases
 * n'ont pas à le répéter, seules celles d'un autre comptoir se nomment. C'est
 * ce qui divise la hauteur d'une case par deux la plupart du temps, et qui fait
 * apparaître le nom exactement là où il apprend quelque chose — sur les heures
 * que la personne fait AILLEURS, et qui figurent maintenant sur sa feuille.
 *
 * `null` veut dire « aucun rayon implicite » : la feuille d'équipe en mélange
 * plusieurs, donc tous se nomment.
 */
export function slotsOfShift(
  shift: BoardShiftVM,
  nameSectors: boolean,
  impliedSectorId: string | null = null
): readonly PublicationSlotVM[] {
  if (shift.sectorBlocks.length === 0) {
    // Aucun bloc de rayon : les minutes travaillées ne se lisent nulle part
    // ici, et la durée reste donc SANS pause plutôt qu'avec une pause fausse.
    // Branche défensive — `buildPlanningBoard` écarte les vacations dont aucun
    // bloc n'appartient à la sélection, donc rien n'arrive ici en pratique.
    return [{
      key: shift.id,
      sectorName: null,
      label: shift.label,
      durationLabel: shift.durationLabel,
      paint: null,
    }]
  }

  return shift.sectorBlocks.map((block, index) => ({
    key: `${shift.id}_${block.sectorId}_${index}`,
    sectorName:
      nameSectors && block.sectorId !== impliedSectorId ? block.sectorName : null,
    label: `${block.startLabel} – ${block.endLabel}`,
    durationLabel: durationWithBreak(
      block.durationLabel,
      block.endMinutes - block.startMinutes
    ),
    // Teinte pleine, sans l'ombrage de bord que la grille utilise pour marquer
    // l'ouverture et la fermeture : la feuille affichée ne parle pas de rôles,
    // et un dégradé sur un bord n'aurait plus rien signifié pour personne.
    paint: sectorBarPaint(block.color, FLAT),
  }))
}

/** Ni ouvrant, ni fermant : la couleur du rayon, et rien d'autre. */
const FLAT = { opens: false, closes: false } as const

function dayLabelOf(input: PlanningBoardInput, date: IsoDate): string {
  const day = input.days.find((entry) => entry.date === date)
  return day ? WEEK_DAY_LABELS[day.weekDay] : date
}

