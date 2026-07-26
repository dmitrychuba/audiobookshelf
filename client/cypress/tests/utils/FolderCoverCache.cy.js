import { cacheFolderCover, getCachedFolderCover } from '@/utils/folderCoverCache'

describe('FolderCoverCache', () => {
  it('persists and retrieves a generated folder cover blob', () => {
    const cacheKey = `folder-cover-test-${Date.now()}`
    const originalBlob = new Blob(['generated folder cover'], { type: 'image/webp' })

    cy.wrap(cacheFolderCover(cacheKey, originalBlob))
      .then(() => getCachedFolderCover(cacheKey))
      .then((cachedBlob) => {
        expect(cachedBlob).to.be.instanceOf(Blob)
        expect(cachedBlob.type).to.equal('image/webp')
        expect(cachedBlob.size).to.equal(originalBlob.size)
        return cachedBlob.text()
      })
      .then((contents) => {
        expect(contents).to.equal('generated folder cover')
      })
  })
})
