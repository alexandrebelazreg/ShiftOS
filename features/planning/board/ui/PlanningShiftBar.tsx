"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { cn } from "@/lib/utils"

import type { BoardShiftVM } from "@/features/planning/board/model/board-view-model"
import {
  applyShiftDrag,
  minutesFromRatio,
  segmentGeometry,
  type DragBounds,
  type EditableShift,
  type ShiftDragMode,
} from "@/features/planning/board/model/shift-edit"
import { sectorBarPaint, sectorBarTitle } from "@/features/planning/board/model/sector-paint"
import { KIND_SURFACE } from "@/features/planning/board/ui/level-styles"

interface PlanningShiftBarProps {
  readonly shift: BoardShiftVM
  readonly onSelect?: () => void
  /** Raw minutes for the bar, present only where editing is enabled (day view). */
  readonly editable?: EditableShift
  /** The day window the drag is clamped to. */
  readonly bounds?: DragBounds
  readonly selected?: boolean
  /** Committed on mouse-up with the shift's new geometry. */
  readonly onEdit?: (next: EditableShift) => void
  /** Pinned by the manager. Local only this sprint: it marks, it never forbids. */
  readonly locked?: boolean
}

type DragState = {
  readonly mode: ShiftDragMode
  readonly grabMinutes: number
  readonly origin: EditableShift
  readonly lane: HTMLElement
}

/**
 * One shift drawn on the day timeline, editable when the view supplies raw
 * minutes and a day window.
 *
 * All the arithmetic — snapping, moving, resizing, clamping to the day — lives
 * in `shift-edit.ts`. This component only turns a pointer position into a minute
 * and renders whatever the pure function returns, so nothing here needs a test:
 * the behaviour is tested where the maths is.
 *
 * Two handles appear only once the bar is selected; the body moves the shift and
 * keeps its duration, the handles move one edge each. A drag previews locally on
 * every move and is committed once, on release — Escape drops it.
 */
