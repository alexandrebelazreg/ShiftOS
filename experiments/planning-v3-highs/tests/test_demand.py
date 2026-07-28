"""Adaptive demand rescaling — the five required cases.

Every fixture here is built from primitives, never from Drive: the rescaling is
a rule about arithmetic and availability, and a test that needed a real sector
to exercise it would be testing the sector.
"""

from __future__ import annotations

import unittest

from shiftos_highs.demand import build_day_demand, build_demand_model


STEP = 15
DATE = "2026-07-20"


def problem(
    *,
    employees: list[tuple[str, int]],
    unavailable: set[str] | None = None,
    budget: int,
    slots: list[tuple[int, int, int, int | None]],
) -> dict:
    """A one-day problem.

    ``employees`` is ``(id, maximumDailyMinutes)``; ``slots`` is
    ``(start, end, requiredEmployees, hardMinimumEmployees | None)``.
    """
    absent = unavailable or set()
    return {
        "timeStepMinutes": STEP,
        "rules": {"maximumShiftMinutes": 600},
        "employees": [
            {"id": employee_id, "maximumDailyMinutes": maximum}
            for employee_id, maximum in employees
        ],
        "days": [{"date": DATE, "closed": False, "budgetMinutes": budget}],
        "employeeDays": [
            {
                "employeeId": employee_id,
                "date": DATE,
                "available": employee_id not in absent,
                "maximumMinutes": 0 if employee_id in absent else maximum,
            }
            for employee_id, maximum in employees
        ],
        "demandSlots": [
            {
                "id": f"slot_{start}",
                "date": DATE,
                "startMinutes": start,
                "endMinutes": end,
                "requiredEmployees": required,
                **({} if hard is None else {"hardMinimumEmployees": hard}),
            }
            for start, end, required, hard in slots
        ],
    }


class FullTeamTests(unittest.TestCase):
    """Cas 1 — équipe complète : la cible adaptée reproduit le profil normal."""

    def test_adapted_target_reproduces_the_reference_profile(self) -> None:
        # 4 intervalles : besoins 1, 3, 3, 1 — plancher 1 partout.
        # Budget = exactement ce que le profil de référence demande : 8 unités.
        day = build_day_demand(
            problem(
                employees=[("a", 600), ("b", 600), ("c", 600)],
                budget=8 * STEP,
                slots=[
                    (360, 375, 1, 1),
                    (375, 390, 3, 1),
                    (390, 405, 3, 1),
                    (405, 420, 1, 1),
                ],
            ),
            DATE,
        )

        self.assertFalse(day.structurally_infeasible)
        self.assertEqual([i.adapted_target for i in day.intervals], [1, 3, 3, 1])
        self.assertEqual([i.reference_required for i in day.intervals], [1, 3, 3, 1])
        self.assertEqual(day.total_adapted_minutes, day.available_worked_minutes)


class AbsenceTests(unittest.TestCase):
    """Cas 2 — deux absents : le flexible baisse, le plancher dur ne bouge pas."""

    def test_flexible_shrinks_proportionally_and_the_floor_is_untouched(self) -> None:
        base_slots = [
            (360, 375, 1, 1),
            (375, 390, 3, 1),
            (390, 405, 3, 1),
            (405, 420, 1, 1),
        ]
        everyone = [("a", 600), ("b", 600), ("c", 600), ("d", 600)]

        full = build_day_demand(
            problem(employees=everyone, budget=8 * STEP, slots=base_slots), DATE
        )
        # Deux absents : le budget disponible tombe à 6 unités.
        reduced = build_day_demand(
            problem(
                employees=everyone,
                unavailable={"c", "d"},
                budget=6 * STEP,
                slots=base_slots,
            ),
            DATE,
        )

        self.assertFalse(reduced.structurally_infeasible)
        # Le plancher dur est identique, intervalle par intervalle.
        self.assertEqual(
            [i.hard_minimum for i in full.intervals],
            [i.hard_minimum for i in reduced.intervals],
        )
        # Le flexible total a diminué exactement du volume perdu.
        self.assertEqual(full.available_flexible_minutes, 4 * STEP)
        self.assertEqual(reduced.available_flexible_minutes, 2 * STEP)
        # Il reste distribué sur les deux intervalles de pointe, pas ailleurs.
        self.assertEqual([i.adapted_target for i in reduced.intervals], [1, 2, 2, 1])
        self.assertEqual(reduced.total_adapted_minutes, reduced.available_worked_minutes)

    def test_absent_employees_never_count_as_capacity(self) -> None:
        # Le budget annoncé dépasse ce que l'équipe présente peut travailler :
        # c'est la capacité réelle qui plafonne, jamais le budget.
        day = build_day_demand(
            problem(
                employees=[("a", 60), ("b", 60)],
                unavailable={"b"},
                budget=8 * STEP,
                slots=[(360, 420, 2, 1)],
            ),
            DATE,
        )
        self.assertEqual(day.available_worked_minutes, 60)


class FloorOnlyTests(unittest.TestCase):
    """Cas 3 — capacité exactement égale au plancher dur."""

    def test_all_flexible_demand_falls_to_zero_and_continuity_survives(self) -> None:
        day = build_day_demand(
            problem(
                employees=[("a", 600)],
                budget=4 * STEP,
                slots=[
                    (360, 375, 1, 1),
                    (375, 390, 3, 1),
                    (390, 405, 3, 1),
                    (405, 420, 1, 1),
                ],
            ),
            DATE,
        )

        self.assertFalse(day.structurally_infeasible)
        self.assertEqual(day.available_flexible_minutes, 0)
        # La continuité dure reste couverte partout ; plus aucune pointe.
        self.assertEqual([i.adapted_target for i in day.intervals], [1, 1, 1, 1])
        self.assertEqual([i.hard_minimum for i in day.intervals], [1, 1, 1, 1])
        self.assertEqual(day.total_adapted_minutes, day.total_hard_minutes)


