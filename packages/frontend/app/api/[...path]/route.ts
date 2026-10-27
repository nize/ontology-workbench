// Same-origin proxy to the backend. The browser only ever talks to the
// frontend, so the backend needs no published port, no hostname and no CORS.
// BACKEND_URL is read per request on the server — unlike NEXT_PUBLIC_* values,
// which are inlined at build time — so one image works in every environment.
export const dynamic = "force-dynamic"

const BACKEND_URL = () => (process.env.BACKEND_URL || "http://localhost:4000").replace(/\/$/, "")

async function proxy(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params
  const { search } = new URL(request.url)
  const target = `${BACKEND_URL()}/${path.map(encodeURIComponent).join("/")}${search}`
  const headers = new Headers(request.headers)
  headers.delete("host")

  try {
    const upstream = await fetch(target, {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer(),
      cache: "no-store",
    })
    // fetch() has already decompressed the body, so the upstream encoding and
    // length no longer describe what is being sent on.
    const responseHeaders = new Headers(upstream.headers)
    responseHeaders.delete("content-encoding")
    responseHeaders.delete("content-length")
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders })
  } catch {
    return Response.json({ message: "Backend unreachable" }, { status: 502 })
  }
}

export { proxy as GET, proxy as POST, proxy as PUT, proxy as PATCH, proxy as DELETE }
