// Subscription service for checking user subscription status
import { supabase } from './supabase';

/**
 * Check if the current user has an active subscription
 * @returns Promise<boolean> - true if user has active subscription, false otherwise
 */
export async function checkSubscriptionStatus(): Promise<boolean> {
  try {
    // 1. Check if user is authenticated
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return false;
    }

    // 2. Get the user's session to access the JWT token
    const { data: { session } } = await supabase.auth.getSession();
    
    if (!session) {
      return false;
    }

    // 3. Query the backend API to check subscription status
    const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3000';
    
    const response = await fetch(`${BACKEND_URL}/api/stripe/payment-status`, {
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
      },
    });

    if (!response.ok) {
      return false;
    }

    const data = await response.json();

    // 4. Return true only if user has an active subscription
    return data.hasActivePlan === true && data.status === 'active';
  } catch {
    return false;
  }
}

/**
 * Get detailed subscription information for the current user
 * @returns Promise with subscription details or null
 */
export async function getSubscriptionDetails(): Promise<{
  hasActivePlan: boolean;
  plan: 'student' | 'enterprise' | null;
  status: 'active' | 'canceled' | 'past_due' | 'trialing' | null;
} | null> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return null;

    const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3000';
    
    const response = await fetch(`${BACKEND_URL}/api/stripe/payment-status`, {
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
      },
    });

    if (!response.ok) {
      return null;
    }

    return await response.json();
  } catch {
    return null;
  }
}
