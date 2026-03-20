import { Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Loader2 } from 'lucide-react';

interface ManagerRouteProps {
  children: React.ReactNode;
  skipOnboardingCheck?: boolean;
}

export function ManagerRoute({ children, skipOnboardingCheck }: ManagerRouteProps) {
  const { session, loading, role, onboardingCompleted } = useAuth();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!session) return <Navigate to="/auth" replace />;
  if (role !== 'manager') return <Navigate to="/employee/schedule" replace />;
  if (!skipOnboardingCheck && !onboardingCompleted) return <Navigate to="/manager/onboarding" replace />;

  return <>{children}</>;
}
