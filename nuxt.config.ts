// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  css: ['~/assets/css/main.css'],
  vite: {
    build: {
      // Cible CSS antérieure à la syntaxe d'intervalle des media queries (Chrome 104, Safari 16.4) :
      // Lightning CSS garde `@media (max-width: 767px)` au lieu de le réécrire en `(width<=767px)`,
      // ce qui couvre aussi les navigateurs mobiles un peu anciens des participants.
      cssTarget: ['chrome100', 'edge100', 'firefox100', 'safari15'],
    },
  },
  nitro: {
    // Fiches des PNJ (Markdown, useStorage('assets:npc')) et guides de l'animateur (docs/guide-animateur/,
    // dir relatif à server/, useStorage('assets:guides')) embarqués dans le build
    serverAssets: [
      { baseName: 'npc', dir: 'npc/personas' },
      { baseName: 'guides', dir: '../docs/guide-animateur' },
    ],
  },
  app: {
    head: {
      htmlAttrs: { lang: 'fr' },
      title: 'SRE Team Instance',
    },
  },
})
