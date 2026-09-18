/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone', // スタンドアロン出力を有効化

  serverExternalPackages: ['pdfjs-dist', '@napi-rs/canvas'],
  outputFileTracingIncludes: {
    '/api/crop-title-block': [
      './node_modules/.pnpm/pdfjs-dist@*/node_modules/pdfjs-dist/standard_fonts/**/*',
      './node_modules/.pnpm/pdfjs-dist@*/node_modules/pdfjs-dist/wasm/**/*',
      './node_modules/.pnpm/pdfjs-dist@*/node_modules/pdfjs-dist/cmaps/**/*',
      './node_modules/.pnpm/pdfjs-dist@*/node_modules/pdfjs-dist/iccs/**/*',
      './node_modules/.pnpm/@napi-rs+canvas-*/node_modules/@napi-rs/canvas-*/**/*',
    ],
  },

  // proxy.ts を使うと Next.js はリクエストボディをメモリにバッファする（既定 10MB）。
  // 超過分はサイレントに切り詰められリクエスト自体は失敗しないため、10MB 超の
  // アップロードは multipart が壊れて formData() が throw し、25MB のファイル上限
  // （413）に到達する前に汎用 500 になる。25MB ＋ multipart オーバーヘッドを収容
  // できる値を明示する。experimental だが、このバッファリング自体は proxy を使う
  // 時点で既定値が有効であり、ここでは値を変えるだけで experimental な面積は増えない。
  // lib/ai/pipeline/upload.ts の MAX_REQUEST_BYTES より必ず大きく保つこと。
  experimental: {
    proxyClientMaxBodySize: '32mb',
  },

  typescript: {
    ignoreBuildErrors: false, // ビルド時のTypeScriptエラーを無視しない
  },
  images: {
    unoptimized: true,
  },
}

export default nextConfig
