'use client'

import type React from 'react'
import { useEffect, useMemo, useState } from 'react'
import {
  type Control,
  Controller,
  type UseFormRegister,
  type UseFormSetValue,
  type UseFormWatch,
  useFieldArray,
  useWatch,
} from 'react-hook-form'

import { Plus, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

import type { OrderFormData } from './schema'

type OrderFormItemsProps = {
  control: Control<OrderFormData>
  register: UseFormRegister<OrderFormData>
  watch: UseFormWatch<OrderFormData>
  setValue: UseFormSetValue<OrderFormData>
}

function NumericInput({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: number
  onChange: (value: number) => void
  placeholder?: string
  className?: string
}) {
  const [isFocused, setIsFocused] = useState(false)
  const [inputValue, setInputValue] = useState(String(value ?? ''))

  const handleFocus = () => {
    setIsFocused(true)
    setInputValue(value === 0 ? '' : String(value))
  }

  const handleBlur = () => {
    setIsFocused(false)
    const numericValue = Number.parseFloat(inputValue) || 0
    onChange(numericValue)
    setInputValue(String(numericValue))
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    // Allow only numbers and decimal point
    if (val === '' || /^-?[0-9]*\.?[0-9]*$/.test(val)) {
      setInputValue(val)
    }
  }

  const displayValue = isFocused
    ? inputValue
    : value != null
      ? value.toLocaleString('ja-JP')
      : ''

  return (
    <Input
      type={isFocused ? 'text' : 'text'}
      inputMode="numeric"
      value={displayValue}
      onChange={handleChange}
      onFocus={handleFocus}
      onBlur={handleBlur}
      placeholder={placeholder}
      className={`${className} [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`}
    />
  )
}

export function OrderFormItems({
  control,
  register,
  watch,
  setValue,
}: OrderFormItemsProps) {
  const { fields, append, remove } = useFieldArray({
    control,
    name: 'items',
  })

  const formValues = useWatch({ control })

  useEffect(() => {
    fields.forEach((_, index) => {
      const quantity = formValues.items?.[index]?.quantity ?? 0
      const unitPrice = formValues.items?.[index]?.unitPrice ?? 0
      const calculatedAmount = quantity * unitPrice

      if (formValues.items?.[index]?.amount !== calculatedAmount) {
        setValue(`items.${index}.amount`, calculatedAmount, {
          shouldValidate: false,
        })
      }
    })
  }, [formValues.items, fields, setValue])

  const watchedItems = useWatch({ control, name: 'items' })

  const totalAmountString = useMemo(() => {
    const total = (watchedItems ?? []).reduce((sum, item) => {
      return sum + (item?.amount ?? 0)
    }, 0)
    return total.toLocaleString('ja-JP')
  }, [watchedItems])

  const addItem = () => {
    append({
      productName: '',
      description: '',
      quantity: 0,
      unitPrice: 0,
      amount: 0,
    })
  }

  const removeItem = (index: number) => {
    if (fields.length > 1) {
      remove(index)
    }
  }

  return (
    <Card className="elevation-1 from-secondary/5 border-0 bg-gradient-to-br to-transparent p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-secondary flex items-center gap-2 font-semibold">
          <div className="bg-secondary h-1 w-1 rounded-full" />
          品目一覧
        </h3>
        <Button
          onClick={addItem}
          size="sm"
          className="text-accent-foreground bg-slate-600 hover:bg-slate-600/90"
        >
          <Plus className="mr-1 h-4 w-4" />
          品目を追加
        </Button>
      </div>

      <p className="text-muted-foreground mb-4 text-sm">
        品目を追加、編集、削除できます
      </p>

      <div className="space-y-4">
        {fields.map((field, index) => (
          <Card
            key={field.id}
            className="elevation-1 border-border/50 bg-background border p-4"
          >
            <div className="mb-3 flex items-center justify-between">
              <span className="text-muted-foreground text-sm font-semibold">
                No. {index + 1}
              </span>
              {fields.length > 1 && (
                <Button
                  onClick={() => removeItem(index)}
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive h-8"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>

            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-4">
                <div>
                  <label className="text-muted-foreground mb-1.5 block text-sm font-medium">
                    品目名
                  </label>
                  <Input
                    {...register(`items.${index}.productName`)}
                    placeholder="品目名を入力"
                    className="elevation-1 bg-muted/30 border-0"
                  />
                </div>
                <div>
                  <label className="text-muted-foreground mb-1.5 block text-sm font-medium">
                    単価
                  </label>
                  <Controller
                    control={control}
                    name={`items.${index}.unitPrice`}
                    render={({ field }) => (
                      <NumericInput
                        value={field.value}
                        onChange={field.onChange}
                        placeholder="0"
                        className="elevation-1 bg-muted/30 border-0 font-mono"
                      />
                    )}
                  />
                </div>
                <div>
                  <label className="text-muted-foreground mb-1.5 block text-sm font-medium">
                    数量
                  </label>
                  <Controller
                    control={control}
                    name={`items.${index}.quantity`}
                    render={({ field }) => (
                      <NumericInput
                        value={field.value}
                        onChange={field.onChange}
                        placeholder="1"
                        className="elevation-1 bg-muted/30 border-0"
                      />
                    )}
                  />
                </div>
                <div>
                  <label className="text-muted-foreground mb-1.5 block text-sm font-medium">
                    小計
                  </label>
                  <div className="bg-muted/50 flex h-10 items-center rounded-md px-3 font-mono text-sm font-semibold">
                    ¥
                    {((watchedItems?.[index]?.amount ?? 0) || 0).toLocaleString(
                      'ja-JP'
                    )}
                  </div>
                </div>
              </div>

              <div>
                <label className="text-muted-foreground mb-1.5 block text-sm font-medium">
                  摘要
                </label>
                <Textarea
                  {...register(`items.${index}.description`)}
                  className="elevation-1 bg-muted/30 border-0"
                  rows={2}
                />
              </div>
            </div>
          </Card>
        ))}

        <div className="elevation-2 rounded-lg bg-slate-600 p-4">
          <div className="flex items-center justify-between">
            <label className="text-accent-foreground text-sm font-semibold">
              合計金額（税抜き）：
            </label>
            <div className="text-accent-foreground text-2xl font-bold">
              ¥{totalAmountString}
            </div>
          </div>
        </div>
      </div>
    </Card>
  )
}
