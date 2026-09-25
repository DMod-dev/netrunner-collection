import { createHash } from 'node:crypto'
import { createReadStream, promises as fs, constants } from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import sharp from 'sharp'
import { MAX_SOURCE_PIXELS, probeImage } from '#app/utils/image.server.ts'
import { getSignedGetRequestInfo } from '#app/utils/storage.server.ts'
import { type Route } from './+types/images'

/**
 * On-demand image resizing for profile photos and a few static assets.
 *
 * This route is reachable without logging in, so it is written to be boring:
 * every input is matched against an allowlist before anything touches disk or
 * the network, the source is probed with sharp before it is decoded, and every
 * failure becomes an HTTP response. It must never throw, because an uncaught
 * error here shuts the server down.
 */

/** Widths/heights we will produce; requests are snapped up to the next one. */
const SIZES = [64, 128, 256, 512, 640, 768, 832, 1024] as const
const MAX_SIZE: number = Math.max(...SIZES)

const FITS = ['cover', 'contain'] as const
type Fit = (typeof FITS)[number]

const OUTPUT_FORMATS = {
	webp: 'image/webp',
	avif: 'image/avif',
	png: 'image/png',
	jpeg: 'image/jpeg',
	gif: 'image/gif',
} as const
type OutputFormat = keyof typeof OUTPUT_FORMATS

/**
 * The key shape `uploadProfileImage` produces. The file part is loose on
 * purpose: avatars imported from GitHub at signup used to be stored as
 * `<timestamp>-<id>.downloaded-file`, and the bytes are probed before decoding
 * regardless of the name.
 */
const OBJECT_KEY_RE = /^users\/[a-z0-9]{1,64}\/profile-images\/[\w.-]{1,160}$/
/** The only static files the proxy will read from `public/`. */
const STATIC_SRC_RE = /^\/(img|favicons)\/[\w-]{1,64}\.(png|jpe?g|webp|avif)$/

/** Profile photos are capped at 3 MB on upload; nothing legitimate is bigger. */
const MAX_SOURCE_BYTES = 3 * 1024 * 1024

type ImgParams = {
	width?: number
	height?: number
	fit?: Fit
	format?: OutputFormat
}

type ImgSource =
	| { kind: 'avatar'; objectKey: string }
	| { kind: 'static'; src: string }

let cacheDir: string | null = null

async function getCacheDir() {
	if (cacheDir) return cacheDir

	let dir = './tests/fixtures/image-cache'
	if (process.env.NODE_ENV === 'production') {
		const isAccessible = await fs
			.access('/data', constants.W_OK)
			.then(() => true)
			.catch(() => false)

		if (isAccessible) {
			dir = '/data/images'
		}
	}
	await fs.mkdir(dir, { recursive: true })

	return (cacheDir = dir)
}

function badRequest(message: string) {
	return new Response(message, {
		status: 400,
		headers: { 'Content-Type': 'text/plain' },
	})
}

function parseSize(raw: string | null, name: string) {
	if (raw === null || raw === '') return { value: undefined }
	if (!/^\d{1,5}$/.test(raw)) {
		return { error: `Search param "${name}" must be a positive integer` }
	}
	const requested = Number(raw)
	if (requested < 1 || requested > MAX_SIZE) {
		return { error: `Search param "${name}" must be between 1 and ${MAX_SIZE}` }
	}
	const value = SIZES.find((size) => size >= requested) ?? MAX_SIZE
	return { value }
}

function parseParams(searchParams: URLSearchParams) {
	const width = parseSize(searchParams.get('w'), 'w')
	if (width.error) return badRequest(width.error)
	const height = parseSize(searchParams.get('h'), 'h')
	if (height.error) return badRequest(height.error)

	const rawFit = searchParams.get('fit')
	const fit = rawFit ? (rawFit as Fit) : undefined
	if (fit && !FITS.includes(fit)) {
		return badRequest(`Search param "fit" must be one of ${FITS.join(', ')}`)
	}

	const rawFormat = searchParams.get('format')
	const format = rawFormat
		? ((rawFormat === 'jpg' ? 'jpeg' : rawFormat) as OutputFormat)
		: undefined
	if (format && !(format in OUTPUT_FORMATS)) {
		return badRequest(
			`Search param "format" must be one of ${Object.keys(OUTPUT_FORMATS).join(', ')}`,
		)
	}

	return {
		width: width.value,
		height: height.value,
		fit,
		format,
	} satisfies ImgParams
}

