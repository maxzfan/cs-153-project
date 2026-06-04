import { Router } from 'express';
import express from 'express';

/**
 * Stripe payment + webhook routes mounted at /api/stripe.
 * Returns an Express Router.
 *
 * IMPORTANT: The webhook route uses express.raw() for signature verification.
 * The caller must ensure the webhook path is excluded from the global JSON
 * body parser (or mount the raw parser before it).
 */
export function createStripeRoutes({ stripe, supabase, verifyAuth }) {
  const router = Router();

  // Create Stripe Checkout Session
  router.post('/create-checkout-session', verifyAuth, async (req, res) => {
    try {
      const { lookup_key, price_id } = req.body;

      if (!lookup_key && !price_id) {
        return res.status(400).json({ error: 'Missing lookup_key or price_id parameter' });
      }

      let price;

      if (lookup_key) {
        const prices = await stripe.prices.list({
          lookup_keys: [lookup_key],
          expand: ['data.product'],
        });

        if (prices.data.length === 0) {
          return res.status(404).json({
            error: 'Price not found',
            lookup_key: lookup_key,
            hint: 'Check your Stripe Dashboard → Products → Prices to find the correct lookup_key, or use price_id instead'
          });
        }

        price = prices.data[0];
      } else if (price_id) {
        try {
          price = await stripe.prices.retrieve(price_id);
        } catch (_error) {
          return res.status(404).json({
            error: 'Price not found',
            price_id: price_id,
            hint: 'Check that the price_id is correct in your Stripe Dashboard'
          });
        }
      }

      // Determine plan name from price or metadata
      let planName = 'student';
      if (lookup_key && lookup_key.toLowerCase().includes('enterprise')) {
        planName = 'enterprise';
      } else if (lookup_key && lookup_key.toLowerCase().includes('student')) {
        planName = 'student';
      } else if (price.product) {
        const product = typeof price.product === 'string'
          ? await stripe.products.retrieve(price.product)
          : price.product;
        if (product.name && product.name.toLowerCase().includes('enterprise')) {
          planName = 'enterprise';
        }
      }

      const session = await stripe.checkout.sessions.create({
        billing_address_collection: 'auto',
        line_items: [
          {
            price: price.id,
            quantity: 1,
          },
        ],
        mode: 'subscription',
        success_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/dashboard?success=true&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/dashboard?canceled=true`,
        customer_email: req.user.email,
        metadata: {
          userId: req.user.id,
          plan: planName,
        },
      });

      res.json({ sessionId: session.id, url: session.url });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to create checkout session',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  });

  // Stripe Webhook Handler — needs raw body for signature verification
  router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;

    try {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err) {
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    switch (event.type) {
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        if (invoice.subscription) {
          await supabase
            .from('subscriptions')
            .update({
              status: 'active',
              updated_at: new Date().toISOString(),
            })
            .eq('stripe_subscription_id', invoice.subscription);
        }
        break;
      }

      case 'invoice.payment_failed': {
        const failedInvoice = event.data.object;
        if (failedInvoice.subscription) {
          await supabase
            .from('subscriptions')
            .update({
              status: 'past_due',
              updated_at: new Date().toISOString(),
            })
            .eq('stripe_subscription_id', failedInvoice.subscription);
        }
        break;
      }

      case 'customer.subscription.created': {
        const newSubscription = event.data.object;

        let plan = 'student';
        if (newSubscription.metadata?.plan) {
          plan = newSubscription.metadata.plan;
        } else if (newSubscription.items?.data?.[0]?.price?.lookup_key) {
          const lookupKey = newSubscription.items.data[0].price.lookup_key;
          if (lookupKey.toLowerCase().includes('student')) {
            plan = 'student';
          } else if (lookupKey.toLowerCase().includes('enterprise')) {
            plan = 'enterprise';
          }
        }

        let status = 'active';
        if (newSubscription.status === 'past_due' || newSubscription.status === 'unpaid') {
          status = 'past_due';
        } else if (newSubscription.status === 'active' || newSubscription.status === 'trialing') {
          status = 'active';
        }

        const { data: existingSub, error: fetchError } = await supabase
          .from('subscriptions')
          .select('*')
          .eq('stripe_subscription_id', newSubscription.id)
          .single();

        if (fetchError && fetchError.code !== 'PGRST116') {
          break;
        }

        if (existingSub) {
          await supabase
            .from('subscriptions')
            .update({
              plan: plan,
              stripe_customer_id: newSubscription.customer,
              stripe_subscription_id: newSubscription.id,
              status: status,
              updated_at: new Date().toISOString(),
            })
            .eq('stripe_subscription_id', newSubscription.id);
        } else {
          let userId = newSubscription.metadata?.userId || null;

          if (!userId && newSubscription.customer) {
            const { data: userSub } = await supabase
              .from('subscriptions')
              .select('user_id')
              .eq('stripe_customer_id', newSubscription.customer)
              .single();

            if (userSub) {
              userId = userSub.user_id;
            }
          }

          await supabase
            .from('subscriptions')
            .insert({
              user_id: userId,
              plan: plan,
              stripe_customer_id: newSubscription.customer,
              stripe_subscription_id: newSubscription.id,
              status: status,
            });
        }
        break;
      }

      case 'customer.subscription.updated': {
        const updatedSubscription = event.data.object;

        const { data: subscriptionData, error: subError } = await supabase
          .from('subscriptions')
          .select('*')
          .or(`stripe_subscription_id.eq.${updatedSubscription.id},stripe_customer_id.eq.${updatedSubscription.customer}`)
          .single();

        if (subError && subError.code !== 'PGRST116') {
          break;
        }

        if (!subscriptionData) {
          break;
        }

        let updateStatus = 'active';
        if (updatedSubscription.status === 'canceled') {
          updateStatus = 'canceled';
        } else if (updatedSubscription.status === 'past_due' || updatedSubscription.status === 'unpaid') {
          updateStatus = 'past_due';
        } else if (updatedSubscription.status === 'active' || updatedSubscription.status === 'trialing') {
          updateStatus = 'active';
        }

        await supabase
          .from('subscriptions')
          .update({
            status: updateStatus,
            stripe_subscription_id: updatedSubscription.id,
            updated_at: new Date().toISOString(),
          })
          .eq('id', subscriptionData.id);
        break;
      }

      case 'customer.subscription.deleted': {
        const deletedSubscription = event.data.object;

        const { data: deletedSubData, error: deletedSubError } = await supabase
          .from('subscriptions')
          .select('*')
          .or(`stripe_subscription_id.eq.${deletedSubscription.id},stripe_customer_id.eq.${deletedSubscription.customer}`)
          .single();

        if (deletedSubError && deletedSubError.code !== 'PGRST116') {
          break;
        }

        if (!deletedSubData) {
          break;
        }

        await supabase
          .from('subscriptions')
          .update({
            status: 'canceled',
            updated_at: new Date().toISOString(),
          })
          .eq('id', deletedSubData.id);
        break;
      }

      default:
        // Unhandled event type — no action needed
        break;
    }

    res.json({ received: true });
  });

  // Create Subscription Intent for custom checkout
  router.post('/create-subscription-intent', verifyAuth, async (req, res) => {
    try {
      const { price_id, plan } = req.body;

      if (!price_id) {
        return res.status(400).json({ error: 'Missing price_id parameter' });
      }

      // Check if customer already exists
      let customer;
      const existingCustomers = await stripe.customers.list({
        email: req.user.email,
        limit: 1,
      });

      if (existingCustomers.data.length > 0) {
        customer = existingCustomers.data[0];
      } else {
        customer = await stripe.customers.create({
          email: req.user.email,
          metadata: {
            userId: req.user.id,
          },
        });
      }

      // Retrieve the price to get the amount
      let price;
      try {
        price = await stripe.prices.retrieve(price_id);
      } catch (_error) {
        return res.status(404).json({
          error: 'Price not found',
          price_id: price_id,
          hint: 'Check that the price_id is correct in your Stripe Dashboard'
        });
      }

      const subscription = await stripe.subscriptions.create({
        customer: customer.id,
        items: [{ price: price_id }],
        payment_behavior: 'default_incomplete',
        payment_settings: { save_default_payment_method: 'on_subscription' },
        expand: ['latest_invoice.payment_intent'],
        metadata: {
          userId: req.user.id,
          plan: plan || 'student',
        },
      });

      const invoice = subscription.latest_invoice;
      const paymentIntent = invoice?.payment_intent;

      if (!paymentIntent || typeof paymentIntent === 'string') {
        throw new Error('Failed to create payment intent for subscription');
      }

      // Store the subscription in our database (pending status until payment completes)
      await supabase
        .from('subscriptions')
        .upsert({
          user_id: req.user.id,
          plan: plan || 'student',
          stripe_customer_id: customer.id,
          stripe_subscription_id: subscription.id,
          status: 'pending',
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'user_id',
        });

      res.json({
        subscriptionId: subscription.id,
        clientSecret: paymentIntent.client_secret,
      });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to create subscription',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  });

  // Get user's payment status
  router.get('/payment-status', verifyAuth, async (req, res) => {
    try {
      const { data: subscription, error } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('user_id', req.user.id)
        .eq('status', 'active')
        .single();

      if (error && error.code !== 'PGRST116') {
        return res.status(500).json({ error: 'Failed to fetch payment status' });
      }

      if (!subscription) {
        return res.json({
          hasActivePlan: false,
          plan: null,
          status: null
        });
      }

      res.json({
        hasActivePlan: true,
        plan: subscription.plan,
        status: subscription.status,
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to get payment status' });
    }
  });

  return router;
}
