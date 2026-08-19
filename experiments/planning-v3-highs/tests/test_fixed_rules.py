"""Les règles fixes du salarié, vues du générateur de journées.

« Commence à 9 h » n'est pas « pas avant 9 h ». La borne interdit le côté
gauche ; la règle fixe interdit les deux, et un moteur qui ne connaît que les
bornes produit sans broncher une journée qui commence à 10 h.

Ces règles se traitent à la GÉNÉRATION, pas au placement : une journée qui les
enfreint ne doit jamais exister, sinon le solveur dépense son budget à explorer
des candidats qu'il devra rejeter, et l'évaluateur le découvre trop tard.
"""

from __future__ import annotations

import unittest

from shiftos_highs.demand import build_demand_model
from shiftos_highs_fast.allocation import Allocation, build_allocation_model
from shiftos_highs_fast.shifts import generate_shifts
from shiftos_highs_fast.skeleton import generate_skeletons


def _problem(**day_overrides: object) -> dict:
    """Un rayon, un salarié, une journée de 7 h à 12 h."""
    date = "2026-07-20"
    entry = {
        "employeeId": "aurelie", "date": date, "available": True, "mandatory": True,
        "fixedRest": False, "earliestStartMinutes": 420, "latestEndMinutes": 720,
        "maximumMinutes": 300,
    }
    entry.update(day_overrides)
    return {
        "version": "v3.0.0", "planningId": "regles", "sectorId": "poisson",
        "sectors": [
            {
                "id": "poisson", "name": "Poisson",
                "splitRules": {"splitShiftAllowed": False, "minimumSplitMinutes": 45,
                               "maximumSplitMinutes": 90, "maximumSplitsPerDay": 1},
                "days": [{"date": date, "closed": False, "opensAtMinutes": 420,
                          "closesAtMinutes": 720, "minimumOpenings": 0, "exactClosings": 0}],
            },
        ],
        "period": {"start": date, "end": date}, "timeStepMinutes": 15,
        "employees": [
            {"id": "aurelie", "firstName": "Aurélie", "lastName": "L", "contractMinutes": 300,
             "workingDays": ["monday"], "fixedRestDays": [], "minimumDailyMinutes": 120,
             "maximumDailyMinutes": 300, "canOpen": True, "canClose": True,
             "canSplitShift": False, "maximumOpenings": None, "maximumClosings": None,
             "prefersOpening": False, "prefersClosing": False, "allowedSectorIds": ["poisson"]},
        ],
        "days": [{"date": date, "weekDay": "monday", "weekKey": "2026-W30", "closed": False,
                  "opensAtMinutes": 420, "closesAtMinutes": 720, "budgetMinutes": 300}],
        "employeeDays": [entry],
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


def _mono_problem(**day_overrides: object) -> dict:
    """Le même cas SANS aucun rayon : la forme que prend toute la production.

    Ce n'est pas une variante exotique. Un magasin qui n'a pas subdivisé son
    activité produit exactement ce problème-là, et c'est celui sur lequel les
    devoirs d'ouverture et de fermeture n'ont jamais été éprouvés.
    """
    problem = _problem(**day_overrides)
    problem.pop("sectors")
    problem["employees"][0].pop("allowedSectorIds", None)
    return problem


def _shifts(problem: dict, minutes: dict[str, int]) -> tuple[list, dict[str, int]]:
    """L'espace des journées, pour une durée imposée à chaque salarié."""
    model = build_allocation_model(problem)
    demand = build_demand_model(problem)
    allocation = Allocation(
        minutes=tuple(
            tuple(minutes.get(model.employees[row], 0) if cell is not None else 0
                  for cell in cells)
            for row, cells in enumerate(model.cells)
        ),
        origin="probe",
    )
    skeleton = generate_skeletons(problem, model, allocation, demand, keep=1)[0]
    space = generate_shifts(problem, model, allocation, skeleton, demand)
    return list(space.shifts), {name: row for row, name in enumerate(model.employees)}


def _starts(problem: dict, minutes: int) -> set[int]:
    """Les heures de début que le générateur juge possibles pour cette durée."""
    space, index = _shifts(problem, {"aurelie": minutes})
    return {shift.segments[0].start for shift in space if shift.employee_index == index["aurelie"]}


def _ends(problem: dict, minutes: int) -> set[int]:
    space, index = _shifts(problem, {"aurelie": minutes})
    return {shift.segments[-1].end for shift in space if shift.employee_index == index["aurelie"]}


class FixedRuleGenerationTests(unittest.TestCase):
    def test_without_a_rule_every_position_of_the_window_exists(self) -> None:
        # Le témoin : sans règle fixe, 180 min dans une fenêtre de 300 laissent
        # neuf départs possibles au pas de 15 minutes.
        self.assertEqual(_starts(_problem(), 180), {420, 435, 450, 465, 480, 495, 510, 525, 540})

    def test_a_fixed_start_leaves_exactly_one_position(self) -> None:
        starts = _starts(_problem(fixedStartMinutes=480), 180)
        self.assertEqual(starts, {480})

    def test_a_fixed_end_leaves_exactly_one_position(self) -> None:
        self.assertEqual(_ends(_problem(fixedEndMinutes=660), 180), {660})

    def test_a_fixed_start_that_no_duration_can_honour_generates_nothing(self) -> None:
        # 07:00 imposé avec 300 minutes finirait à 12:00 : c'est la fermeture,
        # donc admissible. À 09:00 imposé, la même durée déborderait — et une
        # journée impossible ne doit pas être proposée puis rejetée.
        self.assertEqual(_starts(_problem(fixedStartMinutes=420), 300), {420})
        self.assertEqual(_starts(_problem(fixedStartMinutes=540), 300), set())

    def test_must_open_pins_the_start_to_the_sector_opening(self) -> None:
        # Le rayon ouvre à 07:00 ; le devoir d'ouvrir vaut heure de début, sans
        # que personne ait eu à la saisir.
        self.assertEqual(_starts(_problem(mustOpen=True), 180), {420})

    def test_must_close_pins_the_end_to_the_sector_closing(self) -> None:
        self.assertEqual(_ends(_problem(mustClose=True), 180), {720})

    def test_the_duties_hold_when_the_problem_has_no_sector_at_all(self) -> None:
        # Sans rayon, l'heure cherchée n'était nulle part — et « introuvable »
        # tuait la journée. Un magasin mono-secteur ouvre et ferme pourtant bien,
        # à l'heure que porte sa propre journée. Les deux devoirs se lisent donc
        # là, et rendent les mêmes bornes qu'avec un rayon.
        self.assertEqual(_ends(_mono_problem(mustClose=True), 180), {720})
        self.assertEqual(_starts(_mono_problem(mustOpen=True), 180), {420})
        self.assertEqual(_starts(_mono_problem(mustOpen=True, mustClose=True), 300), {420})

    def test_a_declared_sector_that_never_opens_stays_impossible(self) -> None:
        # Le garde-fou du repli. Un problème qui DÉCLARE des rayons et dont
        # aucun de ceux que ce salarié sert n'ouvre ce jour-là est une vraie
        # impossibilité : le repli ne doit pas la transformer en journée
        # ordinaire adossée aux heures du magasin.
        problem = _problem(mustClose=True)
        problem["sectors"][0]["days"][0]["closed"] = True
        self.assertEqual(_ends(problem, 180), set())

    def test_opening_and_closing_the_same_day_forces_the_whole_span(self) -> None:
        # Les deux devoirs ensemble ne laissent qu'une journée : celle qui va de
        # l'ouverture à la fermeture. Toute durée plus courte est impossible.
        self.assertEqual(_starts(_problem(mustOpen=True, mustClose=True), 300), {420})
        self.assertEqual(_ends(_problem(mustOpen=True, mustClose=True), 300), {720})
        self.assertEqual(_starts(_problem(mustOpen=True, mustClose=True), 180), set())

    def test_the_rules_do_not_leak_onto_another_employee(self) -> None:
        problem = _problem(fixedStartMinutes=480)
        problem["employees"].append({
            **problem["employees"][0], "id": "marc", "firstName": "Marc",
        })
        problem["employeeDays"].append({
            "employeeId": "marc", "date": "2026-07-20", "available": True, "mandatory": True,
            "fixedRest": False, "earliestStartMinutes": 420, "latestEndMinutes": 720,
            "maximumMinutes": 300,
        })
        shifts, index = _shifts(problem, {"aurelie": 180, "marc": 180})
        self.assertEqual(
            {shift.segments[0].start for shift in shifts if shift.employee_index == index["aurelie"]},
            {480},
        )
        self.assertEqual(
            {shift.segments[0].start for shift in shifts if shift.employee_index == index["marc"]},
            {420, 435, 450, 465, 480, 495, 510, 525, 540},
        )


if __name__ == "__main__":
    unittest.main()
