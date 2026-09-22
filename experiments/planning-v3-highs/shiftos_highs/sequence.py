"""Calendar-day windows for the configured consecutive-work limit."""
from datetime import date, timedelta


def streak_windows(problem: dict, employee_id: str):
    rules = problem['rules']
    maximum = rules.get('maximumConsecutiveWorkedDays')
    if maximum is None or rules.get('maximumConsecutiveWorkedDaysSource') != 'configured':
        return
    maximum = int(maximum)
    history = next((h for h in problem.get('previousWork') or []
                    if str(h['employeeId']) == employee_id), None)
    historical = set()
    if history:
        end = date.fromisoformat(history['date'])
        historical = {end - timedelta(days=i) for i in range(min(maximum, history['consecutiveDays']))}
    dates = {date.fromisoformat(d['date']): d['date'] for d in problem['days']}
    for end in sorted(dates):
        window = {end - timedelta(days=i) for i in range(maximum + 1)}
        current = [dates[d] for d in sorted(window & dates.keys())]
        remaining = maximum - len(window & historical)
        if len(current) > remaining:
            yield current, remaining
