import {defineConfig} from 'vite';
// Two pages: the game (index.html) and the owner's stats app (stats.html, its own home-screen icon).
export default defineConfig({base: './', server: {port: 5199}, build: {rollupOptions: {input: {main: 'index.html', stats: 'stats.html'}}}});
