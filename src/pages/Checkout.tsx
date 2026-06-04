import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { loadStripe } from '@stripe/stripe-js';
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js';
import { useAuth } from '@/contexts/AuthContext';
import { TitleBar } from '@/components/TitleBar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft, Check, Loader2, Shield, CreditCard } from 'lucide-react';
import { toast } from 'sonner';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3000';
const STRIPE_PUBLISHABLE_KEY = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;

// Initialize Stripe
const stripePromise = STRIPE_PUBLISHABLE_KEY ? loadStripe(STRIPE_PUBLISHABLE_KEY) : null;

interface CheckoutFormProps {
  planName: string;
  planPrice: number;
  onSuccess: () => void;
  onCancel: () => void;
}

function CheckoutForm({ planName, planPrice, onSuccess, onCancel }: CheckoutFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!stripe || !elements) {
      return;
    }

    setIsProcessing(true);
    setErrorMessage(null);

    try {
      const { error, paymentIntent } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: window.location.origin + '/dashboard?success=true',
        },
        redirect: 'if_required',
      });

      if (error) {
        setErrorMessage(error.message || 'An error occurred during payment.');
        setIsProcessing(false);
      } else if (paymentIntent && paymentIntent.status === 'succeeded') {
        toast.success('Payment successful! Your subscription is now active.');
        onSuccess();
      } else if (paymentIntent && paymentIntent.status === 'processing') {
        toast.info('Payment is processing. We\'ll update you when it completes.');
        onSuccess();
      } else {
        // For other statuses, redirect happened or we need to handle differently
        onSuccess();
      }
    } catch (err) {
      setErrorMessage('An unexpected error occurred. Please try again.');
      setIsProcessing(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-4">
        <div className="bg-muted/50 rounded-lg p-4">
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm text-muted-foreground">Plan</span>
            <span className="font-medium">{planName}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm text-muted-foreground">Monthly Price</span>
            <span className="font-bold text-lg">${planPrice.toFixed(2)}/mo</span>
          </div>
        </div>

        <div className="border rounded-lg p-4">
          <PaymentElement 
            options={{
              layout: 'tabs',
            }}
          />
        </div>
      </div>

      {errorMessage && (
        <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-lg">
          {errorMessage}
        </div>
      )}

      <div className="flex gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={isProcessing}
          className="flex-1"
        >
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={!stripe || isProcessing}
          className="flex-1"
        >
          {isProcessing ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Processing...
            </>
          ) : (
            <>
              <CreditCard className="mr-2 h-4 w-4" />
              Subscribe ${planPrice.toFixed(2)}/mo
            </>
          )}
        </Button>
      </div>

      <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
        <Shield className="h-3 w-3" />
        <span>Secured by Stripe. Your payment info is encrypted.</span>
      </div>
    </form>
  );
}

