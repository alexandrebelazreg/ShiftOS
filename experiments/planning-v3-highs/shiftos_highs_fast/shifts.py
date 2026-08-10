"""Step 4 — the reduced shift space.

The global engine enumerates every start crossed with every duration: on the
Drive week that is 28 542 shapes, the overwhelming majority of which contradict
the contracts before anything has been placed. Here the duration is already
DECIDED by the allocation, so only the start is free — and the skeleton fixes
even that for the people holding a role.

What survives:

- a designated opener has exactly ONE legal start;
- a designated closer has exactly one;
- everyone else is forbidden from landing on either boundary, which is the
  two-sided reading the skeleton promised. Without it, a non-opener drifting
  onto the opening minute would silently create an extra opening and break a
  weekly cap that was already arbitrated.

Splits come in two kinds, and both are generated:

- **forced** — the allocated minutes exceed one uninterrupted stretch, so the
  day is only legal in two pieces;
- **opportunistic** — the minutes would fit in one stretch, but two pieces may
  cover two peaks a single block cannot reach. Bounded hard: they multiply the
  space fastest and pay off least, so they are generated only when the day
  actually has two separated peaks.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any

from shiftos_highs.demand import DemandModel

from .allocation import Allocation, AllocationModel
from .skeleton import Skeleton


#: Durée minimale d'un bloc sur un rayon. Miroir de
#: `MINIMUM_SECTOR_ASSIGNMENT_MINUTES` côté TypeScript : passer sur un comptoir
#: pour moins d'une heure n'a pas de sens d'exploitation. Ne s'applique qu'aux
#: CHANGEMENTS de rayon — un shift qui reste au même comptoir a des blocs
#: confondus avec ses segments, déjà bornés par la durée minimale de shift.
MINIMUM_SECTOR_BLOCK_MINUTES = 60

#: Au-delà de combien de candidats l'espace d'une zone est reconstruit plus
#: étroit, et combien de lectures à deux comptoirs chaque forme garde alors.
#:
#: Ce n'est pas un réglage de confort, c'est la frontière mesurée du placement.
#: La zone de référence — chacun sur deux comptoirs — produit 9 634 candidats,
#: son MILP les résout en cinq secondes et PROUVE l'optimum. Rendez tout le
#: monde polyvalent sur quatre comptoirs : 45 423 candidats, 47 708 colonnes, et
#: le solveur devient un coup de dé — quarante-cinq secondes ont trouvé un
#: planning à zéro déficit, cinquante-huit n'ont rien trouvé du tout. Une
#: recherche dont le résultat dépend de la seconde près n'est pas une recherche.
#:
#: Le seuil ne coupe donc jamais dans une zone ordinaire : il empêche seulement
#: qu'une équipe polyvalente noie le modèle. Ce qui est gardé est ce qui COUVRE
#: LE PLUS de demande, c'est-à-dire ce que le placement serait allé chercher.
MAXIMUM_SHIFTS_BEFORE_NARROWING = 20_000
MIXED_PATTERNS_WHEN_NARROWED = 8


def latest_close(sector_day: dict[str, Any]) -> int:
    """Jusqu'à quand ce rayon peut s'attarder ce jour-là.

    Le constructeur TypeScript pose la borne — lui seul connaît la fermeture du
    magasin. En son absence (problèmes écrits à la main, fixtures anciennes), le
    rayon ferme à l'heure pile : ne jamais INVENTER une tolérance que personne
    n'a accordée.
    """
    value = sector_day.get("latestCloseMinutes")
    closes_at = int(sector_day["closesAtMinutes"])
    return max(closes_at, int(value)) if isinstance(value, int) else closes_at


@dataclass(frozen=True, slots=True)
class Segment:
    start: int
    end: int


@dataclass(frozen=True, slots=True)
class SectorAssignment:
    sector_id: str
    start: int
    end: int


@dataclass(frozen=True, slots=True)
class Shift:
    employee_index: int
    day_index: int
    segments: tuple[Segment, ...]
    minutes: int
    opens: bool
    closes: bool
    index: int
    sector_assignments: tuple[SectorAssignment, ...] = ()
    sector_switches: int = 0
    sector_preference_penalty: int = 0

    @property
    def first_start(self) -> int:
        return self.segments[0].start

    @property
    def last_end(self) -> int:
        return self.segments[-1].end

    def covers(self, start: int, end: int) -> bool:
        return any(s.start <= start and s.end >= end for s in self.segments)


@dataclass(frozen=True, slots=True)
class ShiftSpace:
    shifts: tuple[Shift, ...]
    by_cell: dict[tuple[int, int], tuple[int, ...]]
    #: Cells the skeleton left with no legal shape at all.
    impossible: tuple[tuple[int, int], ...]


ShiftShape = tuple[tuple[int, int], ...]
ShiftShapeCacheKey = tuple[int, int, int, bool, bool, int, int, bool]
ShiftShapeCache = dict[ShiftShapeCacheKey, tuple[ShiftShape, ...]]


def _check_deadline(deadline: float | None) -> None:
    if deadline is not None and time.perf_counter() >= deadline:
        raise TimeoutError("budget épuisé pendant l'énumération des shifts")


def _steps(low: int, high: int, step: int) -> range:
    if high < low:
        return range(0)
    return range(low, high + 1, step)


def _tighten_for_rest(
    problem: dict[str, Any],
    model: AllocationModel,
    allocation: Allocation,
    skeleton: Skeleton,
) -> dict[tuple[int, int], tuple[int, int]]:
    """Push the rest rule into the windows BEFORE generating anything.

    The skeleton has already fixed the only two times known exactly: a closer
    ends at closing, an opener starts at opening. Both can be pushed onto their
    neighbour's window — someone who closes cannot start the next worked day
    before ``close + rest``, and someone who opens cannot have ended the previous
    one after ``open − rest``.

    Doing this here rather than rejecting violations later is the difference
    between a search that works and one that does not: the clashing candidates
    are never generated.
    """
    entries = {
        (str(item["employeeId"]), item["date"]): item for item in problem["employeeDays"]
    }
    employees = sorted(problem["employees"], key=lambda item: str(item["id"]))
    days = sorted([d for d in problem["days"] if not d["closed"]], key=lambda d: d["date"])
    rest = int(problem["rules"]["minimumRestMinutes"])

    windows: dict[tuple[int, int], tuple[int, int]] = {}
    for employee_index, employee in enumerate(employees):
        for day_index, day in enumerate(days):
            entry = entries.get((str(employee["id"]), day["date"]))
            if entry is None:
                continue
            windows[(employee_index, day_index)] = (
                int(entry["earliestStartMinutes"]),
                int(entry["latestEndMinutes"]),
            )

    for employee_index in range(len(employees)):
        worked = [
            day_index
            for day_index in range(len(days))
            if allocation.minutes[employee_index][day_index] > 0
        ]
        for position in range(1, len(worked)):
            previous, current = worked[position - 1], worked[position]
            gap = (current - previous) * 1_440

            if skeleton.closes(employee_index, previous):
                floor = int(days[previous]["closesAtMinutes"]) + rest - gap
                earliest, latest = windows[(employee_index, current)]
                if floor > earliest:
                    windows[(employee_index, current)] = (floor, latest)

            if skeleton.opens(employee_index, current):
                ceiling = int(days[current]["opensAtMinutes"]) + gap - rest
                earliest, latest = windows[(employee_index, previous)]
                if ceiling < latest:
                    windows[(employee_index, previous)] = (earliest, ceiling)

    return windows


def _peak_gaps(demand: DemandModel, date: str, step: int) -> list[tuple[int, int]]:
    """Troughs between two peaks — where an opportunistic split may help."""
    day = demand.days.get(date)
    if day is None:
        return []
    targets = [interval.adapted_target for interval in day.intervals]
    if not targets:
        return []
    peak = max(targets)
    if peak < 2:
        return []

    gaps: list[tuple[int, int]] = []
    inside = False
    start = 0
    for index, interval in enumerate(day.intervals):
        low = targets[index] < peak
        if low and not inside:
            inside, start = True, interval.start
        elif not low and inside:
            inside = False
            gaps.append((start, interval.start))
    return gaps


def role_implied_by_demand(
    problem: dict[str, Any], sector_id: str, sector_day: dict[str, Any]
) -> bool:
    """La demande de ce comptoir impose-t-elle DÉJÀ son ouverture et sa fermeture ?

    Un bloc de rayon ne peut ni commencer avant l'ouverture ni finir après la
    fermeture élargie. Donc si la demande réclame au moins une personne en
    continu de l'ouverture à la fermeture, alors couvrir la première tranche
    C'EST ouvrir, et couvrir la dernière C'EST fermer : `minimumOpenings` et
    `exactClosings` ne disent rien de plus.

    Rien de plus, mais pas de la même façon : la demande est SOUPLE — le moteur
    minimise un déficit — tandis que les rôles sont DURS. Les imposer en plus
    transforme un petit manque en semaine entièrement impossible, ce qui n'aide
    personne : sur une semaine réelle, cinq comptoirs ainsi doublés ne rendaient
    aucun planning, là où la seule demande en produit un à neuf créneaux près.

    Quand la demande NE couvre PAS la plage, les rôles restent la seule chose
    qui exprime l'exigence et gardent toute leur force.
    """
    opens_at = sector_day.get("opensAtMinutes")
    closes_at = sector_day.get("closesAtMinutes")
    if not isinstance(opens_at, int) or not isinstance(closes_at, int):
        return False
    covered = sorted(
        (int(slot["startMinutes"]), int(slot["endMinutes"]))
        for slot in problem["demandSlots"]
        if str(slot.get("sectorId") or problem["sectorId"]) == sector_id
        and slot["date"] == sector_day["date"]
        and int(slot["requiredEmployees"]) >= 1
    )
    if not covered:
        return False
    reach = opens_at
    for start, end in covered:
        if start > reach:
            return False
        reach = max(reach, end)
    return reach >= closes_at


def sole_server_duties(
    problem: dict[str, Any], *, designate_holders: bool = False
) -> dict[tuple[str, str], tuple[tuple[str, int, int | None], ...]]:
    """Comptoirs dont une seule personne peut tenir l'ouverture et la fermeture.

    Ce n'est pas une préférence de parcours, c'est une DÉDUCTION. Si un comptoir
    ouvert n'a qu'un salarié autorisé et disponible ce jour-là, et qu'il exige
    une ouverture et une fermeture, alors cette personne tient les deux bouts.
    Comme un salarié ne sert que deux comptoirs par jour avec un seul changement,
    ses blocs sur un comptoir donné forment une seule plage : celle-ci va donc
    exactement de l'ouverture à la fermeture.

    Le moteur ne s'en servait nulle part. Il générait pour cette personne toutes
    les positions et toutes les lectures par rayon — des dizaines de milliers de
    candidats — et laissait le MILP de placement redécouvrir, à chaque fois, la
    seule qui pouvait convenir. Fixer ces comptoirs d'abord, c'est retirer de
    l'espace de recherche ce qui n'y a jamais eu sa place.

    `designate_holders` élargit la déduction en choix : quand plusieurs personnes
    peuvent tenir le comptoir mais qu'une seule l'a en rayon principal, on la
    désigne. Ce n'est plus une impossibilité, c'est une politique — elle gagne
    sur une semaine qui a des heures en trop et coûte cher sur une semaine qui
    n'en a pas assez. Elle se demande donc explicitement, et le défaut reste la
    déduction : personne ne l'active par distraction.
    """
    sectors = problem.get("sectors") or []
    if not sectors:
        return {}

    employees = problem["employees"]
    entries = {
        (str(entry["employeeId"]), entry["date"]): entry
        for entry in problem["employeeDays"]
    }
    duties: dict[tuple[str, str], list[tuple[str, int, int]]] = {}
    for sector in sectors:
        sector_id = str(sector["id"])
        for sector_day in sector["days"]:
            if sector_day["closed"]:
                continue
            if int(sector_day.get("minimumOpenings") or 0) < 1:
                continue
            if int(sector_day.get("exactClosings") or 0) < 1:
                continue
            date = sector_day["date"]
            available = [
                employee
                for employee in employees
                if sector_id in [str(value) for value in employee.get("allowedSectorIds") or []]
                and (entry := entries.get((str(employee["id"]), date))) is not None
                and bool(entry["available"])
            ]
            server, alone = _designated_server(available, sector_id, designate_holders)
            if server is None:
                continue
            opens_at = int(sector_day["opensAtMinutes"])
            closes_at = int(sector_day["closesAtMinutes"])
            entry = entries[(str(server["id"]), date)]
            # ── Une déduction ne doit jamais FABRIQUER l'impossible ──────────
            #
            # Désigner quelqu'un qui n'a pas le droit d'ouvrir, ou qui ne peut
            # pas être là à l'heure, ne produit aucune forme légale : la cellule
            # meurt, l'allocation entière tombe, et le moteur ne rend rien. Un
            # test l'a attrapé — la règle plaçait à l'ouverture d'un comptoir
            # une personne dont la fiche interdit précisément d'ouvrir.
            #
            # Ce n'est pas au raisonnement de trancher ce qu'aucune règle ne
            # permet. Si personne ne peut ouvrir ce comptoir, c'est le préflight
            # des rôles qui doit le dire, avec le nom et la raison.
            if not bool(server.get("canOpen")):
                continue
            if int(entry["earliestStartMinutes"]) > opens_at:
                continue
            # Quand elle est la SEULE autorisée, tenir les deux bouts n'est pas
            # une préférence : personne d'autre ne peut fermer. On ne l'assouplit
            # donc que si la fermeture lui est matériellement possible — sinon
            # la semaine est réellement impossible, et c'est au préflight des
            # rôles de le dire plutôt qu'à cette déduction de le cacher.
            brackets = _can_bracket(problem, server, entry, opens_at, closes_at) or (
                alone and bool(server.get("canClose"))
            )
            duties.setdefault((str(server["id"]), date), []).append(
                (sector_id, opens_at, closes_at if brackets else None)
            )
    return {key: tuple(sorted(value)) for key, value in duties.items()}


def _designated_server(
    available: list[dict[str, Any]], sector_id: str, designate_holders: bool
) -> tuple[dict[str, Any] | None, bool]:
    """Qui tient ce comptoir ce jour-là, et si c'est faute de quiconque d'autre.

    Deux déductions, la seconde étant l'élargissement demandé par le métier et
    commandée par `designate_holders` :

    - une seule personne AUTORISÉE et disponible : c'est elle, quel que soit le
      rang qu'elle donne à ce rayon. Personne d'autre ne peut y aller, donc rien
      ne s'assouplit — le second membre du couple le dit ;
    - une seule personne dont c'est le rayon PRINCIPAL : c'est elle aussi, mais
      des renforts existent. Les autres l'ont en deuxième ou troisième choix ;
      ils viendront pendant sa coupure, et pourront fermer si elle ne le peut
      pas. Sans cette seconde lecture, un comptoir de douze heures servi par une
      titulaire et un renfort restait sans titulaire désigné, et le moteur
      donnait huit heures à la première puis laissait quatre heures éteintes.
    """
    if not available:
        return None, False
    if len(available) == 1:
        return available[0], True
    if not designate_holders:
        return None, False
    holders = [
        employee
        for employee in available
        if [str(value) for value in employee["allowedSectorIds"]][0] == sector_id
    ]
    return (holders[0], False) if len(holders) == 1 else (None, False)


def _can_bracket(
    problem: dict[str, Any],
    employee: dict[str, Any],
    entry: dict[str, Any],
    opens_at: int,
    closes_at: int,
) -> bool:
    """Cette personne peut-elle tenir les DEUX bouts de ce comptoir ?

    Sinon la déduction s'arrête à l'ouverture : elle ouvre et fait ses heures à
    partir de là. C'est l'arbitrage du métier — on ne va pas exiger d'une
    personne qui ne coupe pas qu'elle couvre treize heures d'amplitude, ni la
    priver du comptoir pour autant.
    """
    rules = problem["rules"]
    span = closes_at - opens_at
    if not bool(employee.get("canClose")):
        return False
    if int(entry["latestEndMinutes"]) < closes_at:
        return False
    ceiling = min(
        int(employee["maximumDailyMinutes"]),
        int(entry["maximumMinutes"]),
        int(rules["maximumShiftMinutes"]),
    )
    continuous = int(rules.get("maximumContinuousMinutes") or ceiling)
    if span <= min(ceiling, continuous):
        return True

    own = employee.get("splitRules") if isinstance(employee.get("splitRules"), dict) else rules
    if not bool(rules.get("splitShiftAllowed")) or not bool(employee.get("canSplitShift")):
        return False
    if int(own.get("maximumSplitsPerDay") or 1) < 1:
        return False
    segment = int(rules["minimumShiftMinutes"])
    minimum_gap = int(own.get("minimumSplitMinutes") or 0)
    maximum_gap = own.get("maximumSplitMinutes")
    maximum_gap = span if maximum_gap is None else int(maximum_gap)
    # Les minutes travaillées possibles, vues des deux côtés : ce que les règles
    # de durée permettent, et ce que la coupure impose une fois l'amplitude fixée.
    lowest = max(2 * segment, span - maximum_gap)
    highest = min(ceiling, 2 * continuous, span - minimum_gap)
    return lowest <= highest


def demand_by_cell(problem: dict[str, Any]) -> dict[tuple[str, str, int], int]:
    """``{(comptoir, date, début): personnes réclamées}``, la demande configurée.

    Sert à classer les lectures d'un shift quand il faut en garder moins que ce
    que les règles autorisent : celles qui posent quelqu'un là où le métier en
    demande valent mieux que celles qui le posent ailleurs.
    """
    step = int(problem["timeStepMinutes"])
    lookup: dict[tuple[str, str, int], int] = {}
    for slot in problem["demandSlots"]:
        sector_id = str(slot.get("sectorId") or problem["sectorId"])
        required = int(slot["requiredEmployees"])
        for start in range(int(slot["startMinutes"]), int(slot["endMinutes"]), step):
            key = (sector_id, slot["date"], start)
            lookup[key] = max(lookup.get(key, 0), required)
    return lookup


def _sector_patterns(
    problem: dict[str, Any], employee: dict[str, Any], day: dict[str, Any],
    segments: tuple[Segment, ...], step: int,
    forced: tuple[tuple[str, int, int], ...] = (),
    mixed_cap: int | None = None,
    demand: dict[tuple[str, str, int], int] | None = None,
) -> list[tuple[tuple[SectorAssignment, ...], int, int]]:
    """All legal one/two-sector readings of one already legal shift shape.

    `mixed_cap` bounds the TWO-COUNTER readings, keeping those that cover the
    most configured demand. Absent — the ordinary case, and the only one the
    duration probe ever uses — every legal reading is returned: that probe asks
    whether a cell HAS a legal reading, and answering from a shortened list
    would call a workable cell dead.
    """
    configured = problem.get("sectors") or []
    if not configured:
        sector_id = problem["sectorId"]
        return [(
            tuple(SectorAssignment(sector_id, segment.start, segment.end) for segment in segments),
            0,
            0,
        )]

    sector_by_id = {str(sector["id"]): sector for sector in configured}
    allowed = [str(value) for value in employee.get("allowedSectorIds") or [problem["sectorId"]]]
    allowed = [sector_id for sector_id in allowed if sector_id in sector_by_id]
    date = day["date"]

    def sector_day(sector_id: str) -> dict[str, Any] | None:
        return next((entry for entry in sector_by_id[sector_id]["days"] if entry["date"] == date), None)

    def sector_split_rules(sector_id: str) -> dict[str, Any]:
        own = sector_by_id[sector_id].get("splitRules")
        return own if isinstance(own, dict) else problem["rules"]

    def honours_forced(blocks: tuple[SectorAssignment, ...]) -> bool:
        """La plage tenue sur un comptoir forcé va-t-elle bien d'un bout à l'autre ?

        `closes_at` à `None` : l'obligation ne porte que sur l'OUVERTURE. C'est
        le cas d'une titulaire qui ne coupe pas et dont l'amplitude du comptoir
        dépasse ce qu'elle tient d'une traite — elle ouvre et fait ses heures,
        on ne lui demande pas de fermer douze heures plus tard.
        """
        for sector_id, opens_at, closes_at in forced:
            own = [block for block in blocks if block.sector_id == sector_id]
            if not own:
                return False
            if min(block.start for block in own) != opens_at:
                return False
            if closes_at is None:
                continue
            own_day = sector_day(sector_id)
            latest = latest_close(own_day) if own_day else closes_at
            # Elle doit tenir le comptoir JUSQU'À sa fermeture nominale ; qu'elle
            # s'attarde ensuite dans la tolérance ne lui est pas reproché.
            if not (closes_at <= max(block.end for block in own) <= latest):
                return False
        return True

    def legal(blocks: tuple[SectorAssignment, ...]) -> bool:
        if not honours_forced(blocks):
            return False
        if len(segments) > 1:
            gaps = [right.start - left.end for left, right in zip(segments, segments[1:])]
            for sector_id in {block.sector_id for block in blocks}:
                own_rules = sector_split_rules(sector_id)
                if not bool(own_rules.get("splitShiftAllowed")):
                    return False
                maximum_splits = own_rules.get("maximumSplitsPerDay")
                if maximum_splits is not None and len(gaps) > int(maximum_splits):
                    return False
                minimum_gap = own_rules.get("minimumSplitMinutes")
                maximum_gap = own_rules.get("maximumSplitMinutes")
                if any(minimum_gap is not None and gap < int(minimum_gap) for gap in gaps):
                    return False
                if any(maximum_gap is not None and gap > int(maximum_gap) for gap in gaps):
                    return False
        for block in blocks:
            own_day = sector_day(block.sector_id)
            if not own_day or own_day["closed"]:
                return False
            # Le rayon peut s'attarder, jamais fermer plus tôt : la borne
            # haute est la fermeture élargie, la couverture nominale reste due.
            if block.start < int(own_day["opensAtMinutes"]) or block.end > latest_close(own_day):
                return False
            if block.end - block.start < MINIMUM_SECTOR_BLOCK_MINUTES:
                return False
            if block.start == int(own_day["opensAtMinutes"]) and not employee["canOpen"]:
                return False
            if block.end >= int(own_day["closesAtMinutes"]) and not employee["canClose"]:
                return False
        return True

    patterns: list[tuple[tuple[SectorAssignment, ...], int, int]] = []
    #: Les lectures à deux comptoirs, tenues à part : ce sont les seules que le
    #: plafond puisse couper, et une forme garde ainsi toujours ses lectures à
    #: un comptoir — donc jamais aucune.
    mixed: list[tuple[tuple[SectorAssignment, ...], int, int]] = []
    for rank, sector_id in enumerate(allowed):
        blocks = tuple(SectorAssignment(sector_id, segment.start, segment.end) for segment in segments)
        if legal(blocks):
            patterns.append((blocks, 0, rank * sum(segment.end - segment.start for segment in segments)))

    total = sum(segment.end - segment.start for segment in segments)
    useful_clock = {
        int(value)
        for slot in problem["demandSlots"]
        if slot["date"] == date
        for value in (slot["startMinutes"], slot["endMinutes"])
    }
    useful_clock.update(segment.start for segment in segments)
    useful_clock.update(segment.end for segment in segments)
    for sector in configured:
        own_day = next((entry for entry in sector["days"] if entry["date"] == date), None)
        if own_day and not own_day["closed"]:
            useful_clock.add(int(own_day["opensAtMinutes"]))
            useful_clock.add(int(own_day["closesAtMinutes"]))
            useful_clock.add(latest_close(own_day))

    def cut_clock(before: int) -> int | None:
        remaining = before
        for segment in segments:
            length = segment.end - segment.start
            if remaining <= length:
                return segment.start + remaining
            remaining -= length
        return None

    for first_rank, first_sector in enumerate(allowed):
        for second_rank, second_sector in enumerate(allowed):
            if first_sector == second_sector:
                continue
            for before in range(60, total - 60 + 1, step):
                # A switch away from every demand or operating boundary has the
                # same business effect as its nearest boundary and only blows
                # up the candidate space. Keeping meaningful cut points is what
                # preserves the fast engine's latency in multi-sector mode.
                if cut_clock(before) not in useful_clock:
                    continue
                remaining = before
                blocks_list: list[SectorAssignment] = []
                valid_cut = True
                for segment in segments:
                    length = segment.end - segment.start
                    if remaining <= 0:
                        blocks_list.append(SectorAssignment(second_sector, segment.start, segment.end))
                    elif remaining >= length:
                        blocks_list.append(SectorAssignment(first_sector, segment.start, segment.end))
                        remaining -= length
                    else:
                        cut = segment.start + remaining
                        if (cut - segment.start < MINIMUM_SECTOR_BLOCK_MINUTES
                                or segment.end - cut < MINIMUM_SECTOR_BLOCK_MINUTES):
                            valid_cut = False
                            break
                        blocks_list.append(SectorAssignment(first_sector, segment.start, cut))
                        blocks_list.append(SectorAssignment(second_sector, cut, segment.end))
                        remaining = 0
                blocks = tuple(blocks_list)
                if valid_cut and legal(blocks):
                    penalty = first_rank * before + second_rank * (total - before)
                    mixed.append((blocks, 1, penalty))

    if mixed_cap is not None and demand is not None and len(mixed) > mixed_cap:
        def served(entry: tuple[tuple[SectorAssignment, ...], int, int]) -> int:
            return sum(
                demand.get((block.sector_id, date, start), 0)
                for block in entry[0]
                for start in range(block.start, block.end, step)
            )

        # Ordre total, ne dépendant que du contenu : deux exécutions sur le même
        # problème gardent les mêmes lectures. Le dernier critère descend
        # jusqu'aux primitives — `SectorAssignment` ne s'ordonne pas.
        mixed.sort(
            key=lambda entry: (
                -served(entry),
                entry[2],
                tuple((b.sector_id, b.start, b.end) for b in entry[0]),
            )
        )
        mixed = mixed[:mixed_cap]

    patterns.extend(mixed)
    return patterns


def generate_shifts(
    problem: dict[str, Any],
    model: AllocationModel,
    allocation: Allocation,
    skeleton: Skeleton,
    demand: DemandModel,
    *,
    opportunistic_splits: bool = True,
    cache: ShiftShapeCache | None = None,
    deadline: float | None = None,
    mixed_cap: int | None = None,
    duties: dict[tuple[str, str], tuple[tuple[str, int, int | None], ...]] | None = None,
) -> ShiftSpace:
    step = model.step
    rules = problem["rules"]
    multi_sector = bool(problem.get("sectors"))
    employees = sorted(problem["employees"], key=lambda item: str(item["id"]))
    days = sorted([d for d in problem["days"] if not d["closed"]], key=lambda d: d["date"])
    windows = _tighten_for_rest(problem, model, allocation, skeleton)

    minimum_segment = int(rules["minimumShiftMinutes"])
    continuous_cap = int(rules.get("maximumContinuousMinutes") or rules["maximumShiftMinutes"])
    split_allowed = bool(rules.get("splitShiftAllowed"))
    minimum_gap = int(rules.get("minimumSplitMinutes") or 0)
    maximum_gap = rules.get("maximumSplitMinutes")

    shifts: list[Shift] = []
    by_cell: dict[tuple[int, int], list[int]] = {}
    impossible: list[tuple[int, int]] = []
    # Construite une fois pour la semaine, et seulement si elle peut servir.
    demand_lookup = demand_by_cell(problem) if mixed_cap is not None else None
    # Les comptoirs à serveur unique, résolus AVANT toute énumération. Le
    # pipeline peut en imposer un jeu, parce que lui seul sait si la semaine a
    # les heures qu'une désignation coûte.
    if duties is None:
        duties = sole_server_duties(problem)
    entry_of = {
        (str(entry["employeeId"]), entry["date"]): entry
        for entry in problem["employeeDays"]
    }

    for employee_index, employee in enumerate(employees):
        for day_index, day in enumerate(days):
            _check_deadline(deadline)
            minutes = allocation.minutes[employee_index][day_index]
            if minutes <= 0:
                continue

            key = (employee_index, day_index)
            earliest, latest = windows[key]
            opens_at = int(day["opensAtMinutes"])
            closes_at = int(day["closesAtMinutes"])
            opens = skeleton.opens(employee_index, day_index)
            closes = skeleton.closes(employee_index, day_index)
            bucket: list[int] = []
            generated_shapes: list[ShiftShape] = []
            duty = duties.get((str(employee["id"]), day["date"]), ())
            # ── Les règles fixes du salarié ──────────────────────────────────
            #
            # Une borne autorise à commencer plus tard ; une heure IMPOSÉE non.
            # Elles sont appliquées ici, à la génération, et non rejetées après
            # coup : un candidat interdit qu'on laisse naître est un candidat que
            # le placement peut choisir, puis que l'évaluateur refuse — et la
            # recherche lit ce refus comme un fait sur la semaine.
            # Résolues UNE fois par cellule, jamais par journée énumérée : sans
            # règle fixe — le cas de presque toute la production — `emit` ne paie
            # que deux comparaisons à `None`, et les cellules se comptent par
            # dizaines quand les journées se comptent par centaines de milliers.
            rules_entry = entry_of.get((str(employee["id"]), day["date"])) or {}
            pinned_start = rules_entry.get("fixedStartMinutes")
            pinned_end = rules_entry.get("fixedEndMinutes")
            impossible_rule = False
            if rules_entry.get("mustOpen") or rules_entry.get("mustClose"):
                # « Ouvre ce jour-là » sans dire quel rayon : n'importe lequel de
                # ceux qu'il sert, donc l'instant le plus tôt parmi eux.
                allowed_ids = {str(value) for value in employee.get("allowedSectorIds") or []}
                own_days = [
                    own_day
                    for sector in (problem.get("sectors") or [])
                    if str(sector["id"]) in allowed_ids
                    for own_day in sector["days"]
                    if own_day["date"] == day["date"] and not own_day["closed"]
                ]
                if rules_entry.get("mustOpen"):
                    opens = min((int(own["opensAtMinutes"]) for own in own_days), default=None)
                    # Deux règles qui se contredisent ne se départagent pas : la
                    # cellule ne produit rien, et le diagnostic dira laquelle.
                    if opens is None or (pinned_start is not None and pinned_start != opens):
                        impossible_rule = True
                    pinned_start = opens
                if rules_entry.get("mustClose"):
                    closes = max((int(own["closesAtMinutes"]) for own in own_days), default=None)
                    if closes is None or (pinned_end is not None and pinned_end != closes):
                        impossible_rule = True
                    pinned_end = closes
            if impossible_rule:
                impossible.append(key)
                continue
            # Une forme qui n'enveloppe pas la plage forcée ne peut produire
            # aucune lecture légale : inutile de la construire.
            must_start_by = min((opens for _s, opens, _c in duty), default=None)
            # Une obligation peut ne porter QUE sur l'ouverture : la titulaire
            # qui ne coupe pas ouvre et fait ses heures, sans devoir fermer.
            must_end_after = max(
                (closes for _s, _o, closes in duty if closes is not None), default=None
            )

            def emit(segments: tuple[Segment, ...]) -> None:
                if must_start_by is not None and segments[0].start > must_start_by:
                    return
                if must_end_after is not None and segments[-1].end < must_end_after:
                    return
                if pinned_start is not None and segments[0].start != pinned_start:
                    return
                if pinned_end is not None and segments[-1].end != pinned_end:
                    return
                for sector_assignments, switches, preference_penalty in _sector_patterns(
                    problem, employee, day, segments, step, duty, mixed_cap, demand_lookup
                ):
                    index = len(shifts)
                    shifts.append(
                        Shift(
                            employee_index=employee_index,
                            day_index=day_index,
                            segments=segments,
                            minutes=minutes,
                            opens=segments[0].start == opens_at,
                            closes=segments[-1].end == closes_at,
                            index=index,
                            sector_assignments=sector_assignments,
                            sector_switches=switches,
                            sector_preference_penalty=preference_penalty,
                        )
                    )
                    bucket.append(index)

            cache_key: ShiftShapeCacheKey = (
                employee_index,
                day_index,
                minutes,
                opens,
                closes,
                earliest,
                latest,
                opportunistic_splits,
            )
            if cache is not None and cache_key in cache:
                for index, shape in enumerate(cache[cache_key]):
                    if index % 256 == 0:
                        _check_deadline(deadline)
                    emit(tuple(Segment(start, end) for start, end in shape))
                if not bucket:
                    impossible.append(key)
                by_cell[key] = bucket
                continue

            # ── One uninterrupted stretch ────────────────────────────────────
            if minutes <= continuous_cap:
                if opens:
                    starts = [opens_at]
                elif closes:
                    starts = [closes_at - minutes]
                else:
                    starts = list(_steps(earliest, latest - minutes, step))
                for start in starts:
                    _check_deadline(deadline)
                    end = start + minutes
                    if start < earliest or end > latest:
                        continue
                    if not multi_sector and opens and start != opens_at:
                        continue
                    if not multi_sector and closes and end != closes_at:
                        continue
                    if not multi_sector and start == opens_at and not employee["canOpen"]:
                        continue
                    if not multi_sector and end == closes_at and not employee["canClose"]:
                        continue
                    emit((Segment(start, end),))
                    generated_shapes.append(((start, end),))

            # ── Two stretches with a break ───────────────────────────────────
            may_split = (
                split_allowed
                and bool(employee["canSplitShift"])
                and int(rules.get("maximumSplitsPerDay") or 1) >= 1
            )
            forced = minutes > continuous_cap
            if may_split and (forced or opportunistic_splits):
                gap_high = int(maximum_gap) if maximum_gap is not None else latest - earliest
                gap_low = max(minimum_gap, step)
                troughs = _peak_gaps(demand, day["date"], step)

                probes = 0
                for first in _steps(minimum_segment, min(continuous_cap, minutes - minimum_segment), step):
                    second = minutes - first
                    if second < minimum_segment or second > continuous_cap:
                        continue
                    for gap in _steps(gap_low, gap_high, step):
                        span = minutes + gap
                        for start in _steps(earliest, latest - span, step):
                            probes += 1
                            if probes % 256 == 0:
                                _check_deadline(deadline)
                            first_end = start + first
                            second_start = first_end + gap
                            end = second_start + second
                            if not multi_sector and opens and start != opens_at:
                                continue
                            if not multi_sector and closes and end != closes_at:
                                continue
                            if not multi_sector and start == opens_at and not employee["canOpen"]:
                                continue
                            if not multi_sector and end == closes_at and not employee["canClose"]:
                                continue
                            # An opportunistic split is only kept when its break
                            # actually sits in a trough. Otherwise it costs a
                            # hole and buys nothing.
                            if not forced and troughs:
                                if not any(
                                    low <= first_end and second_start <= high
                                    for low, high in troughs
                                ):
                                    continue
                            elif not forced:
                                continue
                            emit((Segment(start, first_end), Segment(second_start, end)))
                            generated_shapes.append(((start, first_end), (second_start, end)))

            if cache is not None:
                cache[cache_key] = tuple(generated_shapes)
            if not bucket:
                impossible.append(key)
            by_cell[key] = bucket

    return ShiftSpace(
        shifts=tuple(shifts),
        by_cell={key: tuple(value) for key, value in by_cell.items()},
        impossible=tuple(impossible),
    )
