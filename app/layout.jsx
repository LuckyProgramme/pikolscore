import { Outfit } from 'next/font/google';
import './globals.css';

const outfit = Outfit({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800', '900'],
  variable: '--font-outfit',
  display: 'swap',
});

export const metadata = {
  title: 'PikolScore | Courtside Precision',
  description: 'Tactile Pickleball Match Tracker and Scoreboard for Tablet and Mobile Landscape',
};

export const viewport = {
  themeColor: '#203F39',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={outfit.variable}>
      <body className={outfit.className}>{children}</body>
    </html>
  );
}
