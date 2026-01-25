import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';

// Generate or retrieve a persistent visitor ID
function getVisitorId(): string {
  const storageKey = 'visitor_id';
  let visitorId = localStorage.getItem(storageKey);
  
  if (!visitorId) {
    visitorId = crypto.randomUUID();
    localStorage.setItem(storageKey, visitorId);
  }
  
  return visitorId;
}

export function usePageTracking() {
  const location = useLocation();
  const { user } = useAuth();

  useEffect(() => {
    const trackPageView = async () => {
      try {
        const visitorId = getVisitorId();
        
        await supabase.from('page_views').insert({
          visitor_id: visitorId,
          page_path: location.pathname,
          user_id: user?.id || null,
        });
      } catch (error) {
        // Silently fail - analytics should not break the app
        console.error('Failed to track page view:', error);
      }
    };

    trackPageView();
  }, [location.pathname, user?.id]);
}

export function useActivityTracking() {
  const { user } = useAuth();

  useEffect(() => {
    if (!user) return;

    const updateActivity = async () => {
      try {
        const { error } = await supabase
          .from('user_activity')
          .upsert({
            user_id: user.id,
            last_active_at: new Date().toISOString(),
            is_online: true,
          }, {
            onConflict: 'user_id',
          });

        if (error) {
          console.error('Failed to update activity:', error);
        }
      } catch (error) {
        console.error('Failed to update activity:', error);
      }
    };

    // Update on mount
    updateActivity();

    // Update periodically
    const interval = setInterval(updateActivity, 60000); // Every minute

    // Set offline on unmount
    return () => {
      clearInterval(interval);
      supabase
        .from('user_activity')
        .update({ is_online: false })
        .eq('user_id', user.id)
        .then(() => {});
    };
  }, [user?.id]);
}
