import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "HVM Control Panel | KVM VPS & VDS Virtualization",
  description: "Provision and manage QEMU/KVM Virtual Private Servers (VPS) and Virtual Dedicated Servers (VDS)",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
