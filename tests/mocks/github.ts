import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { faker } from '@faker-js/faker'
import fsExtra from 'fs-extra'
import { HttpResponse, passthrough, http, type HttpHandler } from 'msw'
import { USERNAME_MAX_LENGTH } from '#app/utils/user-validation.ts'

const { json } = HttpResponse

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const here = (...s: Array<string>) => path.join(__dirname, ...s)

// One file per user. The server and every Playwright worker read and write
// these at the same time; with a single shared JSON file, concurrent
// read-modify-writes lost users and readers saw half-written files.
const githubUserFixtureDir = here(
	'..',
	'fixtures',
	'github',
	`users.${process.env.VITEST_POOL_ID || 0}.local`,
)
const githubUserFile = (code: string) =>
	path.join(githubUserFixtureDir, `${encodeURIComponent(code)}.json`)

await fsExtra.ensureDir(githubUserFixtureDir)
await migrateLegacyUserFile()

function createGitHubUser(code?: string | null) {
	const createEmail = () => ({
		email: faker.internet.email(),
		verified: faker.datatype.boolean(),
		primary: false, // <-- can only have one of these
		visibility: faker.helpers.arrayElement(['public', null]),
	})
	const primaryEmail = {
		...createEmail(),
		verified: true,
		primary: true,
	}

	const emails = [
		{
			email: faker.internet.email(),
			verified: false,
			primary: false,
			visibility: 'public',
		},
		{
			email: faker.internet.email(),
			verified: true,
			primary: false,
			visibility: null,
		},
		primaryEmail,
	]

	code ??= faker.string.uuid()
	return {
		code,
		accessToken: `${code}_mock_access_token`,
		profile: {
			login: faker.internet.username().slice(0, USERNAME_MAX_LENGTH),
			id: faker.number.int(),
			name: faker.person.fullName(),
			avatar_url: 'https://github.com/ghost.png',
			emails: emails.map((e) => e.email),
		},
		emails,
		primaryEmail: primaryEmail.email,
	}
}

export type GitHubUser = ReturnType<typeof createGitHubUser>

async function getGitHubUsers() {
	let files: Array<string>
	try {
		files = await fsExtra.readdir(githubUserFixtureDir)
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.error(error)
		return []
	}
	const users = await Promise.all(
		files
			.filter((file) => file.endsWith('.json'))
			// another process may delete a user between readdir and read
			.map((file) =>
				fsExtra
					.readJson(path.join(githubUserFixtureDir, file))
					.catch(() => null),
			),
	)
	return users.filter(Boolean) as Array<GitHubUser>
}

export async function deleteGitHubUser(primaryEmail: string) {
	const users = await getGitHubUsers()
	const user = users.find((u) => u.primaryEmail === primaryEmail)
	if (!user) return null
	await fsExtra.remove(githubUserFile(user.code))
	return user
}

export async function deleteGitHubUsers() {
	await fsExtra.remove(githubUserFixtureDir)
}

async function setGitHubUser(user: GitHubUser) {
	await fsExtra.ensureDir(githubUserFixtureDir)
	// write then rename so readers never see a partial file
	const file = githubUserFile(user.code)
	const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
	await fsExtra.writeJson(tmp, user, { spaces: 2 })
	await fsExtra.rename(tmp, file)
}

export async function insertGitHubUser(code?: string | null) {
	// a user with the same code is replaced, like the old shared file did
	const user = createGitHubUser(code)
	await setGitHubUser(user)
	return user
}

// Users used to share `users.<id>.local.json`. Carry them over (the seeded
// kody account among them) so mocked GitHub logins keep working without a
// reseed.
async function migrateLegacyUserFile() {
	const legacyFile = `${githubUserFixtureDir}.json`
	try {
		const users = (await fsExtra.readJson(legacyFile)) as Array<GitHubUser>
		await Promise.all(users.map((user) => setGitHubUser(user)))
		await fsExtra.remove(legacyFile)
	} catch {
		// no legacy file, or another process is already migrating it
	}
}

async function getUser(request: Request) {
	const accessToken = request.headers
		.get('authorization')
		?.slice('Bearer '.length)

	if (!accessToken) {
		return new Response('Unauthorized', { status: 401 })
	}
	const user = (await getGitHubUsers()).find(
		(u) => u.accessToken === accessToken,
	)

	if (!user) {
		return new Response('Not Found', { status: 404 })
	}
	return user
}

const passthroughGitHub =
	!process.env.GITHUB_CLIENT_ID?.startsWith('MOCK_') &&
	process.env.NODE_ENV !== 'test'

export const handlers: Array<HttpHandler> = [
	http.post(
		'https://github.com/login/oauth/access_token',
		async ({ request }) => {
			if (passthroughGitHub) return passthrough()
			const params = new URLSearchParams(await request.text())

			const code = params.get('code')
			const githubUsers = await getGitHubUsers()
			let user = githubUsers.find((u) => u.code === code)
			if (!user) {
				user = await insertGitHubUser(code)
			}

			return json(
				{
					access_token: user.accessToken,
					token_type: '__MOCK_TOKEN_TYPE__',
				},
				{ headers: { 'content-type': 'application/x-www-form-urlencoded' } },
			)
		},
	),
	http.get('https://api.github.com/user/emails', async ({ request }) => {
		if (passthroughGitHub) return passthrough()

		const user = await getUser(request)
		if (user instanceof Response) return user

		return json(user.emails)
	}),
	http.get('https://api.github.com/user/:id', async ({ params }) => {
		if (passthroughGitHub) return passthrough()

		const mockUser = (await getGitHubUsers()).find(
			(u) => u.profile.id === Number(params.id),
		)
		if (mockUser) return json(mockUser.profile)

		return new Response('Not Found', { status: 404 })
	}),
	http.get('https://api.github.com/user', async ({ request }) => {
		if (passthroughGitHub) return passthrough()

		const user = await getUser(request)
		if (user instanceof Response) return user

		return json(user.profile)
	}),
	http.get('https://github.com/ghost.png', async () => {
		if (passthroughGitHub) return passthrough()

		const buffer = await fsExtra.readFile('./tests/fixtures/github/ghost.jpg')
		return new Response(buffer, {
			// the .png is not a mistake even though it looks like it... It's really a jpg
			// but the ghost image URL really has a png extension 😅
			headers: { 'content-type': 'image/jpg' },
		})
	}),
]
