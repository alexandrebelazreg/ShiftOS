"""RÉGRESSION — présence concurrente sur un créneau, cas rapporté.

Trois salariés se relaient sur 12:00-13:00 : 06:00-12:30, 10:00-14:00,
12:15-17:45. Aucun ne couvre l'heure a lui seul, mais la presence simultanee
reelle ne descend jamais sous 2. L'ancienne contrainte de couverture
("un candidat doit couvrir integralement le creneau") ne comptait que le
candidat du milieu -> covered=1, deficit annonce a tort.

Meme scenario, memes chiffres attendus que le twin TypeScript
(features/core/planning-v3/__tests__/coverage-concurrency.test.ts) :
requis=2 -> aucun deficit ; requis=3 -> deficit reel de 45 minutes (pas 60,
pas 120), parce que seuls 45 des 60 minutes de l'heure sont effectivement
courtes d'une personne.

Les affectations sont VERROUILLEES (preservation.lockedAssignments) pour
forcer le solveur a reproduire exactement ce planning : le test verifie la
SEMANTIQUE DE LA CONTRAINTE, pas ce que le solveur choisirait librement.

    python -m pytest experiments/planning-v3-cpsat/tests/test_coverage_concurrency.py
"""
import os
import sys

import pytest
from ortools.sat.python import cp_model

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from cpsat_model import build_model, run_pass  # noqa: E402

DATE = "2026-07-20"


def problem_with_requirement(required_employees):
    """Trois salaries obligatoires, contrats et budget calés exactement sur
    le planning A/B/C attendu, pour isoler la regle de couverture."""
    return {
        "version": "v3.0.0", "planningId": "t", "sectorId": "s",
        "period": {"start": DATE, "end": DATE}, "timeStepMinutes": 15,
        "objectives": [],
        "rules": {
            "minimumShiftMinutes": 240, "maximumShiftMinutes": 600,
            "minimumRestMinutes": 0, "maximumConsecutiveWorkedDays": None,
            "maximumConsecutiveWorkedDaysSource": "derived-fallback",
            "splitShiftAllowed": False, "maximumSplitMinutes": None,
            "minimumOpeningsPerDay": 0, "exactClosingsPerDay": 0,
        },
        "employees": [
            {"id": "empA", "contractMinutes": 390, "workingDays": ["monday"],
             "fixedRestDays": [], "canOpen": True, "canClose": True,
             "maximumOpenings": None, "maximumClosings": None},
            {"id": "empB", "contractMinutes": 240, "workingDays": ["monday"],
             "fixedRestDays": [], "canOpen": True, "canClose": True,
             "maximumOpenings": None, "maximumClosings": None},
            {"id": "empC", "contractMinutes": 330, "workingDays": ["monday"],
             "fixedRestDays": [], "canOpen": True, "canClose": True,
             "maximumOpenings": None, "maximumClosings": None},
        ],
        "days": [{
            "date": DATE, "weekDay": "monday", "weekKey": "2026-W30",
            "closed": False, "opensAtMinutes": 360, "closesAtMinutes": 1080,
            "budgetMinutes": 960,  # 390 + 240 + 330, exact
        }],
        "employeeDays": [
            {"employeeId": "empA", "date": DATE, "available": True, "mandatory": False,
             "earliestStartMinutes": 0, "latestEndMinutes": 1440, "maximumMinutes": 600},
            {"employeeId": "empB", "date": DATE, "available": True, "mandatory": False,
             "earliestStartMinutes": 0, "latestEndMinutes": 1440, "maximumMinutes": 600},
            {"employeeId": "empC", "date": DATE, "available": True, "mandatory": False,
             "earliestStartMinutes": 0, "latestEndMinutes": 1440, "maximumMinutes": 600},
        ],
        "demandSlots": [{
            "id": "req-1200-1300", "date": DATE,
            "startMinutes": 720, "endMinutes": 780,  # 12:00-13:00
            "requiredEmployees": required_employees, "maximumEmployees": None,
        }],
    }


LOCKED = {
    "lockedAssignments": [
        {"shiftId": "sA", "employeeId": "empA", "date": DATE, "startMinutes": 360, "endMinutes": 750},
        {"shiftId": "sB", "employeeId": "empB", "date": DATE, "startMinutes": 600, "endMinutes": 840},
        {"shiftId": "sC", "employeeId": "empC", "date": DATE, "startMinutes": 735, "endMinutes": 1065},
    ],
    "editedAssignments": [], "baselineAssignments": [], "minimizeOtherChanges": False,
}


def solve_two_passes(problem):
    model, handles = build_model(problem, LOCKED)
    assert handles["unmatchedPreservations"] == [], "les verrous doivent matcher un candidat legal"

    solver = cp_model.CpSolver()
    solver.parameters.random_seed = 1
    solver.parameters.num_search_workers = 1
    solver.parameters.max_time_in_seconds = 30.0

    model.Minimize(sum(handles["under"]))
    first = run_pass(solver, model, "1-under")
    assert first["status"] == "OPTIMAL"

    model.Add(sum(handles["under"]) == first["objective"])
    solver.parameters.max_time_in_seconds = 30.0
    model.Minimize(sum(handles["shortfall"]))
    second = run_pass(solver, model, "2-deficit")
    assert second["status"] == "OPTIMAL"

    return first["objective"], second["objective"]


def test_no_deficit_when_required_matches_true_minimum_presence():
    under, deficit = solve_two_passes(problem_with_requirement(2))
    assert under == 0
    assert deficit == 0


def test_deficit_of_3_required_is_45_minutes_not_60_not_120():
    # Ancienne logique : covered=1 (seul empB couvre toute l'heure) ->
    # deficit = (3-1)*60 = 120. Version corrigee, sur-chargee sur l'heure
    # entiere : (3-2)*60 = 60. Version atomique correcte : seuls 45 des 60
    # minutes sont effectivement courtes d'une personne (12:15-12:30 a 3
    # presents, le besoin y est deja atteint).
    under, deficit = solve_two_passes(problem_with_requirement(3))
    assert under == 1
    assert deficit == 45


@pytest.mark.parametrize("required,expected_deficit", [(1, 0), (2, 0), (3, 45)])
def test_deficit_matches_the_atomic_computation_for_every_requirement_level(
    required, expected_deficit
):
    _, deficit = solve_two_passes(problem_with_requirement(required))
    assert deficit == expected_deficit
