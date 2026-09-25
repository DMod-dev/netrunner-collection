import { promises as fs } from 'node:fs'
import sharp from 'sharp'
import { expect, test } from 'vitest'
import {
	MAX_PROFILE_IMAGE_DIMENSION,
	MAX_SOURCE_DIMENSION,
	normalizeProfileImage,
	probeImage,
	UnsupportedImageError,
} from './image.server.ts'

const KODY = './tests/fixtures/images/user/kody.png'

test('probeImage reports accepted raster formats', async () => {
	const probed = await probeImage(await fs.readFile(KODY))
	expect(probed).toEqual({ format: 'png', width: 562, height: 562 })
})

test.each([
	['plain text', Buffer.from('this is not an image')],
	['empty', Buffer.alloc(0)],
	[
		'a PNG signature with garbage',
		Buffer.concat([
			Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
			Buffer.alloc(64, 1),
		]),
	],
	[
		'an SVG',
		Buffer.from(
			'<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>',
		),
	],
])('probeImage returns null for %s', async (_label, input) => {
	expect(await probeImage(input)).toBeNull()
})

test('probeImage refuses images larger than the decode cap', async () => {
	// A 1-bit-per-pixel PNG this big is tiny on disk but huge decoded.
	const bomb = await sharp({
		create: {
			width: MAX_SOURCE_DIMENSION + 1,
			height: 8,
			channels: 3,
			background: 'white',
		},
	})
		.png()
		.toBuffer()
	expect(await probeImage(bomb)).toBeNull()
})

test('normalizeProfileImage re-encodes to a bounded WebP', async () => {
	const big = await sharp({
		create: {
			width: 3000,
			height: 1500,
			channels: 3,
			background: 'rebeccapurple',
		},
	})
		.jpeg()
		.withMetadata({ exif: { IFD0: { Copyright: 'strip me' } } })
		.toBuffer()

	const output = await normalizeProfileImage(big)
	const metadata = await sharp(output).metadata()
	expect(metadata.format).toBe('webp')
	expect(metadata.width).toBe(MAX_PROFILE_IMAGE_DIMENSION)
	expect(metadata.height).toBe(MAX_PROFILE_IMAGE_DIMENSION / 2)
	expect(metadata.exif).toBeUndefined()
})

test('normalizeProfileImage keeps small images at their size', async () => {
	const output = await normalizeProfileImage(await fs.readFile(KODY))
	const metadata = await sharp(output).metadata()
	expect(metadata.format).toBe('webp')
	expect(metadata.width).toBe(562)
	expect(metadata.height).toBe(562)
})

test('normalizeProfileImage rejects non-images with a user-facing error', async () => {
	await expect(
		normalizeProfileImage(Buffer.from('definitely not an image')),
	).rejects.toBeInstanceOf(UnsupportedImageError)
})
