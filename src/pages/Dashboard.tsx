import { useEffect, useState } from 'react';
import { useAuth } from "@/contexts/AuthContext";
import { InteractivePricingCard } from '@/components/ui/pricing';
import { TitleBar } from "@/components/TitleBar";
import { Button } from "@/components/ui/button";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

export default function Dashboard() {
  const { user, paymentPlan, refreshPaymentStatus } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Handle success/cancel from Stripe redirect
  useEffect(() => {
    const success = searchParams.get('success');
    const canceled = searchParams.get('canceled');
    
    if (success) {
      toast.success('Payment successful! Your plan is now active.');
      refreshPaymentStatus?.({ retryAfterPayment: true });
      // Clean up URL
      navigate('/dashboard', { replace: true });
    } else if (canceled) {
      toast.info('Payment canceled. You can try again anytime.');
      navigate('/dashboard', { replace: true });
    }
  }, [searchParams, navigate, refreshPaymentStatus]);

  const freePlanFeatures = [
    'Unlimited commits',
    'File tree visualization',
    'Community support',
  ];

  const proPlanFeatures = [
    'Everything in Free',
    'Pull from cloud storage',
    'Share with 5 other team members',
    'Priority support',
  ];

  const enterprisePlanFeatures = [
    'Everything in Pro',
    'Share across entire organization',
    'Fine-tuned merge conflict resolution',
    'Dedicated support',
  ];

  const handlePlanSelect = (planName: string, units: number, totalPrice: number) => {
    if (!user) {
      toast.error('Please sign in to continue');
      return;
    }

    const plan = planName.toLowerCase();
    const priceId = plan === 'pro'
      ? import.meta.env.VITE_STRIPE_PRO_PRICE_ID
      : import.meta.env.VITE_STRIPE_ENTERPRISE_PRICE_ID || '';

    if (!priceId) {
      toast.info('Please contact sales for Enterprise pricing.');
      return;
    }

    navigate(`/checkout?plan=${plan}&priceId=${priceId}&price=${totalPrice}`);
  };

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      <TitleBar />
          <div className="flex-1 overflow-auto relative">
            {/* Header with back button and current plan - positioned absolutely */}
            <div className="absolute top-6 left-1/2 transform -translate-x-1/2 z-10 space-y-4 text-center">
              <Button
                variant="outline"
                onClick={() => navigate('/')}
                className="gap-2"
              >
                <ArrowLeft className="w-4 h-4" />
                Go back to app
              </Button>
              {paymentPlan ? (
                <p className="text-muted-foreground">
                  Your current plan is: {paymentPlan === 'free' ? 'Free' : paymentPlan === 'pro' || paymentPlan === 'student' ? 'Pro' : 'Enterprise'}
                </p>
              ) : (
                <div className="space-y-2">
                  <p className="text-muted-foreground">
                    Choose a plan to unlock all features. Without a verified plan, you can make commits but cannot pull from cloud
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={async () => {
                      setIsRefreshing(true);
                      const found = await refreshPaymentStatus?.({ retryAfterPayment: true });
                      setIsRefreshing(false);
                      if (!found) toast.info('If you just subscribed, your plan may take a moment to activate.');
                    }}
                    disabled={isRefreshing}
                    className="gap-1.5 text-muted-foreground"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
                    {isRefreshing ? 'Checking...' : 'Just subscribed? Refresh plan status'}
                  </Button>
                </div>
              )}
            </div>

            {/* Pricing cards centered */}
            <div className="flex min-h-full w-full flex-col items-center justify-center gap-8 p-8 md:flex-row">
              {/* Free Plan - Default, current when no paid plan */}
              <InteractivePricingCard
                planName="Free"
                planDescription="For getting started and personal use."
                pricePerUnit={0}
                unitName="user"
                minUnits={1}
                maxUnits={1}
                initialUnits={1}
                features={freePlanFeatures}
                ctaText="Current plan"
                hideSlider={true}
                isCurrentPlan={!paymentPlan || paymentPlan === 'free'}
                highlighted={!paymentPlan || paymentPlan === 'free'}
                onPlanSelect={handlePlanSelect}
              />

              {/* Pro Plan */}
              <InteractivePricingCard
                planName="Pro"
                planDescription="For individuals and small teams."
                pricePerUnit={10}
                unitName="month"
                minUnits={1}
                maxUnits={1}
                initialUnits={1}
                features={proPlanFeatures}
                ctaText="Get Pro"
                hideSlider={true}
                isCurrentPlan={paymentPlan === 'pro' || paymentPlan === 'student'}
                highlighted={paymentPlan === 'pro' || paymentPlan === 'student'}
                onPlanSelect={handlePlanSelect}
              />

              {/* Enterprise Plan */}
              <InteractivePricingCard
                planName="Enterprise"
                planDescription="For advanced collaboration and unlimited power."
                pricePerUnit={100}
                unitName="seat"
                minUnits={5}
                maxUnits={100}
                initialUnits={10}
                features={enterprisePlanFeatures}
                ctaText="Subscribe to Enterprise"
                contactSalesLabel="Contact sales"
                contactSalesHref="mailto:founders@0studio.xyz"
                centerShowsPerUnitRate={true}
                isCurrentPlan={paymentPlan === 'enterprise'}
                highlighted={paymentPlan === 'enterprise'}
                onPlanSelect={handlePlanSelect}
              />
            </div>
          </div>
        </div>
  );
}
