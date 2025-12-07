import Link from "next/link"
import { FileText, FileClock, ClipboardList, Settings, User } from "lucide-react"
import { Button } from "@/components/ui/button"

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-slate-50 dark:bg-slate-950">
      {/* ▼ ヘッダーエリア (右側メニューボタンを目立たせないため背景はなし) */}
      <header className="sticky top-0 z-50 flex h-16 items-center justify-end px-6">
        {/* 右側のメニューエリア */}
        <div className="flex items-center gap-2">
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

          {/* ユーザーメニューボタン */}
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
      </header>

      {/* ▼ メインコンテンツ */}
      <main className="flex flex-1 flex-col items-center justify-center bg-gradient-to-br from-slate-50 via-slate-50 to-slate-100 px-4 py-12 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900">
        <div className="mb-16 text-center">
          <h1 className="mb-3 text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-50 md:text-4xl lg:text-5xl">
            注文書作成システム
          </h1>
          <p className="text-base text-slate-500 dark:text-slate-400">用途に合わせて注文書を作成・管理します</p>
        </div>

        <div className="grid w-full max-w-5xl grid-cols-1 gap-8 md:grid-cols-3">
          {/* 仮注文書作成カード */}
          <Link href="/provisional-order" className="group block h-full">
            <div className="relative flex h-full flex-col items-center justify-center overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-10 text-center shadow-sm transition-all duration-300 ease-out hover:-translate-y-2 hover:border-orange-200/50 hover:shadow-[0_20px_50px_-12px_rgba(249,115,22,0.25)] dark:border-slate-800 dark:bg-slate-900/80 dark:hover:border-orange-500/30 dark:hover:shadow-[0_20px_50px_-12px_rgba(249,115,22,0.15)]">
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-orange-50/0 to-orange-100/0 opacity-0 transition-opacity duration-300 group-hover:opacity-100 dark:from-orange-500/0 dark:to-orange-500/5 dark:group-hover:opacity-100" />

              <div className="relative mb-8">
                <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-50 to-orange-100 text-orange-500 shadow-sm transition-all duration-300 ease-out group-hover:scale-110 group-hover:from-orange-100 group-hover:to-orange-200 group-hover:shadow-md dark:from-orange-500/10 dark:to-orange-500/20 dark:text-orange-400 dark:group-hover:from-orange-500/20 dark:group-hover:to-orange-500/30">
                  <FileClock className="h-9 w-9 transition-transform duration-300 ease-out group-hover:rotate-[-8deg]" />
                </div>
              </div>

              <h2 className="relative mb-3 text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
                仮注文書作成
              </h2>
              <p className="relative text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                概算見積もりや
                <br />
                一時的な注文書を作成します
              </p>

              <div className="relative mt-6 flex items-center gap-2 text-sm font-medium text-orange-500 opacity-0 transition-all duration-300 group-hover:opacity-100 dark:text-orange-400">
                <span>作成する</span>
                <svg
                  className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </div>
          </Link>

          {/* 本注文書作成カード */}
          <Link href="/official-order" className="group block h-full">
            <div className="relative flex h-full flex-col items-center justify-center overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-10 text-center shadow-sm transition-all duration-300 ease-out hover:-translate-y-2 hover:border-blue-200/50 hover:shadow-[0_20px_50px_-12px_rgba(59,130,246,0.25)] dark:border-slate-800 dark:bg-slate-900/80 dark:hover:border-blue-500/30 dark:hover:shadow-[0_20px_50px_-12px_rgba(59,130,246,0.15)]">
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-blue-50/0 to-blue-100/0 opacity-0 transition-opacity duration-300 group-hover:opacity-100 dark:from-blue-500/0 dark:to-blue-500/5 dark:group-hover:opacity-100" />

              <div className="relative mb-8">
                <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-50 to-blue-100 text-blue-500 shadow-sm transition-all duration-300 ease-out group-hover:scale-110 group-hover:from-blue-100 group-hover:to-blue-200 group-hover:shadow-md dark:from-blue-500/10 dark:to-blue-500/20 dark:text-blue-400 dark:group-hover:from-blue-500/20 dark:group-hover:to-blue-500/30">
                  <FileText className="h-9 w-9 transition-transform duration-300 ease-out group-hover:rotate-[8deg]" />
                </div>
              </div>

              <h2 className="relative mb-3 text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
                本注文書作成
              </h2>
              <p className="relative text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                正式な発注処理として
                <br />
                確定した注文書を作成します
              </p>

              <div className="relative mt-6 flex items-center gap-2 text-sm font-medium text-blue-500 opacity-0 transition-all duration-300 group-hover:opacity-100 dark:text-blue-400">
                <span>作成する</span>
                <svg
                  className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </div>
          </Link>

          {/* 注文管理カード (準備中) */}
          <div className="group block h-full cursor-not-allowed">
            <div className="relative flex h-full flex-col items-center justify-center overflow-hidden rounded-2xl border border-slate-200/50 bg-slate-50 p-10 text-center opacity-70 dark:border-slate-800/50 dark:bg-slate-900/40">
              <div className="relative mb-8">
                <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500">
                  <ClipboardList className="h-9 w-9" />
                </div>
              </div>

              <h2 className="relative mb-3 text-xl font-semibold tracking-tight text-slate-500 dark:text-slate-400">
                注文管理
              </h2>
              <p className="relative text-sm leading-relaxed text-slate-400 dark:text-slate-500">
                既存の注文書を管理・
                <br />
                追跡します
              </p>

              <div className="relative mt-6">
                <span className="inline-flex items-center rounded-full bg-slate-200/80 px-3 py-1 text-xs font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                  Coming Soon
                </span>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
