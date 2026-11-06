import { redirect } from 'next/navigation';
import PlayerPortal from '@/components/player/PlayerPortal';

export const metadata = {
  title: 'PikolScore – Player Portal',
};

export default function PlayerPage() {
  // Player portal temporarily hidden while only the umpire role is active
  redirect('/umpire');
  return <PlayerPortal />;
}
