"""Step 5 — the exact placement MILP, one per (allocation, skeleton) pair.

Small by construction. The durations are fixed by the allocation and the roles
by the skeleton, so this model only chooses WHEN each shift starts: a few dozen
binaries per worked day instead of the twenty-eight thousand the global engine
carries. That is the whole speed story — the same question, asked in three
pieces instead of one.

Two objectives, because the two shapes of problem are not the same
------------------------------------------------------------------
**A single sector** keeps the historical lexicographic objective, enforced by
weighting rather than by two solves: ``BIG × underCoveredSlots +
deficitMinutes`` with ``BIG`` strictly greater than any deficit the week could
possibly carry. One extra short slot then always outweighs every minute of
deficit that could be saved, so the ordering is exact and one MILP does the work
of two passes. That regime holds because a Drive can genuinely cover its slots:
the count of short ones discriminates.

**A market zone** is measured against the REFERENCE demand, with a convex cost
and no slot term at all. Three reasons, each of them measured:

- the adapted target is a volume, and when the zone is short of hands that
  volume no longer covers the day. What it drops is the end of the day, so the
  target states that no one is needed after 17:45 — and the placement complies,
  leaving counters dark while people stack up at midday;
- the search ranks its candidates on the reference demand (`evaluate`), so
  optimising the adapted target meant optimising something other than what
  decides between the results;
- with almost every slot already short, ``BIG × underCoveredSlots`` becomes a
  near-constant the linear relaxation can only fractionate, and the branch tree
  explodes: the MILP stopped returning any schedule at all within sixty
  seconds. The count of short slots stays in the objective, but as a WEIGHT
  rather than a priority — it discriminates without dominating.

What neither is, is a claim about the WEEK. This model is optimal for the
allocation and skeleton it was given; both were chosen heuristically upstream,
so the pipeline never reports its answer as a global optimum.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np
from scipy.optimize import Bounds, LinearConstraint, milp
from scipy.sparse import coo_matrix

from shiftos_highs.demand import DemandModel

from .allocation import Allocation, AllocationModel
from .shifts import ShiftSpace, latest_close, role_implied_by_demand

_SCIPY_OPTIMAL = 0
_SCIPY_INFEASIBLE = 2

#: Ce que coûte la PREMIÈRE personne manquante sur un comptoir, en unités de
#: déficit ordinaire. Laisser un comptoir désert n'est pas la même faute que
#: lui retirer un renfort, et un coût linéaire les confond.
DARK_COUNTER_WEIGHT = 4

#: Combien de temps, après l'ouverture d'un comptoir, une absence se paie plus
#: cher — et de combien.
#:
#: Le déficit était UNIFORME : une heure manquante à l'ouverture coûtait
#: exactement le même prix qu'une heure manquante à quinze heures, si bien que
#: le moteur plaçait le trou là où ses durées tombaient le mieux, souvent au
#: début. Pour un magasin les deux heures ne se valent pas : un comptoir qui
#: ouvre en retard se voit, un creux de milieu d'après-midi beaucoup moins.
#:
#: C'est un POIDS, jamais une règle dure. Le moteur ira combler l'ouverture en
#: priorité et, s'il ne le peut vraiment pas, rendra quand même un planning au
#: lieu de déclarer la semaine impossible — ce qu'un plancher incassable aurait
#: fait.
OPENING_PRIORITY_MINUTES = 60
OPENING_DARK_MULTIPLIER = 2


def opening_priority_cells(problem: dict[str, Any]) -> set[tuple[str, str, int]]:
    """Les cellules de la première heure d'ouverture de chaque comptoir.

    Définies ICI et partagées : le placement les fait payer plus cher, l'oracle
    doit les faire payer pareil, et le barème qui compare les deux aussi. Trois
    lectures divergentes de la même règle, c'est trois mesures incomparables.

    Vide en mono-secteur : sa production est mesurée par des fixtures de
    référence, et rien de ce qui suit ne doit la déplacer.
    """
    step = int(problem["timeStepMinutes"])
    cells: set[tuple[str, str, int]] = set()
    for sector in problem.get("sectors") or []:
        sector_id = str(sector["id"])
        for sector_day in sector["days"]:
            if sector_day["closed"]:
                continue
            opens_at = int(sector_day["opensAtMinutes"])
            closes_at = int(sector_day["closesAtMinutes"])
            for start in range(
                opens_at, min(opens_at + OPENING_PRIORITY_MINUTES, closes_at), step
            ):
                cells.add((sector_id, str(sector_day["date"]), start))
    return cells


#: Ce que coûte un CRÉNEAU entamé, en unités de déficit, dans une zone.
#:
#: Un poids, pas une priorité. Le mono met ce compte en tête avec un `BIG` qui
#: écrase le reste, et c'est tenable chez lui : ses créneaux sont couvrables,
#: donc le compte discrimine. Dans une zone qui manque de bras ils sont presque
#: tous entamés — le terme devient une quasi-constante que la relaxation ne sait
#: que fractionner, et le MILP ne rendait plus aucun horaire. À poids modéré il
#: départage sans dominer : la recherche classe ses candidats sur ce compte
#: d'abord, et le placement doit au moins le voir.
SHORT_SLOT_WEIGHT = 1


@dataclass(frozen=True, slots=True)
class PlacementResult:
    assignments: tuple[dict[str, Any], ...] | None
    under_covered_slots: int
    deficit_minutes: int
    proven: bool
    infeasible: bool
    seconds: float
    #: L'écart qui reste entre cet horaire et la meilleure borne que le solveur
    #: ait su démontrer, en fraction. Zéro veut dire prouvé optimal POUR CES
    #: DURÉES. Ce n'est pas la même information que `proven` : un horaire non
    #: prouvé à 2 % d'écart est à prendre, un à 300 % dit que la recherche n'a
    #: rien compris au problème et que le chercher ailleurs est plus utile que
    #: de lui donner du temps.
    gap: float | None = None
    #: Nœuds explorés. Beaucoup de nœuds ET un grand écart désignent une borne
    #: linéaire faible, pas un modèle trop gros.
    nodes: int | None = None
    #: True quand cet horaire vient du filet de sécurité : légal, mais choisi
    #: sans aucun objectif. À ne jamais confondre avec une réponse — voir
    #: `placement_cap_for`, qui rendrait sinon les budgets suivants au motif
    #: qu'une réponse existe.
    fell_back: bool = False


def _finite(value: Any) -> float | None:
    """Un `inf` ou un `nan` n'est pas une mesure : ne rien dire vaut mieux.

    HiGHS rapporte un écart infini tant qu'aucune borne duale n'a été établie,
    et le laisser traverser mettrait `Infinity` dans un JSON de diagnostic —
    illisible pour un lecteur et invalide pour la moitié des analyseurs.
    """
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number or number in (float("inf"), float("-inf")):
        return None
    return number


def _finite_int(value: Any) -> int | None:
    number = _finite(value)
    return None if number is None else int(number)


class _Rows:
    def __init__(self) -> None:
        self.rows: list[int] = []
        self.cols: list[int] = []
        self.values: list[float] = []
        self.lower: list[float] = []
        self.upper: list[float] = []

    def add(self, coefficients: dict[int, float], lb: float, ub: float) -> None:
        row = len(self.lower)
        for column, value in coefficients.items():
            if value:
                self.rows.append(row)
                self.cols.append(column)
                self.values.append(float(value))
        self.lower.append(lb)
        self.upper.append(ub)

    def constraint(self, columns: int) -> LinearConstraint:
        matrix = coo_matrix(
            (self.values, (self.rows, self.cols)), shape=(len(self.lower), columns)
        ).tocsr()
        return LinearConstraint(matrix, np.array(self.lower), np.array(self.upper))


def place(
    problem: dict[str, Any],
    model: AllocationModel,
    allocation: Allocation,
    space: ShiftSpace,
    demand: DemandModel,
    *,
    time_limit: float,
    #: Garder une part du budget pour redemander, sans objectif, N'IMPORTE QUEL
    #: horaire légal. À n'activer que lorsqu'aucune réponse n'existe encore —
    #: voir la raison dans le corps.
    feasibility_fallback: bool = False,
) -> PlacementResult:
    import time

    started = time.perf_counter()
    if space.impossible:
        return PlacementResult(None, 0, 0, True, True, time.perf_counter() - started)

    step = model.step
    employees = sorted(problem["employees"], key=lambda item: str(item["id"]))
    days = sorted([d for d in problem["days"] if not d["closed"]], key=lambda d: d["date"])
    rules = problem["rules"]

    shifts = space.shifts
    shift_count = len(shifts)
    if shift_count == 0:
        return PlacementResult(None, 0, 0, True, True, time.perf_counter() - started)

    # ── Columns ─────────────────────────────────────────────────────────────
    #: `(comptoir, date, début, plancher dur, cible adaptée, demande de référence)`
    intervals: list[tuple[str, str, int, int, int, int]] = []
    slot_of_interval: list[list[int]] = []
    slot_ids: list[str] = []
    slot_index: dict[str, int] = {}

    for slot in sorted(
        problem["demandSlots"], key=lambda s: (s["date"], s["startMinutes"], s["id"])
    ):
        slot_index[slot["id"]] = len(slot_ids)
        slot_ids.append(slot["id"])

    membership: dict[tuple[str, str, int], list[int]] = {}
    for slot in problem["demandSlots"]:
        index = slot_index[slot["id"]]
        sector_id = str(slot.get("sectorId") or problem["sectorId"])
        for start in range(int(slot["startMinutes"]), int(slot["endMinutes"]), step):
            membership.setdefault((sector_id, slot["date"], start), []).append(index)

    if problem.get("sectors"):
        # Per counter, and against the ADAPTED target — the same figure the
        # mono-sector branch below has always used.
        #
        # This branch used to read `requiredEmployees` raw, which quietly
        # switched the adaptive rescaling off for a whole market zone: a week
        # with two people off sick was measured against a normal-day profile
        # nobody could reach, and every counter reported a deficit no schedule
        # could have avoided. The rescaling is decided per atomic counter cell
        # in `demand.py`, so the targets read here already add up to what the
        # day can actually place.
        for date in sorted(demand.days):
            for cell in demand.days[date].sector_intervals:
                intervals.append(
                    (
                        cell.sector_id,
                        date,
                        cell.start,
                        cell.hard_minimum,
                        cell.adapted_target,
                        cell.reference_required,
                    )
                )
                slot_of_interval.append(
                    sorted(membership.get((cell.sector_id, date, cell.start), []))
                )
    else:
        for date in sorted(demand.days):
            for interval in demand.days[date].intervals:
                intervals.append((problem["sectorId"], date, interval.start, interval.hard_minimum, interval.adapted_target, interval.adapted_target))
                slot_of_interval.append(sorted(membership.get((problem["sectorId"], date, interval.start), [])))

    # ── Contre QUELLE demande une zone marché est mesurée ───────────────────
    #
    # Contre la demande de référence, et par couches. Deux corrections en une,
    # et elles vont ensemble.
    #
    # 1. La cible adaptée est un VOLUME réparti sur la journée. Quand la zone
    #    manque de bras, ce volume ne couvre plus la journée entière et le
    #    reste est retiré de sa fin : la cible dit alors « personne n'est requis
    #    après 17:45 ». Le placement obéit — mesuré sur une semaine à quatre
    #    comptoirs, deux d'entre eux éteints la dernière heure et quart pendant
    #    que 705 minutes se dépensaient en double sur un troisième à midi. Le
    #    planning était conforme à ce qu'on lui demandait ; c'est la demande qui
    #    était muette. Or la RECHERCHE, elle, classe déjà ses candidats sur la
    #    demande de référence (`evaluate`) : le placement optimisait donc autre
    #    chose que ce qui départage ses propres résultats.
    #
    #    Contre la référence, minimiser le déficit revient exactement à
    #    minimiser le SURPLUS — la présence totale est fixée par l'allocation —
    #    c'est-à-dire précisément les doublons inutiles.
    #
    # 2. Le déficit devient CONVEXE. Un linéaire fait payer le même prix à la
    #    personne qui manque sur un comptoir désert et à la deuxième qui manque
    #    sur un comptoir déjà tenu ; entre les deux, un chef de rayon n'hésite
    #    pas une seconde. La colonne `dark` porte la première personne
    #    manquante, la colonne `thin` les suivantes, et le solveur épuise la
    #    seconde avant d'entamer la première.
    #
    # 3. Le compte de CRÉNEAUX manqués sort de l'objectif. Il y entrait avec un
    #    poids `BIG` qui écrase tout le reste, ce qui n'a de sens que s'il reste
    #    des créneaux à sauver : dans une zone qui manque de bras, ils sont
    #    presque tous entamés, le terme devient une constante que la relaxation
    #    linéaire ne sait que fractionner, et l'arbre explose. Mesuré : le MILP
    #    ne trouvait PLUS AUCUN horaire en soixante secondes là où il en
    #    trouvait un sans ce terme. Le compte reste rapporté, recalculé sur les
    #    shifts retenus — il informe, il ne guide plus.
    #
    # Le mono garde sa cible adaptée, sa colonne unique et son terme `BIG`,
    # octet pour octet : c'est sa production que les fixtures mesurent.
    layered = bool(problem.get("sectors"))

    deficit_offset = shift_count
    dark_offset = deficit_offset + len(intervals)
    slot_offset = dark_offset + (len(intervals) if layered else 0)
    columns = slot_offset + len(slot_ids)

    def target_of(index: int) -> int:
        """La demande que ce placement doit servir sur cette cellule."""
        return intervals[index][5] if layered else intervals[index][4]

    rows = _Rows()

    # Exactly one shift per worked cell.
    for key, bucket in sorted(space.by_cell.items()):
        if bucket:
            rows.add({index: 1.0 for index in bucket}, 1, 1)

    # ── Coverage ────────────────────────────────────────────────────────────
    covering: dict[tuple[str, str, int], list[int]] = {}
    for shift in shifts:
        date = days[shift.day_index]["date"]
        for block in shift.sector_assignments:
            for start in range(block.start, block.end, step):
                covering.setdefault((block.sector_id, date, start), []).append(shift.index)

    for index, (sector_id, date, start, hard, _adapted, _reference) in enumerate(intervals):
        target = target_of(index)
        presence = {column: 1.0 for column in covering.get((sector_id, date, start), [])}
        if hard > 0:
            rows.add(dict(presence), float(hard), np.inf)
        missing = {deficit_offset + index: 1.0}
        if layered:
            missing[dark_offset + index] = 1.0
        if target > hard:
            with_deficit = dict(presence)
            with_deficit.update(missing)
            rows.add(with_deficit, float(target), np.inf)
        for slot in slot_of_interval[index]:
            if target > 0:
                rows.add(
                    {**missing, slot_offset + slot: -float(target)},
                    -np.inf,
                    0.0,
                )

    # Opening/closing belongs to the sector assignment that touches the
    # boundary, never to the outer span of the employee's day.
    for sector in problem.get("sectors") or []:
        sector_id = str(sector["id"])
        for sector_day in sector["days"]:
            if sector_day["closed"]:
                continue
            # La demande porte deja l'ouverture et la fermeture : les imposer
            # EN PLUS, et en dur, transforme un deficit en impossibilite.
            if role_implied_by_demand(problem, sector_id, sector_day):
                continue
            date = sector_day["date"]
            opens_at = int(sector_day["opensAtMinutes"])
            closes_at = int(sector_day["closesAtMinutes"])
            # Le rayon peut s'attarder : ferme celui qui finit dans la fenêtre.
            latest = latest_close(sector_day)
            openers: dict[int, float] = {}
            closers: dict[int, float] = {}
            for shift in shifts:
                if days[shift.day_index]["date"] != date:
                    continue
                if any(block.sector_id == sector_id and block.start == opens_at for block in shift.sector_assignments):
                    openers[shift.index] = 1.0
                if any(
                    block.sector_id == sector_id and closes_at <= block.end <= latest
                    for block in shift.sector_assignments
                ):
                    closers[shift.index] = 1.0
            rows.add(openers, float(sector_day["minimumOpenings"]), np.inf)
            rows.add(closers, float(sector_day["exactClosings"]), np.inf)

    if problem.get("sectors"):
        # One pass over the shifts, not one pass per employee per counter with a
        # linear day lookup inside. The old shape was O(employees × shifts ×
        # counters) with a `next()` scan at the bottom; on a five-counter zone
        # whose shift space had grown to a hundred thousand candidates that is
        # the single most expensive block in the model build, and it computes
        # the same two numbers per shift for every employee it is not about.
        boundaries: dict[tuple[str, str], tuple[int, int, int]] = {}
        for sector in problem["sectors"]:
            for sector_day in sector["days"]:
                if sector_day["closed"]:
                    continue
                boundaries[(str(sector["id"]), sector_day["date"])] = (
                    int(sector_day["opensAtMinutes"]),
                    int(sector_day["closesAtMinutes"]),
                    latest_close(sector_day),
                )

        opening_by_employee: dict[int, dict[int, float]] = {}
        closing_by_employee: dict[int, dict[int, float]] = {}
        for shift in shifts:
            date = days[shift.day_index]["date"]
            opens = 0
            closes = 0
            for block in shift.sector_assignments:
                own = boundaries.get((block.sector_id, date))
                if own is None:
                    continue
                if block.start == own[0]:
                    opens += 1
                if own[1] <= block.end <= own[2]:
                    closes += 1
            if opens:
                opening_by_employee.setdefault(shift.employee_index, {})[shift.index] = float(opens)
            if closes:
                closing_by_employee.setdefault(shift.employee_index, {})[shift.index] = float(closes)

        for employee_index, employee in enumerate(employees):
            if employee.get("maximumOpenings") is not None:
                rows.add(
                    opening_by_employee.get(employee_index, {}),
                    -np.inf,
                    float(employee["maximumOpenings"]),
                )
            if employee.get("maximumClosings") is not None:
                rows.add(
                    closing_by_employee.get(employee_index, {}),
                    -np.inf,
                    float(employee["maximumClosings"]),
                )

    # ── Rest between consecutive worked days ────────────────────────────────
    rest = int(rules["minimumRestMinutes"])
    for employee_index in range(len(employees)):
        worked = [
            day_index
            for day_index in range(len(days))
            if allocation.minutes[employee_index][day_index] > 0
        ]
        for position in range(1, len(worked)):
            previous, current = worked[position - 1], worked[position]
            gap = (current - previous) * 1_440
            coefficients: dict[int, float] = {}
            for index in space.by_cell.get((employee_index, current), ()):
                coefficients[index] = coefficients.get(index, 0.0) + shifts[index].first_start
            for index in space.by_cell.get((employee_index, previous), ()):
                coefficients[index] = coefficients.get(index, 0.0) - shifts[index].last_end
            rows.add(coefficients, rest - gap, np.inf)

    # ── Objective ───────────────────────────────────────────────────────────
    #
    # Mono : lexicographique par pondération. `BIG` dépasse tout déficit que la
    # semaine pourrait porter, donc un créneau entamé de plus ne s'échange
    # jamais contre des minutes gagnées.
    #
    # Zone : la première personne manquante sur un comptoir coûte
    # `DARK_COUNTER_WEIGHT` fois une suivante, et un créneau entamé coûte
    # `SHORT_SLOT_WEIGHT` — un poids, pas une priorité, contrairement au `BIG`
    # du mono qui rendait le modèle insoluble ici.
    priority = opening_priority_cells(problem) if layered else set()

    objective = np.zeros(columns)
    for index in range(len(intervals)):
        objective[deficit_offset + index] = float(step)
        if layered:
            sector_id, date, start = intervals[index][0:3]
            weight = DARK_COUNTER_WEIGHT * (
                OPENING_DARK_MULTIPLIER if (sector_id, date, start) in priority else 1
            )
            objective[dark_offset + index] = float(step * weight)
    if layered:
        for index in range(len(slot_ids)):
            objective[slot_offset + index] = float(step * SHORT_SLOT_WEIGHT)
    else:
        biggest_deficit = sum(target_of(index) for index in range(len(intervals))) * step
        big = float(biggest_deficit + 1) * 10.0
        for index in range(len(slot_ids)):
            objective[slot_offset + index] = big
    # Sector rank is a REAL tie-break in multi-sector mode, not floating-point
    # decoration.  The former fixed 1e-7 coefficient was below HiGHS' useful
    # tolerance on a normal week: two employees could be exchanged between
    # their first and second sectors with identical coverage and the solver
    # treated both answers as the same objective.
    #
    # Scale it from the whole roster. Even the WORST possible rank assignment
    # then costs at most one quarter of a single missing atomic interval, so
    # coverage remains strictly first. Mono-sector keeps the historical 1e-7
    # value byte-for-byte to protect the Drive's established tie-breaking path.
    preference_weight = 1e-7
    if problem.get("sectors"):
        maximum_preference_penalty = sum(
            max(0, len(employee.get("allowedSectorIds") or [problem["sectorId"]]) - 1)
            * int(employee["contractMinutes"])
            for employee in employees
        )
        if maximum_preference_penalty > 0:
            preference_weight = min(
                1e-3,
                (float(step) / 4.0) / float(maximum_preference_penalty),
            )

    # Plain hours remain far below every coverage term.
    for shift in shifts:
        objective[shift.index] = (
            shift.sector_switches * 1e-2
            + (len(shift.segments) - 1) * 1e-3
            + shift.sector_preference_penalty * preference_weight
            + shift.index * 1e-12
        )

    lower_bounds = np.zeros(columns)
    upper_bounds = np.ones(columns)
    for index in range(len(intervals)):
        target = target_of(index)
        # En couches, `dark` porte la PREMIÈRE personne manquante et garde sa
        # borne à un ; `thin` ne peut donc jamais servir sur un comptoir désert.
        upper_bounds[deficit_offset + index] = float(
            max(0, target - 1) if layered else target
        )

    integrality = np.ones(columns, dtype=np.int8)
    bounds = Bounds(lower_bounds, upper_bounds)
    constraint = rows.constraint(columns)
    # Ce que la recherche du meilleur horaire laisse à la recherche d'un
    # horaire tout court. Zéro quand une réponse existe déjà : il n'y a alors
    # rien à sauver, et le budget vaut mieux dépensé à améliorer.
    # ── Le filet ne se paie PAS sur la recherche du meilleur horaire ────────
    #
    # Il l'a fait, et cela a coûté exactement ce qu'une précaution mal placée
    # coûte toujours. Sur une zone où chacun sert quatre comptoirs, le modèle
    # compte 47 708 colonnes et le MILP y trouve un planning À ZÉRO DÉFICIT en
    # quarante-cinq secondes. Amputé du quart de son budget il n'en trouvait
    # aucun, le filet rendait alors un horaire légal jamais optimisé, et la
    # recherche gardait ce 9 825 comme s'il s'agissait d'une réponse.
    #
    # Le filet n'est donc armé que sur la SECONDE tentative, celle qui n'existe
    # que parce que la première a échoué : là, la question facile est la seule
    # qui reste, et personne ne lui prend rien.
    reserve = (
        float(time_limit) * 0.25 if feasibility_fallback and time_limit >= 4.0 else 0.0
    )

    result = milp(
        objective,
        integrality=integrality,
        bounds=bounds,
        constraints=constraint,
        options={
            "time_limit": float(max(1.0, time_limit)) - reserve,
            "mip_rel_gap": 0.0,
        },
    )

    # ── Un planning imparfait vaut mieux que pas de planning ────────────────
    #
    # Un MILP arrêté par le temps sans incumbent n'a rien prouvé : il n'a pas
    # trouvé, ce qui n'est pas la même chose que « il n'y a rien ». Mesuré sur
    # une zone à quatre comptoirs, une exécution sur cinq du moteur INCHANGÉ
    # rendait `timeout-without-solution` sur une semaine que les quatre autres
    # plannifiaient sans peine — même code, même problème, l'aléa de la
    # recherche arborescente.
    #
    # Trouver un horaire légal est une question bien plus facile que trouver le
    # meilleur. On la repose donc, sans objectif, avec ce qui a été mis de côté
    # pour elle. Le chef de rayon reçoit un planning qu'il peut corriger au lieu
    # d'un refus qu'il ne peut que relancer.
    fell_back = False
    if result.x is None and result.status != _SCIPY_INFEASIBLE and reserve > 0.0:
        fell_back = True
        result = milp(
            np.zeros(columns),
            integrality=integrality,
            bounds=bounds,
            constraints=constraint,
            options={"time_limit": reserve},
        )

    seconds = time.perf_counter() - started

    if result.status == _SCIPY_INFEASIBLE:
        return PlacementResult(None, 0, 0, True, True, seconds)
    if result.x is None:
        return PlacementResult(None, 0, 0, False, False, seconds)

    chosen = [shift for shift in shifts if result.x[shift.index] > 0.5]
    assignments = [
        {
            "employeeId": model.employees[shift.employee_index],
            "date": days[shift.day_index]["date"],
            "segments": [
                {"startMinutes": s.start, "endMinutes": s.end} for s in shift.segments
            ],
            "sectorAssignments": [
                {"sectorId": block.sector_id, "startMinutes": block.start, "endMinutes": block.end}
                for block in shift.sector_assignments
            ],
        }
        for shift in chosen
    ]
    assignments.sort(key=lambda item: (item["date"], item["employeeId"]))

    if layered:
        # Relu sur les shifts retenus, jamais sur les colonnes de déficit : une
        # résolution sans objectif les laisse à n'importe quelle valeur ≥ le
        # manque réel, et un chiffre rapporté doit décrire le planning rendu.
        present: dict[tuple[str, str, int], int] = {}
        for shift in chosen:
            date = days[shift.day_index]["date"]
            for block in shift.sector_assignments:
                for start in range(block.start, block.end, step):
                    key = (block.sector_id, date, start)
                    present[key] = present.get(key, 0) + 1
        deficit = 0
        short_slots: set[int] = set()
        for index, (sector_id, date, start, _hard, _adapted, _reference) in enumerate(
            intervals
        ):
            missing_here = max(
                0, target_of(index) - present.get((sector_id, date, start), 0)
            )
            if missing_here:
                deficit += missing_here * step
                short_slots.update(slot_of_interval[index])
        # Les colonnes de créneau ne sont pas relues non plus : sans objectif,
        # rien ne les tire vers le bas.
        short = len(short_slots)
    else:
        deficit = sum(
            int(round(result.x[deficit_offset + index])) for index in range(len(intervals))
        ) * step
        short = sum(
            1 for index in range(len(slot_ids)) if result.x[slot_offset + index] > 0.5
        )

    return PlacementResult(
        assignments=tuple(assignments),
        under_covered_slots=short,
        deficit_minutes=deficit,
        # Un horaire trouvé sans objectif est légal, pas optimal : le dire
        # optimal serait une affirmation que rien n'a démontrée.
        proven=result.status == _SCIPY_OPTIMAL and not fell_back,
        infeasible=False,
        seconds=seconds,
        # Sans objectif, l'écart rapporté ne parle pas de la couverture : c'est
        # celui du problème de faisabilité, et il vaut zéro sans rien prouver.
        gap=None if fell_back else _finite(getattr(result, "mip_gap", None)),
        nodes=_finite_int(getattr(result, "mip_node_count", None)),
        fell_back=fell_back,
    )
