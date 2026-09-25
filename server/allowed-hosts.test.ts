import { expect, test } from 'vitest'
import { createHostAllowlist } from './allowed-hosts.ts'

const isAllowed = createHostAllowlist({
	appOrigin: 'https://nr-collection.app',
	flyAppName: 'netrunner-collection',
})

test.each([
	'nr-collection.app',
	'NR-Collection.app',
	'www.nr-collection.app',
	'nr-collection.app:443',
	'netrunner-collection.fly.dev',
	'localhost',
	'localhost:3000',
	'127.0.0.1:8081',
	'[::1]:8081',
	'5ef6ddf5.vm.netrunner-collection.internal:8081',
])('allows %s', (host) => {
	expect(isAllowed(host)).toBe(true)
})

test.each([
	undefined,
	'',
	'attacker.example',
	'www.attacker.example',
	'nr-collection.app.attacker.example',
	'evil-nr-collection.app',
	'nr-collection.app:443:attacker.example',
	'internal',
	'attacker.example/.internal',
	'localhost.attacker.example',
])('rejects %s', (host) => {
	expect(isAllowed(host)).toBe(false)
})

test('without APP_ORIGIN only loopback, fly.dev and internal hosts pass', () => {
	const isAllowedNoOrigin = createHostAllowlist({
		appOrigin: undefined,
		flyAppName: undefined,
	})
	expect(isAllowedNoOrigin('localhost:3000')).toBe(true)
	expect(isAllowedNoOrigin('nr-collection.app')).toBe(false)
	expect(isAllowedNoOrigin('netrunner-collection.fly.dev')).toBe(false)
})
