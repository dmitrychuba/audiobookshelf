const Crypto = require('crypto')
const Path = require('path')
const sharp = require('sharp')

const fs = require('../libs/fsExtra')
const Logger = require('../Logger')

const RENDERER_VERSION = 1
const MAX_COVERS = 5
const DEFAULT_SIZE = 768
const MIN_SIZE = 256
const MAX_SIZE = 1024
const MAX_CONCURRENT_RENDERS = 2
const SUPPORTED_FORMATS = new Set(['jpeg', 'png', 'webp'])

const inFlightRenders = new Map()
const pendingRenderSlots = []
let activeRenders = 0

function digest(value) {
  return Crypto.createHash('sha256').update(value).digest('hex')
}

function clampSize(value) {
  const parsed = Number.parseInt(value)
  if (!Number.isFinite(parsed)) return DEFAULT_SIZE
  return Math.max(MIN_SIZE, Math.min(MAX_SIZE, parsed))
}

function normalizeFormat(format) {
  return SUPPORTED_FORMATS.has(format) ? format : 'webp'
}

async function withRenderSlot(render) {
  if (activeRenders >= MAX_CONCURRENT_RENDERS) {
    await new Promise((resolve) => pendingRenderSlots.push(resolve))
  }
  activeRenders++

  try {
    return await render()
  } finally {
    activeRenders--
    pendingRenderSlots.shift()?.()
  }
}

function getItemVersion(item) {
  const updatedAt = item.updatedAt instanceof Date ? item.updatedAt.valueOf() : item.updatedAt || 0
  return `${item.id}:${updatedAt}:${item.coverPath || ''}`
}

function getCacheKey({ folderIdentity, items, size, format }) {
  const manifest = items.map(getItemVersion).sort().join('\n')

  return digest([`folder-cover:${RENDERER_VERSION}`, folderIdentity, size, format, manifest].join('\n'))
}

function selectCoverItems(items, folderIdentity, limit = MAX_COVERS) {
  const scored = items
    .filter((item) => item.coverPath)
    .map((item) => ({
      ...item,
      score: digest(`${folderIdentity}\n${item.id}`)
    }))
    .sort((a, b) => b.score.localeCompare(a.score))

  const selected = []
  const selectedAuthors = new Set()

  for (const item of scored) {
    const authorKey = (item.author || '').trim().toLocaleLowerCase()
    if (authorKey && selectedAuthors.has(authorKey)) continue
    selected.push(item)
    if (authorKey) selectedAuthors.add(authorKey)
    if (selected.length === limit) return selected
  }

  for (const item of scored) {
    if (selected.some((selectedItem) => selectedItem.id === item.id)) continue
    selected.push(item)
    if (selected.length === limit) break
  }

  return selected
}

function getTemplate(count) {
  if (count <= 1) {
    return [{ index: 0, height: 0.76, centerX: 0.5, top: 0.15, angle: 0 }]
  }
  if (count === 2) {
    return [
      { index: 0, height: 0.67, centerX: 0.37, top: 0.2, angle: -5 },
      { index: 1, height: 0.7, centerX: 0.63, top: 0.17, angle: 5 }
    ]
  }
  if (count === 3) {
    return [
      { index: 0, height: 0.61, centerX: 0.24, top: 0.24, angle: -7 },
      { index: 2, height: 0.61, centerX: 0.76, top: 0.24, angle: 7 },
      { index: 1, height: 0.74, centerX: 0.5, top: 0.14, angle: 0 }
    ]
  }
  if (count === 4) {
    return [
      { index: 0, height: 0.57, centerX: 0.2, top: 0.25, angle: -8 },
      { index: 3, height: 0.57, centerX: 0.8, top: 0.25, angle: 8 },
      { index: 1, height: 0.68, centerX: 0.39, top: 0.17, angle: -3 },
      { index: 2, height: 0.68, centerX: 0.61, top: 0.17, angle: 3 }
    ]
  }
  return [
    { index: 0, height: 0.53, centerX: 0.13, top: 0.28, angle: -10 },
    { index: 4, height: 0.53, centerX: 0.87, top: 0.28, angle: 10 },
    { index: 1, height: 0.62, centerX: 0.31, top: 0.22, angle: -5 },
    { index: 3, height: 0.62, centerX: 0.69, top: 0.22, angle: 5 },
    { index: 2, height: 0.72, centerX: 0.5, top: 0.14, angle: 0 }
  ]
}

