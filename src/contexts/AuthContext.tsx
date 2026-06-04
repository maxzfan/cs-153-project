// Authentication context using Supabase
import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import { User, Session, AuthError } from '@supabase/supabase-js';
import { toast } from 'sonner';
import { features } from '@/lib/features';
import { desktopAPI } from '@/lib/desktop-api';

export type PaymentPlan = 'student' | 'enterprise' | null;

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  paymentPlan: PaymentPlan;
  hasVerifiedPlan: boolean;
  signUp: (email: string, password: string) => Promise<{ error: AuthError | null }>;
  signIn: (email: string, password: string) => Promise<{ error: AuthError | null }>;
  signInWithGoogle: () => Promise<{ error: AuthError | null }>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<{ error: AuthError | null }>;
  setPaymentPlan: (plan: PaymentPlan) => Promise<void>;
  refreshPaymentStatus: (options?: { retryAfterPayment?: boolean }) => Promise<boolean>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [paymentPlan, setPaymentPlanState] = useState<PaymentPlan>(null);
  const [paymentPlanLoaded, setPaymentPlanLoaded] = useState(false);

  const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3000';

  // Load payment plan from backend API (Supabase)
  // Returns true if user has active plan, false otherwise (for retry logic)
  // When keepOptimisticOnFailure is true, don't clear plan when API returns no plan (webhook may still be processing)
  const loadPaymentPlan = useCallback(async (keepOptimisticOnFailure = false): Promise<boolean> => {
    if (!features.payments) {
      setPaymentPlanState(null);
      setPaymentPlanLoaded(true);
      return false;
    }
    if (!user || !session?.access_token) {
      setPaymentPlanState(null);
      setPaymentPlanLoaded(false);
      return false;
    }

    try {
      const response = await fetch(`${BACKEND_URL}/api/stripe/payment-status`, {
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        if (data.hasActivePlan && data.plan) {
          setPaymentPlanState(data.plan as PaymentPlan);
          return true;
        } else {
          if (!keepOptimisticOnFailure) setPaymentPlanState(null);
          return false;
        }
      } else {
        if (!keepOptimisticOnFailure) {
          const stored = localStorage.getItem(`paymentPlan_${user.id}`);
          setPaymentPlanState((stored as PaymentPlan) || null);
        }
        return false;
      }
    } catch (error) {
      if (!keepOptimisticOnFailure) {
        const stored = localStorage.getItem(`paymentPlan_${user.id}`);
        setPaymentPlanState((stored as PaymentPlan) || null);
      }
      return false;
    } finally {
      setPaymentPlanLoaded(true);
    }
  }, [user, session, BACKEND_URL]);

  // Load payment plan when user changes
  useEffect(() => {
    loadPaymentPlan();
  }, [loadPaymentPlan]);

  // Subscription redirect disabled: Import is available on free plan; non-import features disabled for now
  // Previously: redirected to checkout when user signed in without subscription

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
      
      // Detect OAuth sign-in (Google auth redirects back with SIGNED_IN event)
      if (event === 'SIGNED_IN' && session) {
        // Check if this is a fresh OAuth sign-in by looking at URL params
        // OAuth redirects include fragments like #access_token=...
        const urlHash = window.location.hash;
        const urlParams = new URLSearchParams(window.location.search);
        
        // If URL contains auth tokens/params, this is likely a fresh OAuth sign-in

      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const signUp = async (email: string, password: string) => {
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${BACKEND_URL}/auth/confirmed`,
        },
      });

      if (error) {
        // Don't show toast here - let the form component handle it
        return { error };
      }

      if (data.user && !data.session) {
        // User needs to verify email
        toast.success('Account created! Please check your email to verify your account.');
      } else if (data.session) {
        // User is automatically signed in (if email confirmation is disabled)
        toast.success('Account created successfully!');
      }

      return { error: null };
    } catch (error) {
      const authError = error as AuthError;
      return { error: authError };
    }
  };

  const signIn = async (email: string, password: string) => {
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        // Don't show toast here - let the form component handle it
        return { error };
      }

      toast.success('Signed in successfully');
      return { error: null };
    } catch (error) {
      const authError = error as AuthError;
      return { error: authError };
    }
  };

  const signInWithGoogle = async () => {
    // Packaged Electron: route through the main-process loopback PKCE flow
    // because window.location.origin is `file://`, which Google rejects (see
    // docs/handoffs/2026-04-26-windows-tester-round-1.md §0a). Browser dev:
    // fall through to the default supabase.auth.signInWithOAuth path.
    if (desktopAPI.isDesktop) {
      try {
        const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL || '').trim().replace(/\/+$/, '');
        const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();
        const result = await desktopAPI.startGoogleSignIn(supabaseUrl, anonKey);
        if (!result || !result.ok) {
          const code = result?.error.code ?? 'OAUTH_FAILED';
          const message = result?.error.message ?? 'Sign-in failed';
          if (code !== 'OAUTH_CANCELLED') toast.error(message);
          return { error: { name: code, message } as AuthError };
        }
        const { error } = await supabase.auth.setSession({
          access_token: result.tokens.access_token,
          refresh_token: result.tokens.refresh_token,
        });
        if (error) {
          toast.error(error.message);
          return { error };
        }
        toast.success('Signed in successfully');
        return { error: null };
      } catch (error) {
        const authError = error as AuthError;
        toast.error(authError.message);
        return { error: authError };
      }
    }

    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}`,
          queryParams: {
            access_type: 'offline',
            prompt: 'consent',
          },
        },
      });

      if (error) {
        toast.error(error.message);
        return { error };
      }

      // OAuth will redirect, so no success toast here
      return { error: null };
    } catch (error) {
      const authError = error as AuthError;
      toast.error(authError.message);
      return { error: authError };
    }
  };

  const signOut = async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        toast.error(error.message);
        throw error;
      }
      toast.success('Signed out successfully');
    } catch (error) {
      throw error;
    }
  };

  const resetPassword = async (email: string) => {
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });

      if (error) {
        // Don't show toast here - let the form component handle it
        return { error };
      }

      // Success toast is handled in the component
      return { error: null };
    } catch (error) {
      const authError = error as AuthError;
      return { error: authError };
    }
  };

  const setPaymentPlan = async (plan: PaymentPlan) => {
    if (user) {
      // This is now handled by Stripe webhooks, but keep for backward compatibility
      localStorage.setItem(`paymentPlan_${user.id}`, plan || '');
      setPaymentPlanState(plan);
    }
  };

  const refreshPaymentStatus = useCallback(async (options?: { retryAfterPayment?: boolean }): Promise<boolean> => {
    if (options?.retryAfterPayment) {
      // After checkout, the Stripe webhook may not have processed yet.
      // Retry up to 4 times with 2s delays. Don't clear optimistic plan on failure.
      const maxAttempts = 4;
      const delayMs = 2000;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const hasPlan = await loadPaymentPlan(true);
        if (hasPlan) return true;
        if (attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }
      return false;
    } else {
      return await loadPaymentPlan(false);
    }
  }, [loadPaymentPlan]);

  const hasVerifiedPlan = paymentPlan !== null;

  const value: AuthContextType = {
    user,
    session,
    loading,
    paymentPlan,
    hasVerifiedPlan,
    signUp,
    signIn,
    signInWithGoogle,
    signOut,
    resetPassword,
    setPaymentPlan,
    refreshPaymentStatus,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

