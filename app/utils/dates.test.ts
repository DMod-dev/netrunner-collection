import { expect, test } from 'vitest'
import { formatDate, formatMonthYear, getYear } from './dates.ts'

test('dates format the same whatever the local time zone', () => {
	// midnight UTC on New Year's Day is still the previous year west of UTC
	const date = new Date('2024-01-01T00:00:00Z')
	expect(formatMonthYear(date)).toBe('January 2024')
	expect(formatDate(date)).toBe('January 1, 2024')
	expect(getYear(date)).toBe(2024)
	expect(formatMonthYear(date.toISOString())).toBe('January 2024')
})
