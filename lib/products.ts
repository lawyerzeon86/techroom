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
  {category:'3D-печать',title:'Готическое кольцо с чёрной розой',price:999,oldPrice:null,rating:5.0,reviews:0,badge:'Новинка',emoji:'🌹',imageUrl:'https://media.canva.com/v2/document-image/hash:-6592298/height:506/id:DAHWCuAgCa4/type:B/width:394?brand=BAHU1-Gyp1o&csig=AAAAAAAAAAAAAAAAAAAAAIN7FdfITN6MG4MGkLvMRtTKqbK70oemw6hLgH4CmG0z&disableexport=T&exp=1790196884&fallback=https%3A%2F%2Fs3.amazonaws.com%2Fdocument-export.canva.com%2FAgCa4%2FDAHWCuAgCa4%2F1%2Fthumbnail%2F0001.png%3FX-Amz-Algorithm%3DAWS4-HMAC-SHA256%26X-Amz-Credential%3DAKIAQYCGKMUHTDF2ZFFQ%252F20260923%252Fus-east-1%252Fs3%252Faws4_request%26X-Amz-Date%3D20260923T042657Z%26X-Amz-Expires%3D61967%26X-Amz-Signature%3D69eba0157883e7d709f19b5aed10f1b2583c147085b31fe13390b9eae5ae8c2e%26X-Amz-SignedHeaders%3Dhost%26response-expires%3DWed%252C%252023%2520Sep%25202026%252021%253A39%253A44%2520GMT&osig=AAAAAAAAAAAAAAAAAAAAAFi40BAU_-hZWVXvKgqW5toXjXpkNVLiq_1mkIusrxmG&page=1&signed=brand%2Cdisableexport%2Cfallback%2Cpage%2Cversion&signer=document-rpc&version=1',imageUrls:['https://media.canva.com/v2/document-image/hash:-6592298/height:506/id:DAHWCuAgCa4/type:B/width:394?brand=BAHU1-Gyp1o&csig=AAAAAAAAAAAAAAAAAAAAAIN7FdfITN6MG4MGkLvMRtTKqbK70oemw6hLgH4CmG0z&disableexport=T&exp=1790196884&fallback=https%3A%2F%2Fs3.amazonaws.com%2Fdocument-export.canva.com%2FAgCa4%2FDAHWCuAgCa4%2F1%2Fthumbnail%2F0001.png%3FX-Amz-Algorithm%3DAWS4-HMAC-SHA256%26X-Amz-Credential%3DAKIAQYCGKMUHTDF2ZFFQ%252F20260923%252Fus-east-1%252Fs3%252Faws4_request%26X-Amz-Date%3D20260923T042657Z%26X-Amz-Expires%3D61967%26X-Amz-Signature%3D69eba0157883e7d709f19b5aed10f1b2583c147085b31fe13390b9eae5ae8c2e%26X-Amz-SignedHeaders%3Dhost%26response-expires%3DWed%252C%252023%2520Sep%25202026%252021%253A39%253A44%2520GMT&osig=AAAAAAAAAAAAAAAAAAAAAFi40BAU_-hZWVXvKgqW5toXjXpkNVLiq_1mkIusrxmG&page=1&signed=brand%2Cdisableexport%2Cfallback%2Cpage%2Cversion&signer=document-rpc&version=1'],sku:'dskgothring1',oem:null,stock:5,description:'Чёрное готическое кольцо с объёмной розой из ASA-пластика. Выразительный аксессуар для готического, альтернативного и повседневного образа. Подойдёт для фотосессий, тематических мероприятий и в качестве оригинального подарка.',specs:'Материал: ASA пластик\nРазмер изделия: 3 × 3 × 0,5 см\nВес: 20 г\nРазмер упаковки: 8 × 13 × 3 см\nАртикул: dskgothring1',isActive:true,sortOrder:6},
  {category:'3D-печать',title:'Готическая фигурка-призрак из ASA пластика',price:299,oldPrice:null,rating:5.0,reviews:0,badge:'Новинка',emoji:'👻',imageUrl:'/products/dskgothtoy1-main.jpg',imageUrls:['/products/dskgothtoy1-main.jpg'],sku:'dskgothtoy1',oem:null,stock:1,description:'Компактная готическая фигурка-призрак для стола, полки, рабочего места или салона автомобиля. Атмосферный декор с выразительным силуэтом, напечатанный из прочного ASA-пластика. Маленькая фигурка — большая атмосфера.',specs:'Материал: ASA пластик\nВысота: 5 см\nШирина: 3,2 см\nТолщина: 3,2 см\nРазмер упаковки: 5 × 4 × 4 см\nНазначение: декор для стола, дома, офиса и автомобиля\nАртикул: dskgothtoy1',isActive:true,sortOrder:5},
  {category:'Автозапчасти',title:'Тормозные диски и колодки Brembo (комплект)',price:12990,oldPrice:null,rating:4.8,reviews:124,badge:'Хит',emoji:'◉',imageUrl:null,imageUrls:[],sku:'AUTO-001',oem:null,stock:8,description:'Комплект тормозных дисков и колодок.',specs:'Комплект: диски + колодки',isActive:true,sortOrder:10},
  {category:'Электроника',title:'Беспроводные наушники Apple AirPods Pro 2',price:24990,oldPrice:null,rating:4.9,reviews:312,badge:null,emoji:'◌',imageUrl:null,imageUrls:[],sku:'ELEC-001',oem:null,stock:12,description:'Беспроводные наушники с активным шумоподавлением.',specs:'Тип: TWS',isActive:true,sortOrder:20},
  {category:'Гаджеты',title:'Смарт-часы Xiaomi Watch S3',price:16990,oldPrice:null,rating:4.7,reviews:198,badge:null,emoji:'⌚',imageUrl:null,imageUrls:[],sku:'GAD-001',oem:null,stock:7,description:'Смарт-часы для повседневного использования.',specs:'Категория: смарт-часы',isActive:true,sortOrder:30},
  {category:'3D-печать',title:'PETG пластик для 3D-принтера (1 кг, чёрный)',price:1990,oldPrice:null,rating:4.8,reviews:76,badge:null,emoji:'◍',imageUrl:null,imageUrls:[],sku:'3DP-001',oem:null,stock:25,description:'PETG пластик для FDM 3D-печати.',specs:'Вес: 1 кг\nЦвет: чёрный',isActive:true,sortOrder:40},
  {category:'Автозапчасти',title:'Фара передняя LED для Audi A4 B9',price:45990,oldPrice:null,rating:4.6,reviews:42,badge:'Новинка',emoji:'▰',imageUrl:null,imageUrls:[],sku:'AUTO-002',oem:null,stock:3,description:'Передняя LED-фара для Audi A4 B9.',specs:'Совместимость: Audi A4 B9',isActive:true,sortOrder:50},
];
