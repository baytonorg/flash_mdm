import { useEffect } from 'react';
import { useLocation } from 'react-router';
import { recordNavigation } from '@/lib/operationalActivity';
export default function OperationalActivity() {
  const location = useLocation();
  useEffect(() => { recordNavigation(); }, [location.pathname]);
  return null;
}