function seededColors(seed) {
  const bytes = Buffer.from(digest(seed).slice(0, 12), 'hex')
  const first = {
    r: 24 + (bytes[0] % 54),
    g: 22 + (bytes[1] % 50),
    b: 30 + (bytes[2] % 58)
  }
  const second = {
    r: 10 + (bytes[3] % 34),
    g: 12 + (bytes[4] % 38),
    b: 18 + (bytes[5] % 42)
  }
  return { first, second }
}

function backgroundOverlay(size) {
  return Buffer.from(`
    <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="shade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#000" stop-opacity=".18"/>
          <stop offset=".58" stop-color="#000" stop-opacity=".08"/>
          <stop offset="1" stop-color="#000" stop-opacity=".6"/>
        </linearGradient>
        <radialGradient id="vignette">
          <stop offset=".52" stop-color="#000" stop-opacity="0"/>
          <stop offset="1" stop-color="#000" stop-opacity=".52"/>
        </radialGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#shade)"/>
      <rect width="100%" height="100%" fill="url(#vignette)"/>
      <rect x="1" y="1" width="${size - 2}" height="${size - 2}" rx="${Math.round(size * 0.025)}" fill="none" stroke="#fff" stroke-opacity=".12" stroke-width="2"/>
    </svg>
  `)
}

async function createBackground(coverPath, folderIdentity, size) {
  if (coverPath && (await fs.pathExists(coverPath))) {
    try {
      return await sharp(coverPath)
        .rotate()
        .resize(size, size, { fit: 'cover' })
        .blur(Math.max(16, Math.round(size * 0.035)))
        .modulate({ brightness: 0.48, saturation: 0.78 })
        .composite([{ input: backgroundOverlay(size), blend: 'over' }])
        .png()
        .toBuffer()
    } catch (error) {
      Logger.warn(`[FolderCoverService] Failed to build adaptive background from "${coverPath}": ${error.message}`)
    }
  }

  const { first, second } = seededColors(folderIdentity)
  const gradient = Buffer.from(`
    <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="background" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="rgb(${first.r},${first.g},${first.b})"/>
          <stop offset="1" stop-color="rgb(${second.r},${second.g},${second.b})"/>
        </linearGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#background)"/>
    </svg>
  `)

  return sharp(gradient)
    .composite([{ input: backgroundOverlay(size), blend: 'over' }])
    .png()
    .toBuffer()
}

