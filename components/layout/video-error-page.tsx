'use client'

import { useEffect, useRef } from 'react'

import Link from 'next/link'

import { logger } from '@/lib/logger'
import { cn } from '@/lib/utils'

type VideoErrorPageProps = {
  statusCode: string
  title: string
  message: string
  videoSrc: string
  posterSrc?: string
  videoClassName?: string
  overlayClassName?: string
  secondaryOverlayClassName?: string
  statusCodeClassName?: string
  titleClassName?: string
}

export function VideoErrorPage({
  statusCode,
  title,
  message,
  videoSrc,
  posterSrc,
  videoClassName = 'opacity-60',
  overlayClassName = 'bg-black/50',
  secondaryOverlayClassName,
  statusCodeClassName,
  titleClassName,
}: VideoErrorPageProps) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = true
      videoRef.current
        .play()
        .catch((error) => logger.warn('Video autoplay failed:', error))
    }
  }, [])

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-black text-white">
      <video
        ref={videoRef}
        autoPlay
        loop
        muted
        playsInline
        poster={posterSrc}
        className={cn(
          'absolute inset-0 z-0 h-full w-full object-cover',
          videoClassName
        )}
      >
        <source src={videoSrc} type="video/webm" />
      </video>

      <div className={cn('absolute inset-0 z-10', overlayClassName)} />
      {secondaryOverlayClassName && (
        <div
          className={cn('absolute inset-0 z-10', secondaryOverlayClassName)}
        />
      )}

      <div className="relative z-20 flex min-h-screen flex-col items-center justify-center px-4 text-center">
        <h1
          className={cn(
            'text-[8rem] leading-none font-bold tracking-tighter text-white sm:text-[12rem] md:text-[16rem]',
            statusCodeClassName
          )}
        >
          {statusCode}
        </h1>
        <h2
          className={cn(
            'mt-4 text-2xl font-semibold tracking-wide text-white/90 sm:text-3xl md:text-4xl',
            titleClassName
          )}
        >
          {title}
        </h2>
        <p className="mx-auto mt-4 w-full max-w-lg text-base font-semibold text-white/70 sm:text-lg">
          {message}
        </p>
        <Link
          href="/"
          className="mt-8 rounded-full border border-white/30 bg-white/10 px-8 py-3 text-sm font-medium text-white backdrop-blur-md transition-all duration-300 hover:scale-105 hover:border-white/50 hover:bg-white/20 sm:text-base"
        >
          Return Home
        </Link>
      </div>
    </div>
  )
}
