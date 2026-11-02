import AuthShell from '@/components/auth/AuthShell';

export const metadata = {
  title: 'PikolScore – Umpire Console',
};

export default function UmpirePage() {
  return <AuthShell initialMode="signin" />;
}
