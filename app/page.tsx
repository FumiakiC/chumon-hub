import Link from "next/link"
import { FileText, FileClock, ClipboardList } from "lucide-react" // FileDashed を FileClock に変更
import { Card } from "@/components/ui/card"

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 dark:bg-slate-950">
      <div className="mb-12 text-center">
        <h1 className="mb-4 text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-50 md:text-4xl">
          注文書作成システム
        </h1>
        <p className="text-slate-500 dark:text-slate-400">
          用途に合わせて注文書を作成・管理します
        </p>
      </div>

      <div className="grid w-full max-w-5xl grid-cols-1 gap-6 md:grid-cols-3">
        
        {/* 仮注文書作成カード */}
        <Link href="/provisional-order" className="group block h-full">
          <Card className="flex h-full flex-col items-center justify-center border-0 bg-white p-8 text-center shadow-md transition-all duration-300 hover:-translate-y-1 hover:shadow-xl dark:bg-slate-900">
            <div className="mb-6 rounded-full bg-orange-50 p-6 text-orange-600 transition-colors group-hover:bg-orange-100 dark:bg-orange-900/20 dark:text-orange-400">
              {/* アイコンを変更 */}
              <FileClock className="h-10 w-10" />
            </div>
            <h2 className="mb-3 text-xl font-bold text-slate-900 dark:text-slate-50">
              仮注文書作成
            </h2>
            <p className="text-sm leading-relaxed text-slate-500 dark:text-slate-400">
              概算見積もりや<br />
              一時的な注文書を作成します
            </p>
          </Card>
        </Link>

        {/* 本注文書作成カード */}
        <Link href="/official-order" className="group block h-full">
          <Card className="flex h-full flex-col items-center justify-center border-0 bg-white p-8 text-center shadow-md transition-all duration-300 hover:-translate-y-1 hover:shadow-xl dark:bg-slate-900">
            <div className="mb-6 rounded-full bg-blue-50 p-6 text-blue-600 transition-colors group-hover:bg-blue-100 dark:bg-blue-900/20 dark:text-blue-400">
              <FileText className="h-10 w-10" />
            </div>
            <h2 className="mb-3 text-xl font-bold text-slate-900 dark:text-slate-50">
              本注文書作成
            </h2>
            <p className="text-sm leading-relaxed text-slate-500 dark:text-slate-400">
              正式な発注処理として<br />
              確定した注文書を作成します
            </p>
          </Card>
        </Link>

        {/* 注文管理カード (準備中) */}
        <div className="group block h-full cursor-not-allowed opacity-60">
          <Card className="flex h-full flex-col items-center justify-center border-0 bg-slate-100 p-8 text-center shadow-none dark:bg-slate-800/50">
            <div className="mb-6 rounded-full bg-slate-200 p-6 text-slate-400 dark:bg-slate-800 dark:text-slate-500">
              <ClipboardList className="h-10 w-10" />
            </div>
            <h2 className="mb-3 text-xl font-bold text-slate-500 dark:text-slate-400">
              注文管理
            </h2>
            <p className="text-sm leading-relaxed text-slate-400 dark:text-slate-500">
              既存の注文書を管理・<br />
              追跡します
              <span className="mt-2 block text-xs font-semibold">(準備中)</span>
            </p>
          </Card>
        </div>

      </div>
    </div>
  )
}
