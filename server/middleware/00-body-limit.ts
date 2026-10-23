// H1 : refuse en 413 une écriture /api/* (POST, PUT, PATCH, DELETE) dont le corps dépasse BODY_MAX_BYTES,
// d'après content-length, ou envoyée en chunked sans content-length (taille inconnue). Rien n'est lu du
// corps avant ce refus. Seule dérogation : PUT /api/admin/npc-personas/edit, jusqu'à
// PERSONA_EDIT_BODY_MAX_BYTES (026, édition d'une fiche de PNJ).
export default defineEventHandler((event) => {
  const max = bodyMaxBytesFor(event.method, event.path)
  if (max === undefined) return

  const contentLength = getRequestHeader(event, 'content-length')
  if (contentLength === undefined) {
    const transferEncoding = getRequestHeader(event, 'transfer-encoding') ?? ''
    if (transferEncoding.toLowerCase().includes('chunked')) {
      throw createError({ statusCode: 413, message: 'Corps de requête sans content-length refusé' })
    }
    return
  }
  const length = Number(contentLength)
  if (!Number.isFinite(length) || length > max) {
    throw createError({ statusCode: 413, message: `Corps de requête limité à ${max} octets` })
  }
})
