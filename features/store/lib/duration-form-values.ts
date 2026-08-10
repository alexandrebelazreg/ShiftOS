/** Convert the minute strings stored by the form into readable hour values. */
export function minutesToHoursValue(minutes: string): string {
  if (minutes.trim() === "") return ""
  const value = Number(minutes)
  if (!Number.isFinite(value)) return minutes
  return String(value / 60)
}

/** Convert an hour input back to the minute strings expected by the schema. */
export function hoursToMinutesValue(hours: string): string {
  if (hours.trim() === "") return ""
  const value = Number(hours)
  if (!Number.isFinite(value)) return hours
  return String(Math.round(value * 60))
}
