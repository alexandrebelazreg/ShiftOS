"""Comptoirs à serveur unique : une déduction, pas une préférence de parcours.

Quand un comptoir ouvert n'a qu'un salarié autorisé et disponible, et qu'il exige
une ouverture et une fermeture, cette personne tient les deux bouts. Comme elle
ne sert que deux comptoirs par jour avec un seul changement, ses blocs sur ce
comptoir forment une seule plage — celle qui va de l'ouverture à la fermeture.

Le moteur générait pour elle toutes les positions et toutes les lectures par
rayon, et laissait le placement redécouvrir la seule qui convienne.
"""

from __future__ import annotations

import json
import unittest
from pathlib import Path

from shiftos_highs_fast.shifts import sole_server_duties

ROOT = Path(__file__).resolve().parents[1]


def _zone() -> dict:
    """Deux comptoirs : l'un avec un seul serveur, l'autre avec deux."""
    date = "2026-07-20"
    return {
        "version": "v3.0.0", "planningId": "zone", "sectorId": "poisson",
        "sectors": [
            {
                "id": "poisson", "name": "Poisson",
                "splitRules": {"splitShiftAllowed": False, "minimumSplitMinutes": 45,
                               "maximumSplitMinutes": 90, "maximumSplitsPerDay": 1},
                "days": [{"date": date, "closed": False, "opensAtMinutes": 420,
                          "closesAtMinutes": 720, "minimumOpenings": 1, "exactClosings": 1}],
            },
            {
                "id": "fruits", "name": "Fruits",
                "splitRules": {"splitShiftAllowed": False, "minimumSplitMinutes": 45,
                               "maximumSplitMinutes": 90, "maximumSplitsPerDay": 1},
                "days": [{"date": date, "closed": False, "opensAtMinutes": 480,
                          "closesAtMinutes": 1020, "minimumOpenings": 1, "exactClosings": 1}],
            },
        ],
        "period": {"start": date, "end": date}, "timeStepMinutes": 15,
        "employees": [
            {"id": "aurelie", "firstName": "Aurélie", "lastName": "L", "contractMinutes": 480,
             "workingDays": ["monday"], "fixedRestDays": [], "minimumDailyMinutes": 240,
             "maximumDailyMinutes": 600, "canOpen": True, "canClose": True,
             "canSplitShift": False, "maximumOpenings": None, "maximumClosings": None,
             "prefersOpening": False, "prefersClosing": False,
             "allowedSectorIds": ["poisson", "fruits"]},
            {"id": "marc", "firstName": "Marc", "lastName": "D", "contractMinutes": 480,
             "workingDays": ["monday"], "fixedRestDays": [], "minimumDailyMinutes": 240,
             "maximumDailyMinutes": 600, "canOpen": True, "canClose": True,
             "canSplitShift": False, "maximumOpenings": None, "maximumClosings": None,
             "prefersOpening": False, "prefersClosing": False, "allowedSectorIds": ["fruits"]},
        ],
        "days": [{"date": date, "weekDay": "monday", "weekKey": "2026-W30", "closed": False,
                  "opensAtMinutes": 420, "closesAtMinutes": 1020, "budgetMinutes": 960}],
        "employeeDays": [
            {"employeeId": employee_id, "date": date, "available": True, "mandatory": True,
             "fixedRest": False, "earliestStartMinutes": 420, "latestEndMinutes": 1020,
             "maximumMinutes": 600}
            for employee_id in ("aurelie", "marc")
        ],
        "demandSlots": [],
        "rules": {
            "minimumShiftMinutes": 240, "maximumShiftMinutes": 600, "minimumRestMinutes": 720,
            "maximumConsecutiveWorkedDays": 7, "maximumConsecutiveWorkedDaysSource": "derived-fallback",
            "splitShiftAllowed": False, "maximumSplitMinutes": None, "minimumSplitMinutes": None,
            "maximumContinuousMinutes": 480, "maximumSplitsPerDay": None,
            "minimumOpeningsPerDay": 0, "exactClosingsPerDay": 0, "closingFairness": None,
        },
        "objectives": [],
    }


