import { cn } from '@/lib/utils';

interface FatigueRingProps {
  score: number; // 0-100
  size?: 'sm' | 'md' | 'lg';
  children?: React.ReactNode;
  className?: string;
}

export function FatigueRing({ score, size = 'md', children, className }: FatigueRingProps) {
  const sizeClasses = {
    sm: 'w-8 h-8',
    md: 'w-10 h-10',
    lg: 'w-12 h-12',
  };

  const getColor = (score: number) => {
    if (score >= 80) return 'hsl(var(--destructive))';
    if (score >= 50) return 'hsl(var(--warning))';
    return 'hsl(var(--success))';
  };

  const ringColor = getColor(score);
  const circumference = 2 * Math.PI * 18;
  const strokeDashoffset = circumference - (score / 100) * circumference;

  return (
    <div className={cn('relative', sizeClasses[size], className)}>
      <svg className="w-full h-full -rotate-90" viewBox="0 0 40 40">
        {/* Background circle */}
        <circle
          cx="20"
          cy="20"
          r="18"
          fill="none"
          stroke="hsl(var(--muted))"
          strokeWidth="3"
        />
        {/* Progress circle */}
        <circle
          cx="20"
          cy="20"
          r="18"
          fill="none"
          stroke={ringColor}
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          className="transition-all duration-500"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        {children}
      </div>
    </div>
  );
}
