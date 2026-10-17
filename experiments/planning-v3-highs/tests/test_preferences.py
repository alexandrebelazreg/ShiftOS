"""Les souhaits du salarié : ouvrir ou fermer, commencer ou finir avant/après.

Des SOUHAITS. Trois choses à tenir ensemble, et chacune a son test :

- sans souhait, rien ne bouge — le Drive et l'Accueil sont la référence ;
- avec un souhait et de la latitude, le planning s'en rapproche ;
- un souhait ne coûte jamais une minute de couverture.

Jusqu'ici, le moteur mono-secteur ne lisait ni `prefersOpening` ni
`prefersClosing` : les cases de la fiche étaient décoratives.
"""

from __future__ import annotations

import copy
import json
import unittest
from pathlib import Path

from shiftos_highs.demand import build_demand_model
from shiftos_highs.quality import time_preference_miss
from shiftos_highs_fast.allocation import build_allocation_model
from shiftos_highs_fast.pipeline import solve_fast
from shiftos_highs_fast.skeleton import generate_skeletons_from_capacity

ROOT = Path(__file__).resolve().parent.parent


def _day(**employee_overrides: object) -> dict:
    """Une journée de 7 h à 12 h, un salarié, 180 minutes à placer, aucune demande.

    Sans demande, la couverture ne départage rien : seuls les souhaits le font,
    ce qui rend leur effet lisible.
    """
    date = "2026-07-20"
    employee = {
        "id": "aurelie", "firstName": "Aurélie", "lastName": "L", "contractMinutes": 180,
        "workingDays": ["monday"], "fixedRestDays": [], "minimumDailyMinutes": 120,
        "maximumDailyMinutes": 300, "canOpen": True, "canClose": True,
        "canSplitShift": False, "maximumOpenings": None, "maximumClosings": None,
        "prefersOpening": False, "prefersClosing": False,
    }
    employee.update(employee_overrides)
    return {
        "version": "v3.0.0", "planningId": "souhaits", "sectorId": "drive",
        "period": {"start": date, "end": date}, "timeStepMinutes": 15,
        "employees": [employee],
        "days": [{"date": date, "weekDay": "monday", "weekKey": "2026-W30", "closed": False,
                  "opensAtMinutes": 420, "closesAtMinutes": 720, "budgetMinutes": 180}],
        "employeeDays": [{
            "employeeId": "aurelie", "date": date, "available": True, "mandatory": True,
            "fixedRest": False, "earliestStartMinutes": 420, "latestEndMinutes": 720,
            "maximumMinutes": 300,
        }],
        "demandSlots": [],
        "rules": {
            "minimumShiftMinutes": 120, "maximumShiftMinutes": 300, "minimumRestMinutes": 720,
            "maximumConsecutiveWorkedDays": 7, "maximumConsecutiveWorkedDaysSource": "derived-fallback",
            "splitShiftAllowed": False, "maximumSplitMinutes": None, "minimumSplitMinutes": None,
            "maximumContinuousMinutes": 300, "maximumSplitsPerDay": None,
            "minimumOpeningsPerDay": 0, "exactClosingsPerDay": 0, "closingFairness": None,
        },
        "objectives": [],
    }


def _span(problem: dict) -> tuple[int, int]:
    answer = solve_fast(problem, time_limit_seconds=10)
    assignments = (answer.get("solution") or {}).get("assignments") or []
    if len(assignments) != 1:
        raise AssertionError(f"une journée attendue, reçu : {answer.get('status')} {assignments}")
    segments = assignments[0]["segments"]
    return segments[0]["startMinutes"], segments[-1]["endMinutes"]


class TimePreferenceMeasureTests(unittest.TestCase):
    def test_nothing_wished_costs_nothing(self) -> None:
        self.assertEqual(time_preference_miss({}, 420, 720), 0.0)

    def test_the_stated_hour_itself_is_kept(self) -> None:
        # « Avant 9 h » est tenu par 9 h pile, « après 17 h » par 17 h pile.
        employee = {"preferredStart": {"side": "before", "minutes": 540},
                    "preferredEnd": {"side": "after", "minutes": 1020}}
        self.assertEqual(time_preference_miss(employee, 540, 1020), 0.0)

    def test_the_miss_grows_with_the_gap_then_stops(self) -> None:
        employee = {"preferredEnd": {"side": "before", "minutes": 600}}
        self.assertEqual(time_preference_miss(employee, 420, 660), 0.25)
        self.assertEqual(time_preference_miss(employee, 420, 1_200), 1.0)


