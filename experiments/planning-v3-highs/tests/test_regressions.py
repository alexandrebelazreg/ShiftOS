"""Regressions for the two bugs that stood between the fast engine and zero.

Both were silent. Neither raised, neither produced an illegal schedule, neither
showed up in any counter — the engine simply returned a slightly worse answer
every time and said nothing. That is exactly the class of defect a test has to
pin, because nothing else will notice it.

1. **A non-role holder was counted present on the boundary cells.** The shift
   generator forbids anyone but a designated opener from starting at opening,
   and anyone but a designated closer from ending at closing. The skeleton's
   presence bound ignored that and let everyone else count everywhere inside
   their window, so a Saturday needing four openers scored identically with
   three — and the engine then lost that slot in every schedule it built.

2. **A couple whose first allocation had no placement was discarded.** Per-cell
   feasibility is not joint feasibility: every duration in the domain has a
   legal shift on its own, and a set of them can still admit no simultaneous
   arrangement. Dropping the couple threw away the SKELETON, including the only
   one that gave Saturday its four openers — while a single 15-minute 2×2 swap
   on that same allocation places at zero.
"""

from __future__ import annotations

import json
import unittest
from pathlib import Path

from shiftos_highs.demand import build_demand_model
from shiftos_highs.evaluate import evaluate
from shiftos_highs_fast.allocation import build_allocation_model, swap_neighbours
from shiftos_highs_fast.placement import place
from shiftos_highs_fast.shifts import generate_shifts
from shiftos_highs_fast.skeleton import (
    DayRoles,
    Skeleton,
    _probe,
    analyse_week,
    generate_skeletons_from_capacity,
    max_presence_profile,
    score_skeleton,
)
from shiftos_highs_fast.skeleton_allocation import (
    build_duration_space,
    respects,
    solve_for_skeleton,
)

ROOT = Path(__file__).resolve().parents[1]


def _drive() -> dict:
    return json.loads(
        (ROOT / "fixtures/drive-canonical-problem.json").read_text(encoding="utf-8")
    )


