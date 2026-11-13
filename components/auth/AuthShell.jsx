'use client';

import { Outfit } from 'next/font/google';
import LoginForm from '@/components/auth/LoginForm';
import CourtPanel from '@/components/auth/CourtPanel';

const outfit = Outfit({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-outfit',
  display: 'swap',
});

export function AuthShell({ initialMode = 'signin' }) {
  return (
    <div
      className={`${outfit.className} min-h-screen grid place-items-center bg-[#203F39] p-0 sm:p-6 lg:p-10 font-outfit text-[#203F39]`}
    >
      <main className="grid w-full max-w-[1360px] lg:grid-cols-2 min-h-screen sm:min-h-[820px] overflow-hidden rounded-none sm:rounded-[40px]">
        <LoginForm initialMode={initialMode} />
        <CourtPanel />
      </main>
    </div>
  );
}

export default AuthShell;
