<script setup lang="ts">
// Rendu des blocs de parseMarkdownBlocks en interpolation de texte (jamais de HTML injecté) : le HTML éventuel
// du Markdown s'affiche tel quel, comme du texte.
import { parseMarkdownBlocks, type InlineSegment } from '~~/shared/utils/markdown-blocks'

const props = defineProps<{ markdown: string }>()
const blocks = computed(() => parseMarkdownBlocks(props.markdown))

// Titres : h1 de la page est déjà pris par /admin, le guide commence à h3
const HEADING_TAGS = { 1: 'h3', 2: 'h4', 3: 'h5' } as const
</script>

<template>
  <div class="md">
    <template v-for="(block, blockIndex) in blocks" :key="blockIndex">
      <component :is="HEADING_TAGS[block.level]" v-if="block.type === 'heading'" class="md__heading" :class="`md__heading--${block.level}`">
        <template v-for="(segment, i) in block.content" :key="i">
          <strong v-if="segment.type === 'strong'">{{ segment.text }}</strong>
          <code v-else-if="segment.type === 'code'">{{ segment.text }}</code>
          <template v-else>{{ segment.text }}</template>
        </template>
      </component>
      <p v-else-if="block.type === 'paragraph'">
        <template v-for="(segment, i) in block.content" :key="i">
          <strong v-if="segment.type === 'strong'">{{ segment.text }}</strong>
          <code v-else-if="segment.type === 'code'">{{ segment.text }}</code>
          <template v-else>{{ segment.text }}</template>
        </template>
      </p>
      <component :is="block.ordered ? 'ol' : 'ul'" v-else-if="block.type === 'list'">
        <li v-for="(item, itemIndex) in block.items" :key="itemIndex">
          <template v-for="(segment, i) in item" :key="i">
            <strong v-if="segment.type === 'strong'">{{ segment.text }}</strong>
            <code v-else-if="segment.type === 'code'">{{ segment.text }}</code>
            <template v-else>{{ segment.text }}</template>
          </template>
        </li>
      </component>
      <div v-else-if="block.type === 'table'" class="md__table-wrap">
        <table>
          <thead>
            <tr>
              <th v-for="(cell, cellIndex) in block.header" :key="cellIndex" scope="col">
                <template v-for="(segment, i) in cell" :key="i">
                  <strong v-if="segment.type === 'strong'">{{ segment.text }}</strong>
                  <code v-else-if="segment.type === 'code'">{{ segment.text }}</code>
                  <template v-else>{{ segment.text }}</template>
                </template>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, rowIndex) in block.rows" :key="rowIndex">
              <td v-for="(cell, cellIndex) in row" :key="cellIndex">
                <template v-for="(segment, i) in cell" :key="i">
                  <strong v-if="segment.type === 'strong'">{{ segment.text }}</strong>
                  <code v-else-if="segment.type === 'code'">{{ segment.text }}</code>
                  <template v-else>{{ segment.text }}</template>
                </template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>

<style scoped>
.md { font-size: 0.9rem; line-height: 1.5; }
.md p, .md ul, .md ol { margin: 0.5rem 0; }
.md ul, .md ol { padding-left: 1.4rem; }
.md__heading { margin: 1rem 0 0.4rem; }
.md__table-wrap { overflow-x: auto; margin: 0.6rem 0; }
.md table { border-collapse: collapse; width: 100%; font-size: 0.82rem; }
.md th, .md td { border: 1px solid #d1d1e0; padding: 0.35rem 0.5rem; text-align: left; vertical-align: top; }
.md th { background: #f0f0f8; white-space: nowrap; }
.md code { background: #f0f0f8; padding: 0 0.25rem; border-radius: 3px; font-size: 0.85em; }
</style>
