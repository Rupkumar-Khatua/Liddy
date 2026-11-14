import { useState, useEffect } from 'react';

export interface LocationData {
  country: string;
  currency: string;
  currency_name: string;
  city: string;
}

export const useLocation = () => {
  const [location, setLocation] = useState<LocationData>({
    country: 'India',
    currency: 'INR',
    currency_name: 'Indian Rupee',
    city: 'New Delhi'
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    try {
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
      if (timeZone.includes('Calcutta') || timeZone.includes('Kolkata') || timeZone.includes('Asia')) {
        setLocation({
          country: 'India',
          currency: 'INR',
          currency_name: 'Indian Rupee',
          city: 'New Delhi'
        });
      } else if (timeZone.includes('America') || timeZone.includes('New_York') || timeZone.includes('Los_Angeles')) {
        setLocation({
          country: 'United States',
          currency: 'USD',
          currency_name: 'US Dollar',
          city: 'New York'
        });
      } else if (timeZone.includes('Europe') || timeZone.includes('London')) {
        setLocation({
          country: 'United Kingdom',
          currency: 'GBP',
          currency_name: 'British Pound',
          city: 'London'
        });
      }
    } catch {
      // Graceful synchronous fallback without network requests
    } finally {
      setLoading(false);
    }
  }, []);

  return { location, loading };
};
