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

export const seedProducts: Omit<Product, 'id'>[] = [
  {category:'Автозапчасти',title:'Тормозные диски и колодки Brembo (комплект)',price:12990,oldPrice:null,rating:4.8,reviews:124,badge:'Хит',emoji:'◉',imageUrl:null,imageUrls:[],sku:'AUTO-001',oem:null,stock:8,description:'Комплект тормозных дисков и колодок.',specs:'Комплект: диски + колодки',isActive:true,sortOrder:10},
  {category:'Электроника',title:'Беспроводные наушники Apple AirPods Pro 2',price:24990,oldPrice:null,rating:4.9,reviews:312,badge:null,emoji:'◌',imageUrl:null,imageUrls:[],sku:'ELEC-001',oem:null,stock:12,description:'Беспроводные наушники с активным шумоподавлением.',specs:'Тип: TWS',isActive:true,sortOrder:20},
  {category:'Гаджеты',title:'Смарт-часы Xiaomi Watch S3',price:16990,oldPrice:null,rating:4.7,reviews:198,badge:null,emoji:'⌚',imageUrl:null,imageUrls:[],sku:'GAD-001',oem:null,stock:7,description:'Смарт-часы для повседневного использования.',specs:'Категория: смарт-часы',isActive:true,sortOrder:30},
  {category:'3D-печать',title:'PETG пластик для 3D-принтера (1 кг, чёрный)',price:1990,oldPrice:null,rating:4.8,reviews:76,badge:null,emoji:'◍',imageUrl:null,imageUrls:[],sku:'3DP-001',oem:null,stock:25,description:'PETG пластик для FDM 3D-печати.',specs:'Вес: 1 кг\nЦвет: чёрный',isActive:true,sortOrder:40},
  {category:'Автозапчасти',title:'Фара передняя LED для Audi A4 B9',price:45990,oldPrice:null,rating:4.6,reviews:42,badge:'Новинка',emoji:'▰',imageUrl:null,imageUrls:[],sku:'AUTO-002',oem:null,stock:3,description:'Передняя LED-фара для Audi A4 B9.',specs:'Совместимость: Audi A4 B9',isActive:true,sortOrder:50},
];
