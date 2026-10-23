// H1 : refuse en 413 un POST /api/* dont le corps dépasse BODY_MAX_BYTES, d'après content-length,
// ou envoyé en chunked sans content-length (taille inconnue). Rien n'est lu du corps avant ce refus.
export default defineEventHandler((event) => {
  if (event.method !== 'POST' || !event.path.startsWith('/api/')) return

  const contentLength = getRequestHeader(event, 'content-length')
  if (contentLength === undefined) {
    const transferEncoding = getRequestHeader(event, 'transfer-encoding') ?? ''
    if (transferEncoding.toLowerCase().includes('chunked')) {
      throw createError({ statusCode: 413, message: 'Corps de requête sans content-length refusé' })
    }
    return
  }
  const length = Number(contentLength)
  if (!Number.isFinite(length) || length > BODY_MAX_BYTES) {
    throw createError({ statusCode: 413, message: `Corps de requête limité à ${BODY_MAX_BYTES} octets` })
  }
})
