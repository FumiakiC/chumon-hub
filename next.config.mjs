/** @type {import('next').NextConfig} */
const nextConfig = {
  // eeslint: {ignoreDuringBuilds: true,},のブロックを削除しました
  typescript: {
    ignoreBuildErrors: true,　// ビルド時のTypeScriptエラーを無視
  },
  images: {
    unoptimized: true,
  },
}

export default nextConfig
