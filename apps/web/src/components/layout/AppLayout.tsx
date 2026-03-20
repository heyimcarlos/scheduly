import { Outlet, useNavigate } from 'react-router-dom';
import { NavLink } from '@/components/NavLink';
import { ThemeToggle } from '@/components/ThemeToggle';
import { useAuth } from '@/hooks/useAuth';
import { CalendarDays, Users, LogOut, FileText, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import logo from '@/assets/logo.png';

const navItems = [
  { to: '/manager', icon: CalendarDays, label: 'Schedule' },
  { to: '/manager/employees', icon: Users, label: 'Employees' },
  { to: '/manager/requests', icon: FileText, label: 'Requests', badgeKey: 'requests' as const },
];

export function AppLayout() {
  const { signOut, user, refreshProfile } = useAuth();
  const navigate = useNavigate();

  const { data: pendingCount = 0 } = useQuery({
    queryKey: ['pending-requests-count'],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('time_off_requests')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending');
      if (error) throw error;
      return count ?? 0;
    },
    refetchInterval: 30000,
  });

  const handleRedoSetup = async () => {
    if (!user) return;
    await supabase
      .from('profiles')
      .update({ onboarding_completed_at: null })
      .eq('id', user.id);
    await refreshProfile();
    navigate('/manager/onboarding');
  };

  return (
    <div className="flex h-screen w-full bg-background">
      {/* Sidebar */}
      <nav className="w-14 flex-shrink-0 border-r border-border bg-sidebar flex flex-col items-center py-3 gap-3">
        <div className="mb-1">
          <img src={logo} alt="AI Scheduler" className="h-8 w-8 object-contain" />
        </div>
        <div className="w-8 border-t border-border" />
        {navItems.map(item => (
          <Tooltip key={item.to}>
            <TooltipTrigger asChild>
              <NavLink
                to={item.to}
                end={item.to === '/manager'}
                className="relative flex items-center justify-center w-9 h-9 rounded-md text-muted-foreground transition-colors hover:text-foreground hover:bg-sidebar-accent"
                activeClassName="bg-sidebar-accent text-primary"
              >
                <item.icon className="h-4.5 w-4.5" />
                {item.badgeKey === 'requests' && pendingCount > 0 && (
                  <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold px-1">
                    {pendingCount > 99 ? '99+' : pendingCount}
                  </span>
                )}
              </NavLink>
            </TooltipTrigger>
            <TooltipContent side="right">{item.label}</TooltipContent>
          </Tooltip>
        ))}
        <div className="mt-auto flex flex-col items-center gap-2">
          <ThemeToggle />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 text-muted-foreground hover:text-foreground"
                onClick={handleRedoSetup}
              >
                <RotateCcw className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Redo Setup</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 text-muted-foreground hover:text-destructive"
                onClick={signOut}
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Sign out</TooltipContent>
          </Tooltip>
        </div>
      </nav>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        <Outlet />
      </div>
    </div>
  );
}
