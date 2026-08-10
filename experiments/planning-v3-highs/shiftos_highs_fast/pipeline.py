"""`v3-highs-global` asks one enormous question. This asks four small ones.

The pipeline, and why it is in this order:

1. **rescale the demand and settle the hard floors** — before any model, so a
   day nobody can staff is reported as such instead of being discovered by a
   solver that then cannot say why;
2. **allocate minutes** — a thirty-variable MILP fixing how long each employee
   works each day. Every later phase deals with durations that are already
   decided, which is what collapses the shift space;
3. **rank several skeletons** — never one greedy walk. Openings and closings are
   weekly facts and choosing them badly is unrecoverable, so candidates come
   from four families and are ranked by the deficit each has already made
   unavoidable;
4. **generate the reduced shifts** — duration decided plus role decided leaves
   only the start free;
5. **place exactly**, one small MILP per (allocation, skeleton);
6. **swap 2×2 and re-place** — the neighbourhood that preserves contracts and
   the current daily totals by construction.

Stopping rules
--------------
Zero is the target and the moment it is reached, INDEPENDENTLY CONFIRMED by the
evaluator, the search stops: there is nothing better than a legal schedule with
nothing missing, and continuing would only spend budget proving a tie.

When zero is out of reach the engine returns the best schedule it found inside
its time budget and says exactly that. `proof` stays `none` — the allocation and
the skeleton were chosen heuristically, so no claim about the week's optimum is
available at any price. That is the difference between this engine and the
oracle, and it is the difference the caller has to see.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from itertools import combinations
from typing import Any

from shiftos_highs.demand import (
    budget_minutes,
    build_demand_model,
    workable_capacity_minutes,
)
from shiftos_highs.evaluate import evaluate
from shiftos_highs.fingerprint import fingerprint_problem, fingerprint_solution

from .allocation import (
    Allocation,
    allocation_infeasibility_details,
    build_allocation_model,
    build_families,
    repair_large_neighbourhood,
    score_allocation,
    solve_allocation,
    solve_polarised,
    swap_neighbours,
)
from .placement import place
from .shifts import (
    MAXIMUM_SHIFTS_BEFORE_NARROWING,
    MINIMUM_SECTOR_BLOCK_MINUTES,
    MIXED_PATTERNS_WHEN_NARROWED,
    generate_shifts,
    role_implied_by_demand,
)
from .skeleton import Skeleton, generate_skeletons, generate_skeletons_from_capacity
from .skeleton_allocation import (
    DurationSpace,
    build_duration_space,
    respects,
    solve_for_skeleton,
)

ENGINE = "v3-highs-fast"


def _sector_role_conflicts(problem: dict[str, Any]) -> list[dict[str, Any]]:
    """Prove sector openings/closings that have too few eligible employees.

    The demand preflight works in employee-minutes and therefore cannot see a
    role attached to one particular sector. Without this check, a day with no
    authorised fish-counter opener can pass both the demand and allocation
    probes, then waste the whole search budget generating role skeletons that
    can never be placed.
    """
    sectors = problem.get("sectors") or []
    if not sectors:
        return []

    employees = list(problem.get("employees") or [])
    rules = problem.get("rules") or {}
    employee_days = {
        (str(entry.get("employeeId")), str(entry.get("date"))): entry
        for entry in problem.get("employeeDays") or []
    }
    conflicts: list[dict[str, Any]] = []

    for sector in sectors:
        sector_id = str(sector.get("id"))
        own_split_rules = (
            sector.get("splitRules")
            if isinstance(sector.get("splitRules"), dict)
            else rules
        )
        assigned = [
            employee
            for employee in employees
            if sector_id in [str(value) for value in employee.get("allowedSectorIds") or []]
        ]
        assigned_names = [
            f"{employee.get('firstName', '')} {employee.get('lastName', '')}".strip()
            or str(employee.get("id"))
            for employee in assigned
        ]

        for sector_day in sector.get("days") or []:
            if bool(sector_day.get("closed")):
                continue
            # Une exigence que la demande porte deja ne peut plus PROUVER
            # une impossibilite : elle se resout en deficit, pas en refus.
            if role_implied_by_demand(problem, sector_id, sector_day):
                continue
            date = str(sector_day.get("date"))
            opens_at = sector_day.get("opensAtMinutes")
            closes_at = sector_day.get("closesAtMinutes")
            required_openers = max(0, int(sector_day.get("minimumOpenings") or 0))
            required_closers = max(0, int(sector_day.get("exactClosings") or 0))

            usable: list[tuple[dict[str, Any], dict[str, Any]]] = []
            unavailable: list[dict[str, str]] = []
            for employee, name in zip(assigned, assigned_names):
                entry = employee_days.get((str(employee.get("id")), date))
                minimum = int(employee.get("minimumDailyMinutes") or 0)
                if (
                    entry is None
                    or not bool(entry.get("available"))
                    or int(entry.get("maximumMinutes") or 0) < minimum
                ):
                    unavailable.append({
                        "employeeName": name,
                        "reason": str((entry or {}).get("unavailableReason") or "indisponible"),
                    })
                    continue
                usable.append((employee, entry))

            opening_candidates = [
                employee
                for employee, entry in usable
                if bool(employee.get("canOpen"))
                and isinstance(opens_at, int)
                and int(entry.get("earliestStartMinutes") or 0) <= opens_at
                and int(entry.get("latestEndMinutes") or 0) > opens_at
            ]
            closing_candidates = [
                employee
                for employee, entry in usable
                if bool(employee.get("canClose"))
                and isinstance(closes_at, int)
                and int(entry.get("earliestStartMinutes") or 0) < closes_at
                and int(entry.get("latestEndMinutes") or 0) >= closes_at
            ]

            span = (
                closes_at - opens_at
                if isinstance(opens_at, int) and isinstance(closes_at, int)
                else 0
            )
            joint_candidates: set[str] = set()
            # Why the best-placed candidate still cannot bracket the day. The
            # counts alone ("1 opener, 1 closer, 0 who can do both") say a
            # schedule is impossible without saying which rule to move, and the
            # rule that binds is very often NOT the one a reader assumes: on an
            # 11 h counter with a 1 h 30 maximum break, one person would have to
            # work 9 h 30 to hold both ends, and it is the DAILY ceiling that
            # refuses — lengthening the permitted break fixes it, raising the
            # daily ceiling alone does not.
            solo: dict[str, Any] | None = None
            minimum_segment = int(rules.get("minimumShiftMinutes") or 0)
            for employee, entry in usable:
                if employee not in opening_candidates or employee not in closing_candidates:
                    continue
                # Le plafond, ET d'où il vient.
                #
                # C'est un `min` de trois entrées qui ne se corrigent pas au
                # même endroit : le contrat du salarié, sa journée du jour
                # (réglages magasin et fenêtre de disponibilité confondus, le
                # constructeur les a déjà fusionnés) et la règle de la zone.
                # Afficher « au-dessus du plafond de 8 h » sans dire lequel
                # laisse le lecteur chercher dans trois écrans — c'est la même
                # faute que nommer « limite continue » un nombre qui vient du
                # plafond quotidien.
                contract_cap = int(employee.get("maximumDailyMinutes") or 0)
                day_cap = int(entry.get("maximumMinutes") or 0)
                zone_cap = int(rules.get("maximumShiftMinutes") or 0)
                maximum_work = min(contract_cap, day_cap, zone_cap)
                # Le constructeur sait LEQUEL de ses cinq plafonds a gagné : il
                # les voit tous les cinq, ce module n'en voit que le minimum.
                # Deviner ici a déjà coûté un aller-retour — le message annonçait
                # « configuration du magasin » alors qu'un RAYON plafonnait.
                declared = entry.get("maximumMinutesSource")
                if maximum_work == day_cap and isinstance(declared, str):
                    cap_source = declared
                elif maximum_work == contract_cap:
                    cap_source = "contract"
                elif maximum_work == day_cap:
                    cap_source = "day"
                else:
                    cap_source = "zone"
                continuous_cap = min(
                    maximum_work,
                    int(rules.get("maximumContinuousMinutes") or maximum_work),
                )
                can_hold_both = span <= continuous_cap
                sector_allows_split = bool(own_split_rules.get("splitShiftAllowed"))
                employee_may_split = bool(employee.get("canSplitShift"))
                may_split = sector_allows_split and employee_may_split
                maximum_gap = int(own_split_rules.get("maximumSplitMinutes") or span)
                minimum_gap = int(own_split_rules.get("minimumSplitMinutes") or 0)
                if may_split:
                    maximum_splits = own_split_rules.get("maximumSplitsPerDay")
                    minimum_total = max(2 * minimum_segment, span - maximum_gap)
                    maximum_total = min(maximum_work, span - minimum_gap)
                    can_hold_both = can_hold_both or (
                        (maximum_splits is None or int(maximum_splits) >= 1)
                        and minimum_total <= maximum_total
                    )
                if can_hold_both:
                    joint_candidates.add(str(employee.get("id")))
                    continue
                # The break long enough to bring the worked minutes under the
                # ceiling, when one exists at all. Both ends still need a legal
                # segment, so a break may not exceed `span − 2 × minimum shift`.
                needed_gap = span - maximum_work
                widest_legal_gap = span - 2 * minimum_segment
                candidate = {
                    "employeeName": (
                        f"{employee.get('firstName', '')} {employee.get('lastName', '')}".strip()
                        or str(employee.get("id"))
                    ),
                    "soloWorkedMinutes": (
                        max(2 * minimum_segment, span - maximum_gap) if may_split else span
                    ),
                    "dailyCapMinutes": maximum_work,
                    "dailyCapSource": cap_source,
                    "contractCapMinutes": contract_cap,
                    "dayCapMinutes": day_cap,
                    "zoneCapMinutes": zone_cap,
                    "continuousCapMinutes": continuous_cap,
                    "splitAllowed": may_split,
                    # Deux permissions distinctes, et le levier n'est pas le
                    # même : le rayon peut interdire la coupure, ou le salarié
                    # ne pas la porter. Dire « autorisez la coupure sur ce
                    # rayon » quand c'est la capacité du salarié qui manque
                    # envoie sur le mauvais écran.
                    "sectorSplitAllowed": sector_allows_split,
                    "employeeMaySplit": employee_may_split,
                    "maximumSplitMinutes": maximum_gap if may_split else None,
                    "requiredSplitMinutes": (
                        needed_gap
                        if may_split and minimum_gap <= needed_gap <= widest_legal_gap
                        else None
                    ),
                }
                # The least-bad candidate: the one closest to holding the day is
                # the one whose configuration is worth moving.
                if solo is None or candidate["soloWorkedMinutes"] < solo["soloWorkedMinutes"]:
                    solo = candidate

            role_combination_exists = False
            for openers in combinations(opening_candidates, required_openers):
                opener_ids = {str(employee.get("id")) for employee in openers}
                for closers in combinations(closing_candidates, required_closers):
                    overlap = opener_ids & {
                        str(employee.get("id")) for employee in closers
                    }
                    if overlap <= joint_candidates:
                        role_combination_exists = True
                        break
                if role_combination_exists:
                    break

            if (
                len(opening_candidates) >= required_openers
                and len(closing_candidates) >= required_closers
                and role_combination_exists
            ):
                continue
            conflicts.append({
                "sectorId": sector_id,
                "sectorName": str(sector.get("name") or sector_id),
                "date": date,
                "opensAtMinutes": opens_at,
                "closesAtMinutes": closes_at,
                "requiredOpeners": required_openers,
                "openingCandidateCount": len(opening_candidates),
                "requiredClosers": required_closers,
                "closingCandidateCount": len(closing_candidates),
                "jointRoleConflict": (
                    len(opening_candidates) >= required_openers
                    and len(closing_candidates) >= required_closers
                    and not role_combination_exists
                ),
                "jointCandidateCount": len(joint_candidates),
                "openingClosingSpanMinutes": span,
                "maximumSingleSpanMinutes": min(
                    int(rules.get("maximumShiftMinutes") or 0),
                    int(rules.get("maximumContinuousMinutes") or rules.get("maximumShiftMinutes") or 0),
                ),
                #: Why one person cannot hold both ends, and what to move.
                #: Absent when nobody is eligible for both roles in the first
                #: place — there is then no single-holder story to tell.
                **({"soloRoleBlock": solo} if solo is not None else {}),
                "availableEmployeeCount": len(usable),
                "assignedEmployeeNames": assigned_names,
                "unavailableEmployees": unavailable,
            })

    return conflicts


def _cross_sector_role_conflicts(problem: dict[str, Any]) -> list[dict[str, Any]]:
    """Prove a role collision created by an employee's sole-sector duty.

    Sector-by-sector candidate counts are insufficient in a market zone. On
    the same Wednesday, Daniel may appear as a valid Charcuterie opener and
    closer when inspected alone, while being the sole person who must already
    cover Fromage from 06:00 to 09:00. This check carries that forced interval
    into the neighbouring sector's role combinations.

    It deliberately proves only the narrow, certain case: one employee is the
    sole opener *and* closer of an anchor sector, and another sector has no
    legal opener/closer pair after that occupation is honoured. Anything less
    certain remains with the heuristic search and is never called infeasible.
    """
    sectors = problem.get("sectors") or []
    if len(sectors) < 2:
        return []

    employees = list(problem.get("employees") or [])
    employee_by_id = {str(employee.get("id")): employee for employee in employees}
    entries = {
        (str(entry.get("employeeId")), str(entry.get("date"))): entry
        for entry in problem.get("employeeDays") or []
    }
    rules = problem.get("rules") or {}

    records: list[dict[str, Any]] = []
    for sector in sectors:
        sector_id = str(sector.get("id"))
        assigned = [
            employee
            for employee in employees
            if sector_id
            in [str(value) for value in employee.get("allowedSectorIds") or []]
        ]
        for sector_day in sector.get("days") or []:
            if bool(sector_day.get("closed")):
                continue
            if role_implied_by_demand(problem, sector_id, sector_day):
                continue
            date = str(sector_day.get("date"))
            opens_at = sector_day.get("opensAtMinutes")
            closes_at = sector_day.get("closesAtMinutes")
            if not isinstance(opens_at, int) or not isinstance(closes_at, int):
                continue
            usable = [
                (employee, entries.get((str(employee.get("id")), date)))
                for employee in assigned
            ]
            usable = [
                (employee, entry)
                for employee, entry in usable
                if entry is not None and bool(entry.get("available"))
            ]
            openers = [
                str(employee.get("id"))
                for employee, entry in usable
                if bool(employee.get("canOpen"))
                and int(entry.get("earliestStartMinutes") or 0) <= opens_at
                and int(entry.get("latestEndMinutes") or 0) > opens_at
            ]
            closers = [
                str(employee.get("id"))
                for employee, entry in usable
                if bool(employee.get("canClose"))
                and int(entry.get("earliestStartMinutes") or 0) < closes_at
                and int(entry.get("latestEndMinutes") or 0) >= closes_at
            ]
            records.append({
                "sector": sector,
                "sectorId": sector_id,
                "sectorName": str(sector.get("name") or sector_id),
                "day": sector_day,
                "date": date,
                "opensAtMinutes": opens_at,
                "closesAtMinutes": closes_at,
                "requiredOpeners": max(0, int(sector_day.get("minimumOpenings") or 0)),
                "requiredClosers": max(0, int(sector_day.get("exactClosings") or 0)),
                "openers": openers,
                "closers": closers,
                "assigned": assigned,
            })

    anchors: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for record in records:
        if record["requiredOpeners"] < 1 or record["requiredClosers"] < 1:
            continue
        if len(record["openers"]) != 1 or record["openers"] != record["closers"]:
            continue
        employee_id = record["openers"][0]
        anchors.setdefault((record["date"], employee_id), []).append(record)

    minimum_segment = int(rules.get("minimumShiftMinutes") or 0)

    def split_rules(record: dict[str, Any]) -> dict[str, Any]:
        own = record["sector"].get("splitRules")
        return own if isinstance(own, dict) else rules

    def maximum_work(employee: dict[str, Any], date: str) -> int:
        entry = entries[(str(employee.get("id")), date)]
        values = [
            int(employee.get("maximumDailyMinutes") or 0),
            int(entry.get("maximumMinutes") or 0),
            int(rules.get("maximumShiftMinutes") or 0),
        ]
        return min(value for value in values if value > 0)

    def can_split_between(
        employee: dict[str, Any], first: dict[str, Any], second: dict[str, Any], span: int
    ) -> bool:
        first_rules = split_rules(first)
        second_rules = split_rules(second)
        if not bool(employee.get("canSplitShift")):
            return False
        if not bool(first_rules.get("splitShiftAllowed")) or not bool(second_rules.get("splitShiftAllowed")):
            return False
        first_count = first_rules.get("maximumSplitsPerDay")
        second_count = second_rules.get("maximumSplitsPerDay")
        if (first_count is not None and int(first_count) < 1) or (
            second_count is not None and int(second_count) < 1
        ):
            return False
        minimum_gap = max(
            int(first_rules.get("minimumSplitMinutes") or 0),
            int(second_rules.get("minimumSplitMinutes") or 0),
        )
        maximum_values = [
            int(value)
            for value in (
                first_rules.get("maximumSplitMinutes"),
                second_rules.get("maximumSplitMinutes"),
            )
            if value is not None
        ]
        maximum_gap = min(maximum_values) if maximum_values else span
        minimum_total = max(2 * minimum_segment, span - maximum_gap)
        maximum_total = min(maximum_work(employee, first["date"]), span - minimum_gap)
        return minimum_total <= maximum_total

    def role_compatible_with_anchors(
        employee_id: str, target: dict[str, Any], point: int, role: str
    ) -> bool:
        employee = employee_by_id[employee_id]
        own_anchors = [
            anchor
            for anchor in anchors.get((target["date"], employee_id), [])
            if anchor["sectorId"] != target["sectorId"]
        ]
        if len(own_anchors) > 1:
            # Multiple independent forced counters need a richer proof. Do not
            # guess here.
            return True
        if not own_anchors:
            return True
        anchor = own_anchors[0]
        anchor_start = int(anchor["opensAtMinutes"])
        anchor_end = int(anchor["closesAtMinutes"])
        overlaps = (
            anchor_start <= point < anchor_end
            if role == "opening"
            else anchor_start < point <= anchor_end
        )
        if overlaps:
            return False

        # ── La place qui reste à côté du comptoir déjà occupé ────────────────
        #
        # Ne pas chevaucher ne suffit pas : tenir une borne sur un AUTRE
        # comptoir crée un bloc, et un bloc de rayon dure au moins une heure. Il
        # faut donc que l'heure tienne entre cette borne et le comptoir-ancre.
        #
        # Sans ce contrôle la preuve passait à côté d'une semaine réelle : le
        # mardi, Charcuterie ouvre à 06:30 et la seule candidate encore libre à
        # cet instant tenait déjà Poisson à partir de 07:00. Trente minutes de
        # Charcuterie, ce n'est pas un passage sur un rayon — mais le préflight
        # l'acceptait, ne prouvait rien, et laissait le moteur chercher soixante
        # secondes un planning qui n'existait pas.
        if role == "opening" and point < anchor_start:
            if anchor_start - point < MINIMUM_SECTOR_BLOCK_MINUTES:
                return False
        if role == "closing" and point > anchor_end:
            if point - anchor_end < MINIMUM_SECTOR_BLOCK_MINUTES:
                return False
        outer_span = max(anchor_end, point) - min(anchor_start, point)
        continuous = min(
            maximum_work(employee, target["date"]),
            int(rules.get("maximumContinuousMinutes") or maximum_work(employee, target["date"])),
        )
        return outer_span <= continuous or can_split_between(
            employee, anchor, target, outer_span
        )

    def can_hold_both(employee_id: str, target: dict[str, Any]) -> bool:
        if not role_compatible_with_anchors(
            employee_id, target, int(target["opensAtMinutes"]), "opening"
        ) or not role_compatible_with_anchors(
            employee_id, target, int(target["closesAtMinutes"]), "closing"
        ):
            return False
        employee = employee_by_id[employee_id]
        span = int(target["closesAtMinutes"]) - int(target["opensAtMinutes"])
        continuous = min(
            maximum_work(employee, target["date"]),
            int(rules.get("maximumContinuousMinutes") or maximum_work(employee, target["date"])),
        )
        if span <= continuous:
            return True
        return can_split_between(employee, target, target, span)

    conflicts: list[dict[str, Any]] = []
    for target in records:
        if target["requiredOpeners"] != 1 or target["requiredClosers"] != 1:
            continue
        openers = [
            employee_id
            for employee_id in target["openers"]
            if role_compatible_with_anchors(
                employee_id, target, int(target["opensAtMinutes"]), "opening"
            )
        ]
        closers = [
            employee_id
            for employee_id in target["closers"]
            if role_compatible_with_anchors(
                employee_id, target, int(target["closesAtMinutes"]), "closing"
            )
        ]
        legal_pair = any(
            opener != closer or can_hold_both(opener, target)
            for opener in openers
            for closer in closers
        )
        if legal_pair:
            continue
        blocking_anchors = [
            anchor
            for employee_id in set(target["openers"] + target["closers"])
            for anchor in anchors.get((target["date"], employee_id), [])
            if anchor["sectorId"] != target["sectorId"]
        ]
        if not blocking_anchors:
            continue
        # TOUS les comptoirs qui retiennent un candidat, pas seulement le
        # premier trouvé. Sur la semaine réelle, Charcuterie était bloquée à la
        # fois par Fromage (qui retient Daniel) et par Poisson (qui retient
        # Aurélie) : n'en nommer qu'un envoie corriger la moitié du problème et
        # relancer pour retomber sur l'autre.
        seen_anchor: set[tuple[str, str]] = set()
        unique_anchors: list[dict[str, Any]] = []
        for candidate in blocking_anchors:
            key = (candidate["sectorId"], candidate["openers"][0])
            if key in seen_anchor:
                continue
            seen_anchor.add(key)
            unique_anchors.append(candidate)
        anchor = unique_anchors[0]
        anchor_employee_id = anchor["openers"][0]
        anchor_employee = employee_by_id[anchor_employee_id]

        def anchor_name(record: dict[str, Any]) -> str:
            employee = employee_by_id[record["openers"][0]]
            return (
                f"{employee.get('firstName', '')} {employee.get('lastName', '')}".strip()
                or record["openers"][0]
            )
        conflicts.append({
            "sectorId": target["sectorId"],
            "sectorName": target["sectorName"],
            "date": target["date"],
            "opensAtMinutes": target["opensAtMinutes"],
            "closesAtMinutes": target["closesAtMinutes"],
            "requiredOpeners": 1,
            "openingCandidateCount": len(openers),
            "requiredClosers": 1,
            "closingCandidateCount": len(closers),
            "jointRoleConflict": True,
            "crossSectorConflict": True,
            "openingClosingSpanMinutes": int(target["closesAtMinutes"]) - int(target["opensAtMinutes"]),
            "maximumSingleSpanMinutes": int(rules.get("maximumContinuousMinutes") or 0),
            "assignedEmployeeNames": [
                f"{employee.get('firstName', '')} {employee.get('lastName', '')}".strip()
                or str(employee.get("id"))
                for employee in target["assigned"]
            ],
            "conflictingSectorName": anchor["sectorName"],
            "conflictingEmployeeName": (
                f"{anchor_employee.get('firstName', '')} {anchor_employee.get('lastName', '')}".strip()
                or anchor_employee_id
            ),
            "conflictingStartMinutes": anchor["opensAtMinutes"],
            "conflictingEndMinutes": anchor["closesAtMinutes"],
            #: Tous les comptoirs qui retiennent un candidat de ce rayon.
            "heldElsewhere": [
                {
                    "employeeName": anchor_name(record),
                    "sectorName": record["sectorName"],
                    "startMinutes": record["opensAtMinutes"],
                    "endMinutes": record["closesAtMinutes"],
                }
                for record in unique_anchors
            ],
        })

    return conflicts


def placement_cap_for(
    default_seconds: float,
    remaining_seconds: float,
    *,
    multi_sector: bool,
    has_answer: bool,
    has_alternative_allocation: bool,
) -> float:
    """How long one placement MILP may run.

    Mono-sector keeps the historical fixed caps, unconditionally: it ranks
    twenty-four skeletons, so a couple that will not place in eight seconds is
    one of many and the budget is better spent on the next one.

    A market zone has exactly ONE couple — `generate_skeletons_from_capacity`
    returns a single empty skeleton because the roles belong to the counters and
    are imposed exactly by the placement MILP. The same eight seconds therefore
    decide the entire answer, and measured on a zone with heterogeneous counter
    hours they decided it wrongly: no incumbent at 8 s, an optimum PROVEN at
    45 s, and the engine reporting "no legal schedule in the explored
    neighbourhood" with fifty seconds of its budget unspent.

    How much more is decided by whether anything ELSE could be tried. Once the
    skeleton is fixed, a 2×2 exchange is the only source of a different
    allocation; when that neighbourhood is empty — the ordinary shape for
    part-time contracts, where five days at the daily minimum add up to exactly
    the week and pin every cell — this placement is the only one the engine will
    ever run, and hoarding budget for a search that cannot happen is how the
    answer was lost.
    """
    if not multi_sector or has_answer:
        return default_seconds
    # Une part, jamais le reste. Ce qui n'est pas donné ici finance la seconde
    # tentative et son filet de faisabilité : leur laisser trois secondes sur un
    # modèle de cinquante mille colonnes, c'était ne rien leur laisser.
    generous = (
        remaining_seconds * 0.5 if has_alternative_allocation else remaining_seconds * 0.8
    )
    return max(default_seconds, generous)


def _refuted_days(
    problem: dict[str, Any],
    model: Any,
    allocation: Any,
    space: Any,
) -> list[tuple[tuple[int, int, int], ...]]:
    """Les journées dont CES durées-là n'admettent aucun horaire.

    Une par coupe. Reposée jour par jour avec les durées effectivement choisies,
    donc ce qui revient est une preuve sur cette combinaison précise — jamais
    sur la journée en général, qu'une autre répartition sait peut-être servir.
    """
    if space is None:
        return []
    days = sorted([d for d in problem["days"] if not d["closed"]], key=lambda d: d["date"])
    blamed = days_without_placement(problem, model, space)
    cuts: list[tuple[tuple[int, int, int], ...]] = []
    for date in blamed:
        day_index = next((index for index, day in enumerate(days) if day["date"] == date), None)
        if day_index is None:
            continue
        cut = tuple(
            (employee_index, day_index, allocation.minutes[employee_index][day_index])
            for employee_index in range(len(allocation.minutes))
            if allocation.minutes[employee_index][day_index] > 0
        )
        if cut:
            cuts.append(cut)
    return cuts


def days_without_placement(
    problem: dict[str, Any],
    model: Any,
    space: Any,
    *,
    skeleton: Any = None,
    durations: Any = None,
    demand: Any = None,
) -> list[str]:
    """Les jours qu'AUCUN horaire ne peut servir, quelles que soient les durées.

    « 25 placements refusés » ne dit rien à personne : le refus vient d'un MILP
    qui couvre la semaine, et le lecteur n'a aucun moyen de savoir quelle
    journée l'a fait tomber. Ici, la même question est reposée jour par jour,
    sans le repos qui relie les journées — donc une relaxation.

    TOUTES LES DURÉES SONT MISES EN CONCURRENCE, pas seulement celles que
    l'allocation avait retenues. C'est la différence entre « cette journée est
    impossible » et « cette journée est impossible AVEC CES DURÉES-LÀ », et
    seule la première mérite d'être dite : accuser un jour que le moteur sait
    servir autrement enverrait corriger une configuration qui n'a rien.

    Ne tourne que sur le chemin d'échec, où le budget est de toute façon perdu.
    """
    # L'union des espaces d'horaires sur toutes les durées admissibles.
    if durations is not None and skeleton is not None and demand is not None:
        from .allocation import Allocation

        days_count = len(
            [d for d in problem["days"] if not d["closed"]]
        )
        employees_count = len(problem["employees"])
        merged_shifts: list[Any] = []
        merged_by_cell: dict[tuple[int, int], list[int]] = {}
        values = sorted(
            {option.minutes for options in durations.options.values() for option in options}
        )
        for value in values:
            minutes = tuple(
                tuple(
                    value if value in durations.durations(employee, day) else 0
                    for day in range(days_count)
                )
                for employee in range(employees_count)
            )
            partial = generate_shifts(
                problem, model, Allocation(minutes=minutes, origin="probe"), skeleton, demand
            )
            for shift in partial.shifts:
                merged_by_cell.setdefault(
                    (shift.employee_index, shift.day_index), []
                ).append(len(merged_shifts))
                merged_shifts.append(shift)
        if merged_shifts:
            space = type(space)(
                shifts=tuple(merged_shifts),
                by_cell={key: tuple(value) for key, value in merged_by_cell.items()},
                impossible=(),
            )
    import numpy as np
    from scipy.optimize import Bounds, LinearConstraint, milp
    from scipy.sparse import coo_matrix

    step = model.step
    days = sorted([d for d in problem["days"] if not d["closed"]], key=lambda d: d["date"])
    culprits: list[str] = []

    for day_index, day in enumerate(days):
        date = day["date"]
        local = sorted(
            index
            for (_employee, index_day), bucket in space.by_cell.items()
            if index_day == day_index
            for index in bucket
        )
        if not local:
            continue
        column_of = {index: position for position, index in enumerate(local)}

        rows_i: list[int] = []
        rows_j: list[int] = []
        rows_v: list[float] = []
        lower: list[float] = []
        upper: list[float] = []

        def add(coefficients: dict[int, float], low: float, high: float) -> None:
            row = len(lower)
            for column, value in coefficients.items():
                if value:
                    rows_i.append(row)
                    rows_j.append(column)
                    rows_v.append(float(value))
            lower.append(low)
            upper.append(high)

        for (_employee, index_day), bucket in sorted(space.by_cell.items()):
            if index_day == day_index and bucket:
                add({column_of[index]: 1.0 for index in bucket}, 1.0, 1.0)

        covering: dict[tuple[str, int], list[int]] = {}
        for index in local:
            for block in space.shifts[index].sector_assignments:
                for start in range(block.start, block.end, step):
                    covering.setdefault((block.sector_id, start), []).append(column_of[index])

        # Seuls les PLANCHERS DURS entrent ici, jamais la demande ordinaire.
        #
        # Le placement accepte un déficit de couverture — c'est ce qu'il
        # minimise. Exiger la couverture ici accuserait des journées que le
        # moteur sait parfaitement servir, en déficit : un diagnostic qui
        # dénonce l'innocent est pire que pas de diagnostic.
        floors: dict[tuple[str, int], int] = {}
        for slot in problem["demandSlots"]:
            if slot["date"] != date:
                continue
            hard = int(slot.get("hardMinimumEmployees") or 0)
            if hard <= 0:
                continue
            sector_id = str(slot.get("sectorId") or problem["sectorId"])
            for start in range(int(slot["startMinutes"]), int(slot["endMinutes"]), step):
                key = (sector_id, start)
                floors[key] = max(floors.get(key, 0), hard)
        for (sector_id, start), hard in sorted(floors.items()):
            add({column: 1.0 for column in covering.get((sector_id, start), [])}, float(hard), np.inf)

        for sector in problem.get("sectors") or []:
            sector_id = str(sector["id"])
            own = next((entry for entry in sector["days"] if entry["date"] == date), None)
            if not own or own["closed"] or role_implied_by_demand(problem, sector_id, own):
                continue
            opens_at = int(own["opensAtMinutes"])
            closes_at = int(own["closesAtMinutes"])
            latest = max(closes_at, int(own.get("latestCloseMinutes") or closes_at))
            add(
                {
                    column_of[index]: 1.0
                    for index in local
                    if any(
                        block.sector_id == sector_id and block.start == opens_at
                        for block in space.shifts[index].sector_assignments
                    )
                },
                float(own["minimumOpenings"]),
                np.inf,
            )
            add(
                {
                    column_of[index]: 1.0
                    for index in local
                    if any(
                        block.sector_id == sector_id and closes_at <= block.end <= latest
                        for block in space.shifts[index].sector_assignments
                    )
                },
                float(own["exactClosings"]),
                np.inf,
            )

        result = milp(
            np.zeros(len(column_of)),
            integrality=np.ones(len(column_of), dtype=np.int8),
            bounds=Bounds(np.zeros(len(column_of)), np.ones(len(column_of))),
            constraints=LinearConstraint(
                coo_matrix((rows_v, (rows_i, rows_j)), shape=(len(lower), len(column_of))).tocsr(),
                np.array(lower),
                np.array(upper),
            ),
            options={"time_limit": 5.0, "mip_rel_gap": 0.0},
        )
        if result.status == 2:
            culprits.append(date)

    return culprits


@dataclass
class _Counters:
    allocations_tested: int = 0
    unique_allocations: int = 0
    roots_built: int = 0
    generations: int = 0
    large_neighbourhoods: int = 0
    #: One per skeleton in the new order: how many role-conditioned allocation
    #: MILPs were actually solved, and how many had no answer at all.
    skeleton_allocations_solved: int = 0
    skeleton_allocations_infeasible: int = 0
    skeletons_without_durations: int = 0
    swaps_tested: int = 0
    swaps_rejected_by_domain: int = 0
    #: Cells the duration probe called workable and the shift generator then
    #: left empty. Must stay at zero: anything else is the two readings of the
    #: rules disagreeing, and a search steered by a lie about what is placeable.
    probe_disagreements: int = 0
    used_fallback: bool = False
    skeletons_generated: int = 0
    skeletons_placed: int = 0
    placements_run: int = 0
    placements_infeasible: int = 0
    #: Placements re-run with the remaining budget after the first attempt ended
    #: without an incumbent. Multi-sector only — see where it is raised.
    placement_retries: int = 0
    #: Combinaisons de durées que le placement a réfutées et que
    #: l'allocation ne repropose plus.
    allocation_cuts: int = 0
    shifts_generated: int = 0
    families_seen: list[str] = field(default_factory=list)
    improvements: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)


@dataclass(frozen=True, slots=True)
class _Pair:
    """A placed (allocation, skeleton) couple and what it actually scored.

    Kept as a couple rather than as an allocation, because in this order the two
    are not separable: the allocation was chosen FOR these roles and means
    nothing under different ones. The 2×2 repair below therefore re-uses the
    same skeleton and the same duration domain.
    """

    allocation: Allocation
    skeleton: Skeleton
    space: DurationSpace | None
    slots: int
    minutes: int
    label: str
    short_days: frozenset[int] = frozenset()
    #: True when the placement found nothing for THIS allocation. The couple is
    #: still kept, because the failure belongs to the allocation and not to the
    #: skeleton — see where it is recorded.
    placement_failed: bool = False


@dataclass
class _Best:
    assignments: tuple[dict[str, Any], ...] | None = None
    #: Against the REFERENCE demand, as the official validator counts it.
    under_covered_slots: int = 10**9
    deficit_minutes: int = 10**9
    #: Against the ADAPTED target, as the placement MILP counts it. Reported
    #: separately because the oracle reports both, and comparing a figure
    #: measured against one target with a figure measured against the other is
    #: how two engines get declared different when they agree.
    adapted_short_slots: int = 10**9
    adapted_deficit_minutes: int = 10**9
    allocation: Allocation | None = None
    report: dict[str, Any] | None = None
    found_at: float | None = None
    first_legal_at: float | None = None
    origin: str = ""
    #: Day indexes where the best schedule fell short. Steers the 2×2 swaps.
    short_days: frozenset[int] = frozenset()
    #: Employee-minutes spent outside their first configured sector. Ranked
    #: only after the two coverage figures.
    sector_preference_penalty: int = 10**9
    #: True quand le MILP de placement a prouvé l'optimalité de CE planning pour
    #: les durées qu'on lui avait données. Jamais une affirmation sur la semaine.
    placement_proven: bool = False
    #: L'écart restant, et l'effort qu'il a coûté — voir `PlacementResult`.
    placement_gap: float | None = None
    placement_nodes: int | None = None
    #: True quand ce planning vient du filet de faisabilité : légal, jamais
    #: optimisé. Il tient lieu de plancher, pas de réponse.
    from_fallback: bool = False

    def better_than(self, slots: int, minutes: int, sector_penalty: int = 0) -> bool:
        return (slots, minutes, sector_penalty) < (
            self.under_covered_slots,
            self.deficit_minutes,
            self.sector_preference_penalty,
        )


def _sector_preference_penalty(
    problem: dict[str, Any], assignments: tuple[dict[str, Any], ...]
) -> int:
    """Rank-weighted minutes, zero exactly when everybody stays priority #1."""
    if not problem.get("sectors"):
        return 0
    employees = {str(item["id"]): item for item in problem["employees"]}
    penalty = 0
    for assignment in assignments:
        employee = employees[str(assignment["employeeId"])]
        allowed = [str(value) for value in employee.get("allowedSectorIds") or [problem["sectorId"]]]
        rank = {sector_id: index for index, sector_id in enumerate(allowed)}
        for block in assignment.get("sectorAssignments") or []:
            penalty += rank.get(str(block["sectorId"]), len(allowed)) * (
                int(block["endMinutes"]) - int(block["startMinutes"])
            )
    return penalty


