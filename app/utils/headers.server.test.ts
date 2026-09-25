import { format, parse } from '@tusbar/cache-control'
import { expect, test } from 'vitest'
import { getSessionCookieHeader } from '#tests/utils.ts'
import {
	applyPrivateCacheControl,
	getConservativeCacheControl,
	PRIVATE_CACHE_CONTROL,
} from './headers.server.ts'

test('works for basic usecase', () => {
	const result = getConservativeCacheControl(
		'max-age=3600',
		'max-age=1800, s-maxage=600',
		'private, max-age=86400',
	)

	expect(result).toEqual(
		format({
			maxAge: 1800,
			sharedMaxAge: 600,
			private: true,
		}),
	)
})
test('retains boolean directive', () => {
	const result = parse(
		getConservativeCacheControl('private', 'no-cache,no-store'),
	)

	expect(result.private).toBe(true)
	expect(result.noCache).toBe(true)
	expect(result.noStore).toBe(true)
})
test('gets smallest number directive', () => {
	const result = parse(
		getConservativeCacheControl(
			'max-age=10, s-maxage=300',
			'max-age=300, s-maxage=600',
		),
	)

	expect(result.maxAge).toBe(10)
	expect(result.sharedMaxAge).toBe(300)
})

test('signed-in requests are marked private and never stored', async () => {
	const request = new Request('http://localhost/collection', {
		headers: { cookie: await getSessionCookieHeader({ id: 'session-id' }) },
	})
	const headers = new Headers({ 'Cache-Control': 'public, max-age=300' })

	await applyPrivateCacheControl(request, headers)

	expect(headers.get('Cache-Control')).toBe(PRIVATE_CACHE_CONTROL)
})

test('anonymous requests keep their cache headers', async () => {
	const headers = new Headers({ 'Cache-Control': 'public, max-age=300' })

	await applyPrivateCacheControl(new Request('http://localhost/'), headers)
	await applyPrivateCacheControl(
		new Request('http://localhost/', { headers: { cookie: 'theme=dark' } }),
		headers,
	)

	expect(headers.get('Cache-Control')).toBe('public, max-age=300')
})
