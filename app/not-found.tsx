import { VideoErrorPage } from "@/components/layout/video-error-page"

export default function NotFound() {
  return (
    <VideoErrorPage
      statusCode="404"
      title="虚空への現実逃避"
      message="お探しのページは「自分探しの旅に出たい」と言い残し、どこかへ流れていきました。"
      videoSrc="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/git-blob/prj_sytANobx0QSKmtJHK5EbPt6pXukh/cRB5_Cul5QQlr_G2j4Sa6S/public/404-bg.webm"
      posterSrc="/404-poster.jpg"
      videoClassName="opacity-60"
      overlayClassName="bg-white/25"
      secondaryOverlayClassName="bg-black/40"
    />
  )
}
