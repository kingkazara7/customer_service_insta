import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PartSelect 配件助手 | 冰箱 & 洗碗机零件",
  description:
    "PartSelect 智能客服:冰箱/洗碗机故障诊断、零件查询、兼容性确认、安装指导与订购。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