export function PlanningShiftBar({
  shift,
  onSelect,
  editable,
  bounds,
  selected = false,
  onEdit,
  locked = false,
}: PlanningShiftBarProps) {
  const editing = editable !== undefined && bounds !== undefined && onEdit !== undefined
  const [preview, setPreview] = useState<EditableShift | null>(null)
  const drag = useRef<DragState | null>(null)

  // The geometry to draw: the live preview while dragging, the committed minutes
  // when editing, and — outside the editable view — the ViewModel's own percents.
  //
  // UNE BARRE PAR SEGMENT, jamais par rayon. Les deux comptes divergeaient dès
  // qu'un salarié enchaînait deux comptoirs sans coupure : la barre éditable
  // suivait le segment réel (un seul), et tout ce qui s'indexait sur les rayons
  // ne montrait que le premier. Les rayons se peignent maintenant DANS la barre.
  const geometry =
    editing && (preview ?? editable)
      ? segmentGeometry(preview ?? editable!, bounds!)
      : shift.segments

  // Les rayons traversés par ce segment, en pourcentage de la barre. Pendant un
  // glissement on garde les proportions : la barre bouge, le partage la suit.
  const sectorsOf = (index: number) => shift.segments[index]?.sectors ?? []

  // La peinture d'un rayon, quand il en déclare une.
  const paintOf = (index: number) => {
    const parts = sectorsOf(index)
    return parts.length === 1 ? sectorBarPaint(parts[0].color, parts[0]) : null
  }

  const cancel = useCallback(() => {
    drag.current = null
    setPreview(null)
  }, [])

  useEffect(() => {
    if (!editing) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && drag.current) {
        event.stopPropagation()
        cancel()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [editing, cancel])

  const pointerMinutes = (clientX: number, lane: HTMLElement): number => {
    const rect = lane.getBoundingClientRect()
    const ratio = rect.width > 0 ? (clientX - rect.left) / rect.width : 0
    return minutesFromRatio(ratio, bounds!)
  }

  const beginDrag = (mode: ShiftDragMode) => (event: React.PointerEvent<HTMLElement>) => {
    if (!editing) return
    event.preventDefault()
    event.stopPropagation()
    // First press selects; the drag starts on a press of an already-selected bar,
    // so a plain click never nudges the schedule by accident.
    if (!selected && mode === "move") {
      onSelect?.()
      return
    }
    const lane = event.currentTarget.parentElement
    if (!lane) return
    // Capture keeps the drag alive when the pointer leaves the small handle. If
    // the browser refuses it, the drag still works within the element rather
    // than throwing and dying, so the guard is correctness, not just belt-and-braces.
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      /* no capture available — proceed without it */
    }
    drag.current = {
      mode,
      grabMinutes: pointerMinutes(event.clientX, lane),
      origin: editable!,
      lane,
    }
  }

  const onPointerMove = (event: React.PointerEvent<HTMLElement>) => {
    const state = drag.current
    if (!state) return
    const minutes = pointerMinutes(event.clientX, state.lane)
    setPreview(applyShiftDrag(state.origin, state.mode, minutes, state.grabMinutes, bounds!))
  }

  const onPointerUp = () => {
    const state = drag.current
    if (!state) return
    if (preview) onEdit!(preview)
    cancel()
  }

  // Le nom du rayon vaut mieux qu'une heure que la barre montre déjà — y
  // compris en édition, où il était tu alors que c'est là qu'on déplace les
  // blocs d'un comptoir à l'autre.
  const bodyLabel = (index: number) => {
    const parts = sectorsOf(index)
    if (parts.length === 1) return `${parts[0].sectorName} · ${parts[0].startLabel}–${parts[0].endLabel}`
    return index === 0 ? `${shift.startLabel} – ${shift.endLabel}` : "suite"
  }

  return (
    <>
      {geometry.map((segment, index) => (
        <button
          key={`${shift.id}-${index}`}
          type="button"
          onClick={editing ? undefined : onSelect}
          onPointerDown={editing ? beginDrag("move") : undefined}
          onPointerMove={editing ? onPointerMove : undefined}
          onPointerUp={editing ? onPointerUp : undefined}
          style={{
            left: `${segment.leftPercent}%`,
            width: `${segment.widthPercent}%`,
            // La couleur du rayon prime sur toute classe : elle est saisie
            // par le gérant, donc aucune classe ne peut l'exprimer.
            ...(paintOf(index) ?? {}),
          }}
          className={cn(
            "absolute inset-y-1 flex items-center justify-center overflow-hidden rounded-md border px-2",
            "text-[11px] font-medium shadow-sm transition",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            editing ? "cursor-grab active:cursor-grabbing touch-none" : "hover:brightness-95",
            // Selection wins the ring; a lock keeps a quieter amber one so the
            // two states never fight over the same visual channel.
            selected
              ? "ring-2 ring-primary ring-offset-1"
              : locked && "ring-1 ring-amber-500/80",
            // L'habillage de secours ne sert que si le rayon n'a pas de
            // couleur : sinon les classes lutteraient contre le style calculé.
            paintOf(index)
              ? "border"
              : sectorsOf(index).length === 1
                ? SECTOR_SURFACES[sectorColorIndex(sectorsOf(index)[0].sectorId)]
                : KIND_SURFACE[shift.kind]
          )}
          title={sectorBarTitle({
            sectorName: sectorsOf(index).map((part) => part.sectorName).join(" → ") || undefined,
            kindLabel: shift.kindLabel,
            role: sectorsOf(index).length === 1
              ? sectorsOf(index)[0]
              : {
                  opens: sectorsOf(index).some((part) => part.opens),
                  closes: sectorsOf(index).some((part) => part.closes),
                },
            label: shift.label,
            durationLabel: shift.durationLabel,
            locked,
          })}
        >
          {/* Plusieurs comptoirs dans une seule plage : ils se partagent la
              barre au prorata de leurs minutes. Sans ça, seul le premier était
              visible — le reste de la journée se lisait sous son nom. */}
          {sectorsOf(index).length > 1
            ? sectorsOf(index).map((part) => (
                <span
                  key={`${part.sectorId}-${part.startLabel}`}
                  style={{
                    left: `${part.offsetPercent}%`,
                    width: `${part.widthPercent}%`,
                    ...(sectorBarPaint(part.color, part) ?? {}),
                  }}
                  className={cn(
                    "absolute inset-y-0 flex items-center justify-center overflow-hidden px-1",
                    "border-r border-white/60 text-[10px] leading-none last:border-r-0",
                    sectorBarPaint(part.color, part)
                      ? null
                      : SECTOR_SURFACES[sectorColorIndex(part.sectorId)]
                  )}
                >
                  <span className="truncate">{part.sectorName}</span>
                </span>
              ))
            : null}
          {locked && index === 0 ? (
            <span className="relative z-10 mr-1 shrink-0 text-[10px] leading-none" aria-label="Verrouillé">
              🔒
            </span>
          ) : null}
          {sectorsOf(index).length > 1 ? null : (
            <span className="truncate tabular-nums">{bodyLabel(index)}</span>
          )}
        </button>
      ))}

      {editing && selected ? (
        <>
          <Handle
            side="start"
            leftPercent={geometry[0]?.leftPercent ?? 0}
            onPointerDown={beginDrag("resize-start")}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          />
          <Handle
            side="end"
            leftPercent={
              (geometry[geometry.length - 1]?.leftPercent ?? 0) +
              (geometry[geometry.length - 1]?.widthPercent ?? 0)
            }
            onPointerDown={beginDrag("resize-end")}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          />
        </>
      ) : null}
    </>
  )
}

const SECTOR_SURFACES = [
  "border-emerald-300 bg-emerald-100 text-emerald-950",
  "border-sky-300 bg-sky-100 text-sky-950",
  "border-violet-300 bg-violet-100 text-violet-950",
  "border-amber-300 bg-amber-100 text-amber-950",
] as const

function sectorColorIndex(sectorId: string): number {
  let hash = 0
  for (const character of sectorId) hash = (hash * 31 + character.charCodeAt(0)) >>> 0
  return hash % SECTOR_SURFACES.length
}

interface HandleProps {
  readonly side: "start" | "end"
  readonly leftPercent: number
  readonly onPointerDown: (event: React.PointerEvent<HTMLElement>) => void
  readonly onPointerMove: (event: React.PointerEvent<HTMLElement>) => void
  readonly onPointerUp: (event: React.PointerEvent<HTMLElement>) => void
}

/** A grab tab straddling one edge of the selected shift. */
function Handle({ side, leftPercent, onPointerDown, onPointerMove, onPointerUp }: HandleProps) {
  return (
    <button
      type="button"
      aria-label={side === "start" ? "Modifier l’heure de début" : "Modifier l’heure de fin"}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      style={{ left: `${leftPercent}%` }}
      className={cn(
        "absolute inset-y-0 z-10 w-3 -translate-x-1/2 cursor-ew-resize touch-none rounded-sm",
        "border border-primary bg-background shadow-sm",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      )}
    />
  )
}
