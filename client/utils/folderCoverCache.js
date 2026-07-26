const CACHE_NAME = 'audiobookshelf-folder-covers-v1'
const CACHE_PATH = '/__audiobookshelf_folder_cover_cache__/'

const memoryCache = new Map()
const pendingReads = new Map()

function getCacheRequestUrl(cacheKey) {
  return `${window.location.origin}${CACHE_PATH}${encodeURIComponent(cacheKey)}`
}

function canUsePersistentCache() {
  return typeof window !== 'undefined' && 'caches' in window
}

export async function getCachedFolderCover(cacheKey) {
  if (!cacheKey) return null
  if (memoryCache.has(cacheKey)) return memoryCache.get(cacheKey)
  if (!canUsePersistentCache()) return null
  if (pendingReads.has(cacheKey)) return pendingReads.get(cacheKey)

  const pendingRead = (async () => {
    try {
      const cache = await window.caches.open(CACHE_NAME)
      const response = await cache.match(getCacheRequestUrl(cacheKey))
      if (!response) return null

      const blob = await response.blob()
      if (!blob.size) {
        await cache.delete(getCacheRequestUrl(cacheKey))
        return null
      }

      memoryCache.set(cacheKey, blob)
      return blob
    } catch (error) {
      // Cache Storage can be unavailable in private browsing or when the
      // browser has exhausted its quota. Network loading remains the fallback.
      return null
    }
  })()

  pendingReads.set(cacheKey, pendingRead)
  try {
    return await pendingRead
  } finally {
    pendingReads.delete(cacheKey)
  }
}

export async function cacheFolderCover(cacheKey, blob) {
  if (!cacheKey || !blob?.size) return

  memoryCache.set(cacheKey, blob)
  if (!canUsePersistentCache()) return

  try {
    const cache = await window.caches.open(CACHE_NAME)
    const response = new Response(blob, {
      headers: {
        'Cache-Control': 'private, max-age=31536000, immutable',
        'Content-Type': blob.type || 'image/webp'
      }
    })
    await cache.put(getCacheRequestUrl(cacheKey), response)
  } catch (error) {
    // The generated cover is still usable for this render even if persistence
    // is unavailable.
  }
}

