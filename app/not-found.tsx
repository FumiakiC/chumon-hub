import { VideoErrorPage } from "@/components/layout/video-error-page"

export default function NotFound() {
  return (
    <VideoErrorPage
      statusCode="404"
      title="虚空への現実逃避"
      message="お探しのページは「自分探しの旅に出たい」と言い残し、どこかへ流れていきました。"
      videoSrc="/404-bg.webm"
      posterSrc="/404-poster.jpg"
      videoClassName="opacity-60"
      overlayClassName="bg-white/25"
      secondaryOverlayClassName="bg-black/40"
    />
  )
}
