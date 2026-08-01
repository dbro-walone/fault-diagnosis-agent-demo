import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import fs from 'fs'

// Force a SINGLE `three` instance. 3d-force-graph's renderer stack
// (three-render-objects / three-forcegraph) needs the modern `three` the library
// ships (>=0.179, which exports `./webgpu` and `./tsl`); the top-level
// `three-forcegraph` otherwise resolves bare `three` to a different version
// hoisted at the project root. Two THREE instances → meshes built from one are
// not recognized by the renderer built from the other → blank canvas. We never
// set window.THREE.
//
// Prefer the copy nested under 3d-force-graph (the version it is tested with);
// fall back to the hoisted top-level three (after `npm install` with three
// >=0.179 the two collapse to a single hoisted copy, so this still resolves
// correctly). Match the BARE specifier only (`/^three$/`) so subpath imports
// like `three/webgpu` keep resolving naturally through the package exports map.
function resolveSingleThree(): string {
  const candidates = [
    'node_modules/3d-force-graph/node_modules/three',
    'node_modules/three',
  ]
  for (const c of candidates) {
    const abs = path.resolve(__dirname, c)
    if (fs.existsSync(abs)) return abs
  }
  return 'three'
}

export default defineConfig({
  plugins: [react()],
  base: './',
  resolve: {
    alias: [
      { find: '@', replacement: path.resolve(__dirname, 'src') },
      { find: /^three$/, replacement: resolveSingleThree() },
    ],
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 2500,
  },
})
