const { expect } = require('chai')
const { Sequelize } = require('sequelize')
const sinon = require('sinon')

const Database = require('../../../server/Database')
const LibraryController = require('../../../server/controllers/LibraryController')
const zipHelpers = require('../../../server/utils/zipHelpers')
const Logger = require('../../../server/Logger')
const FolderCoverService = require('../../../server/services/FolderCoverService')

describe('LibraryController.downloadMultiple', () => {
  let library
  let libraryFolder
  let allowedItemId
  let explicitItemId
  let taggedItemId
  let restrictedUser
  let libraryRecord

  beforeEach(async () => {
    global.ServerSettings = {}
    Database.sequelize = new Sequelize({ dialect: 'sqlite', storage: ':memory:', logging: false })
    Database.sequelize.uppercaseFirst = (str) => (str ? `${str[0].toUpperCase()}${str.substr(1)}` : '')
    await Database.buildModels()

    library = await Database.libraryModel.create({ name: 'Test Library', mediaType: 'book' })
    libraryFolder = await Database.libraryFolderModel.create({ path: '/test-lib', libraryId: library.id })
    libraryRecord = await Database.libraryModel.findByIdWithFolders(library.id)

    const allowedBook = await Database.bookModel.create({
      title: 'Allowed Book',
      explicit: false,
      audioFiles: [],
      tags: ['allowed-tag'],
      narrators: [],
      genres: [],
      chapters: []
    })
    const allowedItem = await Database.libraryItemModel.create({
      path: '/test-lib/allowed',
      relPath: 'Authors/Allowed Book',
      isFile: false,
      libraryFiles: [],
      mediaId: allowedBook.id,
      mediaType: 'book',
      libraryId: library.id,
      libraryFolderId: libraryFolder.id
    })
    allowedItemId = allowedItem.id

    const explicitBook = await Database.bookModel.create({
      title: 'Explicit Book',
      explicit: true,
      audioFiles: [],
      tags: [],
      narrators: [],
      genres: [],
      chapters: []
    })
    const explicitItem = await Database.libraryItemModel.create({
      path: '/test-lib/explicit',
      relPath: 'Authors/Explicit Book',
      isFile: false,
      libraryFiles: [],
      mediaId: explicitBook.id,
      mediaType: 'book',
      libraryId: library.id,
      libraryFolderId: libraryFolder.id
    })
    explicitItemId = explicitItem.id

    const taggedBook = await Database.bookModel.create({
      title: 'Tagged Book',
      explicit: false,
      audioFiles: [],
      tags: ['restricted-tag'],
      narrators: [],
      genres: [],
      chapters: []
    })
    const taggedItem = await Database.libraryItemModel.create({
      path: '/test-lib/tagged',
      relPath: 'Restricted/Tagged Book',
      isFile: false,
      libraryFiles: [],
      mediaId: taggedBook.id,
      mediaType: 'book',
      libraryId: library.id,
      libraryFolderId: libraryFolder.id
    })
    taggedItemId = taggedItem.id

    const permissions = Database.userModel.getDefaultPermissionsForUserType('user')
    permissions.download = true
    permissions.accessExplicitContent = false
    permissions.accessAllLibraries = false
    permissions.accessAllTags = false
    permissions.librariesAccessible = [library.id]
    permissions.itemTagsSelected = ['allowed-tag']
    permissions.selectedTagsNotAccessible = false

    restrictedUser = await Database.userModel.create({
      username: 'restricted',
      pash: 'hash',
      token: 'token',
      type: 'user',
      isActive: true,
      permissions,
      bookmarks: [],
      extraData: {}
    })

    sinon.stub(Logger, 'info')
    sinon.stub(Logger, 'warn')
    sinon.stub(Logger, 'error')
    sinon.stub(zipHelpers, 'zipDirectoriesPipe').resolves()
    sinon.stub(FolderCoverService, 'getOrCreateFolderCover').resolves({
      cacheKey: 'folder-cover-key',
      cachePath: '/tmp/folder-cover.webp',
      format: 'webp'
    })
  })

  afterEach(async () => {
    sinon.restore()
    await Database.sequelize.sync({ force: true })
  })

  function makeReq(ids) {
    return {
      query: { ids: ids.join(',') },
      user: restrictedUser,
      library: libraryRecord
    }
  }

  function makeRes() {
    return {
      sendStatus: sinon.spy(),
      status: sinon.stub().returnsThis(),
      send: sinon.spy()
    }
  }

  it('returns 403 for bulk download of an explicit item', async () => {
    const req = makeReq([explicitItemId])
    const res = makeRes()

    await LibraryController.downloadMultiple(req, res)

    expect(res.sendStatus.calledWith(403)).to.be.true
    expect(zipHelpers.zipDirectoriesPipe.called).to.be.false
  })

  it('returns 403 for bulk download of a tag-restricted item', async () => {
    const req = makeReq([taggedItemId])
    const res = makeRes()

    await LibraryController.downloadMultiple(req, res)

    expect(res.sendStatus.calledWith(403)).to.be.true
    expect(zipHelpers.zipDirectoriesPipe.called).to.be.false
  })

  it('returns 403 when bulk download includes both allowed and forbidden items', async () => {
    const req = makeReq([allowedItemId, explicitItemId])
    const res = makeRes()

    await LibraryController.downloadMultiple(req, res)

    expect(res.sendStatus.calledWith(403)).to.be.true
    expect(zipHelpers.zipDirectoriesPipe.called).to.be.false
  })

  it('starts zip download for allowed items only', async () => {
    const req = makeReq([allowedItemId])
    const res = makeRes()

    await LibraryController.downloadMultiple(req, res)

    expect(res.sendStatus.called).to.be.false
    expect(zipHelpers.zipDirectoriesPipe.calledOnce).to.be.true
    const pathObjects = zipHelpers.zipDirectoriesPipe.firstCall.args[0]
    expect(pathObjects).to.have.length(1)
    expect(pathObjects[0].path).to.equal('/test-lib/allowed')
  })

  it('returns an indexed folder tree containing only accessible items', async () => {
    const req = {
      user: restrictedUser,
      library: libraryRecord
    }
    const res = {
      json: sinon.spy()
    }

    await LibraryController.getFolderTree(req, res)

    expect(res.json.calledOnce).to.be.true
    const payload = res.json.firstCall.args[0]
    expect(payload.folders).to.deep.equal([{ id: libraryFolder.id, name: 'test-lib' }])
    expect(payload.items).to.deep.equal([
      {
        id: allowedItemId,
        folderId: libraryFolder.id,
        relPath: 'Authors/Allowed Book',
        title: 'Allowed Book',
        author: '',
        hasCover: false,
        updatedAt: payload.items[0].updatedAt,
        mediaType: 'book'
      }
    ])
  })

  it('generates folder artwork using accessible items only', async () => {
    const req = {
      query: {
        rootId: libraryFolder.id,
        path: 'Authors',
        width: '384',
        v: 'browser-cache-key'
      },
      headers: {
        accept: 'image/webp'
      },
      user: restrictedUser,
      library: libraryRecord
    }
    const res = {
      type: sinon.stub().returnsThis(),
      set: sinon.stub().returnsThis(),
      sendFile: sinon.spy(),
      sendStatus: sinon.spy()
    }

    await LibraryController.getFolderCover(req, res)

    expect(FolderCoverService.getOrCreateFolderCover.calledOnce).to.be.true
    const renderRequest = FolderCoverService.getOrCreateFolderCover.firstCall.args[0]
    expect(renderRequest.folderIdentity).to.equal(`${library.id}:${libraryFolder.id}:Authors`)
    expect(renderRequest.items.map((item) => item.id)).to.deep.equal([allowedItemId])
    expect(renderRequest.size).to.equal('384')
    expect(renderRequest.format).to.equal('webp')
    expect(res.set.calledWith('Cache-Control', 'private, max-age=31536000, immutable')).to.be.true
    expect(res.sendFile.calledWith('/tmp/folder-cover.webp')).to.be.true
  })

  it('rejects folder artwork paths that could escape a library root', async () => {
    const req = {
      query: {
        rootId: libraryFolder.id,
        path: '../Restricted'
      },
      user: restrictedUser,
      library: libraryRecord
    }
    const res = {
      sendStatus: sinon.spy()
    }

    await LibraryController.getFolderCover(req, res)

    expect(res.sendStatus.calledWith(400)).to.be.true
    expect(FolderCoverService.getOrCreateFolderCover.called).to.be.false
  })
})
