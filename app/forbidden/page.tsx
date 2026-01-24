"use client"

import { VideoErrorPage } from "@/components/layout/video-error-page"

export default function ForbiddenPage() {
  return (
    <VideoErrorPage
      statusCode="403"
      title="ACCESS DENIED"
      message="必要な権限を持つアカウントで再認証してください。"
      videoSrc="/403-bg.webm"
      posterSrc="/403-poster.jpg"
      videoClassName="opacity-80"
      overlayClassName="bg-black/60"
      /*statusCodeClassName="glitch-text"
      titleClassName="text-shadow-glow"*/
    />
  )
}