def _short_days(
    problem: dict[str, Any], demand: Any, assignments: tuple[dict[str, Any], ...]
) -> frozenset[int]:
    """Which day indexes the schedule left short of the adapted target.

    Feeds the 2×2 neighbourhood. A swap that rearranges a day already fully
    covered cannot improve anything, so those pairs are tried last.
    """
    step = int(problem["timeStepMinutes"])
    dates = [
        day["date"]
        for day in sorted(
            [d for d in problem["days"] if not d["closed"]], key=lambda d: d["date"]
        )
    ]
    present: dict[tuple[str, int], int] = {}
    for assignment in assignments:
        for segment in assignment["segments"]:
            for start in range(segment["startMinutes"], segment["endMinutes"], step):
                key = (assignment["date"], start)
                present[key] = present.get(key, 0) + 1

    short: set[int] = set()
    for index, date in enumerate(dates):
        day = demand.days.get(date)
        if day is None:
            continue
        for interval in day.intervals:
            if present.get((date, interval.start), 0) < interval.adapted_target:
                short.add(index)
                break
    return frozenset(short)


def _worst_days(
    problem: dict[str, Any],
    demand: Any,
    assignments: tuple[dict[str, Any], ...] | None,
    *,
    limit: int,
) -> list[int]:
    """The days carrying the most missing employee-minutes, worst first.

    Ranked by MINUTES rather than by count of short intervals: a day two people
    short for an hour is worth more attention than one a single person short for
    a quarter of an hour, and the count cannot tell them apart.
    """
    if assignments is None:
        return []
    step = int(problem["timeStepMinutes"])
    dates = [
        day["date"]
        for day in sorted(
            [d for d in problem["days"] if not d["closed"]], key=lambda d: d["date"]
        )
    ]
    present: dict[tuple[str, int], int] = {}
    for assignment in assignments:
        for segment in assignment["segments"]:
            for start in range(segment["startMinutes"], segment["endMinutes"], step):
                key = (assignment["date"], start)
                present[key] = present.get(key, 0) + 1

    missing: list[tuple[int, int]] = []
    for index, date in enumerate(dates):
        day = demand.days.get(date)
        if day is None:
            continue
        total = sum(
            max(0, interval.adapted_target - present.get((date, interval.start), 0)) * step
            for interval in day.intervals
        )
        if total > 0:
            missing.append((total, index))

    missing.sort(key=lambda pair: (-pair[0], pair[1]))
    return [index for _minutes, index in missing[:limit]]


