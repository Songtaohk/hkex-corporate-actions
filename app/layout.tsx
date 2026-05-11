import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "香港上市公司事項查詢",
  description: "查看未來三個月香港 IPO、增發及分紅資料，並下載英文 Excel。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
