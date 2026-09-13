export default function TelegramLayout({ children }: { children: React.ReactNode }) {
  return <>{children}<script src="https://telegram.org/js/telegram-web-app.js" async /></>;
}
