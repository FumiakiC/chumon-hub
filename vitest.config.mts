import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    // tsconfig.json の paths（"@/*"）を vitest 側でも解決する。
    // vite-tsconfig-paths は依存を増やすため使わず、エイリアス1本を手で持つ。
    alias: [
      {
        find: /^@\//,
        replacement: fileURLToPath(new URL('./', import.meta.url)),
      },
    ],
  },
  test: {
    environment: 'node',
    // AI 呼び出しを伴う評価ハーネス本体（tsx で手動実行）は対象にしない。
    // ここに載るのは決定的な純関数のテストだけで、CI で常時実行される。
    include: ['lib/**/*.test.ts'],
  },
})
