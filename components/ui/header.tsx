"use client"

import type { ReactNode } from "react"
import Link from "next/link"
import { ChevronLeft, Settings, User } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type HeaderProps = {
  title?: ReactNode
  showBackButton?: boolean
  transparent?: boolean
}

export function Header({ title, showBackButton = false, transparent = false }: HeaderProps) {
  const wrapperClass = cn(
    "sticky top-0 z-50 w-full",
    transparent
      ? ""
      : "border-b border-slate-200/80 bg-white/70 backdrop-blur-sm dark:border-slate-800/80 dark:bg-slate-950/70",
  )

  return (
    <header className={wrapperClass}>
      <div className="mx-auto flex h-16 max-w-[1600px] items-center px-4 md:px-8">
        {/* Left: Back button */}
        <div className="flex flex-1 items-center justify-start gap-3">
          {showBackButton && (
            <Link
              href="/"
              className="group flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition-all duration-300 hover:bg-slate-100/80 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/80 dark:hover:text-slate-100"
            >
              <ChevronLeft className="h-4 w-4 transition-transform duration-300 group-hover:-translate-x-1" />
              <span className="text-sm font-bold">戻る</span>
            </Link>
          )}
        </div>

        {/* Center: Title */}
        <div className="flex flex-none items-center justify-center px-2">{title}</div>

        {/* Right: Icons */}
        <div className="flex flex-1 items-center justify-end gap-2">
          <Link href="/admin">
            <Button
              variant="ghost"
              size="icon"
              className="text-slate-400 transition-all duration-300 ease-out hover:rotate-180 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-100"
            >
              <Settings className="h-5 w-5" />
              <span className="sr-only">設定（管理者）</span>
            </Button>
          </Link>

          <Link href="/profile">
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full text-slate-400 transition-all duration-300 ease-out hover:scale-110 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-100"
            >
              <User className="h-5 w-5" />
              <span className="sr-only">ユーザーメニュー</span>
            </Button>
          </Link>
        </div>
      </div>
    </header>
  )
}
