import { Barlow_Condensed, Plus_Jakarta_Sans } from 'next/font/google';
import './globals.css';

const barlowCondensed = Barlow_Condensed({
  subsets: ['latin'],
  weight: ['600', '700', '800'],
  style: ['normal', 'italic'],
  variable: '--font-barlow-condensed',
  display: 'swap',
});

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-plus-jakarta',
  display: 'swap',
});

export const metadata = {
  title: 'PikolScore | Courtside Precision Scoreboard',
  description: 'Athletic dark-mode pickleball match officiating console, court hub, and TV display',
};

export const viewport = {
  themeColor: '#021024',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};

export default function RootLayout({ children }) {
  return (
    <html
      lang="en"
      className={`${barlowCondensed.variable} ${plusJakartaSans.variable}`}
    >
      <body className={plusJakartaSans.className}>{children}</body>
    </html>
  );
}
