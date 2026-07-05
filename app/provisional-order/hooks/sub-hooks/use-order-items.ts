import { useCallback, useReducer } from 'react'

import type { OrderItem } from '../../schema'

export type OrderAction =
  | { type: 'ADD_ITEMS'; payload: OrderItem[] }
  | { type: 'REMOVE_ITEM'; payload: string }
  | {
      type: 'UPDATE_ITEM'
      payload: { id: string; changes: Partial<OrderItem> }
    }

export function orderReducer(
  state: OrderItem[],
  action: OrderAction
): OrderItem[] {
  switch (action.type) {
    case 'ADD_ITEMS':
      return [...state, ...action.payload]
    case 'REMOVE_ITEM':
      return state.filter((item) => item.id !== action.payload)
    case 'UPDATE_ITEM':
      return state.map((item) =>
        item.id === action.payload.id
          ? { ...item, ...action.payload.changes }
          : item
      )
    default:
      return state
  }
}

/**
 * Manages orderItems state and operations
 */
export function useOrderItems() {
  const [orderItems, dispatch] = useReducer(orderReducer, [] as OrderItem[])

  /**
   * Add multiple items to the order
   */
  const addFiles = useCallback((newItems: OrderItem[]) => {
    dispatch({ type: 'ADD_ITEMS', payload: newItems })
  }, [])

  const addItems = addFiles

  /**
   * Delete an item from the order
   */
  const removeFile = useCallback((itemId: string) => {
    dispatch({ type: 'REMOVE_ITEM', payload: itemId })
  }, [])

  const deleteItem = removeFile

  /**
   * Update a specific field of an item
   */
  const updateItemField = useCallback(
    (itemId: string, field: keyof OrderItem, value: string | number | null) => {
      dispatch({
        type: 'UPDATE_ITEM',
        payload: {
          id: itemId,
          changes: { [field]: value } as Partial<OrderItem>,
        },
      })
    },
    []
  )

  /**
   * Update multiple fields of an item
   */
  const updateItem = useCallback(
    (itemId: string, updates: Partial<OrderItem>) => {
      dispatch({
        type: 'UPDATE_ITEM',
        payload: { id: itemId, changes: updates },
      })
    },
    []
  )

  /**
   * Get an item by ID
   */
  const getItem = useCallback(
    (itemId: string) => {
      return orderItems.find((item) => item.id === itemId)
    },
    [orderItems]
  )

  return {
    orderItems,
    dispatch,
    addFiles,
    removeFile,
    addItems,
    deleteItem,
    updateItemField,
    updateItem,
    getItem,
  }
}