def solve_fast(
    problem: dict[str, Any],
    *,
    time_limit_seconds: float = 60.0,
    #: How many skeletons the search conditions its allocations on. Higher than
    #: the old order's budget on purpose: in this order a skeleton is not one of
    #: several ways to shape a week that was already decided, it is the question
    #: the allocation MILP answers. Drive measured 1/60 at twelve skeletons and
    #: 1/30 at twenty-four, with the extra MILPs costing under a second in total.
    skeletons_per_allocation: int = 24,
    swap_limit: int = 400,
    max_generations: int = 6,
    neighbour_skeletons: int = 3,
    #: How many placed couples the 2×2 repair starts from. More than one,
    #: because the best-scoring couple is not always the one a local exchange
    #: can finish — a schedule one slot short with a rigid skeleton has less
    #: room than one two short with a permissive one.
    repair_pairs: int = 3,
) -> dict[str, Any]:
    started = time.perf_counter()
    deadline = started + max(0.0, time_limit_seconds)

    def elapsed() -> float:
        return time.perf_counter() - started

    def remaining() -> float:
        return deadline - time.perf_counter()

    fingerprint = fingerprint_problem(problem)
    multi_sector = bool(problem.get("sectors"))
    counters = _Counters()
    best = _Best()
    duration_cache: dict[Any, Any] = {}
    shift_cache: dict[Any, Any] = {}
    # Once coverage reaches 0/0, multi-sector may still improve which counter
    # owns the same hours. Give that tie-break a tiny bounded neighbourhood —
    # never the rest of the 60-second budget. Mono-sector never enters it.
    zero_coverage_tie_placements = 0
    #: Le dernier espace d'horaires construit, gardé pour pouvoir nommer le jour
    #: fautif si la recherche échoue. Sans lui, l'échec ne dit que son nombre.
    last_space: Any = None
    last_durations: Any = None
    last_skeleton: Any = None
    #: Ce que le placement a prouvé irréalisable, accumulé pour de bon.
    refuted: list[tuple[tuple[int, int, int], ...]] = []

    # The engine's decomposition assumes the support of the allocation matrix
    # is known before skeletons are generated: every available cell is worked.
    # The V3 contract also permits available-but-optional days, which violate
    # that assumption.  Refuse that shape explicitly until support selection is
    # modelled; silently forcing optional days would solve a stricter problem
    # and could turn a feasible week into a false impossibility.
    optional_days = [
        entry
        for entry in problem["employeeDays"]
        if bool(entry["available"]) and not bool(entry["mandatory"])
    ]
    if optional_days:
        return {
            "engine": ENGINE,
            "status": "invalid-problem",
            "problemFingerprint": fingerprint,
            "solution": None,
            "diagnostics": {
                "reason": "optional-work-days-not-supported",
                "optionalCells": [
                    {
                        "employeeId": str(entry["employeeId"]),
                        "date": entry["date"],
                    }
                    for entry in optional_days[:20]
                ],
                "optionalCellCount": len(optional_days),
                "totalSeconds": elapsed(),
                "proof": "none",
            },
        }

    # Sector roles are hard constraints, but unlike coverage they are attached
    # to one counter. Prove missing eligibility before any skeleton search.
    sector_role_conflicts = _sector_role_conflicts(problem)
    if not sector_role_conflicts:
        sector_role_conflicts = _cross_sector_role_conflicts(problem)
    if sector_role_conflicts:
        return {
            "engine": ENGINE,
            "status": "infeasible-proven",
            "problemFingerprint": fingerprint,
            "solution": None,
            "diagnostics": {
                "reason": "sector-role-cannot-be-staffed",
                "infeasibleSectorRoles": sector_role_conflicts,
                "totalSeconds": elapsed(),
                "proof": "structural",
            },
        }

    # ── 1. Demand rescaling and hard floors ─────────────────────────────────
    demand = build_demand_model(problem)
    if demand.infeasible_days:
        infeasible_days = []
        for date in demand.infeasible_days:
            day_demand = demand.days[date]
            budget = budget_minutes(problem, date)
            capacity = workable_capacity_minutes(problem, date)
            reason = day_demand.infeasible_reason
            if reason == "daily-budget-exceeds-workable-capacity":
                missing = max(0, (budget or 0) - capacity)
            else:
                missing = max(
                    0,
                    day_demand.total_hard_minutes
                    - day_demand.available_worked_minutes,
                )
            peak = max(
                day_demand.intervals,
                key=lambda interval: interval.hard_minimum,
                default=None,
            )
            infeasible_days.append(
                {
                    "date": date,
                    "reason": reason,
                    "budgetMinutes": budget,
                    "workableCapacityMinutes": capacity,
                    "availableWorkedMinutes": day_demand.available_worked_minutes,
                    "hardMinimumMinutes": day_demand.total_hard_minutes,
                    "missingMinutes": missing,
                    "availableEmployeeCount": sum(
                        1
                        for entry in problem["employeeDays"]
                        if entry["date"] == date and entry["available"]
                    ),
                    "peakHardMinimumEmployees": (
                        peak.hard_minimum if peak is not None else 0
                    ),
                    "peakHardMinimumStartMinutes": (
                        peak.start if peak is not None else None
                    ),
                    "peakHardMinimumEndMinutes": (
                        peak.end if peak is not None else None
                    ),
                }
            )
        return {
            "engine": ENGINE,
            "status": "infeasible-proven",
            "problemFingerprint": fingerprint,
            "solution": None,
            "diagnostics": {
                "reason": "day-cannot-be-staffed",
                "infeasibleDays": infeasible_days,
                "totalSeconds": elapsed(),
                "proof": "structural",
            },
        }

    # ── 2. Allocation — several deterministic roots, never one ──────────────
    model = build_allocation_model(problem)

    def build_roots(short_days: frozenset[int]) -> list[Allocation]:
        """One MILP per family, deduplicated, ranked by the predictive score."""
        produced: dict[str, Allocation] = {}
        for name, weights, even in build_families(problem, model, demand, short_days=short_days):
            if remaining() <= 2.0:
                break
            solved = solve_allocation(
                problem,
                model,
                time_limit=min(8.0, max(1.0, remaining())),
                weights=weights,
                even_weight=even,
                origin=name,
            )
            counters.roots_built += 1
            candidate = solved.allocation
            if candidate is None:
                continue
            # Deduplicated by SIGNATURE, not by family: two objectives that land
            # on the same matrix describe the same week, and placing it twice
            # would spend a budget rediscovering one answer.
            signature = candidate.signature()
            if signature not in produced:
                produced[signature] = candidate
        # ── Polarised roots: cells at their minimum or at their ceiling ─────
        #
        # The weighted families above all pull toward some middle. These refuse
        # it, because the shape a peaked demand needs is uneven by nature.
        starts_priority: dict[tuple[int, int], float] = {}
        for employee_index in range(len(model.employees)):
            for day_index in range(len(model.dates)):
                cell = model.cell(employee_index, day_index)
                if cell is None:
                    continue
                # How much room a cell leaves the placement, as a stand-in for
                # "how many legal starts will this shift have".
                starts_priority[(employee_index, day_index)] = float(
                    cell.maximum - cell.minimum
                )

        critical = frozenset(
            index
            for index, date in enumerate(model.dates)
            if (day := demand.days.get(date)) is not None
            and max((i.adapted_target for i in day.intervals), default=0) >= 3
        )

        polarised = [
            ("polar-concentrate", "concentrate", None, frozenset()),
            ("polar-spread", "spread", None, frozenset()),
            ("polar-parity", "parity", None, frozenset()),
            ("polar-most-starts", "weighted", starts_priority, frozenset()),
            ("polar-critical-days", "critical", None, critical),
        ]
        for name, mode, priority, days_set in polarised:
            if remaining() <= 2.0:
                break
            candidate = solve_polarised(
                problem,
                model,
                time_limit=min(8.0, max(1.0, remaining())),
                mode=mode,
                origin=name,
                cell_priority=priority,
                critical_days=days_set,
            )
            counters.roots_built += 1
            if candidate is None:
                continue
            signature = candidate.signature()
            if signature not in produced:
                produced[signature] = candidate

        ranked = sorted(
            produced.values(),
            key=lambda item: (score_allocation(problem, model, demand, item), item.signature()),
        )
        return ranked

    def attempt(
        allocation: Allocation,
        skeleton: Skeleton,
        *,
        label: str,
        space: DurationSpace | None = None,
        placement_cap_seconds: float = 8.0,
    ) -> bool:
        """Place ONE (allocation, skeleton) couple. True to stop the search.

        Both halves arrive already decided, which is the point of the order: the
        skeleton fixed the roles, the allocation chose durations those roles can
        actually work, and the placement is left with the single question it is
        good at — where inside the window each shift starts.
        """
        nonlocal zero_coverage_tie_placements
        counters.allocations_tested += 1

        try:
            shifts = generate_shifts(
                problem,
                model,
                allocation,
                skeleton,
                demand,
                cache=shift_cache,
                deadline=deadline,
            )
            # ── Un espace que le placement ne sait pas résoudre ne sert pas ──
            #
            # Mesuré sur une zone où chacun sert quatre comptoirs : 45 423
            # candidats, et le MILP devient un coup de dé — quarante-cinq
            # secondes trouvaient un planning à zéro déficit, cinquante-huit n'en
            # trouvaient aucun. Un espace plus riche qu'on ne sait pas fouiller
            # vaut moins qu'un espace plus pauvre qu'on fouille en entier.
            #
            # Jamais sur une zone ordinaire, dont l'espace tient loin sous le
            # seuil : c'est une soupape, pas une politique.
            if multi_sector and len(shifts.shifts) > MAXIMUM_SHIFTS_BEFORE_NARROWING:
                narrowed = generate_shifts(
                    problem,
                    model,
                    allocation,
                    skeleton,
                    demand,
                    deadline=deadline,
                    mixed_cap=MIXED_PATTERNS_WHEN_NARROWED,
                )
                counters.notes.append(
                    f"{label}: espace resserré de {len(shifts.shifts)} à "
                    f"{len(narrowed.shifts)} candidats"
                )
                shifts = narrowed
        except TimeoutError:
            counters.notes.append(f"{label}: budget épuisé pendant la génération des shifts")
            return False
        counters.shifts_generated += len(shifts.shifts)
        if shifts.impossible:
            # The duration probe and the shift generator must agree: a cell the
            # probe called workable and the generator leaves empty is a
            # DIVERGENCE between two readings of the same rules, not a property
            # of the week. Counted, never swallowed.
            if space is not None:
                counters.probe_disagreements += sum(
                    1 for key in shifts.impossible if key in space.options
                )
            counters.notes.append(
                f"{label}: {len(shifts.impossible)} journée(s) sans forme légale"
            )
            return False

        nonlocal last_space, last_durations, last_skeleton
        last_space, last_durations, last_skeleton = shifts, space, skeleton
        counters.skeletons_placed += 1
        counters.placements_run += 1
        # How long this one placement may take — see `placement_cap_for`.
        cap = placement_cap_for(
            placement_cap_seconds,
            remaining(),
            multi_sector=multi_sector,
            # Un horaire du filet n'est PAS une réponse : il a été choisi sans
            # objectif. Le compter comme telle rendait les budgets suivants au
            # motif qu'on avait trouvé, et gelait la zone sur le premier planning
            # légal venu.
            has_answer=best.assignments is not None and not best.from_fallback,
            has_alternative_allocation=(
                multi_sector
                and best.assignments is None
                and any(True for _ in swap_neighbours(allocation, model, limit=1))
            ),
        )
        result = place(
            problem,
            model,
            allocation,
            shifts,
            demand,
            time_limit=min(cap, max(1.0, remaining())),
        )
        # A MILP that ran out of time without an incumbent has proven NOTHING —
        # `infeasible` is false and `x` is simply absent. Treating that as a
        # failed couple is what threw the answer away above, so give it the rest
        # of the budget once before believing it.
        #
        # La condition porte sur CE QUI RESTE, pas sur ce que la tentative
        # précédente avait reçu. Comparer les deux — ce qu'elle faisait — rendait
        # la reprise impossible dès que la première tentative avait été
        # généreuse : après quarante secondes de recherche il en restait dix, et
        # « dix valent-elles mieux que quarante » a toujours répondu non. Le
        # filet ne s'est donc jamais déployé sur les seules zones qui en avaient
        # besoin.
        if (
            multi_sector
            and best.assignments is None
            and result.assignments is None
            and not result.infeasible
            and remaining() > 4.0
        ):
            counters.placement_retries += 1
            counters.placements_run += 1
            result = place(
                problem,
                model,
                allocation,
                shifts,
                demand,
                time_limit=max(1.0, remaining() - 2.0),
                feasibility_fallback=True,
            )
        if result.infeasible or result.assignments is None:
            if result.infeasible:
                counters.placements_infeasible += 1
            # Keep the couple anyway, as an anchor for the 2×2 repair.
            #
            # The placement failed for THIS allocation, not for this skeleton.
            # Per-cell feasibility is not joint feasibility: every duration in
            # the domain has a legal shift on its own, and a set of them can
            # still admit no simultaneous arrangement once rest and the hard
            # floors are imposed across the week. Dropping the couple throws
            # away the skeleton too.
            #
            # That is what stood between this engine and zero on Drive. The
            # best-ranked skeleton — the only one giving Saturday the four
            # openers its demand needs — had an infeasible first allocation and
            # was discarded, while a single 15-minute 2×2 swap on that same
            # allocation places at 0/0.
            #
            # Ranked by the SKELETON's predicted floor rather than by a result it
            # does not have. That score is a lower bound on the deficit, so a
            # skeleton predicting zero earns its repair ahead of one that placed
            # but is structurally short — which is exactly the case here.
            floor = skeleton.score[1:3] if len(skeleton.score) >= 3 else (10**6, 10**6)
            placed.append(
                _Pair(
                    allocation=allocation,
                    skeleton=skeleton,
                    space=space,
                    slots=int(floor[0]),
                    minutes=int(floor[1]),
                    label=label,
                    placement_failed=True,
                )
            )
            return False

        # The independent second opinion, before anything is kept. A model that
        # scores itself is not evidence.
        report = evaluate(problem, list(result.assignments))
        if not report["validHardConstraints"]:
            counters.notes.append(
                f"{label}: refusé par l'évaluateur ({', '.join(report['violations'][:2])})"
            )
            return False

        if best.first_legal_at is None:
            best.first_legal_at = elapsed()

        slots = int(report["underCoveredSlots"])
        minutes = int(report["totalDeficitMinutes"])
        sector_penalty = _sector_preference_penalty(problem, result.assignments)
        already_had_zero = best.under_covered_slots == 0 and best.deficit_minutes == 0
        if already_had_zero and problem.get("sectors"):
            zero_coverage_tie_placements += 1
        pair_short_days = _short_days(problem, demand, result.assignments)
        placed.append(
            _Pair(
                allocation=allocation,
                skeleton=skeleton,
                space=space,
                slots=slots,
                minutes=minutes,
                label=label,
                short_days=pair_short_days,
            )
        )
        if best.better_than(slots, minutes, sector_penalty):
            best.assignments = result.assignments
            best.under_covered_slots = slots
            best.deficit_minutes = minutes
            best.report = report
            best.adapted_short_slots = result.under_covered_slots
            best.adapted_deficit_minutes = result.deficit_minutes
            # Le placement a-t-il PROUVÉ qu'aucun horaire ne fait mieux POUR CES
            # DURÉES-LÀ ? La réponse dit où vit le déficit restant : prouvé, il
            # ne reste plus rien à gagner côté horaires et tout ce qui manque
            # tient au choix des durées, donc à l'allocation. Non prouvé, le
            # budget est la limite. Sans ce booléen les deux se ressemblent.
            best.placement_proven = result.proven
            best.placement_gap = result.gap
            best.placement_nodes = result.nodes
            best.from_fallback = result.fell_back
            best.allocation = allocation
            best.found_at = elapsed()
            best.origin = label
            best.short_days = pair_short_days
            best.sector_preference_penalty = sector_penalty
            counters.improvements.append(
                f"{elapsed():.2f}s → {slots} créneaux / {minutes} min [{label}]"
            )
            if label not in counters.families_seen:
                counters.families_seen.append(label)

        # Mono-sector keeps its historical immediate 0/0 stop. In a group,
        # zero rank-penalty is also unbeatable; otherwise inspect at most six
        # more legal placements, a bounded tie-break rather than a longer search.
        if slots == 0 and minutes == 0:
            if not problem.get("sectors") or sector_penalty == 0:
                return True
        if already_had_zero and zero_coverage_tie_placements >= 6:
            return True

        # ── S'arrêter quand la recherche n'avance plus ───────────────────────
        #
        # Mesuré sur une semaine réelle : le meilleur planning apparaît à 6,6 s
        # et les cinquante-deux secondes suivantes produisent dix-huit
        # placements, dix-huit échanges et aucune amélioration. Rendre la
        # réponse une minute après l'avoir trouvée n'aide personne.
        #
        # Le seuil est une FRACTION du budget, pas un nombre d'essais : une
        # semaine dense place moins souvent qu'une petite, et compter les essais
        # arrêterait la première trop tôt et la seconde trop tard.
        #
        # Multi-secteur seulement. Le mono garde sa recherche exhaustive, dont
        # les fixtures de référence mesurent la production.
        if multi_sector and best.found_at is not None:
            stall = elapsed() - best.found_at
            if stall > max(8.0, time_limit_seconds * 0.30):
                counters.notes.append(
                    f"arrêt à {elapsed():.1f}s : aucune amélioration depuis {stall:.1f}s"
                )
                return True
        return False

    placed: list[_Pair] = []
    stop = False

    # ── 2a. The one impossibility this engine may prove ─────────────────────
    #
    # Before any skeleton, ask the unconditioned allocation MILP whether ANY
    # matrix satisfies the exact contracts, availability and hard daily bounds.
    # and a refusal is a proof about the week rather than about a search: the
    # feasible set here contains every allocation any skeleton could ever use,
    # so if it is empty no arrangement of roles or hours can be legal.
    #
    # Restored to the front on purpose. When the skeleton-first loop took over,
    # this check moved into the complement path and stopped running first, and a
    # perturbation campaign showed the cost immediately: thirteen weeks that were
    # arithmetically impossible — a contract exceeding what the remaining days
    # can hold, a budget below what the available people must work — each spent
    # the full sixty-second budget to report
    # `no-legal-schedule-in-the-explored-neighbourhood`. Never a false claim, and
    # never a useful one either. A manager deserves "Luca's contract does not fit
    # his remaining days", not "the engine gave up".
    #
    # The demand model above already ruled on the hard floors, which is the
    # OTHER thing that may be proven impossible. Everything past this point is
    # heuristic and may only ever report what it failed to find.
    probe_result = solve_allocation(
        problem, model, time_limit=min(5.0, max(1.0, remaining())), origin="faisabilité"
    )
    counters.roots_built += 1
    probe_allocation = probe_result.allocation
    if probe_allocation is None:
        if not probe_result.proven_infeasible:
            return {
                "engine": ENGINE,
                "status": "timeout-without-solution",
                "problemFingerprint": fingerprint,
                "solution": None,
                "diagnostics": {
                    "reason": "allocation-feasibility-probe-ended-without-proof",
                    "solverStatus": probe_result.solver_status,
                    "totalSeconds": elapsed(),
                    "proof": "none",
                },
            }
        return {
            "engine": ENGINE,
            "status": "infeasible-proven",
            "problemFingerprint": fingerprint,
            "solution": None,
            "diagnostics": {
                "reason": "no-minute-allocation-satisfies-contracts-and-budgets",
                "totalSeconds": elapsed(),
                "proof": "solver",
                **allocation_infeasibility_details(problem, model),
            },
        }

    # ── 2. Skeletons FIRST, then one allocation MILP for each ───────────────
    #
    # The order the documented spike used, and it is not a preference. A
    # duration on its own says nothing about coverage; a duration held by a
    # designated opener says exactly where that person stands all morning. So
    # the roles are settled first and every allocation below is answering a
    # narrower, better-posed question than a generic one ever could.
    skeletons = generate_skeletons_from_capacity(
        problem,
        model,
        demand,
        # Each family walks up to `per_family` assignments and the four families
        # overlap heavily, so asking each for exactly the final count returns far
        # fewer than that after deduplication. Asking for more is what makes the
        # kept set genuinely diverse rather than four views of one walk.
        per_family=max(6, skeletons_per_allocation),
        keep=skeletons_per_allocation,
        deadline=deadline,
    )
    counters.skeletons_generated = len(skeletons)

    # Preserve a meaningful share of the same wall-clock budget for local
    # repair.  Previously the skeleton loop could consume virtually all sixty
    # seconds, leaving the declared 2×2 phase with no opportunity to run.
    skeleton_phase_deadline = started + max(5.0, time_limit_seconds * 0.65)

    for rank, skeleton in enumerate(skeletons):
        if remaining() <= 2.0:
            break
        if rank >= 6 and placed and time.perf_counter() >= skeleton_phase_deadline:
            counters.notes.append(
                f"phase squelettes arrêtée à {elapsed():.1f}s pour réserver le budget de réparation"
            )
            break
        try:
            space = build_duration_space(
                problem,
                model,
                demand,
                skeleton,
                cache=duration_cache,
                deadline=deadline,
            )
        except TimeoutError:
            counters.notes.append("budget épuisé pendant la construction des domaines de durées")
            break
        if space.dead_cells:
            counters.skeletons_without_durations += 1
            counters.notes.append(
                f"sk#{rank}({skeleton.family}): {len(space.dead_cells)} cellule(s) sans durée travaillable"
            )
            continue
        # ── Réfuter, couper, recommencer ────────────────────────────────────
        #
        # Le placement ne se contente pas d'échouer : quand il PROUVE qu'aucun
        # horaire ne réalise ces durées, il apprend quelque chose de définitif
        # sur ce domaine. Sans coupe, la boucle repropose des vecteurs voisins
        # jusqu'à épuiser le budget — mesuré sur une semaine réelle :
        # cinquante-deux allocations, cinquante-deux réfutations, aucune retenue.
        #
        # La coupe porte sur la SEULE JOURNÉE fautive, pas sur la semaine : c'est
        # elle que le placement a réfutée, et interdire tout le vecteur laisserait
        # revenir la même journée sous un habillage différent.
        # Pas de compteur de tours : avec un seul squelette, cette boucle EST
        # la recherche. Elle s'arrête quand le budget est épuisé, quand plus
        # aucune allocation ne survit aux coupes, ou quand le placement cesse
        # de réfuter — jamais sur un nombre arbitraire d'essais.
        #
        # MULTI-SECTEUR SEULEMENT. En mono, vingt-quatre squelettes se partagent
        # le budget et rejouer le même en boucle le vole aux autres : mesuré,
        # une fixture y perdait un créneau. Là-bas, un squelette a droit à une
        # allocation, et le suivant prend la main.
        while True:
            if remaining() <= 3.0:
                break
            allocation = solve_for_skeleton(
                problem,
                model,
                space,
                time_limit=min(8.0, max(1.0, remaining())),
                origin=f"sk#{rank}({skeleton.family})",
                forbidden=tuple(refuted),
            )
            counters.skeleton_allocations_solved += 1
            if allocation is None:
                counters.skeleton_allocations_infeasible += 1
                counters.notes.append(
                    f"sk#{rank}({skeleton.family}): aucune allocation ne satisfait "
                    "contrats et budgets dans ce domaine de durées"
                )
                break
            counters.unique_allocations += 1
            before_infeasible = counters.placements_infeasible
            if attempt(
                allocation,
                skeleton,
                label=allocation.origin,
                space=space,
                placement_cap_seconds=8.0,
            ):
                stop = True
                break
            if counters.placements_infeasible == before_infeasible:
                # ── Le placement a répondu. Et alors ? ──────────────────────
                #
                # En mono, le squelette suivant prend la main : il y en a
                # vingt-quatre, et c'est de là que vient la diversité.
                #
                # UNE ZONE MARCHÉ N'A QU'UN SEUL SQUELETTE — les rôles
                # appartiennent aux comptoirs. Sortir ici lui laissait donc
                # exactement une allocation pour toute la semaine, et la mesure
                # a montré ce que cela coûte : le placement PROUVE l'optimalité
                # de son horaire, donc tout ce qui manque encore tient au choix
                # des durées, et ce choix n'était jamais rejoué. Une coupe sur
                # le vecteur entier force la répartition suivante par ordre de
                # score, et c'est la seule source de diversité qui reste.
                #
                # Bornée par la fenêtre réservée aux squelettes : la réparation
                # 2×2 doit garder sa part du budget.
                if not multi_sector or time.perf_counter() >= skeleton_phase_deadline:
                    break
                refuted.append(
                    tuple(
                        (employee_index, day_index, minutes)
                        for employee_index, row in enumerate(allocation.minutes)
                        for day_index, minutes in enumerate(row)
                        if minutes > 0
                    )
                )
                counters.allocation_cuts += 1
                continue
            if not multi_sector:
                break
            cuts = _refuted_days(problem, model, allocation, last_space)
            if not cuts:
                break
            refuted.extend(cuts)
            counters.allocation_cuts += len(cuts)
        if stop:
            break

    before_repair = (best.under_covered_slots, best.deficit_minutes)

    # ── 7. Repair: 2×2 exchanges under the SAME skeleton, then re-place ─────
    #
    # Deltas of ±15, ±30, ±45 and ±60 minutes only. The spike's measured
    # progression was one short slot away from zero after allocation and
    # placement, and closing it by a local exchange — not by another week. Larger
    # moves belong to the previous order, where the allocation had been chosen
    # blind and had to be reshaped wholesale.
    #
    # Every day pair is walked, not only the short ones. A swap that fills a hole
    # takes its minutes from somewhere, and the day that can spare them is by
    # definition not deficient: restricting the search to visible deficits hides
    # exactly the compensation days that make the move possible.
    swap_deltas = tuple(model.step * multiple for multiple in (1, 2, 3, 4))
    seen: set[str] = {pair.allocation.signature() for pair in placed}

    for pair in sorted(placed, key=lambda item: (item.slots, item.minutes, item.label))[
        :repair_pairs
    ]:
        if stop or remaining() <= 3.0:
            break
        counters.generations += 1
        for neighbour in swap_neighbours(
            pair.allocation,
            model,
            limit=swap_limit,
            deltas=swap_deltas,
            priority_days=pair.short_days or best.short_days,
        ):
            if remaining() <= 2.0:
                break
            counters.swaps_tested += 1
            # A swap may only land on durations the roles can still work.
            # Otherwise the placement fails and the search reads the failure as
            # a fact about coverage, when it is a fact about the move.
            if pair.space is not None and not respects(neighbour, pair.space):
                counters.swaps_rejected_by_domain += 1
                continue
            signature = neighbour.signature()
            if signature in seen:
                continue
            seen.add(signature)
            counters.unique_allocations += 1
            if attempt(
                neighbour,
                pair.skeleton,
                label=f"{pair.label}+swap",
                space=pair.space,
                placement_cap_seconds=2.0,
            ):
                stop = True
                break

    after_repair = (best.under_covered_slots, best.deficit_minutes)

    # ── 8. Complement: the previous order, when this one runs out of room ───
    #
    # NOT a safety net for a broken loop — a different question, asked when the
    # first one has been answered as far as it goes and the week is still short.
    #
    # The two orders draw their diversity from opposite places. Skeleton-first
    # gets it from the ROLE assignments: many legal skeletons, one conditioned
    # allocation each. Where the roster is tight — the absence scenario admits
    # exactly one legal skeleton — that well is dry, one MILP is solved, the 2×2
    # neighbourhood over a sparse availability matrix is nearly empty, and the
    # search stops with fifty seconds unspent. Allocation-first draws its
    # diversity from the MINUTES instead, which is still plentiful there.
    #
    # So the trigger is an exhausted search with budget left and a deficit
    # standing, not an empty result. Reaching zero closes it, as does spending
    # the budget: on Drive the repair uses the whole window and this never runs.
    incomplete = (
        best.assignments is None
        or best.under_covered_slots > 0
        or best.deficit_minutes > 0
    )
    if not stop and incomplete and remaining() > 5.0:
        counters.used_fallback = True
        counters.notes.append(
            f"recherche squelette-d'abord épuisée à {elapsed():.1f}s avec "
            f"{best.under_covered_slots}/{best.deficit_minutes} restant : "
            "complément par l'ordre allocation → squelette"
        )

        def consider_legacy(allocation: Allocation, budget: int) -> bool:
            signature = allocation.signature()
            if signature in seen:
                return False
            seen.add(signature)
            counters.unique_allocations += 1
            counters.allocations_tested += 1
            legacy = generate_skeletons(
                problem,
                model,
                allocation,
                demand,
                keep=budget,
                deadline=deadline,
            )
            counters.skeletons_generated += len(legacy)
            for rank, candidate in enumerate(legacy):
                if remaining() <= 1.0:
                    return True
                if attempt(
                    allocation,
                    candidate,
                    label=f"{allocation.origin}/sk#{rank}({candidate.family})",
                    placement_cap_seconds=4.0,
                ):
                    return True
            return False

        for candidate in build_roots(frozenset()):
            if remaining() <= 2.0:
                break
            if consider_legacy(candidate, neighbour_skeletons):
                stop = True
                break

        # The generation loop as it stood: large neighbourhood first, then 2×2,
        # widening the block when a generation stalls.
        generation = 0
        block_size = 3
        while not stop and remaining() > 3.0 and generation < max_generations:
            generation += 1
            counters.generations += 1
            anchor = best.allocation
            if anchor is None:
                break
            before = (best.under_covered_slots, best.deficit_minutes)

            worst = _worst_days(problem, demand, best.assignments, limit=block_size)
            if worst and remaining() > 5.0:
                if len(worst) < block_size:
                    worst = worst + [
                        index for index in range(len(model.dates)) if index not in worst
                    ][: block_size - len(worst)]
                counters.large_neighbourhoods += 1
                for candidate in repair_large_neighbourhood(
                    problem,
                    model,
                    anchor,
                    worst,
                    time_limit=min(6.0, max(1.0, remaining())),
                    deadline=deadline,
                ):
                    if remaining() <= 2.0:
                        break
                    if consider_legacy(candidate, neighbour_skeletons):
                        stop = True
                        break
            if stop:
                break

            for neighbour in swap_neighbours(
                anchor, model, limit=swap_limit, priority_days=best.short_days
            ):
                if remaining() <= 2.0:
                    break
                if consider_legacy(neighbour, neighbour_skeletons):
                    stop = True
                    break

            if (best.under_covered_slots, best.deficit_minutes) == before:
                if block_size >= len(model.dates):
                    break
                block_size += 1
                continue

            if not stop and remaining() > 5.0:
                for candidate in build_roots(best.short_days):
                    if remaining() <= 2.0:
                        break
                    if consider_legacy(candidate, neighbour_skeletons):
                        stop = True
                        break

    total = elapsed()
    if best.assignments is None:
        # NEVER `infeasible-proven` here.
        #
        # Only two things in this engine may say a problem has no answer: the
        # demand model, which compares hard floors against real capacity, and
        # the allocation MILP, which either finds a matrix satisfying the exact
        # sums or proves none exists. Both ran above and both said the problem
        # is fine.
        #
        # What ran here is a HEURISTIC neighbourhood — a few allocations, a few
        # ranked skeletons. Exhausting it proves nothing about the week, and
        # saying otherwise would tell a manager their shop cannot open when the
        # oracle can staff it.
        # Quel JOUR a fait tomber le placement. Un compte de refus n'est pas un
        # diagnostic : il faut nommer la journée, sinon le lecteur relance en
        # espérant, ce qui est exactement ce que ce moteur doit lui épargner.
        culprit_days: list[str] = []
        if multi_sector and counters.placements_infeasible > 0 and last_space is not None:
            try:
                culprit_days = days_without_placement(
                    problem, model, last_space,
                    skeleton=last_skeleton, durations=last_durations, demand=demand,
                )
            except Exception:  # noqa: BLE001 — un diagnostic ne fait jamais échouer un solve
                culprit_days = []

        return {
            "engine": ENGINE,
            "status": "timeout-without-solution",
            "problemFingerprint": fingerprint,
            "solution": None,
            "diagnostics": {
                "reason": "no-legal-schedule-in-the-explored-neighbourhood",
                **({"daysWithoutPlacement": culprit_days} if culprit_days else {}),
                "note": (
                    "L'espace exploré est un sous-ensemble heuristique. "
                    "Aucune conclusion sur la faisabilité du problème."
                ),
                "allocationsTested": counters.allocations_tested,
                "skeletonsGenerated": counters.skeletons_generated,
                "skeletonsPlaced": counters.skeletons_placed,
                "placementsInfeasible": counters.placements_infeasible,
                "allocationCuts": counters.allocation_cuts,
                "notes": counters.notes[:20],
                "totalSeconds": total,
                "proof": "none",
            },
        }

    solution = {
        "version": "v3.0.0",
        "problemFingerprint": fingerprint,
        "assignments": list(best.assignments),
        "declaredMetrics": {"totalDeficitMinutes": best.deficit_minutes},
    }

    perfect = best.under_covered_slots == 0 and best.deficit_minutes == 0
    return {
        "engine": ENGINE,
        # `feasible-zero-deficit` is a statement about the SCHEDULE, not about
        # the problem: nothing is missing. It is deliberately not called
        # `optimal` — the allocation and skeleton were heuristic.
        "status": "feasible-zero-deficit" if perfect else "feasible-best-effort",
        "problemFingerprint": fingerprint,
        "solutionFingerprint": fingerprint_solution(solution),
        "solution": solution,
        "evaluation": best.report,
        "diagnostics": {
            "firstLegalSeconds": best.first_legal_at,
            "bestFoundSeconds": best.found_at,
            "totalSeconds": total,
            # Both targets, side by side. The oracle reports both; reporting one
            # of them alone is how the two engines look further apart than they
            # are.
            #
            # DANS UNE ZONE MARCHÉ LES DEUX COÏNCIDENT, et c'est voulu : le
            # placement y mesure son déficit contre la demande de référence,
            # comme l'évaluateur. Deux chiffres égaux ne sont pas une redite,
            # c'est la preuve que le modèle et son juge comptent la même chose.
            "adaptedTargetShortSlots": best.adapted_short_slots,
            "adaptedTargetDeficitMinutes": best.adapted_deficit_minutes,
            #: Optimal POUR CES DURÉES, jamais pour la semaine — les durées et
            #: les rôles ont été choisis heuristiquement en amont.
            "placementProven": best.placement_proven,
            #: Non prouvé, DE COMBIEN ? Un horaire à 2 % de la borne est bon et
            #: le dire évite de dépenser du budget à le prouver ; un à 300 % dit
            #: que la recherche patauge, et c'est un diagnostic, pas un détail.
            "placementGap": best.placement_gap,
            "placementNodes": best.placement_nodes,
            "referenceShortSlots": best.under_covered_slots,
            "referenceDeficitMinutes": best.deficit_minutes,
            "uniqueAllocations": counters.unique_allocations,
            "allocationRootsBuilt": counters.roots_built,
            "generations": counters.generations,
            "largeNeighbourhoods": counters.large_neighbourhoods,
            # The new order, measured. `skeletonAllocationsSolved` is one MILP
            # per skeleton that had a workable duration domain.
            "skeletonAllocationsSolved": counters.skeleton_allocations_solved,
            "skeletonAllocationsInfeasible": counters.skeleton_allocations_infeasible,
            "skeletonsWithoutDurations": counters.skeletons_without_durations,
            "swapsTested": counters.swaps_tested,
            "swapsRejectedByDomain": counters.swaps_rejected_by_domain,
            "allocationCuts": counters.allocation_cuts,
            # Must be zero. Anything else is the duration probe and the shift
            # generator reading the same rules differently.
            "probeDisagreements": counters.probe_disagreements,
            "usedAllocationFirstFallback": counters.used_fallback,
            "beforeRepair": {
                "shortSlots": None if before_repair[0] >= 10**9 else before_repair[0],
                "deficitMinutes": None if before_repair[1] >= 10**9 else before_repair[1],
            },
            "afterRepair": {
                "shortSlots": None if after_repair[0] >= 10**9 else after_repair[0],
                "deficitMinutes": None if after_repair[1] >= 10**9 else after_repair[1],
            },
            "placedCouples": [
                {
                    "label": pair.label,
                    "shortSlots": pair.slots,
                    "deficitMinutes": pair.minutes,
                    # Distinguishes a measured result from a skeleton's
                    # predicted floor, which is what an unplaced couple carries.
                    "placementFailed": pair.placement_failed,
                    "allocation": {
                        model.employees[index]: list(row)
                        for index, row in enumerate(pair.allocation.minutes)
                    },
                }
                for pair in sorted(
                    placed, key=lambda item: (item.slots, item.minutes, item.label)
                )[:8]
            ],
            "familiesThatImproved": counters.families_seen,
            "improvements": counters.improvements,
            "finalAllocation": (
                {
                    model.employees[index]: list(row)
                    for index, row in enumerate(best.allocation.minutes)
                }
                if best.allocation is not None
                else None
            ),
            "finalAllocationOrigin": best.allocation.origin if best.allocation else None,
            "allocationsTested": counters.allocations_tested,
            "skeletonsGenerated": counters.skeletons_generated,
            "skeletonsPlaced": counters.skeletons_placed,
            "placementsRun": counters.placements_run,
            "placementsInfeasible": counters.placements_infeasible,
            "shiftsGenerated": counters.shifts_generated,
            "bestOrigin": best.origin,
            "adaptedTargetByDate": {
                date: day.total_adapted_minutes for date, day in sorted(demand.days.items())
            },
            "surplusByDate": {
                date: day.surplus_minutes for date, day in sorted(demand.days.items())
            },
            "notes": counters.notes[:20],
            # Never `optimal`, at any budget. Two heuristic choices sit upstream
            # of the only exact step.
            "proof": "none",
        },
    }