class MonoPlacementTests(unittest.TestCase):
    def test_without_wish_the_day_is_placed_as_before(self) -> None:
        # Le témoin : à égalité parfaite, le départage historique place la
        # journée au plus tôt.
        self.assertEqual(_span(_day()), (420, 600))

    def test_start_after_moves_the_day(self) -> None:
        start, end = _span(_day(preferredStart={"side": "after", "minutes": 510}))
        self.assertGreaterEqual(start, 510)
        self.assertEqual(end - start, 180)

    def test_end_after_moves_the_day(self) -> None:
        start, end = _span(_day(preferredEnd={"side": "after", "minutes": 720}))
        self.assertEqual((start, end), (540, 720))

    def test_two_wishes_held_together(self) -> None:
        start, end = _span(_day(
            preferredStart={"side": "after", "minutes": 450},
            preferredEnd={"side": "before", "minutes": 660},
        ))
        self.assertGreaterEqual(start, 450)
        self.assertLessEqual(end, 660)

    def test_a_wish_never_buys_a_hole(self) -> None:
        # La demande veut quelqu'un de 7 h à 10 h. Le souhait de finir après
        # 12 h tirerait la journée vers la fin : la couverture l'emporte.
        problem = _day(preferredEnd={"side": "after", "minutes": 720})
        problem["demandSlots"] = [{
            "id": "matin", "date": "2026-07-20", "startMinutes": 420, "endMinutes": 600,
            "requiredEmployees": 1, "minimumEmployees": 0, "maximumEmployees": None,
            "priority": "normal",
        }]
        self.assertEqual(_span(problem), (420, 600))


class DriveSkeletonTests(unittest.TestCase):
    """Sur la vraie semaine Drive : un souhait d'ouvrir ou de fermer est servi."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.drive = json.loads(
            (ROOT / "fixtures" / "drive-canonical-problem.json").read_text(encoding="utf-8")
        )

    def _roles(self, problem: dict) -> tuple[dict[str, int], dict[str, int]]:
        model = build_allocation_model(problem)
        demand = build_demand_model(problem)
        best = generate_skeletons_from_capacity(problem, model, demand)[0]
        employees = sorted(problem["employees"], key=lambda item: str(item["id"]))
        openings = {str(e["id"]): 0 for e in employees}
        closings = dict(openings)
        for entry in best.roles:
            for index in entry.openers:
                openings[str(employees[index]["id"])] += 1
            for index in entry.closers:
                closings[str(employees[index]["id"])] += 1
        return openings, closings

    def _with(self, employee_id: str, **wish: object) -> dict:
        problem = copy.deepcopy(self.drive)
        for employee in problem["employees"]:
            if employee["id"] == employee_id:
                employee.update(wish)
        return problem

    def test_prefers_closing_closes_more(self) -> None:
        # Valentin ne ferme jamais dans la semaine de référence ; le plafond
        # du Drive est de deux fermetures, il a donc de la place.
        _, before = self._roles(self.drive)
        _, after = self._roles(self._with("valentin", prefersClosing=True))
        self.assertGreater(after["valentin"], before["valentin"])

    def test_a_wish_never_breaks_the_weekly_cap(self) -> None:
        # Luca ferme déjà deux fois, le maximum : le souhait ne le dépasse pas.
        _, after = self._roles(self._with("luca", prefersClosing=True))
        self.assertLessEqual(after["luca"], 2)

    def test_prefers_opening_does_not_close_more(self) -> None:
        opens_before, closes_before = self._roles(self.drive)
        opens_after, closes_after = self._roles(self._with("arthur", prefersOpening=True))
        self.assertGreaterEqual(opens_after["arthur"], opens_before["arthur"])
        self.assertLess(closes_after["arthur"], closes_before["arthur"])

    def test_the_wish_does_not_degrade_what_the_skeleton_already_dooms(self) -> None:
        # Les composantes de couverture du score — structure, créneaux et
        # minutes déjà perdus — ne bougent pas pour un souhait.
        model = build_allocation_model(self.drive)
        demand = build_demand_model(self.drive)
        plain = generate_skeletons_from_capacity(self.drive, model, demand)[0]
        wished = self._with("luca", prefersClosing=True)
        model = build_allocation_model(wished)
        demand = build_demand_model(wished)
        served = generate_skeletons_from_capacity(wished, model, demand)[0]
        # Tout ce qui précède le souhait dans le classement — la couverture déjà
        # perdue — reste au moins aussi bon.
        self.assertLessEqual(served.score[:4], plain.score[:4])


if __name__ == "__main__":
    unittest.main()
