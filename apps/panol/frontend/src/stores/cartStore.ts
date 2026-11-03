import { create } from 'zustand';
import { CatalogItem, CartItem } from '../types';

interface CartState {
  items: CartItem[];
  targetPlate: string;
  targetType: 'TRACTOR' | 'SEMI';
  addItem: (item: CatalogItem) => void;
  removeItem: (itemId: string) => void;
  updateQuantity: (itemId: string, delta: number) => void;
  setQuantity: (itemId: string, quantity: number) => void;
  setTargetPlate: (plate: string, type: 'TRACTOR' | 'SEMI') => void;
  clearCart: () => void;
}

export const useCartStore = create<CartState>((set) => ({
  items: [],
  targetPlate: '',
  targetType: 'TRACTOR',

  addItem: (item) => set((state) => {
    const existing = state.items.find((i) => i.item.id === item.id);
    if (existing) {
      return {
        items: state.items.map((i) =>
          i.item.id === item.id ? { ...i, quantity: i.quantity + 1 } : i
        ),
      };
    }
    return {
      items: [
        ...state.items,
        {
          item,
          quantity: 1,
          exchangeStatus: item.requires_exchange ? 'PENDIENTE' : 'NO_APLICA',
        },
      ],
    };
  }),

  removeItem: (itemId) => set((state) => ({
    items: state.items.filter((i) => i.item.id !== itemId),
  })),

  updateQuantity: (itemId, delta) => set((state) => ({
    items: state.items
      .map((i) => {
        if (i.item.id === itemId) {
          const newQty = i.quantity + delta;
          return newQty > 0 ? { ...i, quantity: newQty } : null;
        }
        return i;
      })
      .filter((i): i is CartItem => i !== null),
  })),

  setQuantity: (itemId, quantity) => set((state) => ({
    items: state.items.map((i) =>
      i.item.id === itemId ? { ...i, quantity: Math.max(1, quantity) } : i
    ),
  })),

  setTargetPlate: (plate, type) => set({ targetPlate: plate, targetType: type }),

  clearCart: () => set({ items: [] }),
}));
