import sharp from 'sharp'

/**
 * Shared image handling for uploads and the image proxy. Everything here is
 * defensive: a bad input must become a thrown `UnsupportedImageError` (or a
 * `null`), never an uncaught stream error, because `close-with-grace` turns
 * uncaught errors into a server shutdown.
 */

/** Raster formats we accept as input anywhere (uploads and the proxy). */
export const ACCEPTED_INPUT_FORMATS = [
	'png',
	'jpeg',
	'webp',
	'gif',
	'avif',
] as const
export type AcceptedInputFormat = (typeof ACCEPTED_INPUT_FORMATS)[number]

/** Hard cap on decoded size so a small compressed bomb can't eat the machine. */
export const MAX_SOURCE_DIMENSION = 4096
export const MAX_SOURCE_PIXELS = MAX_SOURCE_DIMENSION * MAX_SOURCE_DIMENSION

/** Profile photos are re-encoded to at most this on upload. */
export const MAX_PROFILE_IMAGE_DIMENSION = 1024

export class UnsupportedImageError extends Error {
	name = 'UnsupportedImageError'
}

export type ProbedImage = {
	format: AcceptedInputFormat
	width: number
	height: number
}

/**
 * Reads only the header. Returns `null` for anything that is not one of the
 * accepted raster formats or is larger than we are willing to decode.
 */
export async function probeImage(input: Buffer): Promise<ProbedImage | null> {
	let metadata: sharp.Metadata
	try {
		metadata = await sharp(input, {
			limitInputPixels: MAX_SOURCE_PIXELS,
		}).metadata()
	} catch {
		return null
	}
	const format = metadata.format
	if (!format || !isAcceptedFormat(format)) return null
	const { width, height } = metadata
	if (!width || !height) return null
	if (width > MAX_SOURCE_DIMENSION || height > MAX_SOURCE_DIMENSION) {
		return null
	}
	return { format, width, height }
}

function isAcceptedFormat(format: string): format is AcceptedInputFormat {
	return (ACCEPTED_INPUT_FORMATS as readonly string[]).includes(format)
}

/**
 * Turns whatever a user uploaded into a well-formed WebP: rotated according to
 * EXIF, metadata stripped, no larger than MAX_PROFILE_IMAGE_DIMENSION on either
 * side. Throws `UnsupportedImageError` for non-images and oversized inputs, so
 * storage only ever holds images we know sharp can decode again.
 */
export async function normalizeProfileImage(input: Buffer): Promise<Buffer> {
	const probed = await probeImage(input)
	if (!probed) {
		throw new UnsupportedImageError(
			`Please choose a PNG, JPEG, WebP, GIF or AVIF image no larger than ${MAX_SOURCE_DIMENSION}×${MAX_SOURCE_DIMENSION}`,
		)
	}
	try {
		return await sharp(input, { limitInputPixels: MAX_SOURCE_PIXELS })
			.rotate()
			.resize({
				width: MAX_PROFILE_IMAGE_DIMENSION,
				height: MAX_PROFILE_IMAGE_DIMENSION,
				fit: 'inside',
				withoutEnlargement: true,
			})
			.webp({ quality: 85 })
			.toBuffer()
	} catch {
		throw new UnsupportedImageError(
			'That image could not be processed. Please try a different file.',
		)
	}
}
