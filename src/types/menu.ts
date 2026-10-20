
export type MenuCategory = 'morning' | 'evening';

export interface MenuItem {
  id: string;
  name: string;
  nameTe: string;
  category: MenuCategory;
  serving: string;
  servingTe: string;
  price: number;
  available: boolean;
}
