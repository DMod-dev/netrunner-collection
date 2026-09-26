import { expect, test } from 'vitest'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { createUser } from '#tests/db-utils.ts'
import { getSessionCookieHeader } from '#tests/utils.ts'
import { loader } from './nrdb-sync.tsx'

test('admins see the ban or points list in force for each format', async () => {
	const admin = await prisma.user.create({
		select: { id: true },
		data: { ...createUser(), roles: { connect: { name: 'admin' } } },
	})
	const session = await prisma.session.create({
		select: { id: true },
		data: { expirationDate: getSessionExpirationDate(), userId: admin.id },
	})
	await prisma.format.create({
		data: {
			id: 'standard',
			name: 'Standard',
			activeRestrictionId: 'standard_ban_list_26_03',
			restrictions: {
				create: {
					id: 'standard_ban_list_26_03',
					name: 'Standard Ban List 26.03',
					verdicts: {
						create: [
							{ cardId: 'a', verdict: 'banned' },
							{ cardId: 'b', verdict: 'banned' },
						],
					},
				},
			},
		},
	})
	await prisma.format.create({ data: { id: 'startup', name: 'Startup' } })

	const request = new Request('http://localhost/admin/nrdb-sync', {
		headers: { cookie: await getSessionCookieHeader(session) },
	})
	const data = await loader({ request } as Parameters<typeof loader>[0])

	expect(data.counts).toMatchObject({ formats: 2, restrictions: 1 })
	expect(data.formatLists).toEqual([
		{
			id: 'standard',
			name: 'Standard',
			restriction: { name: 'Standard Ban List 26.03', verdicts: 2 },
		},
		{ id: 'startup', name: 'Startup', restriction: null },
		{ id: 'eternal', name: 'Eternal', restriction: null },
	])
})
