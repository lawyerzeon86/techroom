export type Product = {
  id: number;
  category: string;
  title: string;
  price: number;
  oldPrice?: number | null;
  rating: number;
  reviews: number;
  badge?: string | null;
  emoji?: string | null;
  imageUrl?: string | null;
  imageUrls?: string[];
  sku?: string | null;
  oem?: string | null;
  stock: number;
  description?: string | null;
  specs?: string | null;
  isActive: boolean;
  sortOrder: number;
};

// The site catalog must contain only products imported from real marketplaces.
// Never add demo, placeholder, sample, or invented products here.
export const seedProducts: Omit<Product, 'id'>[] = [];
