'use client'

import type { Dispatch, SetStateAction } from 'react'
import { UseFormReturn } from 'react-hook-form'

import { format, isValid, parse } from 'date-fns'
import { ja } from 'date-fns/locale'
import { CalendarIcon, Check, Copy, FileText } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'

import { cn } from '@/lib/utils'

import { OrderFormItems } from './order-form-items'
import type { OrderFormData } from './schema'

type OrderFormProps = {
  form: UseFormReturn<OrderFormData>
  isCopied: boolean
  setIsCopied: Dispatch<SetStateAction<boolean>>
}

export function OrderForm({ form, isCopied, setIsCopied }: OrderFormProps) {
  const { register, control, watch, setValue } = form

  return (
    <div className="flex-1 space-y-6 lg:min-w-[50%]">
      <Card className="elevation-2 border-0 bg-white p-8 dark:bg-slate-900">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-secondary/10 rounded-full p-2">
              <FileText className="text-secondary h-5 w-5" />
            </div>
            <h2 className="text-foreground text-xl font-bold">
              発注フォーム（抽出結果）
            </h2>
          </div>
          <Button
            onClick={() => {
              if (!navigator.clipboard) {
                console.error('[v0] Clipboard API not available.')
                return
              }
              const currentValues = watch()
              const jsonString = JSON.stringify(currentValues, null, 2)
              navigator.clipboard
                .writeText(jsonString)
                .then(() => {
                  console.log('[v0] formData copied to clipboard')
                  setIsCopied(true)
                  setTimeout(() => setIsCopied(false), 2000)
                })
                .catch((err) => {
                  console.error('[v0] Failed to copy:', err)
                })
            }}
            variant="outline"
            size="sm"
            className="gap-2"
            disabled={
              !watch('orderNo') &&
              !watch('items')?.some((item) => item?.productName)
            }
          >
            {isCopied ? (
              <Check className="h-4 w-4" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
            {isCopied ? 'コピーしました' : 'コピー'}
          </Button>
        </div>

        <div className="space-y-6">
          <Card className="elevation-1 from-primary/5 border-0 bg-gradient-to-br to-transparent p-5">
            <h3 className="text-primary mb-4 flex items-center gap-2 font-semibold">
              <div className="bg-primary h-1 w-1 rounded-full" />
              基本情報
            </h3>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="text-muted-foreground mb-2 block text-sm font-medium">
                  注 No
                </label>
                <Input
                  {...register('orderNo')}
                  className="elevation-1 bg-background border-0 font-mono"
                />
              </div>
              <div>
                <label className="text-muted-foreground mb-2 block text-sm font-medium">
                  見積書 No.
                </label>
                <Input
                  {...register('quoteNo')}
                  className="elevation-1 bg-background border-0 font-mono"
                />
              </div>
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <label className="text-muted-foreground mb-2 block text-sm font-medium">
                  宛先（相手企業名）
                </label>
                <Input
                  {...register('recipientCompany')}
                  className="elevation-1 bg-background border-0"
                />
              </div>
              <div>
                <label className="text-muted-foreground mb-2 block text-sm font-medium">
                  発注元（自社名）
                </label>
                <Input
                  {...register('issuerCompany')}
                  className="elevation-1 bg-background border-0"
                />
              </div>
            </div>
          </Card>

          <OrderFormItems
            control={control}
            register={register}
            watch={watch}
            setValue={setValue}
          />

          <Card className="elevation-1 from-accent/5 border-0 bg-gradient-to-br to-transparent p-5">
            <h3 className="text-primary mb-4 flex items-center gap-2 font-semibold">
              <div className="bg-primary h-1 w-1 rounded-full" />
              納期・条件
            </h3>

            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="text-muted-foreground mb-2 block text-sm font-medium">
                    希望納期
                  </label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          'elevation-1 bg-background w-full justify-start border-0 text-left font-normal',
                          !watch('desiredDeliveryDate') &&
                            'text-muted-foreground'
                        )}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {watch('desiredDeliveryDate') &&
                        isValid(
                          parse(
                            watch('desiredDeliveryDate'),
                            'yyyyMMdd',
                            new Date()
                          )
                        )
                          ? format(
                              parse(
                                watch('desiredDeliveryDate'),
                                'yyyyMMdd',
                                new Date()
                              ),
                              'yyyy年MM月dd日',
                              { locale: ja }
                            )
                          : '日付を選択'}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={
                          watch('desiredDeliveryDate') &&
                          isValid(
                            parse(
                              watch('desiredDeliveryDate'),
                              'yyyyMMdd',
                              new Date()
                            )
                          )
                            ? parse(
                                watch('desiredDeliveryDate'),
                                'yyyyMMdd',
                                new Date()
                              )
                            : undefined
                        }
                        onSelect={(date: Date | undefined) => {
                          if (date) {
                            setValue(
                              'desiredDeliveryDate',
                              format(date, 'yyyyMMdd')
                            )
                          }
                        }}
                        locale={ja}
                      />
                    </PopoverContent>
                  </Popover>
                </div>
                <div>
                  <label className="text-muted-foreground mb-2 block text-sm font-medium">
                    請納期
                  </label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          'elevation-1 bg-background w-full justify-start border-0 text-left font-normal',
                          !watch('requestedDeliveryDate') &&
                            'text-muted-foreground'
                        )}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {watch('requestedDeliveryDate') &&
                        isValid(
                          parse(
                            watch('requestedDeliveryDate'),
                            'yyyyMMdd',
                            new Date()
                          )
                        )
                          ? format(
                              parse(
                                watch('requestedDeliveryDate'),
                                'yyyyMMdd',
                                new Date()
                              ),
                              'yyyy年MM月dd日',
                              { locale: ja }
                            )
                          : '日付を選択'}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={
                          watch('requestedDeliveryDate') &&
                          isValid(
                            parse(
                              watch('requestedDeliveryDate'),
                              'yyyyMMdd',
                              new Date()
                            )
                          )
                            ? parse(
                                watch('requestedDeliveryDate'),
                                'yyyyMMdd',
                                new Date()
                              )
                            : undefined
                        }
                        onSelect={(date: Date | undefined) => {
                          if (date) {
                            setValue(
                              'requestedDeliveryDate',
                              format(date, 'yyyyMMdd')
                            )
                          }
                        }}
                        locale={ja}
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              </div>

              <div>
                <label className="text-muted-foreground mb-2 block text-sm font-medium">
                  支払条件
                </label>
                <Input
                  {...register('paymentTerms')}
                  className="elevation-1 bg-background border-0"
                />
              </div>

              <div>
                <label className="text-muted-foreground mb-2 block text-sm font-medium">
                  受渡場所
                </label>
                <Input
                  {...register('deliveryLocation')}
                  className="elevation-1 bg-background border-0"
                />
              </div>

              <div>
                <label className="text-muted-foreground mb-2 block text-sm font-medium">
                  検査完了期日
                </label>
                <Input
                  {...register('inspectionDeadline')}
                  className="elevation-1 bg-background border-0"
                />
              </div>
            </div>
          </Card>

          <Card className="elevation-1 from-primary/5 border-0 bg-gradient-to-br to-transparent p-5">
            <h3 className="text-primary mb-4 flex items-center gap-2 font-semibold">
              <div className="bg-primary h-1 w-1 rounded-full" />
              担当者情報
            </h3>

            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="text-muted-foreground mb-2 block text-sm font-medium">
                    担当
                  </label>
                  <Input
                    {...register('manager')}
                    className="elevation-1 bg-background border-0"
                  />
                </div>
                <div>
                  <label className="text-muted-foreground mb-2 block text-sm font-medium">
                    承認
                  </label>
                  <Input
                    {...register('approver')}
                    className="elevation-1 bg-background border-0"
                    placeholder="（空欄）"
                  />
                </div>
              </div>

              <div>
                <label className="text-muted-foreground mb-2 block text-sm font-medium">
                  自社住所
                </label>
                <Input
                  {...register('issuerAddress')}
                  className="elevation-1 bg-background border-0"
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="text-muted-foreground mb-2 block text-sm font-medium">
                    電話
                  </label>
                  <Input
                    {...register('phone')}
                    className="elevation-1 bg-background border-0 font-mono"
                  />
                </div>
                <div>
                  <label className="text-muted-foreground mb-2 block text-sm font-medium">
                    FAX
                  </label>
                  <Input
                    {...register('fax')}
                    className="elevation-1 bg-background border-0 font-mono"
                  />
                </div>
              </div>
            </div>
          </Card>
        </div>
      </Card>
    </div>
  )
}
