import { createServer } from 'node:http'
import { type AddressInfo, connect } from 'node:net'
import express from 'express'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { createBodyLimit } from './body-limit.ts'

const LIMIT = 4096

const app = express()
app.use(createBodyLimit({ maxBytes: LIMIT }))
// Mirrors what the app does: read the whole body, then respond.
let handlerCalls = 0
let lastReceived = 0
app.post('/echo', (req, res) => {
	handlerCalls++
	let received = 0
	req.on('data', (chunk: Buffer) => {
		received += chunk.length
		lastReceived = received
	})
	req.on('end', () => res.json({ received }))
})

const server = createServer(app)
let port = 0

beforeAll(async () => {
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
	port = (server.address() as AddressInfo).port
})

afterAll(async () => {
	server.closeAllConnections()
	await new Promise<void>((resolve, reject) =>
		server.close((e) => (e ? reject(e) : resolve())),
	)
})

/**
 * Talk HTTP over a raw socket (MSW intercepts fetch and http.request in the
 * test environment, and we need control over framing anyway). `writeBody` is
 * given the socket and resolves when it has written everything it could.
 */
async function rawRequest(
	headers: string,
	writeBody: (socket: ReturnType<typeof connect>) => Promise<void>,
) {
	const socket = connect(port, '127.0.0.1')
	await new Promise<void>((resolve) => socket.once('connect', resolve))
	socket.on('error', () => {}) // ECONNRESET/EPIPE are expected in some cases
	let response = ''
	socket.setEncoding('utf8')
	socket.on('data', (chunk: string) => (response += chunk))
	const closed = new Promise<void>((resolve) => socket.once('close', resolve))
	socket.write(`${headers}\r\n`)
	await writeBody(socket)
	await closed
	const [head = '', body = ''] = response.split('\r\n\r\n')
	const status = Number(head.split(' ')[1])
	return {
		status,
		head,
		body: body.replace(/^[0-9a-f]+\r\n|\r\n0\r\n\r\n$/g, ''),
	}
}

function contentLengthRequest(length: number) {
	return `POST /echo HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nContent-Type: application/octet-stream\r\nContent-Length: ${length}\r\n`
}

const CHUNKED_REQUEST =
	'POST /echo HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nContent-Type: application/octet-stream\r\nTransfer-Encoding: chunked\r\n'

function chunk(size: number) {
	return `${size.toString(16)}\r\n${'x'.repeat(size)}\r\n`
}

/** Write `total` bytes in chunks; stops early if the server hangs up. */
async function writeChunked(socket: ReturnType<typeof connect>, total: number) {
	const size = 256
	let sent = 0
	while (sent < total && !socket.destroyed && socket.writable) {
		const n = Math.min(size, total - sent)
		await new Promise<void>((resolve) =>
			socket.write(chunk(n), () => resolve()),
		)
		sent += n
	}
	if (!socket.destroyed && socket.writable) socket.write('0\r\n\r\n')
	return sent
}

test('a body within the limit passes through untouched', async () => {
	const calls = handlerCalls
	const { status, body } = await rawRequest(
		contentLengthRequest(LIMIT),
		async (socket) => {
			socket.write('x'.repeat(LIMIT))
		},
	)
	expect(status).toBe(200)
	expect(JSON.parse(body)).toEqual({ received: LIMIT })
	expect(handlerCalls).toBe(calls + 1)
})

test('a Content-Length over the limit is a 413 before the route runs', async () => {
	const calls = handlerCalls
	const { status, head, body } = await rawRequest(
		contentLengthRequest(LIMIT + 1),
		async (socket) => {
			// keep sending; the server should answer without waiting for it
			socket.write('x'.repeat(LIMIT + 1))
		},
	)
	expect(status).toBe(413)
	expect(head).toMatch(/connection: close/i)
	expect(body).toBe('Payload Too Large')
	expect(handlerCalls).toBe(calls)
})

test('a chunked body within the limit passes through', async () => {
	const total = LIMIT - 512
	const { status, body } = await rawRequest(CHUNKED_REQUEST, async (socket) => {
		await writeChunked(socket, total)
	})
	expect(status).toBe(200)
	expect(JSON.parse(body)).toEqual({ received: total })
})

test('a chunked body over the limit is cut off', async () => {
	// Far more than the loopback socket buffers will absorb before the server
	// hangs up, so the client sees the reset.
	const total = LIMIT * 1024
	const { status, body } = await rawRequest(CHUNKED_REQUEST, async (socket) => {
		await writeChunked(socket, total)
	})
	expect(body).toBe('')
	expect(Number.isNaN(status)).toBe(true) // no response at all
	// the route never saw more than the limit plus a couple of socket reads
	// (64 KiB each): the read that carried the headers is already counted
	// before the middleware runs, and the parser hands each read to the route
	// before the meter sees it.
	expect(lastReceived).toBeLessThan(LIMIT + 3 * 64 * 1024)

	// and the server is still fine afterwards
	const next = await rawRequest(contentLengthRequest(10), async (socket) => {
		socket.write('x'.repeat(10))
	})
	expect(JSON.parse(next.body)).toEqual({ received: 10 })
})

test('requests without a body are unaffected', async () => {
	const { status } = await rawRequest(
		'GET /missing HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n',
		async () => {},
	)
	expect(status).toBe(404)
})
