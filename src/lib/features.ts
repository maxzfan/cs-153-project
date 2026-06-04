export const features = {
  team: import.meta.env.VITE_FEATURES_TEAM === 'true',
  payments: import.meta.env.VITE_FEATURES_PAYMENTS === 'true',
} as const;
