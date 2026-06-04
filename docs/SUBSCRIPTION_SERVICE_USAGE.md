# Subscription Service Usage Guide

This guide shows how to use the subscription check helpers throughout the application.

## Helper Functions

### `checkSubscriptionStatus()`

Returns a boolean indicating if the current user has an active subscription.

```typescript
import { checkSubscriptionStatus } from '@/lib/subscription-service';

// Simple check
const hasSubscription = await checkSubscriptionStatus();

if (!hasSubscription) {
  toast.error('Subscription Required');
  return;
}

// Continue with gated feature...
```

### `getSubscriptionDetails()`

Returns detailed subscription information including plan type and status.

```typescript
import { getSubscriptionDetails } from '@/lib/subscription-service';

const details = await getSubscriptionDetails();

if (!details || !details.hasActivePlan) {
  console.log('No active subscription');
  return;
}

console.log('Plan:', details.plan); // 'student' | 'enterprise'
console.log('Status:', details.status); // 'active' | 'canceled' | 'past_due'
```

## Usage Examples

### Example 1: Gate a Feature (Import Model)

```typescript
// In ModelContext.tsx (already implemented)
const importFile = async (file: File) => {
  // Check auth
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    toast.error('Authentication Required');
    return;
  }

  // Check subscription
  const hasSubscription = await checkSubscriptionStatus();
  if (!hasSubscription) {
    toast.error('Subscription Required', {
      description: 'Please subscribe to import models.',
    });
    return;
  }

  // Continue with import...
};
```

### Example 2: Conditional UI Display

```typescript
// Show/hide premium features based on subscription
import { useState, useEffect } from 'react';
import { getSubscriptionDetails } from '@/lib/subscription-service';

function PremiumFeature() {
  const [hasAccess, setHasAccess] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkAccess = async () => {
      const details = await getSubscriptionDetails();
      setHasAccess(details?.hasActivePlan ?? false);
      setLoading(false);
    };
    checkAccess();
  }, []);

  if (loading) return <div>Loading...</div>;
  
  if (!hasAccess) {
    return (
      <div className="p-4 border rounded">
        <p>This feature requires an active subscription.</p>
        <Button onClick={() => window.location.href = '/subscribe'}>
          Subscribe Now
        </Button>
      </div>
    );
  }

  return <div>Premium feature content here</div>;
}
```

### Example 3: Check Plan Type

```typescript
// Different features for different plans
import { getSubscriptionDetails } from '@/lib/subscription-service';

async function checkPlanAccess() {
  const details = await getSubscriptionDetails();
  
  if (!details?.hasActivePlan) {
    return { canImport: false, canExport: false, canShare: false };
  }

  // Basic features for all plans
  const access = { canImport: true, canExport: true, canShare: false };
  
  // Additional features for enterprise
  if (details.plan === 'enterprise') {
    access.canShare = true;
  }

  return access;
}
```

### Example 4: Disable UI Elements

```typescript
// Disable button if no subscription
import { Button } from '@/components/ui/button';
import { useEffect, useState } from 'react';
import { checkSubscriptionStatus } from '@/lib/subscription-service';
import { toast } from 'sonner';

function ImportButton() {
  const [hasSubscription, setHasSubscription] = useState(false);

  useEffect(() => {
    checkSubscriptionStatus().then(setHasSubscription);
  }, []);

  const handleClick = () => {
    if (!hasSubscription) {
      toast.error('Subscription Required');
      return;
    }
    // Trigger import...
  };

  return (
    <Button 
      onClick={handleClick}
      disabled={!hasSubscription}
    >
      {hasSubscription ? 'Import Model' : 'Subscribe to Import'}
    </Button>
  );
}
```

### Example 5: API Route Protection (Backend)

While the frontend checks are important for UX, always validate on the backend too:

```javascript
// backend/server.js
app.post('/api/models/upload', verifyAuth, async (req, res) => {
  // User is authenticated (verifyAuth middleware)
  const userId = req.user.id;

  // Check subscription in database
  const { data: subscription, error } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'active')
    .single();

  if (error || !subscription) {
    return res.status(403).json({ 
      error: 'Active subscription required' 
    });
  }

  // Continue with upload...
});
```

