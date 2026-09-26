// Dates are rendered on the server and again when the page hydrates, so they
// use a fixed locale and time zone. Otherwise the server's settings and the
// browser's can disagree and React warns about the mismatch.
const options = { timeZone: 'UTC' } as const
const monthYear = new Intl.DateTimeFormat('en-US', {
	...options,
	year: 'numeric',
	month: 'long',
})
const fullDate = new Intl.DateTimeFormat('en-US', {
	...options,
	dateStyle: 'long',
})

/** "October 2023" */
export function formatMonthYear(date: Date | string) {
	return monthYear.format(new Date(date))
}

/** "October 5, 2023" */
export function formatDate(date: Date | string) {
	return fullDate.format(new Date(date))
}

export function getYear(date: Date | string) {
	return new Date(date).getUTCFullYear()
}