function parseSource(searchParams: URLSearchParams): ImgSource | Response {
	const objectKey = searchParams.get('objectKey')
	if (objectKey !== null) {
		if (!OBJECT_KEY_RE.test(objectKey)) return badRequest('Unknown objectKey')
		return { kind: 'avatar', objectKey }
	}
	const src = searchParams.get('src')
	if (src === null)
		return badRequest('src or objectKey query parameter is required')
	if (!STATIC_SRC_RE.test(src)) return badRequest('Unknown src')
	return { kind: 'static', src }
}

function getCachePath(dir: string, source: ImgSource, params: ImgParams) {
	const key = [
		source.kind,
		source.kind === 'avatar' ? source.objectKey : source.src,
		params.width ?? '',
		params.height ?? '',
		params.fit ?? '',
		params.format ?? '',
	].join('|')
	const hash = createHash('sha256').update(key).digest('hex')
	// The extension is resolved on write; we only know the output format after
	// sharp has run, so the cache is looked up by prefix.
	return path.join(dir, hash)
}

async function findCached(cachePathPrefix: string) {
	const dir = path.dirname(cachePathPrefix)
	const base = path.basename(cachePathPrefix)
	for (const format of Object.keys(OUTPUT_FORMATS) as Array<OutputFormat>) {
		const candidate = path.join(dir, `${base}.${format}`)
		const stat = await fs.stat(candidate).catch(() => null)
		if (stat?.isFile() && stat.size > 0)
			return { path: candidate, format, size: stat.size }
	}
	return null
}

async function readSource(source: ImgSource): Promise<Buffer | Response> {
	if (source.kind === 'static') {
		const filePath = path.join(process.cwd(), 'public', source.src)
		try {
			return await fs.readFile(filePath)
		} catch {
			return new Response('Image not found', { status: 404 })
		}
	}

	const { url, headers } = getSignedGetRequestInfo(source.objectKey)
	const response = await fetch(url, { headers }).catch(() => null)
	if (!response || !response.ok || !response.body) {
		return new Response('Image not found', { status: 404 })
	}
	const declaredLength = Number(response.headers.get('content-length') ?? 0)
	if (declaredLength > MAX_SOURCE_BYTES) {
		return new Response('Image too large', { status: 413 })
	}
	const bytes = Buffer.from(await response.arrayBuffer())
	if (bytes.byteLength > MAX_SOURCE_BYTES) {
		return new Response('Image too large', { status: 413 })
	}
	return bytes
}

function fileResponse(
	filePath: string,
	contentType: string,
	size: number,
	headers: Headers,
) {
	headers.set('Content-Type', contentType)
	headers.set('Content-Length', String(size))
	const stream = createReadStream(filePath)
	return new Response(Readable.toWeb(stream) as ReadableStream, { headers })
}

export async function loader({ request }: Route.LoaderArgs) {
	const searchParams = new URL(request.url).searchParams

	const params = parseParams(searchParams)
	if (params instanceof Response) return params
	const source = parseSource(searchParams)
	if (source instanceof Response) return source

	const headers = new Headers()
	headers.set('Cache-Control', 'public, max-age=31536000, immutable')

	const dir = await getCacheDir()
	const cachePathPrefix = getCachePath(dir, source, params)
	const cached = await findCached(cachePathPrefix)
	if (cached) {
		return fileResponse(
			cached.path,
			OUTPUT_FORMATS[cached.format],
			cached.size,
			headers,
		)
	}

	const input = await readSource(source)
	if (input instanceof Response) return input

	const probed = await probeImage(input)
	if (!probed) {
		return new Response('Unsupported image', { status: 415 })
	}

	try {
		let pipeline = sharp(input, {
			limitInputPixels: MAX_SOURCE_PIXELS,
		}).rotate()
		if (params.width || params.height) {
			pipeline = pipeline.resize({
				width: params.width,
				height: params.height,
				fit: params.fit ?? 'cover',
			})
		}
		const outputFormat: OutputFormat = params.format ?? probed.format
		pipeline = pipeline.toFormat(outputFormat)
		const output = await pipeline.toBuffer()

		const finalPath = `${cachePathPrefix}.${outputFormat}`
		const tmpPath = `${finalPath}.${process.pid}-${Date.now()}.tmp`
		await fs.writeFile(tmpPath, output)
		await fs.rename(tmpPath, finalPath)

		return fileResponse(
			finalPath,
			OUTPUT_FORMATS[outputFormat],
			output.byteLength,
			headers,
		)
	} catch (error) {
		console.error('image processing failed', {
			source,
			params,
			error: error instanceof Error ? error.message : error,
		})
		return new Response('Image processing failed', { status: 500 })
	}
}
