/**
 * @vitest-environment jsdom
 */
import { render, screen } from '@testing-library/react'
import { createRoutesStub } from 'react-router'
import { expect, test } from 'vitest'
import { loader as rootLoader } from '#app/root.tsx'
import { getSessionExpirationDate, sessionKey } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { authSessionStorage } from '#app/utils/session.server.ts'
import { createUser } from '#tests/db-utils.ts'
import { parseSetCookieHeader } from '#tests/utils.ts'
import { default as SetsRoute, loader } from './index.tsx'

async function renderSetsAs(roles: string[]) {
	const user = await prisma.user.create({
		select: { id: true },
		data: {
			...createUser(),
			roles: { connect: roles.map((name) => ({ name })) },
		},
	})
	const session = await prisma.session.create({
		select: { id: true },
		data: { expirationDate: getSessionExpirationDate(), userId: user.id },
	})
	const authSession = await authSessionStorage.getSession()
	authSession.set(sessionKey, session.id)
	const parsedCookie = parseSetCookieHeader(
		await authSessionStorage.commitSession(authSession),
	)
	const cookieHeader = new URLSearchParams({
		[parsedCookie.name]: parsedCookie.value,
	}).toString()

	const App = createRoutesStub([
		{
			id: 'root',
			path: '/',
			loader: async (args) => {
				args.request.headers.set('cookie', cookieHeader)
				return rootLoader(args)
			},
			HydrateFallback: () => <div>Loading...</div>,
			children: [
				{
					path: 'collection/sets',
					Component: SetsRoute,
					loader: async (args) => {
						args.request.headers.set('cookie', cookieHeader)
						return loader(args)
					},
				},
			],
		},
	])
	render(<App initialEntries={['/collection/sets']} />)
	await screen.findByRole('heading', { level: 1, name: 'Set completion' })
}

test('with no card data, admins are pointed at the sync', async () => {
	await renderSetsAs(['user', 'admin'])
	expect(screen.getByText('No card data yet')).toBeInTheDocument()
	expect(screen.getByRole('link', { name: /sync card data/i })).toHaveAttribute(
		'href',
		'/admin/nrdb-sync',
	)
	expect(screen.queryByRole('combobox', { name: 'Jump to cycle' })).toBeNull()
})

test('with no card data, other users are not offered the sync', async () => {
	await renderSetsAs(['user'])
	expect(screen.getByText('No card data yet')).toBeInTheDocument()
	expect(screen.queryByRole('link', { name: /sync card data/i })).toBeNull()
})
