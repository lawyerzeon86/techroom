import './globals.css';
import '../lib/vk-auto-sync';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Duisun — техника, запчасти, гаджеты и 3D-печать',
  description: 'Интернет-магазин Duisun: автозапчасти, электроника, гаджеты и товары 3D-печати.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="ru"><body>{children}</body></html>;
}
