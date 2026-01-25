import { usePageTracking, useActivityTracking } from '@/hooks/usePageTracking';

export function PageTracker() {
  usePageTracking();
  useActivityTracking();
  return null;
}
