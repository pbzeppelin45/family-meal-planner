import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "Family Meal Planner", description: "Plan family meals, inventory, grocery lists, and recipe emails." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
