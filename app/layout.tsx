import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'TechRoom — техника, запчасти, гаджеты и 3D-печать',
  description: 'Интернет-магазин TechRoom: автозапчасти, электроника, гаджеты и товары 3D-печати.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="ru"><body>{children}</body></html>;
}
