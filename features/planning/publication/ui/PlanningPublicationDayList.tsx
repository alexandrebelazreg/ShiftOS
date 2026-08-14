import type {
  PublicationDayGroupVM,
  PublicationDayPageVM,
  PublicationHourVM,
} from "@/features/planning/publication/model/publication-document"

interface PlanningPublicationDayListProps {
  readonly page: PublicationDayPageVM
}

/** La largeur de la colonne des noms, partagée par la règle et par les barres. */
const NAME_COLUMN = "w-[46mm]"

/**
 * La feuille du matin : qui tient quel comptoir, et quand.
 *
 * Une FRISE plutôt qu'une liste. Une colonne de « 06:00 – 14:00 » obligeait à
 * reconstituer de tête les relais, les chevauchements et les creux ; ici on les
 * voit — deux barres qui se touchent sont une passation, un blanc dans la ligne
 * du rayon est un comptoir sans personne. C'est exactement la question qu'on
 * pose à cette feuille quand on la consulte à 6h du matin.
 *
 * Une seule règle des heures pour toute la page, en haut, et chaque barre
 * positionnée en pourcentage de la même journée : c'est ce qui garantit que
 * deux barres alignées à l'œil le sont réellement.
 */
export function PlanningPublicationDayList({ page }: PlanningPublicationDayListProps) {
  if (page.emptyLabel) {
    return (
      <p className="border border-dashed border-neutral-400 p-10 text-center text-sm text-neutral-500">
        {page.emptyLabel}
      </p>
    )
  }

  return (
    <div className="space-y-[3mm]">
      <HourRuler hours={page.hours} />

      {page.groups.map((group) => (
        <DayGroup key={group.key} group={group} hours={page.hours} />
      ))}

      {/* Qui n'est pas attendu ce jour-là. Sans cette ligne, une absence et un
          oubli de planification se ressemblent trait pour trait sur le mur. */}
      {page.restLabel ? (
        <p className="break-inside-avoid border-t border-neutral-300 pt-2 text-[11px] text-neutral-600">
          {page.restLabel}
        </p>
      ) : null}
    </div>
  )
}

function HourRuler({ hours }: { readonly hours: readonly PublicationHourVM[] }) {
  return (
    <div className="flex items-end">
      <div className={`${NAME_COLUMN} shrink-0`} />
      <div className="flex flex-1 border-b-2 border-black">
        {hours.map((hour) => (
          <div
            key={hour.key}
            style={{ width: `${hour.widthPercent}%` }}
            className="border-l border-neutral-300 pb-0.5 pl-0.5 text-[9px] font-medium tabular-nums text-neutral-600 first:border-l-0"
          >
            {hour.label}
          </div>
        ))}
      </div>
    </div>
  )
}

function DayGroup({
  group,
  hours,
}: {
  readonly group: PublicationDayGroupVM
  readonly hours: readonly PublicationHourVM[]
}) {
  return (
    <section className="break-inside-avoid">
      <div className="flex items-baseline">
        <h3
          style={group.paint ?? undefined}
          className="mb-0.5 flex flex-1 items-baseline justify-between rounded-sm border border-neutral-400 px-2 py-1 text-[13px] font-bold uppercase tracking-wide"
        >
          {group.sectorName}
          {group.totalLabel ? (
            <span className="text-[11px] font-semibold tabular-nums opacity-75">
              {group.totalLabel}
            </span>
          ) : null}
        </h3>
      </div>

      <ul>
        {group.entries.map((entry) => (
          <li key={entry.key} className="flex items-stretch border-b border-neutral-200 last:border-0">
            <div className={`${NAME_COLUMN} shrink-0 self-center py-1 pr-2`}>
              <p className="truncate text-[12px] font-semibold leading-tight">{entry.name}</p>
              <p className="text-[9px] tabular-nums text-neutral-500">{entry.durationLabel}</p>
            </div>

            {/* La piste porte les mêmes graduations que la règle, en filigrane :
                sans elles, une barre isolée au milieu de la page ne se rattache
                à aucune heure. */}
            <div className="relative flex-1 py-1">
              <div className="absolute inset-y-1 flex w-full">
                {hours.map((hour) => (
                  <div
                    key={hour.key}
                    style={{ width: `${hour.widthPercent}%` }}
                    className="border-l border-neutral-200 first:border-l-0"
                  />
                ))}
              </div>

              <div
                style={{
                  marginLeft: `${entry.leftPercent}%`,
                  width: `${entry.widthPercent}%`,
                  ...(group.paint ?? {}),
                }}
                className="relative flex h-[7mm] items-center justify-center rounded-sm border px-1"
              >
                <span className="whitespace-nowrap text-[11px] font-bold tabular-nums">
                  {entry.label}
                </span>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