async function createCoverLayer(coverPath, targetHeight, angle, size) {
  // Landscape and unusually wide artwork must stay inside the square even
  // after rotation adds to the layer's bounding box.
  const resized = await sharp(coverPath)
    .rotate()
    .resize({ width: Math.round(size * 0.68), height: targetHeight, fit: 'inside', withoutEnlargement: false })
    .png()
    .toBuffer({ resolveWithObject: true })

  const radius = Math.max(5, Math.round(size * 0.012))
  const mask = Buffer.from(`
    <svg width="${resized.info.width}" height="${resized.info.height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" rx="${radius}" fill="#fff"/>
    </svg>
  `)
  const roundedCover = await sharp(resized.data)
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer()

  const padding = Math.max(14, Math.round(size * 0.035))
  const shadowBlur = Math.max(8, Math.round(size * 0.018))
  const layerWidth = resized.info.width + padding * 2
  const layerHeight = resized.info.height + padding * 2
  const shadow = Buffer.from(`
    <svg width="${layerWidth}" height="${layerHeight}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="shadow" x="-30%" y="-30%" width="160%" height="170%">
          <feGaussianBlur stdDeviation="${shadowBlur}"/>
        </filter>
      </defs>
      <rect x="${padding}" y="${padding + Math.round(size * 0.012)}" width="${resized.info.width}" height="${resized.info.height}" rx="${radius}" fill="#000" fill-opacity=".78" filter="url(#shadow)"/>
    </svg>
  `)

  return sharp({
    create: {
      width: layerWidth,
      height: layerHeight,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  })
    .composite([
      { input: shadow, left: 0, top: 0 },
      { input: roundedCover, left: padding, top: padding }
    ])
    .rotate(angle, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer({ resolveWithObject: true })
}

async function renderFolderCover({ folderIdentity, coverItems, size = DEFAULT_SIZE, format = 'webp' }) {
  size = clampSize(size)
  format = normalizeFormat(format)

  const validCoverItems = []
  for (const item of coverItems.slice(0, MAX_COVERS)) {
    if (item.coverPath && (await fs.pathExists(item.coverPath))) validCoverItems.push(item)
  }

  const heroCover = validCoverItems[Math.floor(validCoverItems.length / 2)]?.coverPath
  const background = await createBackground(heroCover, folderIdentity, size)
  const composites = []

  for (const placement of getTemplate(validCoverItems.length)) {
    const item = validCoverItems[placement.index]
    if (!item) continue
    try {
      const layer = await createCoverLayer(item.coverPath, Math.round(size * placement.height), placement.angle, size)
      const left = Math.max(0, Math.min(size - layer.info.width, Math.round(size * placement.centerX - layer.info.width / 2)))
      const top = Math.max(0, Math.min(size - layer.info.height, Math.round(size * placement.top)))
      composites.push({ input: layer.data, left, top })
    } catch (error) {
      Logger.warn(`[FolderCoverService] Failed to add cover "${item.coverPath}": ${error.message}`)
    }
  }

  const renderer = sharp(background).composite(composites)
  if (format === 'png') return renderer.png({ compressionLevel: 8 }).toBuffer()
  if (format === 'jpeg') return renderer.jpeg({ quality: 86, mozjpeg: true }).toBuffer()
  return renderer.webp({ quality: 86, smartSubsample: true }).toBuffer()
}

async function getOrCreateFolderCover({ folderIdentity, items, size = DEFAULT_SIZE, format = 'webp' }) {
  size = clampSize(size)
  format = normalizeFormat(format)

  const cacheKey = getCacheKey({ folderIdentity, items, size, format })
  const cacheDirectory = Path.join(global.MetadataPath, 'cache', 'folder-covers', cacheKey.slice(0, 2))
  const cachePath = Path.join(cacheDirectory, `${cacheKey}.${format === 'jpeg' ? 'jpg' : format}`)

  if (await fs.pathExists(cachePath)) return { cacheKey, cachePath, format, size }
  if (inFlightRenders.has(cacheKey)) return inFlightRenders.get(cacheKey)

  const renderPromise = (async () => {
    await fs.ensureDir(cacheDirectory)
    const selectedItems = selectCoverItems(items, folderIdentity)
    const image = await withRenderSlot(() => renderFolderCover({ folderIdentity, coverItems: selectedItems, size, format }))
    const temporaryPath = `${cachePath}.${process.pid}.${Date.now()}.tmp`

    try {
      await fs.writeFile(temporaryPath, image)
      await fs.rename(temporaryPath, cachePath)
    } catch (error) {
      await fs.remove(temporaryPath).catch(() => {})
      throw error
    }

    return { cacheKey, cachePath, format, size }
  })()

  inFlightRenders.set(cacheKey, renderPromise)
  try {
    return await renderPromise
  } finally {
    inFlightRenders.delete(cacheKey)
  }
}

module.exports = {
  DEFAULT_SIZE,
  MAX_COVERS,
  clampSize,
  getCacheKey,
  getOrCreateFolderCover,
  normalizeFormat,
  renderFolderCover,
  selectCoverItems
}
