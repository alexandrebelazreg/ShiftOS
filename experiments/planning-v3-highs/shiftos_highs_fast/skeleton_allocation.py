"""Allocation conditioned on a skeleton — the order the documented spike used.

Why the order matters
---------------------
The engine used to ask "how long does everyone work" first, then "who opens and
who closes", then "when". That order throws away the only information that makes
a duration meaningful. A duration on its own says nothing about coverage: 465
minutes is a number. A duration held by a DESIGNATED OPENER is a fact about the
week — that person is on the floor from opening until opening plus 465, and
nowhere else. The position is decided, so the coverage is decided.

Asking for minutes before roles therefore forces the allocation MILP to steer by
proxies — evenness, polarisation, concentration — none of which can see demand.
Six shape families and a large-neighbourhood repair took Drive to one short slot
and stopped there, not because the search was weak but because no proxy for
shape is a statement about coverage.

Conditioning the allocation on the skeleton removes the proxy. Once the roles
are fixed, every candidate duration has a KNOWN set of legal positions, so the
objective can reward the minutes that will actually land on demand.

What makes this legal to do in this order
-----------------------------------------
Planiteo has no optional days. A fixed rest, an unavailability or an absence
forbids work; every other available day is worked, and every cell carries at
least ``minimumDailyMinutes``. So the SUPPORT of the allocation matrix — who
works which days — is settled by availability alone, before any MILP. Which is
what lets the skeleton be built first: the roles only need to know who is on the
floor, not for how long.

Only the distribution of minutes inside that fixed support is open, and that is
what this module decides, one small MILP per skeleton.

Durations restricted to what can actually be worked
---------------------------------------------------
A duration the allocation picks but the placement cannot shape is worse than
useless — it wastes a placement and hides the cell that caused it. So each cell's
domain is filtered to the durations admitting at least one legal shift under the
skeleton's role: an opener keeps only durations that still fit from the opening
instant inside their own window, a closer only those that reach back from
closing, a split-length duration only those with a legal two-segment shape. The
MILP then chooses from a domain where every value is placeable by construction.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any

import numpy as np
from scipy.optimize import Bounds, LinearConstraint, milp
from scipy.sparse import coo_matrix

from shiftos_highs.demand import DemandModel

from .allocation import Allocation, AllocationModel
from .shifts import Segment, _sector_patterns, _tighten_for_rest, sole_server_duties
from .skeleton import Skeleton

#: Enough shapes to find the best position without paying for a full
#: enumeration. Probing is a ranking device, not the placement.
SHAPE_PROBE_CAP = 400

#: Ce que coûte une journée dont les minutes IMPOSENT une coupure.
#:
#: Mille, quand le meilleur gain de couverture vaut dix : ce n'est pas une
#: préférence, c'est un veto — aucune couverture, si grande soit-elle, ne peut
#: acheter une coupure.
#:
#: ABAISSÉ À TROIS PUIS RÉTABLI, mesuré sur une vraie semaine à cinq comptoirs.
#: Le raisonnement semblait imparable : un comptoir ouvert de 8h à 20h ne peut
#: pas être tenu d'un bout à l'autre par une personne dont la traite est
#: plafonnée à huit heures, le rayon autorisait la coupure, le salarié la
#: portait, et dix heures en deux fois cinq couvraient tout sauf deux. La
#: mesure a dit non : déficit 345 → 390 minutes et deux journées coupées de
#: plus, pour quinze minutes gagnées sur le comptoir visé et un trou NEUF créé
#: le lendemain.
#:
#: Pourquoi : `covered_demand` est un PROXY, la meilleure position possible de
#: cette durée-là. Donner dix heures à quelqu'un n'oblige personne à les poser
#: sur le comptoir qui en manque — le placement, lui, arbitre ensuite avec ses
#: propres contraintes, et le budget journalier exact fait payer ces minutes par
#: quelqu'un d'autre. Allonger une journée ne couvre donc pas ce qu'on croyait
#: allonger.
FORCED_SPLIT_PENALTY = 1_000.0


@dataclass(frozen=True, slots=True)
class DurationOption:
    minutes: int
    #: How many legal positions this duration has. More positions is more room
    #: for the placement to resolve a conflict it cannot foresee here.
    starts: int
    #: Best demand actually reachable from those positions, summed over the
    #: atomic cells the shift would occupy.
    covered_demand: int
    splits: bool


@dataclass(frozen=True, slots=True)
class DayReach:
    """What a day needs so that its evening is covered at all.

    Openers start exactly at opening and closers end exactly at closing, so the
    two groups reach toward each other and someone has to bridge the gap. This
    records who may bridge and how far the bridge must go.
    """

    day_index: int
    amplitude: int
    opener_indexes: tuple[int, ...]
    closer_indexes: tuple[int, ...]
    #: Ceilings of everyone holding no role: they may sit anywhere in the middle,
    #: so they shorten the bridge for free.
    free_reach: int


@dataclass(frozen=True, slots=True)
class DurationSpace:
    """Admissible durations per cell, under one skeleton."""

    options: dict[tuple[int, int], tuple[DurationOption, ...]]
    #: Cells the skeleton left with no workable duration at all. A skeleton with
    #: any of these cannot produce a schedule and is dropped before its MILP.
    dead_cells: tuple[tuple[int, int], ...]
    #: Per day, what the roles force about reaching from opening to closing.
    #: Empty for days where the role-free staff already cover any gap.
    reaches: tuple[DayReach, ...] = ()

    def durations(self, employee_index: int, day_index: int) -> frozenset[int]:
        return frozenset(
            option.minutes for option in self.options.get((employee_index, day_index), ())
        )


# The problem, demand model and rules are immutable during one solve.  A cell's
# duration options therefore depend only on its identity, tightened window and
# role under the current skeleton.  Reusing this cache avoids probing the same
# hundreds of split shapes again for every near-identical skeleton.
DurationOptionCacheKey = tuple[int, int, int, int, bool, bool]
DurationOptionCache = dict[DurationOptionCacheKey, tuple[DurationOption, ...]]


def _check_deadline(deadline: float | None) -> None:
    if deadline is not None and time.perf_counter() >= deadline:
        raise TimeoutError("budget épuisé pendant l'énumération des durées")


def _prefix_demand(
    demand: DemandModel,
    date: str,
    step: int,
    origin: int,
    cells: int,
    *,
    reference: bool = False,
) -> list[int]:
    """Cumulative target, so covering [a, b) costs one subtraction.

    `reference` picks WHICH target. A market zone reads the configured demand,
    a single sector the adapted one, and the difference is not cosmetic: the
    adapted target of a zone short of hands drops to zero at the end of the day,
    so an evening position scores zero here and the allocation quietly prefers
    durations that sit in the morning — the very concentration the placement is
    then blamed for. The zone's placement measures itself against the reference
    demand, and this is the same question asked earlier.
    """
    profile = [0] * (cells + 1)
    day = demand.days.get(date)
    if day is not None:
        for interval in day.intervals:
            index = (interval.start - origin) // step
            if 0 <= index < cells:
                profile[index + 1] = (
                    interval.reference_required if reference else interval.adapted_target
                )
    for index in range(1, cells + 1):
        profile[index] += profile[index - 1]
    return profile


def _day_reaches(
    problem: dict[str, Any],
    model: AllocationModel,
    skeleton: Skeleton,
) -> tuple[DayReach, ...]:
    """Which days need someone to bridge opening to closing, and who may do it.

    The bound the ROLES force — the "bornes supplémentaires liées aux rôles
    forcés" the design document asks the allocation to receive, and the piece
    this engine was missing.

    Every designated opener starts exactly at opening, so opener ``i`` is on the
    floor until ``opening + d_i``. The closer ends exactly at closing, so they
    reach back to ``closing − d_c``. Someone holding no role may sit anywhere in
    their own window and shortens the bridge by at most their ceiling. So the day
    is coverable only if

        max over openers of d_i  +  free ceilings  +  d_c  ≥  amplitude

    A first attempt used the openers' CEILINGS instead of their chosen durations,
    to keep the bound a plain constant. It was valid but useless: one opener with
    a split allowed reaches 600 minutes on paper, so the bound came out at the
    minimum shift length and never bit — while the allocation handed that same
    opener 420 and left two hours of the evening empty. The bound has to speak
    about the durations actually chosen, which is why it is imposed inside the
    MILP rather than as a domain filter.

    Days where the role-free ceilings already span the gap are dropped here, so
    the model only carries the constraint where it can bind.
    """
    employees = sorted(problem["employees"], key=lambda item: str(item["id"]))
    days = sorted([d for d in problem["days"] if not d["closed"]], key=lambda d: d["date"])

    reaches: list[DayReach] = []
    for day_index, day in enumerate(days):
        amplitude = int(day["closesAtMinutes"]) - int(day["opensAtMinutes"])
        openers: list[int] = []
        closers: list[int] = []
        free_reach = 0
        for employee_index in range(len(employees)):
            cell = model.cell(employee_index, day_index)
            if cell is None:
                continue
            if skeleton.opens(employee_index, day_index):
                openers.append(employee_index)
            elif skeleton.closes(employee_index, day_index):
                closers.append(employee_index)
            else:
                free_reach += cell.maximum
        if not openers or not closers:
            continue
        if free_reach >= amplitude:
            continue
        reaches.append(
            DayReach(
                day_index=day_index,
                amplitude=amplitude,
                opener_indexes=tuple(openers),
                closer_indexes=tuple(closers),
                free_reach=free_reach,
            )
        )
    return tuple(reaches)


def build_duration_space(
    problem: dict[str, Any],
    model: AllocationModel,
    demand: DemandModel,
    skeleton: Skeleton,
    *,
    cache: DurationOptionCache | None = None,
    deadline: float | None = None,
    duties: dict[tuple[str, str], tuple[tuple[str, int, int | None], ...]] | None = None,
) -> DurationSpace:
    """Which durations each cell can actually work, given its role.

    Mirrors the shift generator's rules exactly — same boundary reading, same
    split conditions — but only asks whether a shape EXISTS and how good its
    best position is. Generating the shapes here would duplicate the generator;
    contradicting it would be worse. The pipeline cross-checks the two by
    counting any cell this module declared workable that the generator then left
    empty.
    """
    step = model.step
    rules = problem["rules"]
    employees = sorted(problem["employees"], key=lambda item: str(item["id"]))
    days = sorted([d for d in problem["days"] if not d["closed"]], key=lambda d: d["date"])

    # The support is fixed by availability, so the rest-tightened windows can be
    # computed from a probe that simply marks every available cell as worked.
    probe = Allocation(
        minutes=tuple(
            tuple(
                0 if model.cell(employee_index, day_index) is None else step
                for day_index in range(len(days))
            )
            for employee_index in range(len(employees))
        ),
        origin="probe",
    )
    windows = _tighten_for_rest(problem, model, probe, skeleton)

    minimum_segment = int(rules["minimumShiftMinutes"])
    continuous_cap = int(rules.get("maximumContinuousMinutes") or rules["maximumShiftMinutes"])
    split_allowed = bool(rules.get("splitShiftAllowed"))
    minimum_gap = int(rules.get("minimumSplitMinutes") or 0)
    maximum_gap = rules.get("maximumSplitMinutes")

    options: dict[tuple[int, int], tuple[DurationOption, ...]] = {}
    dead: list[tuple[int, int]] = []
    # Comptoirs à serveur unique : une seule personne peut y tenir l'ouverture
    # ET la fermeture, donc elle y est d'un bout à l'autre. Une durée qui ne
    # laisse pas la place à cette plage — plus, le cas échéant, un second bloc
    # d'au moins une heure ailleurs — n'est pas travaillable, et ce module doit
    # le dire ICI. Sinon il annonce une durée que le générateur laissera vide,
    # et le pipeline compte cette divergence comme une recherche pilotée par un
    # mensonge sur ce qui est plaçable.
    if duties is None:
        duties = sole_server_duties(problem)

    for day_index, day in enumerate(days):
        _check_deadline(deadline)
        opens_at = int(day["opensAtMinutes"])
        closes_at = int(day["closesAtMinutes"])
        end_of_day = closes_at
        day_demand = demand.days.get(day["date"])
        if day_demand is not None:
            for interval in day_demand.intervals:
                end_of_day = max(end_of_day, interval.end)
        cells = max(0, -(-(end_of_day - opens_at) // step))
        multi_sector = bool(problem.get("sectors"))
        prefix = _prefix_demand(
            demand, day["date"], step, opens_at, cells, reference=multi_sector
        )
        # ── La demande que CETTE personne peut servir ───────────────────────
        #
        # Un salarié de zone n'est autorisé que sur deux comptoirs. Classer ses
        # durées sur la demande de la zone entière lui compte des heures qu'il
        # ne pourra jamais tenir : la journée paraît chargée à l'heure où c'est
        # le comptoir du voisin qui l'est, et l'allocation lui donne des minutes
        # là où elles ne serviront à personne. Un prefix par ENSEMBLE de
        # comptoirs autorisés répond à la vraie question — ils sont peu nombreux
        # et partagés, donc le cache tient en quelques entrées.
        by_allowed: dict[tuple[str, ...], list[int]] = {}

        def prefix_for(allowed: tuple[str, ...]) -> list[int]:
            if not multi_sector or not allowed:
                return prefix
            known = by_allowed.get(allowed)
            if known is not None:
                return known
            own = [0] * (cells + 1)
            day_own = demand.days.get(day["date"])
            if day_own is not None:
                for interval in day_own.sector_intervals:
                    if interval.sector_id not in allowed:
                        continue
                    index = (interval.start - opens_at) // step
                    if 0 <= index < cells:
                        own[index + 1] += interval.reference_required
            for index in range(1, cells + 1):
                own[index] += own[index - 1]
            by_allowed[allowed] = own
            return own

        def covered(start: int, stop: int, own: list[int]) -> int:
            first = max(0, (start - opens_at) // step)
            last = min(cells, -(-(stop - opens_at) // step))
            if last <= first:
                return 0
            return own[last] - own[first]

        for employee_index, employee in enumerate(employees):
            _check_deadline(deadline)
            cell = model.cell(employee_index, day_index)
            if cell is None:
                continue
            key = (employee_index, day_index)
            earliest, latest = windows[key]
            opens = skeleton.opens(employee_index, day_index)
            closes = skeleton.closes(employee_index, day_index)
            may_split = (
                split_allowed
                and bool(employee["canSplitShift"])
                and int(rules.get("maximumSplitsPerDay") or 1) >= 1
            )

            cache_key: DurationOptionCacheKey = (
                employee_index,
                day_index,
                earliest,
                latest,
                opens,
                closes,
            )
            if cache is not None and cache_key in cache:
                cached = cache[cache_key]
                if cached:
                    options[key] = cached
                else:
                    dead.append(key)
                continue

            own_prefix = prefix_for(
                tuple(
                    sorted(str(value) for value in employee.get("allowedSectorIds") or ())
                )
            )

            duty = duties.get((str(employee["id"]), day["date"]), ())
            # Les deux bornes que la plage forcée impose, calculées une fois.
            # Une forme qui ne l'enveloppe pas ne peut admettre aucune lecture —
            # le vérifier ici coûte deux comparaisons, alors qu'interroger le
            # générateur de motifs coûtait cinquante fois le reste du sondage :
            # dix secondes et demie sur une semaine réelle, contre deux dixièmes
            # pour tout le travail restant.
            must_start_by = min((opens for _s, opens, _c in duty), default=None)
            # Une obligation peut ne porter QUE sur l'ouverture : la titulaire
            # qui ne coupe pas ouvre et fait ses heures, sans devoir fermer.
            must_end_after = max(
                (closes for _s, _o, closes in duty if closes is not None), default=None
            )

            def shapes_into_sectors(segments: tuple[Segment, ...]) -> bool:
                """La forme admet-elle une lecture par rayon ?

                Filtre arithmétique d'abord, générateur ensuite — et c'est bien
                la MÊME fonction que lui qui tranche au bout, sans quoi les deux
                lectures des règles pourraient diverger. Sans contrainte forcée,
                la question est déjà tranchée ailleurs et on ne la repose pas.
                """
                if not duty:
                    return True
                if must_start_by is not None and segments[0].start > must_start_by:
                    return False
                if must_end_after is not None and segments[-1].end < must_end_after:
                    return False
                return bool(_sector_patterns(problem, employee, day, segments, step, duty))

            found: list[DurationOption] = []
            for minutes in range(cell.minimum, cell.maximum + 1, step):
                _check_deadline(deadline)
                starts = 0
                best = 0

                if minutes <= continuous_cap:
                    if opens:
                        candidates = [opens_at]
                    elif closes:
                        candidates = [closes_at - minutes]
                    else:
                        candidates = list(range(earliest, latest - minutes + 1, step))
                    for start in candidates:
                        end = start + minutes
                        if start < earliest or end > latest:
                            continue
                        if opens and start != opens_at:
                            continue
                        if closes and end != closes_at:
                            continue
                        if start == opens_at and not employee["canOpen"]:
                            continue
                        if end == closes_at and not employee["canClose"]:
                            continue
                        if not shapes_into_sectors((Segment(start, end),)):
                            continue
                        starts += 1
                        best = max(best, covered(start, end, own_prefix))

                forced = minutes > continuous_cap
                if may_split and forced:
                    # Only FORCED splits are probed. An opportunistic split needs
                    # a trough between two peaks and never changes whether a
                    # duration is workable — the single stretch already answers
                    # that — so probing them would cost enumeration and decide
                    # nothing.
                    gap_high = int(maximum_gap) if maximum_gap is not None else latest - earliest
                    gap_low = max(minimum_gap, step)
                    shapes = 0
                    probes = 0
                    for first in range(
                        minimum_segment, min(continuous_cap, minutes - minimum_segment) + 1, step
                    ):
                        second = minutes - first
                        if second < minimum_segment or second > continuous_cap:
                            continue
                        for gap in range(gap_low, gap_high + 1, step):
                            span = minutes + gap
                            for start in range(earliest, latest - span + 1, step):
                                probes += 1
                                if probes % 256 == 0:
                                    _check_deadline(deadline)
                                first_end = start + first
                                second_start = first_end + gap
                                end = second_start + second
                                if opens and start != opens_at:
                                    continue
                                if closes and end != closes_at:
                                    continue
                                if start == opens_at and not employee["canOpen"]:
                                    continue
                                if end == closes_at and not employee["canClose"]:
                                    continue
                                if not shapes_into_sectors(
                                    (Segment(start, first_end), Segment(second_start, end))
                                ):
                                    continue
                                starts += 1
                                best = max(
                                    best,
                                    covered(start, first_end, own_prefix)
                                    + covered(second_start, end, own_prefix),
                                )
                                shapes += 1
                                if shapes >= SHAPE_PROBE_CAP:
                                    break
                            if shapes >= SHAPE_PROBE_CAP:
                                break
                        if shapes >= SHAPE_PROBE_CAP:
                            break

                if starts > 0:
                    found.append(
                        DurationOption(
                            minutes=minutes, starts=starts, covered_demand=best, splits=forced
                        )
                    )

            cached_options = tuple(found)
            if cache is not None:
                cache[cache_key] = cached_options
            if cached_options:
                options[key] = cached_options
            else:
                dead.append(key)

    return DurationSpace(
        options=options,
        dead_cells=tuple(dead),
        reaches=_day_reaches(problem, model, skeleton),
    )


def solve_for_skeleton(
    problem: dict[str, Any],
    model: AllocationModel,
    space: DurationSpace,
    *,
    time_limit: float,
    origin: str,
    coverage_weight: float = 10.0,
    freedom_weight: float = 1.0,
    #: Combinaisons de durées dont le placement a PROUVÉ qu'aucun horaire ne les
    #: réalise. Chacune interdit exactement son ensemble, jamais davantage.
    forbidden: tuple[tuple[tuple[int, int, int], ...], ...] = (),
) -> Allocation | None:
    """One small MILP: choose a duration per cell, from the workable ones only.

    A binary per (cell, admissible duration) rather than an integer minute
    column, because the admissible set has HOLES — an opener whose window ends
    at 14:00 can work 240 minutes from opening but not 255 if 255 would cross
    it, and there is no interval that says so. An integer column would have to
    be relaxed to the hull and would then choose values nothing can place.

    The sums are unchanged and still exact:

        Σ_v y[e,d,v] = 1                      one duration per worked cell
        Σ_d Σ_v v·y[e,d,v] = contract(e)
        Σ_e Σ_v v·y[e,d,v] = budget(d)

    The objective is what the old order could not express. With the roles fixed,
    every (cell, duration) has a known best position, so the reward is the demand
    that position actually covers — a statement about coverage, not about shape.
    Freedom of position breaks ties: between two durations covering the same
    demand, the one with more legal starts leaves the placement somewhere to go.
    Forced splits stay heavily penalised, so neither term can ever buy one.
    """
    step = model.step
    employees = sorted(problem["employees"], key=lambda item: str(item["id"]))
    days = sorted([d for d in problem["days"] if not d["closed"]], key=lambda d: d["date"])

    if space.dead_cells:
        return None

    columns: dict[tuple[int, int, int], int] = {}
    for key in sorted(space.options):
        for option in space.options[key]:
            columns[(key[0], key[1], option.minutes)] = len(columns)
    if not columns:
        return None

    total = len(columns)
    day_deviation: dict[int, int] = {}
    for day_index, day in enumerate(days):
        if day.get("budgetMode", "exact") == "target":
            day_deviation[day_index] = total + len(day_deviation)
    total += len(day_deviation)
    rows: list[int] = []
    cols: list[int] = []
    values: list[float] = []
    lower: list[float] = []
    upper: list[float] = []

    def add(coefficients: dict[int, float], lb: float, ub: float) -> None:
        row = len(lower)
        for column, value in coefficients.items():
            if value:
                rows.append(row)
                cols.append(column)
                values.append(float(value))
        lower.append(lb)
        upper.append(ub)

    for key in sorted(space.options):
        add({columns[(key[0], key[1], o.minutes)]: 1.0 for o in space.options[key]}, 1.0, 1.0)

    for employee_index, employee in enumerate(employees):
        contract = int(employee["contractMinutes"])
        coefficients = {
            column: minutes / step
            for (index, _day, minutes), column in columns.items()
            if index == employee_index
        }
        add(coefficients, contract / step, contract / step)

    for day_index, day in enumerate(days):
        budget = int(day["budgetMinutes"])
        coefficients = {
            column: minutes / step
            for (_employee, index, minutes), column in columns.items()
            if index == day_index
        }
        if day_index not in day_deviation:
            add(coefficients, budget / step, budget / step)
        else:
            dev = day_deviation[day_index]
            add({**coefficients, dev: -1.0}, -np.inf, budget / step)
            add({column: -value for column, value in coefficients.items()} | {dev: -1.0}, -np.inf, -budget / step)

    # ── Ce que le placement a déjà réfuté ───────────────────────────────────
    #
    # Le moteur essayait des allocations jusqu'à épuisement du budget sans rien
    # RETENIR de ses échecs : sur une semaine réelle, cinquante-deux vecteurs de
    # durées ont été proposés et cinquante-deux placements les ont prouvés
    # irréalisables, sans qu'aucune de ces preuves ne rétrécisse la recherche.
    #
    # Une coupe « no-good » corrige cela. Elle interdit EXACTEMENT la
    # combinaison réfutée — au moins une de ses durées doit changer — et rien de
    # plus : une coupe plus large retirerait des allocations que personne n'a
    # réfutées, et pourrait cacher la seule qui marche.
    for cut in forbidden:
        columns_of_cut = [
            columns[(employee_index, day_index, minutes)]
            for employee_index, day_index, minutes in cut
            if (employee_index, day_index, minutes) in columns
        ]
        if len(columns_of_cut) == len(cut) and columns_of_cut:
            add({column: 1.0 for column in columns_of_cut}, -np.inf, float(len(cut) - 1))

    # ── The bridge from opening to closing ──────────────────────────────────
    #
    # One binary per (day, opener) saying "this one is the reacher", exactly one
    # per day, and a big-M constraint that only binds on the chosen reacher:
    #
    #     d_reacher + free ceilings + Σ closers ≥ amplitude
    #
    # Without it the allocation is free to hand every opener a short day and the
    # closer a short evening, which satisfies contracts and budgets exactly and
    # leaves a hole in the middle that no placement can fill. That is precisely
    # what happened on a real roster: four openers off by 14:00, the closer in at
    # 16:00, and two hours with nobody in the shop — reported by the placement as
    # infeasible, which is true and unhelpful, because the decision that doomed
    # it was taken one phase earlier.
    reachers: dict[tuple[int, int], int] = {}
    for reach in space.reaches:
        for employee_index in reach.opener_indexes:
            reachers[(reach.day_index, employee_index)] = total + len(reachers)
    total += len(reachers)

    for reach in space.reaches:
        add(
            {reachers[(reach.day_index, e)]: 1.0 for e in reach.opener_indexes},
            1.0,
            1.0,
        )
        # M has to dominate the shortfall the constraint can express. The
        # amplitude is that shortfall's ceiling, in steps.
        big_m = reach.amplitude / step
        for employee_index in reach.opener_indexes:
            coefficients: dict[int, float] = {}
            for option in space.options[(employee_index, reach.day_index)]:
                coefficients[columns[(employee_index, reach.day_index, option.minutes)]] = (
                    option.minutes / step
                )
            for closer_index in reach.closer_indexes:
                for option in space.options[(closer_index, reach.day_index)]:
                    column = columns[(closer_index, reach.day_index, option.minutes)]
                    coefficients[column] = coefficients.get(column, 0.0) + option.minutes / step
            coefficients[reachers[(reach.day_index, employee_index)]] = -big_m
            floor = (reach.amplitude - reach.free_reach) / step - big_m
            add(coefficients, floor, np.inf)

    objective = np.zeros(total)
    upper_bounds = np.ones(total)
    integrality = np.ones(total, dtype=np.int8)
    for day_index, column in day_deviation.items():
        maximum = sum(
            max((option.minutes for option in space.options.get((employee_index, day_index), ())), default=0)
            for employee_index in range(len(employees))
        )
        upper_bounds[column] = (maximum + int(days[day_index]["budgetMinutes"])) / step + 1.0
        integrality[column] = 0
        objective[column] = 1.0
    peak_demand = max(
        (option.covered_demand for entries in space.options.values() for option in entries),
        default=0,
    )

    for key in sorted(space.options):
        for option in space.options[key]:
            column = columns[(key[0], key[1], option.minutes)]
            score = 0.0
            if peak_demand > 0:
                score += coverage_weight * (option.covered_demand / peak_demand)
            score += freedom_weight * (min(option.starts, 20) / 20.0)
            objective[column] = -score
            if option.splits:
                objective[column] += FORCED_SPLIT_PENALTY

    result = milp(
        objective,
        integrality=integrality,
        bounds=Bounds(np.zeros(total), upper_bounds),
        constraints=LinearConstraint(
            coo_matrix((values, (rows, cols)), shape=(len(lower), total)).tocsr(),
            np.array(lower),
            np.array(upper),
        ),
        options={"time_limit": float(time_limit), "mip_rel_gap": 0.0},
    )

    if result.x is None:
        return None

    minutes_by_cell = [[0] * len(days) for _ in employees]
    for (employee_index, day_index, minutes), column in columns.items():
        if result.x[column] > 0.5:
            minutes_by_cell[employee_index][day_index] = minutes

    return Allocation(
        minutes=tuple(tuple(row) for row in minutes_by_cell), origin=origin
    )


def respects(allocation: Allocation, space: DurationSpace) -> bool:
    """Is every cell of this allocation still a workable duration?

    The 2×2 repair moves minutes around a rectangle, and a move that lands a
    cell on a duration its role cannot shape produces a placement that fails for
    a reason the search would then misattribute to the swap's coverage.
    """
    for employee_index, row in enumerate(allocation.minutes):
        for day_index, minutes in enumerate(row):
            key = (employee_index, day_index)
            if minutes <= 0:
                if key in space.options:
                    return False
                continue
            if minutes not in space.durations(*key):
                return False
    return True