class SoleServerDeductionTests(unittest.TestCase):
    def test_a_counter_with_one_eligible_employee_pins_that_employee(self) -> None:
        duties = sole_server_duties(_zone())
        self.assertIn(("poisson", 420, 720), duties[("aurelie", "2026-07-20")])

    def test_a_counter_with_two_candidates_pins_the_one_whose_counter_it_is(self) -> None:
        """La déduction s'est élargie, et ce test dit dans quel sens.

        Fruits a deux candidats — mais Aurélie l'a en second choix et Marc en
        premier. Auparavant rien n'était déduit et le comptoir se retrouvait
        sans titulaire : sur une vraie semaine, le moteur donnait huit heures à
        quelqu'un puis laissait quatre heures de comptoir éteint. Désormais
        c'est celui dont c'est le rayon qui le tient, et l'autre vient en
        renfort.

        Marc ne coupe pas et l'amplitude dépasse sa traite : l'obligation ne
        porte donc que sur l'OUVERTURE. Il ouvre et fait ses heures ; fermer
        reviendra à quelqu'un d'autre.

        Cet élargissement se demande : par défaut la fonction s'en tient à ce
        qu'elle peut prouver.
        """
        duties = sole_server_duties(_zone(), designate_holders=True)
        self.assertNotIn(("marc", "2026-07-20"), sole_server_duties(_zone()))
        self.assertEqual(duties[("marc", "2026-07-20")], (("fruits", 480, None),))

    def test_a_counter_that_requires_no_role_pins_nobody(self) -> None:
        problem = _zone()
        for sector in problem["sectors"]:
            for day in sector["days"]:
                day["exactClosings"] = 0
        self.assertEqual(sole_server_duties(problem), {})

    def test_an_unavailable_employee_is_not_counted_as_eligible(self) -> None:
        problem = _zone()
        for entry in problem["employeeDays"]:
            if entry["employeeId"] == "marc":
                entry.update({"available": False, "mandatory": False, "maximumMinutes": 0})
        duties = sole_server_duties(problem)
        # Marc absent : Aurélie devient aussi la seule sur Fruits.
        self.assertEqual(
            duties[("aurelie", "2026-07-20")],
            (("fruits", 480, 1020), ("poisson", 420, 720)),
        )

    def test_a_mono_sector_problem_deduces_nothing(self) -> None:
        problem = json.loads(
            (ROOT / "fixtures/drive-canonical-problem.json").read_text(encoding="utf-8")
        )
        self.assertEqual(sole_server_duties(problem), {})


class ForcedCounterShrinksTheShiftSpaceTests(unittest.TestCase):
    def test_the_pinned_employee_only_gets_shifts_that_span_the_counter(self) -> None:
        from shiftos_highs.demand import build_demand_model
        from shiftos_highs_fast.allocation import Allocation, build_allocation_model
        from shiftos_highs_fast.shifts import generate_shifts
        from shiftos_highs_fast.skeleton import generate_skeletons_from_capacity

        problem = _zone()
        model = build_allocation_model(problem)
        demand = build_demand_model(problem)
        skeleton = generate_skeletons_from_capacity(problem, model, demand, keep=1)[0]
        allocation = Allocation(
            minutes=tuple(tuple(0 if cell is None else 480 for cell in row) for row in model.cells),
            origin="probe",
        )
        space = generate_shifts(problem, model, allocation, skeleton, demand)

        index = model.employees.index("aurelie")
        pinned = [shift for shift in space.shifts if shift.employee_index == index]
        self.assertTrue(pinned)
        for shift in pinned:
            poisson = [b for b in shift.sector_assignments if b.sector_id == "poisson"]
            self.assertTrue(poisson, "le comptoir forcé doit être servi")
            self.assertEqual(min(b.start for b in poisson), 420)
            self.assertEqual(max(b.end for b in poisson), 720)


