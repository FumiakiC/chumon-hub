"use client"

import { AlertTriangle, CheckCircle2, Eye, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Spinner } from "@/components/ui/spinner"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"
import type { OrderItem, OrderItemStatus } from "../schema"

function StatusIcon({ status }: { status: OrderItemStatus }) {
  switch (status) {
    case "pending":
    case "cropping":
    case "analyzing":
      return <Spinner className="size-5 text-blue-500" />
    case "completed":
      return <CheckCircle2 className="size-5 text-emerald-500" />
    case "needs_review":
      return <AlertTriangle className="size-5 text-amber-500" />
    case "error":
      return <AlertTriangle className="size-5 text-red-500" />
    default:
      return null
  }
}

export interface AnalysisTableProps {
  orderItems: OrderItem[]
  completedCount: number
  reviewCount: number
  processingCount: number
  onUpdateItemField: (itemId: string, field: keyof OrderItem, value: string | number | null) => void
  onVerify: (item: OrderItem) => void
  onDelete: (itemId: string) => void
}

export function AnalysisTable({
  orderItems,
  completedCount,
  reviewCount,
  processingCount,
  onUpdateItemField,
  onVerify,
  onDelete,
}: AnalysisTableProps) {
  return (
    <Card className="lg:w-2/3">
      <CardHeader className="bg-muted/50 border-b">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2">
            <Badge variant="outline">Phase 2</Badge>
            <CardTitle className="text-lg">解析結果</CardTitle>
          </div>
          {orderItems.length > 0 && (
            <div className="flex gap-2 text-xs">
              <Badge variant="secondary" className="gap-1">
                <CheckCircle2 className="size-3 text-emerald-500" /> {completedCount}
              </Badge>
              {reviewCount > 0 && (
                <Badge variant="secondary" className="gap-1">
                  <AlertTriangle className="size-3 text-amber-500" /> {reviewCount}
                </Badge>
              )}
              {processingCount > 0 && (
                <Badge variant="secondary" className="gap-1">
                  <Spinner className="size-3" /> {processingCount}
                </Badge>
              )}
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent className="p-0">
        <div className="max-h-[600px] overflow-y-auto">
          <Table>
            <TableHeader className="sticky top-0 bg-background z-10">
              <TableRow>
                <TableHead className="w-[50px]">状態</TableHead>
                <TableHead>図面番号</TableHead>
                <TableHead>品名</TableHead>
                <TableHead>材質</TableHead>
                <TableHead className="w-[80px]">数量</TableHead>
                <TableHead className="w-[80px]">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orderItems.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                    解析結果がここに表示されます
                  </TableCell>
                </TableRow>
              ) : (
                orderItems.map((item) => (
                  <TableRow key={item.id} className={cn(item.needsReview && "bg-amber-50/50 dark:bg-amber-950/10")}>
                    <TableCell>
                      <div className="flex justify-center">
                        <StatusIcon status={item.status} />
                      </div>
                    </TableCell>
                    <TableCell>
                      <Input
                        value={item.drawingNo}
                        onChange={(e) => onUpdateItemField(item.id, "drawingNo", e.target.value)}
                        className="h-8"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        value={item.partName}
                        onChange={(e) => onUpdateItemField(item.id, "partName", e.target.value)}
                        className="h-8"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        value={item.material}
                        onChange={(e) => onUpdateItemField(item.id, "material", e.target.value)}
                        className="h-8"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        value={item.quantity ?? ""}
                        onChange={(e) =>
                          onUpdateItemField(
                            item.id,
                            "quantity",
                            e.target.value === "" ? null : Number(e.target.value)
                          )
                        }
                        className="h-8"
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="size-8" onClick={() => onVerify(item)}>
                          <Eye className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-destructive"
                          onClick={() => onDelete(item.id)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}