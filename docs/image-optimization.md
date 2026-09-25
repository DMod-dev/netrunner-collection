# Image Optimization

Images are resized on demand by
[/resources/images](../app/routes/resources/images.tsx). The route originally
came from the Epic Stack's openimg integration (see
[this decision doc](./decisions/041-image-optimization.md)); the server half was
rewritten on top of `sharp` directly so that a bad input can never crash the
process or fill the disk. The client half still uses `openimg/react`.

## Server Part

The endpoint accepts either `objectKey` (a profile photo in object storage) or
`src` (a static file), plus `w`, `h`, `fit` and `format`. It is reachable
without logging in, so it is deliberately strict:

- `objectKey` must match the exact shape `uploadProfileImage` produces
  (`users/<id>/profile-images/<name>.<ext>`); `src` must be a file under
  `public/img` or `public/favicons`. Anything else, including absolute URLs and
  `..` segments, is a 400 before any I/O happens.
- `w` and `h` are snapped up to the next of a fixed set of sizes (64 … 1024),
  which bounds both the work per request and the number of cache files a source
  can produce. Larger values are a 400.
- The source is probed with `sharp` metadata before decoding; non-images and
  images larger than 4096×4096 are a 415, never an exception.
- Results are written atomically to `/data/images` in production (the LiteFS
  volume) or `tests/fixtures/image-cache` locally, and served with a one-year
  immutable cache header. Object keys include a timestamp, so a new photo is a
  new URL.
- The route has its own rate-limit bucket in `server/index.ts`.

Profile photos are also normalised on upload
([photo.tsx](../app/routes/settings/profile/photo.tsx) →
[image.server.ts](../app/utils/image.server.ts)): re-encoded to WebP with
metadata stripped and at most 1024×1024, so storage only ever contains images we
know we can decode again.

## Client Part

On the client side, the `Img` React component from openimg/react is used to
query the [/resources/images](../app/routes/resources/images.tsx) endpoint with
the appropriate query parameters, including the source image string. The
component renders a picture element that requests modern formats and sets
attributes such as `fetchpriority`, `loading`, and `decoding` to optimize image
loading. It also computes `srcset` and `sizes` based on the provided `width` and
`height` props (the breakpoints it uses are all in the server's size list). Use
the `isAboveFold` prop on the `Img` component to prioritize images that should
load immediately.

## Image Sources

Card art is not proxied; it is loaded straight from NetrunnerDB's image CDN. If
you need to serve a new kind of image through the proxy, extend the allowlists
at the top of [/resources/images](../app/routes/resources/images.tsx) rather
than loosening them, and add a case to the unit tests next to it.
