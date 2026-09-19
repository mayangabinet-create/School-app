import type { Metadata, Viewport } from 'next';
import './globals.css';
export const metadata: Metadata = {title:'School — your school day, organised',description:'Tasks, deadlines, timetable, notes and exam preparation in one personal workspace.'};
export const viewport: Viewport = {themeColor:'#f6f7f9'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en" dir="ltr"><body>{children}</body></html>;}
