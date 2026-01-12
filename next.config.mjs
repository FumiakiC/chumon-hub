/** @type {import('next').NextConfig} */
const nextConfig = {

  output: "standalone", // スタンドアロン出力を有効化
  
  typescript: {
    ignoreBuildErrors: false, // ビルド時のTypeScriptエラーを無視しない
  },
  images: {
    unoptimized: true,
  },
}

export default nextConfig
