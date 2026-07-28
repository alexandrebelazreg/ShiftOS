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
6. **swap 2×2 and re-place** — the neighbourhood that preserves both the
   contracts and the daily budgets by construction.

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
from typing import Any

from shiftos_highs.demand import build_demand_model
from shiftos_highs.evaluate import evaluate
from shiftos_highs.fingerprint import fingerprint_problem, fingerprint_solution

from .allocation import (
    Allocation,
    build_allocation_model,
    build_families,
    repair_large_neighbourhood,
    score_allocation,
    solve_allocation,
    solve_polarised,
    swap_neighbours,
)
from .placement import place
from .shifts import generate_shifts
from .skeleton import Skeleton, generate_skeletons, generate_skeletons_from_capacity
from .skeleton_allocation import (
    DurationSpace,
    build_duration_space,
    respects,
    solve_for_skeleton,
)

ENGINE = "v3-highs-fast"


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

    def better_than(self, slots: int, minutes: int) -> bool:
        return (slots, minutes) < (self.under_covered_slots, self.deficit_minutes)


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

    def elapsed() -> float:
        return time.perf_counter() - started

    def remaining() -> float:
        return time_limit_seconds - elapsed()

    fingerprint = fingerprint_problem(problem)
    counters = _Counters()
    best = _Best()

    # ── 1. Demand rescaling and hard floors ─────────────────────────────────
    demand = build_demand_model(problem)
    if demand.infeasible_days:
        return {
            "engine": ENGINE,
            "status": "infeasible-proven",
            "problemFingerprint": fingerprint,
            "solution": None,
            "diagnostics": {
                "reason": "day-cannot-be-staffed",
                "infeasibleDays": [
                    {"date": date, "reason": demand.days[date].infeasible_reason}
                    for date in demand.infeasible_days
                ],
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
            candidate = solve_allocation(
                problem,
                model,
                time_limit=min(8.0, max(1.0, remaining())),
                weights=weights,
                even_weight=even,
                origin=name,
            )
            counters.roots_built += 1
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
    ) -> bool:
        """Place ONE (allocation, skeleton) couple. True to stop the search.

        Both halves arrive already decided, which is the point of the order: the
        skeleton fixed the roles, the allocation chose durations those roles can
        actually work, and the placement is left with the single question it is
        good at — where inside the window each shift starts.
        """
        counters.allocations_tested += 1

        shifts = generate_shifts(problem, model, allocation, skeleton, demand)
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

        counters.skeletons_placed += 1
        counters.placements_run += 1
        result = place(
            problem,
            model,
            allocation,
            shifts,
            demand,
            time_limit=min(20.0, max(1.0, remaining())),
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
        placed.append(
            _Pair(
                allocation=allocation,
                skeleton=skeleton,
                space=space,
                slots=slots,
                minutes=minutes,
                label=label,
            )
        )
        if best.better_than(slots, minutes):
            best.assignments = result.assignments
            best.under_covered_slots = slots
            best.deficit_minutes = minutes
            best.report = report
            best.adapted_short_slots = result.under_covered_slots
            best.adapted_deficit_minutes = result.deficit_minutes
            best.allocation = allocation
            best.found_at = elapsed()
            best.origin = label
            best.short_days = _short_days(problem, demand, result.assignments)
            counters.improvements.append(
                f"{elapsed():.2f}s → {slots} créneaux / {minutes} min [{label}]"
            )
            if label not in counters.families_seen:
                counters.families_seen.append(label)

        # Nothing beats a legal week with nothing missing.
        return slots == 0 and minutes == 0

    placed: list[_Pair] = []
    stop = False

    # ── 2a. The one impossibility this engine may prove ─────────────────────
    #
    # Before any skeleton, ask the unconditioned allocation MILP whether ANY
    # matrix satisfies the exact contracts and budgets. It answers in a second,
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
    probe_allocation = solve_allocation(
        problem, model, time_limit=min(5.0, max(1.0, remaining())), origin="faisabilité"
    )
    counters.roots_built += 1
    if probe_allocation is None:
        return {
            "engine": ENGINE,
            "status": "infeasible-proven",
            "problemFingerprint": fingerprint,
            "solution": None,
            "diagnostics": {
                "reason": "no-minute-allocation-satisfies-contracts-and-budgets",
                "totalSeconds": elapsed(),
                "proof": "solver",
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
    )
    counters.skeletons_generated = len(skeletons)

    for rank, skeleton in enumerate(skeletons):
        if remaining() <= 2.0:
            break
        space = build_duration_space(problem, model, demand, skeleton)
        if space.dead_cells:
            counters.skeletons_without_durations += 1
            counters.notes.append(
                f"sk#{rank}({skeleton.family}): {len(space.dead_cells)} cellule(s) sans durée travaillable"
            )
            continue
        allocation = solve_for_skeleton(
            problem,
            model,
            space,
            time_limit=min(8.0, max(1.0, remaining())),
            origin=f"sk#{rank}({skeleton.family})",
        )
        counters.skeleton_allocations_solved += 1
        if allocation is None:
            counters.skeleton_allocations_infeasible += 1
            counters.notes.append(
                f"sk#{rank}({skeleton.family}): aucune allocation ne satisfait "
                "contrats et budgets dans ce domaine de durées"
            )
            continue
        counters.unique_allocations += 1
        if attempt(allocation, skeleton, label=allocation.origin, space=space):
            stop = True
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
            pair.allocation, model, limit=swap_limit, deltas=swap_deltas
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
            legacy = generate_skeletons(problem, model, allocation, demand, keep=budget)
            counters.skeletons_generated += len(legacy)
            for rank, candidate in enumerate(legacy):
                if remaining() <= 1.0:
                    return True
                if attempt(
                    allocation,
                    candidate,
                    label=f"{allocation.origin}/sk#{rank}({candidate.family})",
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
                    problem, model, anchor, worst, time_limit=min(6.0, max(1.0, remaining()))
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
        return {
            "engine": ENGINE,
            "status": "timeout-without-solution",
            "problemFingerprint": fingerprint,
            "solution": None,
            "diagnostics": {
                "reason": "no-legal-schedule-in-the-explored-neighbourhood",
                "note": (
                    "L'espace exploré est un sous-ensemble heuristique. "
                    "Aucune conclusion sur la faisabilité du problème."
                ),
                "allocationsTested": counters.allocations_tested,
                "skeletonsGenerated": counters.skeletons_generated,
                "skeletonsPlaced": counters.skeletons_placed,
                "placementsInfeasible": counters.placements_infeasible,
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
            "adaptedTargetShortSlots": best.adapted_short_slots,
            "adaptedTargetDeficitMinutes": best.adapted_deficit_minutes,
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
