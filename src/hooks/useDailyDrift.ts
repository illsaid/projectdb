import { useEffect, useState } from 'react';
import { dailyDrift, msUntilNextDay, type DailyDrift } from '@/drift/daily';

/** Today's shared drift, rolling over at UTC midnight. */
export function useDailyDrift(): DailyDrift {
  const [daily, setDaily] = useState(dailyDrift);
  useEffect(() => {
    const t = setTimeout(() => setDaily(dailyDrift()), msUntilNextDay() + 1000);
    return () => clearTimeout(t);
  }, [daily]);
  return daily;
}
