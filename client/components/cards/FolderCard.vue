<template>
  <button type="button" class="block text-left group" :style="{ width: cardSize + 'px' }" :aria-label="`${folder.name}, ${numBooks} ${$strings.LabelBooks}`" @click="$emit('click', folder)">
    <div class="relative rounded-sm overflow-hidden bg-primary box-shadow-book" :style="{ width: cardSize + 'px', height: cardSize + 'px' }">
      <covers-group-cover :id="folder.key" :name="folder.name" :book-items="coverItems" :width="cardSize" :height="cardSize" :book-cover-aspect-ratio="bookCoverAspectRatio" />
      <img v-if="generatedCoverSrc && !generatedCoverFailed" :src="generatedCoverSrc" alt="" aria-hidden="true" draggable="false" class="absolute z-10 inset-0 w-full h-full object-cover transition-opacity duration-300" :class="generatedCoverReady ? 'opacity-100' : 'opacity-0'" @load="generatedCoverReady = true" @error="generatedCoverFailed = true" />

      <div class="absolute inset-0 z-20 folder-cover-overlay opacity-40 group-hover:opacity-100 transition-opacity">
        <div class="absolute inset-0 bg-black/20 group-hover:bg-black/45 transition-colors" />
      </div>

      <div class="absolute z-30 bottom-2 left-2 w-10 h-10 rounded-md flex items-center justify-center box-shadow-md" style="background-color: #232323">
        <span class="material-symbols fill text-3xl text-yellow-300">folder</span>
      </div>

      <div class="absolute z-30 top-2 right-2 rounded-full min-w-7 h-7 px-2 font-semibold text-white flex items-center justify-center box-shadow-md" style="background-color: #cd9d49dd">
        {{ numBooks }}
      </div>
    </div>

    <p class="mt-3 text-base md:text-lg font-semibold truncate group-hover:text-yellow-200">{{ folder.name }}</p>
    <p class="text-xs md:text-sm text-white/55">{{ numBooks }} {{ $strings.LabelBooks }}</p>
  </button>
</template>

<script>
export default {
  props: {
    folder: {
      type: Object,
      required: true
    },
    size: {
      type: Number,
      default: 192
    }
  },
  data() {
    return {
      generatedCoverFailed: false,
      generatedCoverReady: false,
      generatedCoverSrc: '',
      generatedCoverObjectUrl: '',
      generatedCoverRequest: 0
    }
  },
  computed: {
    currentLibraryId() {
      return this.$store.state.libraries.currentLibraryId
    },
    sizeMultiplier() {
      return this.$store.getters['user/getSizeMultiplier']
    },
    cardSize() {
      return Math.round(this.size * this.sizeMultiplier)
    },
    bookCoverAspectRatio() {
      return this.$store.getters['libraries/getBookCoverAspectRatio']
    },
    numBooks() {
      return this.folder.items?.length || 0
    },
    folderCoverVersion() {
      const manifest = (this.folder.items || [])
        .map((item) => `${item.id}:${item.updatedAt || 0}:${item.hasCover ? 1 : 0}`)
        .sort()
        .join('|')

      // FNV-1a gives the image URL a compact, deterministic browser cache key.
      let hash = 0x811c9dc5
      for (let index = 0; index < manifest.length; index++) {
        hash ^= manifest.charCodeAt(index)
        hash = Math.imul(hash, 0x01000193)
      }
      return (hash >>> 0).toString(16)
    },
    folderCoverUrl() {
      const query = [`rootId=${encodeURIComponent(this.folder.rootId)}`, `path=${encodeURIComponent((this.folder.path || []).join('/'))}`, `width=${Math.min(1024, Math.round(this.cardSize * 2))}`, `v=${this.folderCoverVersion}`].join('&')
      // Axios already uses routerBasePath as its base URL. Keeping this
      // relative avoids duplicating the subpath in reverse-proxy installs.
      return `/api/libraries/${this.currentLibraryId}/folder-cover?${query}`
    },
    coverItems() {
      return (this.folder.items || [])
        .filter((item) => item.hasCover)
        .map((item) => ({
          id: item.id,
          updatedAt: item.updatedAt,
          media: {
            // GroupCover only needs a truthy coverPath before constructing the item cover URL.
            coverPath: 'indexed'
          }
        }))
    }
  },
  watch: {
    folderCoverUrl: {
      immediate: true,
      handler() {
        this.loadGeneratedCover()
      }
    }
  },
  methods: {
    releaseGeneratedCover() {
      if (this.generatedCoverObjectUrl) URL.revokeObjectURL(this.generatedCoverObjectUrl)
      this.generatedCoverObjectUrl = ''
      this.generatedCoverSrc = ''
    },
    async loadGeneratedCover() {
      const request = ++this.generatedCoverRequest
      this.generatedCoverFailed = false
      this.generatedCoverReady = false
      this.releaseGeneratedCover()

      try {
        // Folder artwork is permission-aware, so fetch it through the
        // authenticated Axios client before handing the blob to the image tag.
        const response = await this.$axios.get(this.folderCoverUrl, { responseType: 'blob' })
        if (request !== this.generatedCoverRequest) return
        this.generatedCoverObjectUrl = URL.createObjectURL(response.data)
        this.generatedCoverSrc = this.generatedCoverObjectUrl
      } catch (error) {
        if (request === this.generatedCoverRequest) this.generatedCoverFailed = true
      }
    }
  },
  beforeDestroy() {
    this.generatedCoverRequest++
    this.releaseGeneratedCover()
  }
}
</script>

<style scoped>
.folder-cover-overlay {
  background: linear-gradient(to top, rgb(0 0 0 / 45%), transparent 55%);
}
</style>
