import Link from "next/link"

export default function NotFound() {
  return (
    <div className="relative min-h-screen w-full overflow-hidden">
      {/* Background Video */}
      <video
        autoPlay
        loop
        muted
        playsInline
        poster="/404-poster.jpg"
        className="absolute inset-0 z-[-1] h-full w-full object-cover opacity-60"
      >
        <source src="/404-bg.webm" type="video/webm" />
      </video>

      {/* Dark Overlay */}
      <div className="absolute inset-0 bg-black/50" />

      {/* Content */}
      <div className="relative z-10 flex min-h-screen flex-col items-center justify-center px-4 text-center">
        <h1 className="text-[8rem] font-bold leading-none tracking-tighter text-white sm:text-[12rem] md:text-[16rem]">
          404
        </h1>

        <h2 className="mt-4 text-2xl font-semibold tracking-wide text-white/90 sm:text-3xl md:text-4xl">
          虚空への現実逃避
        </h2>

        <p className="mt-4 w-full text-base text-white/70 sm:text-lg font-semibold">
          お探しのページは「自分探しの旅に出たい」と言い残し、どこかへ流れていきました。
        </p>

        <Link
          href="/"
          className="mt-8 rounded-full border border-white/30 bg-white/10 px-8 py-3 text-sm font-medium text-white backdrop-blur-md transition-all duration-300 hover:bg-white/20 hover:border-white/50 hover:scale-105 sm:text-base"
        >
          Return Home
        </Link>
      </div>
    </div>
  )
}
