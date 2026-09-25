import { afterEach, expect, test, vi } from 'vitest'
import { getDomainUrl } from './misc.tsx'

afterEach(() => {
	vi.unstubAllEnvs()
})

function makeRequest(headers: Record<string, string>) {
	return new Request('https://internal.example/forgot-password', {
		headers,
	})
}

test('uses APP_ORIGIN and ignores every host-related header when pinned', () => {
	vi.stubEnv('APP_ORIGIN', 'https://nr-collection.app')
	const request = makeRequest({
		host: 'attacker.example',
		'X-Forwarded-Host': 'www.attacker.example',
		'X-Forwarded-Proto': 'http',
	})
	expect(getDomainUrl(request)).toBe('https://nr-collection.app')
})

test('never trusts X-Forwarded-Host, even without APP_ORIGIN', () => {
	vi.stubEnv('APP_ORIGIN', '')
	const request = makeRequest({
		host: 'localhost:3000',
		'X-Forwarded-Host': 'attacker.example',
		'X-Forwarded-Proto': 'https',
	})
	expect(getDomainUrl(request)).toBe('https://localhost:3000')
})

test('falls back to the request URL when no Host header is present', () => {
	vi.stubEnv('APP_ORIGIN', '')
	expect(getDomainUrl(makeRequest({}))).toBe('https://internal.example')
})
