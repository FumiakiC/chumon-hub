"use client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import type { UseFormReturn } from "react-hook-form"
import type { CroppedFile, OrderItem, VerificationFormData } from "../schema"

export interface VerificationSheetProps {
  isPreviewOpen: boolean
  onPreviewOpenChange: (open: boolean) => void
  previewFile: CroppedFile | null
  isSheetOpen: boolean
  onSheetOpenChange: (open: boolean) => void
  selectedItem: OrderItem | null
  verificationForm: UseFormReturn<VerificationFormData>
  onVerificationSubmit: (data: VerificationFormData) => void
}

export function VerificationSheet({
  isPreviewOpen,
  onPreviewOpenChange,
  previewFile,
  isSheetOpen,
  onSheetOpenChange,
  selectedItem,
  verificationForm,
  onVerificationSubmit,
}: VerificationSheetProps) {
  return (
    <>
      <Sheet open={isPreviewOpen} onOpenChange={onPreviewOpenChange}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>プレビュー</SheetTitle>
          </SheetHeader>
          <div className="mt-4 aspect-video bg-muted rounded border overflow-hidden">
            {previewFile?.base64 && <iframe src={previewFile.base64} className="w-full h-full" title="図面プレビュー" />}
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={isSheetOpen} onOpenChange={onSheetOpenChange}>
        <SheetContent className="sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>データ確認・修正</SheetTitle>
            <SheetDescription>抽出結果を確認してください</SheetDescription>
          </SheetHeader>
          {selectedItem && (
            <div className="py-4 space-y-4">
              <div className="aspect-[16/9] bg-muted rounded border overflow-hidden relative">
                {selectedItem.previewUrl ? (
                  <iframe src={selectedItem.previewUrl} className="w-full h-full" title="抽出結果図面プレビュー" />
                ) : (
                  <div className="flex items-center justify-center h-full text-muted-foreground">
                    プレビューなし
                  </div>
                )}
                <Badge className="absolute bottom-2 left-2">信頼度: {selectedItem.confidence}%</Badge>
              </div>

              <form
                onSubmit={verificationForm.handleSubmit(onVerificationSubmit)}
                className="space-y-4"
              >
                <div className="grid gap-2">
                  <Label>図面番号</Label>
                  <Input {...verificationForm.register("drawingNo")} />
                </div>
                <div className="grid gap-2">
                  <Label>品名</Label>
                  <Input {...verificationForm.register("partName")} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label>材質</Label>
                    <Input {...verificationForm.register("material")} />
                  </div>
                  <div className="grid gap-2">
                    <Label>数量</Label>
                    <Input
                      type="number"
                      {...verificationForm.register("quantity", {
                        setValueAs: (v) => (v === "" ? null : Number(v)),
                      })}
                    />
                  </div>
                </div>
                <Button type="submit" className="w-full">
                  確認完了
                </Button>
              </form>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  )
}