class PresenceBoundTests(unittest.TestCase):
    """The bound must exclude what is impossible, not merely over-estimate."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.problem = _drive()
        cls.demand = build_demand_model(cls.problem)
        cls.model = build_allocation_model(cls.problem)
        cls.week = analyse_week(
            cls.problem, cls.model, _probe(cls.model, lambda cell: cell.minimum), cls.demand
        )
        # The longest durations, so every role covers the widest stretch it could
        # and the profile stays an UPPER bound on presence.
        cls.presence = _probe(cls.model, lambda cell: cell.maximum)

    def _profile(self, day_index: int, openers: tuple[int, ...], closers: tuple[int, ...]):
        day = self.week.by_index(day_index)
        assert day is not None
        return max_presence_profile(
            self.problem,
            self.model,
            self.presence,
            self.demand,
            DayRoles(day_index, openers, closers),
            day,
        )

    def test_opening_cell_counts_exactly_the_designated_openers(self) -> None:
        """Nobody joins the openers at the opening instant. Ever."""
        for day_index in range(len(self.model.dates)):
            day = self.week.by_index(day_index)
            assert day is not None
            pool = day.opener_pool
            closers = tuple(index for index in day.closer_pool if index not in pool[:2])[:1]
            for size in range(1, len(pool) + 1):
                openers = pool[:size]
                if set(openers) & set(closers):
                    continue
                profile = self._profile(day_index, openers, closers)
                self.assertEqual(
                    profile[0],
                    len(openers),
                    f"jour {day_index}, {size} ouvreur(s) désigné(s) : la cellule "
                    f"d'ouverture en compte {profile[0]}",
                )

    def test_closing_cell_counts_exactly_the_designated_closers(self) -> None:
        """Symmetrically at the other boundary."""
        for day_index in range(len(self.model.dates)):
            day = self.week.by_index(day_index)
            assert day is not None
            cell = (day.closes_at - self.model.step - day.opens_at) // self.model.step
            openers = day.opener_pool[:1]
            for index in day.closer_pool:
                if index in openers:
                    continue
                profile = self._profile(day_index, openers, (index,))
                self.assertEqual(
                    profile[cell],
                    1,
                    f"jour {day_index}, fermeur {index} : la cellule de fermeture "
                    f"en compte {profile[cell]}",
                )

    def test_a_skeleton_short_at_a_boundary_scores_worse(self) -> None:
        """The score must SEE a doomed boundary, not average it away.

        Saturday's demand wants four openers and exactly four employees can hold
        one — the fifth cannot start before 08:00. So three openers condemn the
        opening slot with certainty, and the ranking has to say so before any
        placement is attempted.
        """
        saturday = len(self.model.dates) - 1
        day = self.week.by_index(saturday)
        assert day is not None
        self.assertGreaterEqual(
            day.opening_demand,
            4,
            "la fixture ne pose plus le cas testé ici",
        )
        full = tuple(day.opener_pool[: day.opening_demand])
        short = full[:-1]
        closers = tuple(index for index in day.closer_pool if index not in full)[:1]
        self.assertTrue(closers, "aucun fermeur disponible hors du vivier d'ouvreurs")

        def score(openers: tuple[int, ...]) -> tuple[int, ...]:
            roles = tuple(
                DayRoles(
                    index,
                    openers if index == saturday else self.week.days[index].opener_pool[:1],
                    closers if index == saturday else (),
                )
                for index in range(len(self.model.dates))
            )
            return score_skeleton(
                self.problem, self.model, self.presence, self.demand, self.week, roles
            )

        complete, incomplete = score(full), score(short)
        # The other days are built identically in both, so whatever they condemn
        # is a constant and the DIFFERENCE is Saturday's alone. Comparing the
        # difference rather than an absolute keeps the test about the boundary
        # and not about how well the rest of the week happens to be staffed.
        #
        # Indexes 1 and 2 of the lexicographic tuple: slots and minutes the
        # skeleton has already made unavoidable.
        self.assertEqual(incomplete[1] - complete[1], 1)
        self.assertEqual(incomplete[2] - complete[2], self.model.step)
        self.assertLess(complete, incomplete)

    def test_the_full_opener_skeleton_is_ranked_first(self) -> None:
        """Not merely scored better — actually reachable in the kept set."""
        skeletons = generate_skeletons_from_capacity(
            self.problem, self.model, self.demand, per_family=24, keep=24
        )
        saturday = len(self.model.dates) - 1
        best = skeletons[0]
        roles = next(entry for entry in best.roles if entry.day_index == saturday)
        self.assertEqual(len(roles.openers), 4)


class UnplacedAnchorTests(unittest.TestCase):
    """A failed placement condemns the allocation, never the skeleton."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.problem = _drive()
        cls.demand = build_demand_model(cls.problem)
        cls.model = build_allocation_model(cls.problem)
        cls.skeleton = generate_skeletons_from_capacity(
            cls.problem, cls.model, cls.demand, per_family=24, keep=24
        )[0]
        cls.space = build_duration_space(cls.problem, cls.model, cls.demand, cls.skeleton)
        cls.allocation = solve_for_skeleton(
            cls.problem, cls.model, cls.space, time_limit=10.0, origin="sk#0"
        )

    def test_the_best_skeleton_now_places_straight_away(self) -> None:
        """What the role-derived bridge bound changed, asserted as such.

        This test used to assert the OPPOSITE: that the best skeleton's first
        allocation had no placement at all. That was true, and it was the defect
        — the allocation was free to hand every opener a short day and the closer
        a short evening, leaving a stretch of the day with nobody in it. Legal on
        contracts, legal on budgets, impossible to place.

        Constraining the reach inside the allocation MILP removed the failure at
        its source, so the couple that used to need rescuing now places directly.
        The rescue path still exists and is still exercised below, because
        per-cell feasibility is not joint feasibility in general — but Drive no
        longer demonstrates it, and pretending otherwise would leave a test whose
        premise is quietly false.
        """
        self.assertIsNotNone(self.allocation)
        space = generate_shifts(
            self.problem, self.model, self.allocation, self.skeleton, self.demand
        )
        self.assertEqual(space.impossible, ())
        result = place(
            self.problem, self.model, self.allocation, space, self.demand, time_limit=30.0
        )
        self.assertIsNotNone(result.assignments)
        report = evaluate(self.problem, list(result.assignments))
        self.assertTrue(report["validHardConstraints"], report["violations"])
        self.assertEqual(report["underCoveredSlots"], 0)

    def test_no_day_leaves_a_stretch_with_nobody(self) -> None:
        """The bound itself: openers and the closer must meet in the middle.

        Checked on the allocation rather than on the schedule, because that is
        where the decision is taken. On every day whose whole team holds a role,
        the longest opener's reach plus the closer's must span the amplitude —
        anything less is an evening no placement can staff.
        """
        days = sorted(
            [d for d in self.problem["days"] if not d["closed"]], key=lambda d: d["date"]
        )
        for reach in self.space.reaches:
            day = days[reach.day_index]
            longest_opener = max(
                self.allocation.minutes[index][reach.day_index]
                for index in reach.opener_indexes
            )
            closers = sum(
                self.allocation.minutes[index][reach.day_index]
                for index in reach.closer_indexes
            )
            self.assertGreaterEqual(
                longest_opener + closers + reach.free_reach,
                reach.amplitude,
                f"{day['date']} : l'ouverture et la fermeture ne se rejoignent pas",
            )

    def test_a_two_by_two_swap_rescues_that_same_skeleton(self) -> None:
        """One rectangle, fifteen minutes, and the week places at zero."""
        rescued = None
        for neighbour in swap_neighbours(
            self.allocation, self.model, limit=250, deltas=(15, 30, 45, 60)
        ):
            if not respects(neighbour, self.space):
                continue
            space = generate_shifts(
                self.problem, self.model, neighbour, self.skeleton, self.demand
            )
            if space.impossible:
                continue
            result = place(
                self.problem, self.model, neighbour, space, self.demand, time_limit=10.0
            )
            if result.assignments is None:
                continue
            report = evaluate(self.problem, list(result.assignments))
            if report["validHardConstraints"] and report["underCoveredSlots"] == 0:
                rescued = (neighbour, report)
                break

        self.assertIsNotNone(
            rescued, "aucun voisin 2×2 ne sauve l'ancre : la régression est de retour"
        )
        neighbour, report = rescued
        self.assertEqual(report["totalDeficitMinutes"], 0)
        # Contracts and budgets are preserved by the 2×2 move itself, so the
        # rescue never buys coverage with a broken sum.
        for index, employee in enumerate(
            sorted(self.problem["employees"], key=lambda item: str(item["id"]))
        ):
            self.assertEqual(sum(neighbour.minutes[index]), employee["contractMinutes"])

    def test_the_pipeline_reports_every_couple_it_placed(self) -> None:
        """End to end, and the anchor bookkeeping still has to be honest.

        A couple whose placement fails must still be recorded — that is the
        mechanism, and it is what let Drive reach zero before the bridge bound
        existed. What changed is that Drive no longer produces such a couple, so
        this asserts the bookkeeping is present and correct rather than that a
        failure occurred.
        """
        from shiftos_highs_fast import solve_fast

        result = solve_fast(_drive(), time_limit_seconds=60.0)
        couples = result["diagnostics"]["placedCouples"]
        self.assertTrue(couples)
        for entry in couples:
            self.assertIn("placementFailed", entry)

        self.assertEqual(result["status"], "feasible-zero-deficit")
        self.assertEqual(result["diagnostics"]["referenceShortSlots"], 0)
        self.assertEqual(result["diagnostics"]["referenceDeficitMinutes"], 0)

    def test_the_bridge_bound_makes_drive_fast(self) -> None:
        """Zero reached without needing the repair at all.

        Drive used to need twelve seconds and a rescuing 2×2 swap. Pruning the
        allocations that cannot be placed removes both: the first couple already
        covers the week. The threshold is deliberately loose — this guards
        against losing the pruning entirely, not against a machine being slow.
        """
        from shiftos_highs_fast import solve_fast

        result = solve_fast(_drive(), time_limit_seconds=60.0)
        self.assertEqual(result["diagnostics"]["referenceShortSlots"], 0)
        self.assertLess(result["diagnostics"]["totalSeconds"], 10.0)


if __name__ == "__main__":
    unittest.main()
