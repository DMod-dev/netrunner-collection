import { expect, test } from 'vitest'
import {
	claimEmailCooldown,
	EMAIL_COOLDOWN_MS,
	releaseEmailCooldown,
} from './email-cooldown.server.ts'

test('the same kind and recipient gets one email per cooldown window', () => {
	const t0 = 1_000_000
	expect(claimEmailCooldown('reset', 'kody@kcd.dev', t0)).toBe(true)
	expect(claimEmailCooldown('reset', 'kody@kcd.dev', t0 + 1)).toBe(false)
	// case and whitespace don't get around it
	expect(claimEmailCooldown('reset', ' Kody@KCD.dev ', t0 + 2)).toBe(false)
	expect(
		claimEmailCooldown('reset', 'kody@kcd.dev', t0 + EMAIL_COOLDOWN_MS - 1),
	).toBe(false)
	expect(
		claimEmailCooldown('reset', 'kody@kcd.dev', t0 + EMAIL_COOLDOWN_MS),
	).toBe(true)
})

test('different kinds and recipients are independent', () => {
	const t0 = 2_000_000
	expect(claimEmailCooldown('signup', 'a@example.com', t0)).toBe(true)
	expect(claimEmailCooldown('reset', 'a@example.com', t0)).toBe(true)
	expect(claimEmailCooldown('signup', 'b@example.com', t0)).toBe(true)
	expect(claimEmailCooldown('signup', 'a@example.com', t0)).toBe(false)
})

test('a released cooldown can be claimed again right away', () => {
	const t0 = 3_000_000
	expect(claimEmailCooldown('signup', 'c@example.com', t0)).toBe(true)
	releaseEmailCooldown('signup', 'c@example.com')
	expect(claimEmailCooldown('signup', 'c@example.com', t0)).toBe(true)
})

test('expired entries are pruned once the map grows', () => {
	const t0 = 4_000_000
	for (let i = 0; i < 1000; i++) {
		expect(claimEmailCooldown('prune', `${i}@example.com`, t0)).toBe(true)
	}
	// still within the window: nothing to prune, still refused
	expect(claimEmailCooldown('prune', '0@example.com', t0 + 1)).toBe(false)
	// after the window everything old is dropped and re-claimable
	const later = t0 + EMAIL_COOLDOWN_MS
	expect(claimEmailCooldown('prune', 'new@example.com', later)).toBe(true)
	expect(claimEmailCooldown('prune', '0@example.com', later)).toBe(true)
})