export default function Checkout() {
  const { user, session, loading: authLoading, refreshPaymentStatus, setPaymentPlan } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Get plan details from URL params
  const planName = searchParams.get('plan') || 'student';
  const priceId = searchParams.get('priceId') || '';
  const planPrice = parseFloat(searchParams.get('price') || '10');

  useEffect(() => {
    // Wait for auth to finish loading before checking user
    if (authLoading) {
      return;
    }

    if (!user || !session?.access_token) {
      toast.error('Please sign in to continue');
      navigate('/');
      return;
    }

    if (!STRIPE_PUBLISHABLE_KEY) {
      setError('Stripe is not configured. Please check your environment variables.');
      setLoading(false);
      return;
    }

    // Create subscription intent
    const createSubscription = async () => {
      try {
        const response = await fetch(`${BACKEND_URL}/api/stripe/create-subscription-intent`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            price_id: priceId,
            plan: planName,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Failed to initialize checkout');
        }

        const data = await response.json();
        setClientSecret(data.clientSecret);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to initialize checkout');
      } finally {
        setLoading(false);
      }
    };

    createSubscription();
  }, [user, session, priceId, planName, navigate, authLoading]);

  const handleSuccess = async () => {
    // Optimistically set plan so UI updates immediately (webhook may take a few seconds)
    setPaymentPlan?.(planName.toLowerCase() as 'student' | 'enterprise');
    await refreshPaymentStatus?.({ retryAfterPayment: true });
    navigate('/dashboard?success=true');
  };

  const handleCancel = () => {
    navigate('/dashboard?canceled=true');
  };

  const planFeatures = planName.toLowerCase() === 'enterprise' 
    ? [
        'Everything in Student',
        'Share across entire organization',
        'Fine-tuned merge conflict resolution',
        'Priority support',
      ]
    : [
        'Unlimited commits',
        'File tree visualization',
        'Pull from cloud storage',
        'Share with 5 other team members',
        'Community support',
      ];

  // Show loading while auth is initializing
  if (authLoading) {
    return (
      <div className="h-screen flex flex-col bg-background">
        <TitleBar />
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (!stripePromise) {
    return (
      <div className="h-screen flex flex-col bg-background">
        <TitleBar />
        <div className="flex-1 flex items-center justify-center">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle>Configuration Error</CardTitle>
              <CardDescription>
                Stripe is not configured. Please add VITE_STRIPE_PUBLISHABLE_KEY to your environment.
              </CardDescription>
            </CardHeader>
            <CardFooter>
              <Button onClick={() => navigate('/dashboard')} className="w-full">
                Go Back
              </Button>
            </CardFooter>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      <TitleBar />
      <div className="flex-1 overflow-auto">
            <div className="container max-w-4xl mx-auto py-8 px-4">
              <div className="flex items-center justify-between mb-6">
                <Button
                  variant="ghost"
                  onClick={() => navigate('/dashboard')}
                >
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Compare all plans
                </Button>
                <Button
                  variant="outline"
                  onClick={() => navigate('/')}
                >
                  Back to app
                </Button>
              </div>

              <div className="grid md:grid-cols-2 gap-8">
                {/* Plan Summary */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-2xl">
                      {planName.charAt(0).toUpperCase() + planName.slice(1)} Plan
                    </CardTitle>
                    <CardDescription>
                      Complete your subscription to unlock all features
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="text-center py-4">
                      <span className="text-4xl font-bold">${planPrice.toFixed(2)}</span>
                      <span className="text-muted-foreground">/month</span>
                    </div>
                    
                    <ul className="space-y-3">
                      {planFeatures.map((feature, index) => (
                        <li key={index} className="flex items-center gap-2">
                          <Check className="h-4 w-4 text-primary flex-shrink-0" />
                          <span className="text-sm text-muted-foreground">{feature}</span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>

                {/* Payment Form */}
                <Card>
                  <CardHeader>
                    <CardTitle>Payment Details</CardTitle>
                    <CardDescription>
                      Enter your payment information to complete your subscription
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {loading ? (
                      <div className="flex items-center justify-center py-12">
                        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                      </div>
                    ) : error ? (
                      <div className="text-center py-8">
                        <p className="text-destructive mb-4">{error}</p>
                        <Button onClick={() => navigate('/dashboard')} variant="outline">
                          Go Back
                        </Button>
                      </div>
                    ) : clientSecret ? (
                      <Elements 
                        stripe={stripePromise} 
                        options={{
                          clientSecret,
                          appearance: {
                            theme: 'stripe',
                            variables: {
                              colorPrimary: '#0f172a',
                              borderRadius: '8px',
                            },
                          },
                        }}
                      >
                        <CheckoutForm
                          planName={planName.charAt(0).toUpperCase() + planName.slice(1)}
                          planPrice={planPrice}
                          onSuccess={handleSuccess}
                          onCancel={handleCancel}
                        />
                      </Elements>
                    ) : (
                      <div className="text-center py-8">
                        <p className="text-muted-foreground">Unable to load payment form</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        </div>
  );
}