## Custom Hook Example

Create a reusable hook for subscription checks:

```typescript
// src/hooks/useSubscription.ts
import { useState, useEffect } from 'react';
import { getSubscriptionDetails } from '@/lib/subscription-service';
import type { PaymentPlan } from '@/contexts/AuthContext';

export function useSubscription() {
  const [loading, setLoading] = useState(true);
  const [hasSubscription, setHasSubscription] = useState(false);
  const [plan, setPlan] = useState<PaymentPlan>(null);
  const [status, setStatus] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    const details = await getSubscriptionDetails();
    setHasSubscription(details?.hasActivePlan ?? false);
    setPlan(details?.plan ?? null);
    setStatus(details?.status ?? null);
    setLoading(false);
  };

  useEffect(() => {
    refresh();
  }, []);

  return {
    loading,
    hasSubscription,
    plan,
    status,
    refresh,
  };
}

// Usage:
function MyComponent() {
  const { loading, hasSubscription, plan } = useSubscription();

  if (loading) return <div>Loading...</div>;

  return (
    <div>
      {hasSubscription ? (
        <p>You're on the {plan} plan!</p>
      ) : (
        <p>No active subscription</p>
      )}
    </div>
  );
}
```

## Error Handling

Always handle errors gracefully:

```typescript
import { checkSubscriptionStatus } from '@/lib/subscription-service';
import { toast } from 'sonner';

async function protectedAction() {
  try {
    const hasSubscription = await checkSubscriptionStatus();
    
    if (!hasSubscription) {
      toast.error('Subscription Required', {
        description: 'Please subscribe to use this feature.',
        action: {
          label: 'Subscribe',
          onClick: () => window.location.href = '/subscribe',
        },
      });
      return;
    }

    // Proceed with action...
    
  } catch (error) {
    console.error('Subscription check failed:', error);
    toast.error('Unable to verify subscription', {
      description: 'Please try again or contact support.',
    });
  }
}
```

## Testing

### Test Without Subscription

```typescript
// Temporarily mock the function
import * as subscriptionService from '@/lib/subscription-service';

// In your test
vi.spyOn(subscriptionService, 'checkSubscriptionStatus')
  .mockResolvedValue(false);

// Test that UI shows "Subscription Required"
```

### Test With Subscription

```typescript
vi.spyOn(subscriptionService, 'checkSubscriptionStatus')
  .mockResolvedValue(true);

// Test that feature works normally
```

## Best Practices

1. **Always check on backend**: Frontend checks are for UX, backend checks are for security
2. **Cache subscription status**: Don't call the API on every click, cache for 60 seconds
3. **Show clear messaging**: Tell users what they need to do (sign in, subscribe, etc.)
4. **Provide upgrade path**: Include a link to subscribe when showing "Subscription Required"
5. **Handle edge cases**: What if API is down? Gracefully degrade
6. **Test both paths**: Test with and without subscription

## Common Pitfalls

❌ **Don't trust frontend only**:
```typescript
// BAD - can be bypassed
if (hasSubscription) {
  uploadToServer();
}
```

✅ **Always validate on backend**:
```typescript
// GOOD - backend validates too
if (hasSubscription) {
  await uploadToServer(); // Server checks subscription again
}
```

❌ **Don't hardcode subscription checks**:
```typescript
// BAD - hard to maintain
const canImport = user && user.plan === 'student' && user.subscriptionActive;
```

✅ **Use the helper function**:
```typescript
// GOOD - centralized logic
const canImport = await checkSubscriptionStatus();
```

## Integration with Existing Code

The subscription check has been integrated into:

- ✅ `ModelContext.tsx` - `importFile()` function
- ✅ `ModelContext.tsx` - Electron `handleProjectOpened()` handler

You can add similar checks to:

- Export functionality
- AI generation features
- Team collaboration features
- Cloud sync features

Simply call `checkSubscriptionStatus()` before allowing the feature to proceed.
