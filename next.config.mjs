/** @type {import('next').NextConfig} */
const nextConfig = {

  output: "standalone", // スタンドアロン出力を有効化
  
  typescript: {
    ignoreBuildErrors: true, // ビルド時のTypeScriptエラーを無視
  },
  images: {
    unoptimized: true,
  },
}

export default nextConfig
