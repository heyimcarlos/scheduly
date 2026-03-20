import { useState, useEffect } from 'react';
import { formatInTimeZone } from 'date-fns-tz';
import { Clock, MapPin } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getTimeZoneShortName } from '@/lib/timezone';

interface TimeZoneDisplay {
  id: string;
  city: string;
  timezone: string;
  color: string;
}

const TIMEZONES: TimeZoneDisplay[] = [
  { id: 'toronto', city: 'Toronto', timezone: 'America/Toronto', color: 'team-canada' },
  { id: 'belgrade', city: 'Belgrade', timezone: 'Europe/Belgrade', color: 'team-serbia' },
  { id: 'bangalore', city: 'Bangalore', timezone: 'Asia/Kolkata', color: 'team-india' },
];

export function GlobalTimeBar() {
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const getIsBusinessHours = (timezone: string): boolean => {
    const hour = parseInt(formatInTimeZone(currentTime, timezone, 'H'));
    return hour >= 7 && hour < 18;
  };

  return (
    <div className="h-10 px-4 border-b border-border bg-card/80 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Clock className="w-4 h-4 text-primary animate-pulse" />
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Follow-the-Sun
        </span>
      </div>

      <div className="flex items-center gap-6">
        {TIMEZONES.map((tz) => {
          const isBusinessHours = getIsBusinessHours(tz.timezone);
          return (
            <div key={tz.id} className="flex items-center gap-2">
              <div className={cn(
                "w-2 h-2 rounded-full",
                isBusinessHours ? "bg-success animate-pulse" : "bg-muted-foreground/30"
              )} />
              <MapPin 
                className="w-3 h-3" 
                style={{ color: `hsl(var(--${tz.color}))` }}
              />
              <div className="flex flex-col">
                <span 
                  className="text-xs font-semibold"
                  style={{ color: `hsl(var(--${tz.color}))` }}
                >
                  {tz.city}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {formatInTimeZone(currentTime, tz.timezone, 'HH:mm')} {getTimeZoneShortName(currentTime, tz.timezone)}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="text-xs text-muted-foreground">
        UTC: {formatInTimeZone(currentTime, 'UTC', 'HH:mm:ss')}
      </div>
    </div>
  );
}
