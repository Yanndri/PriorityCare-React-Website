// Report-generation timestamps shown on printed and exported reports.
// PriorityCare operates in the Philippines, so reports show Asia/Manila
// time, with the UTC instant alongside for an unambiguous record.

export function reportTimestamp(date = new Date()) {
  const manila = new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }).format(date)

  return { manila: `${manila} (Asia/Manila)`, utc: date.toISOString() }
}

// File-name safe stamp in Manila time, e.g. 2026-10-18_1430
export function reportFileStamp(date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Manila',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  )

  return `${parts.year}-${parts.month}-${parts.day}_${parts.hour}${parts.minute}`
}
