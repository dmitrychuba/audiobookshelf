<template>
  <button type="button" class="block text-left group" :style="{ width: cardSize + 'px' }" :aria-label="`${folder.name}, ${numBooks} ${$strings.LabelBooks}`" @click="$emit('click', folder)">
    <div class="relative rounded-sm overflow-hidden bg-primary box-shadow-book" :style="{ width: cardSize + 'px', height: cardSize + 'px' }">
      <img v-if="!generatedCoverFailed" :src="folderCoverSrc" alt="" aria-hidden="true" loading="lazy" draggable="false" class="absolute inset-0 w-full h-full object-cover transition-opacity duration-300" :class="generatedCoverReady ? 'opacity-100' : 'opacity-0'" @load="generatedCoverReady = true" @error="generatedCoverFailed = true" />
      <covers-group-cover v-else :id="folder.key" :name="folder.name" :book-items="coverItems" :width="cardSize" :height="cardSize" :book-cover-aspect-ratio="bookCoverAspectRatio" />

      <div class="absolute inset-0 z-20 folder-cover-overlay opacity-40 group-hover:opacity-100 transition-opacity">
        <div class="absolute inset-0 bg-black/20 group-hover:bg-black/45 transition-colors" />
        <span class="material-symbols fill absolute bottom-3 left-3 text-4xl text-yellow-200 drop-shadow-md">folder</span>
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
      generatedCoverReady: false
    }
  },
  computed: {
    currentLibraryId() {
      return this.$store.state.libraries.currentLibraryId
    },
    routerBasePath() {
      return this.$store.state.routerBasePath
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
    folderCoverSrc() {
      const query = [`rootId=${encodeURIComponent(this.folder.rootId)}`, `path=${encodeURIComponent((this.folder.path || []).join('/'))}`, `width=${Math.min(1024, Math.round(this.cardSize * 2))}`, `v=${this.folderCoverVersion}`].join('&')
      return `${this.routerBasePath}/api/libraries/${this.currentLibraryId}/folder-cover?${query}`
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
    folderCoverSrc() {
      this.generatedCoverFailed = false
      this.generatedCoverReady = false
    }
  }
}
</script>

<style scoped>
.folder-cover-overlay {
  background: linear-gradient(to top, rgb(0 0 0 / 45%), transparent 55%);
}
</style>