def _pinned_neighbours() -> dict:
    """Un grand comptoir dont les candidats sont retenus par leurs propres rayons.

    Charcuterie ouvre 06:30–20:00 : treize heures et demie, donc deux personnes
    au minimum. Trois y sont autorisées, mais deux d'entre elles sont les seules
    à pouvoir servir Poisson et Fromage, et y sont donc retenues le matin. La
    troisième reste seule, et personne ne tient 13 h 30.
    """
    date = "2026-07-20"

    def sector(sector_id, name, opens, closes):
        return {
            "id": sector_id, "name": name,
            "splitRules": {"splitShiftAllowed": True, "minimumSplitMinutes": 45,
                           "maximumSplitMinutes": 120, "maximumSplitsPerDay": 2},
            "days": [{"date": date, "closed": False, "opensAtMinutes": opens,
                      "closesAtMinutes": closes, "minimumOpenings": 1, "exactClosings": 1}],
        }

    def employee(employee_id, sectors):
        return {
            "id": employee_id, "firstName": employee_id, "lastName": "",
            "contractMinutes": 480, "workingDays": ["monday"], "fixedRestDays": [],
            "minimumDailyMinutes": 240, "maximumDailyMinutes": 600,
            "canOpen": True, "canClose": True, "canSplitShift": True,
            "maximumOpenings": None, "maximumClosings": None,
            "prefersOpening": False, "prefersClosing": False, "allowedSectorIds": sectors,
        }

    return {
        "version": "v3.0.0", "planningId": "pinned", "sectorId": "charcuterie",
        "sectors": [
            sector("charcuterie", "Charcuterie", 390, 1200),
            sector("poisson", "Poisson", 420, 720),
            sector("fromage", "Fromage", 360, 540),
        ],
        "period": {"start": date, "end": date}, "timeStepMinutes": 15,
        "employees": [
            employee("aurelie", ["charcuterie", "poisson"]),
            employee("daniel", ["charcuterie", "fromage"]),
            employee("jean", ["charcuterie"]),
        ],
        "days": [{"date": date, "weekDay": "monday", "weekKey": "2026-W30", "closed": False,
                  "opensAtMinutes": 360, "closesAtMinutes": 1200, "budgetMinutes": 1440}],
        "employeeDays": [
            {"employeeId": employee_id, "date": date, "available": True, "mandatory": True,
             "fixedRest": False, "earliestStartMinutes": 360, "latestEndMinutes": 1200,
             "maximumMinutes": 600}
            for employee_id in ("aurelie", "daniel", "jean")
        ],
        "demandSlots": [],
        "rules": {
            "minimumShiftMinutes": 240, "maximumShiftMinutes": 600, "minimumRestMinutes": 720,
            "maximumConsecutiveWorkedDays": 7, "maximumConsecutiveWorkedDaysSource": "derived-fallback",
            "splitShiftAllowed": True, "maximumSplitMinutes": 120, "minimumSplitMinutes": 45,
            "maximumContinuousMinutes": 480, "maximumSplitsPerDay": 2,
            "minimumOpeningsPerDay": 0, "exactClosingsPerDay": 0, "closingFairness": None,
        },
        "objectives": [],
    }


class PinnedNeighboursPreflightTests(unittest.TestCase):
    """Le préflight doit PROUVER ce cas, pas laisser la recherche s'épuiser."""

    def test_it_proves_the_conflict_instead_of_searching(self) -> None:
        from shiftos_highs_fast.pipeline import solve_fast

        answer = solve_fast(_pinned_neighbours(), time_limit_seconds=30.0)
        self.assertEqual(answer["status"], "infeasible-proven")
        self.assertEqual(
            answer["diagnostics"]["reason"], "sector-role-cannot-be-staffed"
        )
        self.assertEqual(answer["diagnostics"]["proof"], "structural")
        # Et vite : c'est un fait structurel, pas une recherche.
        self.assertLess(answer["diagnostics"]["totalSeconds"], 2.0)

    def test_it_names_every_counter_holding_a_candidate(self) -> None:
        from shiftos_highs_fast.pipeline import _cross_sector_role_conflicts

        conflicts = _cross_sector_role_conflicts(_pinned_neighbours())
        self.assertEqual(len(conflicts), 1)
        held = {
            (entry["employeeName"], entry["sectorName"])
            for entry in conflicts[0]["heldElsewhere"]
        }
        # Les DEUX, pas seulement le premier trouvé : corriger l'un et relancer
        # pour retomber sur l'autre est ce que ce champ existe pour éviter.
        self.assertEqual(held, {("aurelie", "Poisson"), ("daniel", "Fromage")})

    def test_one_more_authorised_employee_removes_the_proof(self) -> None:
        from shiftos_highs_fast.pipeline import _cross_sector_role_conflicts

        problem = _pinned_neighbours()
        problem["employees"].append({
            **problem["employees"][2], "id": "renfort", "firstName": "renfort",
            "allowedSectorIds": ["charcuterie"],
        })
        problem["employeeDays"].append({
            **problem["employeeDays"][2], "employeeId": "renfort",
        })
        self.assertEqual(_cross_sector_role_conflicts(problem), [])

    def test_a_short_counter_one_person_can_hold_is_never_flagged(self) -> None:
        from shiftos_highs_fast.pipeline import _cross_sector_role_conflicts

        problem = _pinned_neighbours()
        # Charcuterie sur sept heures : une seule personne suffit.
        problem["sectors"][0]["days"][0]["closesAtMinutes"] = 810
        self.assertEqual(_cross_sector_role_conflicts(problem), [])


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
