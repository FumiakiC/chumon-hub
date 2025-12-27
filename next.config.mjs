/** @type {import('next').NextConfig} */
const nextConfig = {
  
  typescript: {
    ignoreBuildErrors: true,　// ビルド時のTypeScriptエラーを無視
  },
  images: {
    unoptimized: true,
  },
}

export default nextConfig
