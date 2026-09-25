import { expect, test } from 'vitest'
import {
	formatUrlForLog,
	redactSentryRequest,
	redactUrl,
} from './log-redaction.ts'

test('redacts the OTP, target and redirectTo of a verify link', () => {
	expect(
		redactUrl(
			'/verify?type=reset-password&target=kody%40kcd.dev&code=ABC123&redirectTo=%2Fsettings',
		),
	).toBe(
		'/verify?type=reset-password&target=[redacted]&code=[redacted]&redirectTo=[redacted]',
	)
})

test('leaves other URLs alone', () => {
	expect(redactUrl('/collection?q=hedge%20fund&page=2')).toBe(
		'/collection?q=hedge%20fund&page=2',
	)
	expect(redactUrl('/users/kody')).toBe('/users/kody')
	// `codec` is not `code`
	expect(redactUrl('/x?codec=h264&targeting=1')).toBe(
		'/x?codec=h264&targeting=1',
	)
})

test('an encoded ampersand inside a value cannot leak the rest of it', () => {
	expect(formatUrlForLog('/verify?code=AB%26code%3DCD&type=onboarding')).toBe(
		'/verify?code=[redacted]&type=onboarding',
	)
})

test('formatUrlForLog decodes the rest and survives bad encodings', () => {
	expect(formatUrlForLog('/search?q=caf%C3%A9&code=X')).toBe(
		'/search?q=café&code=[redacted]',
	)
	expect(formatUrlForLog('/search?q=%E0%A4%A&code=X')).toBe(
		'/search?q=%E0%A4%A&code=[redacted]',
	)
})

test('redactSentryRequest scrubs url and query_string in place', () => {
	const event = {
		request: {
			url: 'https://nr-collection.app/verify?type=onboarding&target=a%40b.c&code=ZZZ',
			query_string: 'type=onboarding&target=a%40b.c&code=ZZZ',
		},
	}
	redactSentryRequest(event)
	expect(event.request.url).toBe(
		'https://nr-collection.app/verify?type=onboarding&target=[redacted]&code=[redacted]',
	)
	expect(event.request.query_string).toBe(
		'type=onboarding&target=[redacted]&code=[redacted]',
	)

	const objectQuery = {
		request: { query_string: { type: 'onboarding', code: 'ZZZ' } },
	}
	redactSentryRequest(objectQuery)
	expect(objectQuery.request.query_string).toEqual({
		type: 'onboarding',
		code: '[redacted]',
	})

	expect(redactSentryRequest({})).toEqual({})
	expect(redactSentryRequest({ request: null })).toEqual({ request: null })
})
