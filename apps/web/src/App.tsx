import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ThemeProvider } from "next-themes";
import { AuthProvider } from "@/hooks/useAuth";
import { ManagerRoute } from "@/components/ManagerRoute";
import { EmployeeRoute } from "@/components/EmployeeRoute";
import { RoleRedirect } from "@/components/RoleRedirect";
import { AppLayout } from "@/components/layout/AppLayout";
import { EmployeeLayout } from "@/components/layout/EmployeeLayout";
import Index from "./pages/Index";
import Employees from "./pages/Employees";
import ManagerRequests from "./pages/ManagerRequests";
import Auth from "./pages/Auth";
import NotFound from "./pages/NotFound";
import Onboarding from "./pages/manager/Onboarding";
import EmployeeSchedule from "./pages/employee/Schedule";
import EmployeeRequests from "./pages/employee/Requests";
import EmployeeProfile from "./pages/employee/Profile";
import { TimelineScheduler } from "./components/scheduler/TimelineScheduler";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
      <AuthProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <Routes>
              <Route path="/auth" element={<Auth />} />

              {/* Role-based redirect at root */}
              <Route path="/" element={<RoleRedirect />} />

              {/* Manager onboarding — outside AppLayout, skip onboarding check */}
              <Route
                path="/manager/onboarding"
                element={
                  <ManagerRoute skipOnboardingCheck>
                    <Onboarding />
                  </ManagerRoute>
                }
              />

              {/* Manager routes */}
              <Route
                element={
                  <ManagerRoute>
                    <AppLayout />
                  </ManagerRoute>
                }
              >
                <Route path="/manager" element={<Index />} />
                <Route path="/manager/employees" element={<Employees />} />
                <Route path="/manager/requests" element={<ManagerRequests />} />
                <Route path="/manager/timeline" element={<TimelineScheduler />} />
              </Route>

              {/* Employee routes */}
              <Route
                element={
                  <EmployeeRoute>
                    <EmployeeLayout />
                  </EmployeeRoute>
                }
              >
                <Route path="/employee/schedule" element={<EmployeeSchedule />} />
                <Route path="/employee/requests" element={<EmployeeRequests />} />
                <Route path="/employee/profile" element={<EmployeeProfile />} />
              </Route>

              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        </TooltipProvider>
      </AuthProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
