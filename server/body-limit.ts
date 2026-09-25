import { type RequestHandler } from 'express'

/**
 * The largest request body any route accepts. Collection imports are capped
 * at 2 MB and profile photos at 3 MB by their own routes, but those checks
 * run after `request.formData()` has already buffered the whole body, so
 * without a cap here a handful of concurrent large POSTs could exhaust the
 * 512 MB machine before any route code runs.
 */
export const MAX_BODY_BYTES = 5 * 1024 * 1024

/**
 * Reject request bodies larger than `maxBytes` before any route reads them.
 *
 * - A `Content-Length` over the limit gets a 413 right away; the body is never
 *   read and the connection is closed so the client stops sending.
 * - A chunked body (no `Content-Length`) is metered as it arrives on the
 *   socket and the connection is destroyed once it passes the limit. There is
 *   no response in that case: the route is already consuming the body, and a
 *   torn-down socket is the one thing a lying client can't talk its way past.
 *   The meter is a socket-level observer, so the route can see up to a couple
 *   of socket reads (64 KiB each) beyond the limit before the cut-off lands.
 */
export function createBodyLimit({
	maxBytes = MAX_BODY_BYTES,
}: { maxBytes?: number } = {}): RequestHandler {
	return (req, res, next) => {
		const declared = req.get('content-length')
		if (declared !== undefined) {
			// Node's parser has already rejected a malformed Content-Length by
			// the time we get here, so this is a plain number.
			if (Number(declared) > maxBytes) {
				res
					.status(413)
					.set('Connection', 'close')
					.type('text/plain')
					.send('Payload Too Large')
				return
			}
			return next()
		}

		// No Content-Length: either no body at all or a chunked one. The HTTP
		// parser already has the socket flowing, so a second 'data' listener
		// observes bytes without consuming them or changing the stream's mode.
		const socket = req.socket
		const start = socket.bytesRead
		const cleanup = () => {
			socket.off('data', onData)
		}
		const onData = () => {
			if (socket.bytesRead - start > maxBytes) {
				cleanup()
				req.destroy()
			}
		}
		socket.on('data', onData)
		req.once('end', cleanup)
		req.once('close', cleanup)
		res.once('close', cleanup)
		next()
	}
}
