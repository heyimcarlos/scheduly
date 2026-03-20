import { Outlet } from 'react-router-dom';
import { NavLink } from '@/components/NavLink';
import { ThemeToggle } from '@/components/ThemeToggle';
import { useAuth } from '@/hooks/useAuth';
import { CalendarDays, FileText, UserCircle, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import logo from '@/assets/logo.png';

const navItems = [
  { to: '/employee/schedule', icon: CalendarDays, label: 'Schedule' },
  { to: '/employee/requests', icon: FileText, label: 'Requests' },
  { to: '/employee/profile', icon: UserCircle, label: 'Profile' },
];

export function EmployeeLayout() {
  const { signOut } = useAuth();

  return (
    <div className="flex h-screen w-full bg-background">
      <nav className="w-14 flex-shrink-0 border-r border-border bg-sidebar flex flex-col items-center py-3 gap-3">
        <div className="mb-1">
          <img src={logo} alt="AI Scheduler" className="h-8 w-8 object-contain" />
        </div>
        <div className="w-8 border-t border-border" />
        {navItems.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            className="flex items-center justify-center w-9 h-9 rounded-md text-muted-foreground transition-colors hover:text-foreground hover:bg-sidebar-accent"
            activeClassName="bg-sidebar-accent text-primary"
            title={item.label}
          >
            <item.icon className="h-4.5 w-4.5" />
          </NavLink>
        ))}
        <div className="mt-auto flex flex-col items-center gap-2">
          <ThemeToggle />
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
      <div className="flex-1 flex flex-col min-w-0">
        <Outlet />
      </div>
    </div>
  );
}
