import { useState, useCallback } from "react"
import type { OrderItem } from "../../schema"

/**
 * Manages orderItems state and operations
 */
export function useOrderItems() {
  const [orderItems, setOrderItems] = useState<OrderItem[]>([])

  /**
   * Add multiple items to the order
   */
  const addItems = useCallback((newItems: OrderItem[]) => {
    setOrderItems((prev) => [...prev, ...newItems])
  }, [])

  /**
   * Delete an item from the order
   */
  const deleteItem = useCallback((itemId: string) => {
    setOrderItems((prev) => prev.filter((item) => item.id !== itemId))
  }, [])

  /**
   * Update a specific field of an item
   */
  const updateItemField = useCallback(
    (itemId: string, field: keyof OrderItem, value: string | number | null) => {
      setOrderItems((prev) =>
        prev.map((item) => (item.id === itemId ? { ...item, [field]: value } : item))
      )
    },
    []
  )

  /**
   * Update multiple fields of an item
   */
  const updateItem = useCallback((itemId: string, updates: Partial<OrderItem>) => {
    setOrderItems((prev) =>
      prev.map((item) => (item.id === itemId ? { ...item, ...updates } : item))
    )
  }, [])

  /**
   * Get an item by ID
   */
  const getItem = useCallback((itemId: string) => {
    return orderItems.find((item) => item.id === itemId)
  }, [orderItems])

  return {
    orderItems,
    setOrderItems,
    addItems,
    deleteItem,
    updateItemField,
    updateItem,
    getItem,
  }
}