class InfeasibleFloorTests(unittest.TestCase):
    """Cas 4 — capacité inférieure au plancher dur."""

    def test_the_day_is_structurally_infeasible(self) -> None:
        day = build_day_demand(
            problem(
                employees=[("a", 30)],
                budget=30,
                slots=[(360, 420, 2, 1)],
            ),
            DATE,
        )

        self.assertTrue(day.structurally_infeasible)
        # 4 intervalles × 1 salarié = 60 minutes exigées, 30 disponibles.
        self.assertEqual(day.total_hard_minutes, 60)
        self.assertEqual(day.available_worked_minutes, 30)
        self.assertEqual(day.available_flexible_minutes, 0)

    def test_no_employee_at_all_is_infeasible(self) -> None:
        day = build_day_demand(
            problem(
                employees=[("a", 600)],
                unavailable={"a"},
                budget=0,
                slots=[(360, 420, 1, 1)],
            ),
            DATE,
        )
        self.assertTrue(day.structurally_infeasible)
        self.assertEqual(day.available_worked_minutes, 0)


class TotalConservationTests(unittest.TestCase):
    """Cas 5 — la somme des cibles adaptées égale exactement le budget."""

    def test_totals_match_at_the_time_step(self) -> None:
        # Un profil dont le poids relatif ne tombe pas juste : 5 unités flexibles
        # à répartir sur des poids 2/6, 3/6 et 1/6. Sans plus forts restes le
        # total serait faux.
        day = build_day_demand(
            problem(
                employees=[("a", 600), ("b", 600), ("c", 600), ("d", 600)],
                budget=8 * STEP,
                slots=[
                    (360, 375, 3, 1),
                    (375, 390, 4, 1),
                    (390, 405, 2, 1),
                ],
            ),
            DATE,
        )

        self.assertFalse(day.structurally_infeasible)
        self.assertEqual(day.total_adapted_minutes, day.available_worked_minutes)
        self.assertEqual(day.total_adapted_minutes % STEP, 0)
        # Le plancher est servi avant toute distribution.
        for interval in day.intervals:
            self.assertGreaterEqual(interval.adapted_target, interval.hard_minimum)

    def test_flat_profile_does_not_invent_demand(self) -> None:
        # Aucun besoin au-dessus du plancher : les minutes restantes sont du
        # surplus planifiable, pas une cible.
        day = build_day_demand(
            problem(
                employees=[("a", 600), ("b", 600)],
                budget=10 * STEP,
                slots=[(360, 420, 1, 1)],
            ),
            DATE,
        )

        self.assertTrue(day.flat_profile)
        self.assertEqual([i.adapted_target for i in day.intervals], [1, 1, 1, 1])
        self.assertEqual(day.total_adapted_minutes, day.total_hard_minutes)
        self.assertEqual(day.surplus_minutes, 10 * STEP - day.total_hard_minutes)

    def test_capacity_above_the_reference_never_inflates_the_target(self) -> None:
        # Le cas Drive : 12 unités de budget pour un profil qui n'en demande que
        # 6. Le redimensionnement ne monte JAMAIS — au-dessus de la référence il
        # n'y a plus de demande à satisfaire, seulement des minutes à poser.
        day = build_day_demand(
            problem(
                employees=[("a", 600), ("b", 600), ("c", 600)],
                budget=12 * STEP,
                slots=[
                    (360, 375, 1, 1),
                    (375, 390, 3, 1),
                    (390, 405, 1, 1),
                    (405, 420, 1, 1),
                ],
            ),
            DATE,
        )

        self.assertTrue(day.capacity_exceeds_reference)
        # Exactement le profil de référence, ni plus ni moins.
        self.assertEqual([i.adapted_target for i in day.intervals], [1, 3, 1, 1])
        self.assertEqual([i.reference_required for i in day.intervals], [1, 3, 1, 1])
        # Le reste est du surplus planifiable, jamais un déficit.
        self.assertEqual(day.total_adapted_minutes, 6 * STEP)
        self.assertEqual(day.surplus_minutes, 6 * STEP)

    def test_rescaling_is_deterministic(self) -> None:
        spec = problem(
            employees=[("a", 600), ("b", 600), ("c", 600)],
            budget=7 * STEP,
            slots=[(360, 375, 3, 1), (375, 390, 2, 1), (390, 405, 4, 1)],
        )
        first = build_day_demand(spec, DATE)
        second = build_day_demand(spec, DATE)
        self.assertEqual(
            [i.adapted_target for i in first.intervals],
            [i.adapted_target for i in second.intervals],
        )


class ModelTests(unittest.TestCase):
    def test_model_reports_infeasible_days(self) -> None:
        model = build_demand_model(
            problem(
                employees=[("a", 30)],
                budget=30,
                slots=[(360, 420, 2, 1)],
            )
        )
        self.assertEqual(model.infeasible_days, (DATE,))

    def test_model_exposes_targets_and_floors_by_interval(self) -> None:
        model = build_demand_model(
            problem(
                employees=[("a", 600), ("b", 600)],
                budget=4 * STEP,
                slots=[(360, 390, 2, 1), (390, 420, 1, 1)],
            )
        )
        self.assertEqual(model.floor(DATE, 360), 1)
        self.assertGreaterEqual(model.target(DATE, 360), 1)


if __name__ == "__main__":
    unittest.main()
