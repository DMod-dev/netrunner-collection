import { promises as fs } from 'node:fs'
import path from 'node:path'
import { type AppLoadContext } from 'react-router'
import sharp from 'sharp'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { BASE_URL } from '#tests/utils.ts'
import { type Route } from './+types/images.ts'
import { loader } from './images.tsx'

const ROUTE_PATH = '/resources/images'
const KODY = './tests/fixtures/images/user/kody.png'

// The tigris mock serves GET requests from tests/fixtures/uploaded/<key>.
const UPLOADED_DIR = path.join(
	'tests/fixtures/uploaded',
	'users/imgtest/profile-images',
)
const GOOD_KEY = 'users/imgtest/profile-images/1-good.png'
const BAD_KEY = 'users/imgtest/profile-images/2-bad.png'
const LEGACY_KEY = 'users/imgtest/profile-images/3-legacy.downloaded-file'

beforeAll(async () => {
	await fs.mkdir(UPLOADED_DIR, { recursive: true })
	await fs.copyFile(KODY, path.join(UPLOADED_DIR, '1-good.png'))
	await fs.writeFile(
		path.join(UPLOADED_DIR, '2-bad.png'),
		'not an image at all',
	)
	await fs.copyFile(KODY, path.join(UPLOADED_DIR, '3-legacy.downloaded-file'))
})

afterAll(async () => {
	await fs.rm(path.dirname(UPLOADED_DIR), { recursive: true, force: true })
})

function run(query: string) {
	const url = new URL(`${ROUTE_PATH}?${query}`, BASE_URL)
	return loader({
		request: new Request(url),
		params: {},
		context: {} as AppLoadContext,
		url,
		pattern: ROUTE_PATH,
	} satisfies Route.LoaderArgs)
}

async function decode(response: Response) {
	return sharp(Buffer.from(await response.arrayBuffer())).metadata()
}

test.each([
	['a non-image public file', 'src=/favicon.ico'],
	['a manifest', 'src=/site.webmanifest'],
	['path traversal', 'src=/../package.json'],
	['traversal inside an allowed folder', 'src=/img/../../package.json'],
	['an absolute URL', 'src=https://example.com/x.png'],
	['a protocol-relative URL', 'src=//example.com/x.png'],
	['a source outside public', 'src=/assets/anything.png'],
	['an object key with traversal', 'objectKey=../../etc/passwd'],
	[
		'an object key with traversal in the file part',
		'objectKey=users/x/profile-images/../../../etc/passwd',
	],
	['an object key for another prefix', 'objectKey=users/x/exports/file.png'],
	['no source at all', 'w=256'],
	['an oversized width', 'src=/img/user.png&w=12000&h=12000'],
	['a zero width', 'src=/img/user.png&w=0'],
	['a non-numeric width', 'src=/img/user.png&w=abc'],
	['a negative height', 'src=/img/user.png&h=-1'],
	['an unknown fit', 'src=/img/user.png&fit=stretch'],
	['an unknown format', 'src=/img/user.png&format=bmp'],
])('rejects %s with 400', async (_label, query) => {
	const response = await run(query)
	expect(response.status).toBe(400)
})

test('404s for a missing but allowlisted static file', async () => {
	const response = await run('src=/img/does-not-exist.png')
	expect(response.status).toBe(404)
})

test('resizes an allowlisted static image', async () => {
	const response = await run('src=/img/user.png&w=256&h=256')
	expect(response.status).toBe(200)
	expect(response.headers.get('Content-Type')).toBe('image/png')
	expect(response.headers.get('Cache-Control')).toContain('immutable')
	const metadata = await decode(response)
	expect(metadata).toMatchObject({ format: 'png', width: 256, height: 256 })
})

test('snaps sizes up to the next allowed size and converts formats', async () => {
	const response = await run('src=/img/user.png&w=200&h=200&format=webp')
	expect(response.status).toBe(200)
	expect(response.headers.get('Content-Type')).toBe('image/webp')
	const metadata = await decode(response)
	expect(metadata).toMatchObject({ format: 'webp', width: 256, height: 256 })
})

test('serves the same image from cache on the second request', async () => {
	const first = await run('src=/img/user.png&w=64&h=64&format=jpeg')
	const second = await run('src=/img/user.png&w=64&h=64&format=jpeg')
	expect(first.status).toBe(200)
	expect(second.status).toBe(200)
	expect(Buffer.from(await second.arrayBuffer())).toEqual(
		Buffer.from(await first.arrayBuffer()),
	)
})

test('serves a profile photo by objectKey', async () => {
	const response = await run(
		`objectKey=${encodeURIComponent(GOOD_KEY)}&w=128&h=128`,
	)
	expect(response.status).toBe(200)
	const metadata = await decode(response)
	expect(metadata).toMatchObject({ width: 128, height: 128 })
})

test('serves a legacy GitHub-imported avatar key', async () => {
	const response = await run(
		`objectKey=${encodeURIComponent(LEGACY_KEY)}&w=64&h=64`,
	)
	expect(response.status).toBe(200)
	const metadata = await decode(response)
	expect(metadata).toMatchObject({ width: 64, height: 64 })
})

test('answers 415 (and stays alive) for a stored non-image', async () => {
	const response = await run(`objectKey=${encodeURIComponent(BAD_KEY)}&w=128`)
	expect(response.status).toBe(415)
	// and the process is still here to serve the next request
	const next = await run('src=/img/user.png&w=64')
	expect(next.status).toBe(200)
})

test('404s for an object that does not exist', async () => {
	const response = await run(
		'objectKey=users/imgtest/profile-images/3-missing.png',
	)
	expect(response.status).toBe(404)
})
