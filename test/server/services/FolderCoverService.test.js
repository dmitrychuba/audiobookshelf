const { expect } = require('chai')
const os = require('os')
const Path = require('path')
const sharp = require('sharp')

const fs = require('../../../server/libs/fsExtra')
const FolderCoverService = require('../../../server/services/FolderCoverService')

describe('FolderCoverService', () => {
  let temporaryDirectory
  let previousMetadataPath
  let coverPaths

  beforeEach(async () => {
    temporaryDirectory = await fs.mkdtemp(Path.join(os.tmpdir(), 'abs-folder-covers-'))
    previousMetadataPath = global.MetadataPath
    global.MetadataPath = temporaryDirectory
    coverPaths = []

    const colors = ['#244c88', '#b43d3d', '#d0a62c', '#477b51', '#6f448d']
    for (let index = 0; index < colors.length; index++) {
      const coverPath = Path.join(temporaryDirectory, `cover-${index}.png`)
      await sharp({
        create: {
          width: 300 + index * 10,
          height: 480,
          channels: 3,
          background: colors[index]
        }
      })
        .png()
        .toFile(coverPath)
      coverPaths.push(coverPath)
    }
  })

  afterEach(async () => {
    global.MetadataPath = previousMetadataPath
    await fs.remove(temporaryDirectory)
  })

  function createItems(count = coverPaths.length) {
    return coverPaths.slice(0, count).map((coverPath, index) => ({
      id: `item-${index}`,
      updatedAt: 1000 + index,
      coverPath,
      author: `Author ${index}`
    }))
  }

  it('selects covers deterministically while preferring different authors', () => {
    const items = createItems()
    items[1].author = items[0].author

    const firstSelection = FolderCoverService.selectCoverItems(items, 'library:root:Fiction', 3)
    const secondSelection = FolderCoverService.selectCoverItems([...items].reverse(), 'library:root:Fiction', 3)

    expect(firstSelection.map((item) => item.id)).to.deep.equal(secondSelection.map((item) => item.id))
    expect(new Set(firstSelection.map((item) => item.author)).size).to.equal(3)
  })

  it('changes the cache key when folder membership or cover metadata changes', () => {
    const base = {
      folderIdentity: 'library:root:Fiction',
      items: createItems(3),
      size: 512,
      format: 'webp'
    }
    const original = FolderCoverService.getCacheKey(base)
    const changedTimestamp = FolderCoverService.getCacheKey({
      ...base,
      items: base.items.map((item, index) => (index === 0 ? { ...item, updatedAt: item.updatedAt + 1 } : item))
    })
    const removedItem = FolderCoverService.getCacheKey({
      ...base,
      items: base.items.slice(0, 2)
    })

    expect(changedTimestamp).not.to.equal(original)
    expect(removedItem).not.to.equal(original)
  })

  it('renders square WebP artwork for one through five covers', async () => {
    for (let count = 1; count <= 5; count++) {
      const output = await FolderCoverService.renderFolderCover({
        folderIdentity: `library:root:folder-${count}`,
        coverItems: createItems(count),
        size: 384,
        format: 'webp'
      })
      const metadata = await sharp(output).metadata()

      expect(metadata.width).to.equal(384)
      expect(metadata.height).to.equal(384)
      expect(metadata.format).to.equal('webp')
    }
  })

  it('writes one reusable content-addressed cache artifact', async () => {
    const input = {
      folderIdentity: 'library:root:Fiction',
      items: createItems(3),
      size: 384,
      format: 'webp'
    }
    const first = await FolderCoverService.getOrCreateFolderCover(input)
    const second = await FolderCoverService.getOrCreateFolderCover(input)

    expect(second.cacheKey).to.equal(first.cacheKey)
    expect(second.cachePath).to.equal(first.cachePath)
    expect(await fs.pathExists(first.cachePath)).to.be.true
  })
})
