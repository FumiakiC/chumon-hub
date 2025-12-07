/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true, // ビルド時のESLintエラーを無視
  },
  typescript: {
    ignoreBuildErrors: true,　// ビルド時のTypeScriptエラーを無視
  },
  images: {
    unoptimized: true,
  },
}

export default nextConfig
