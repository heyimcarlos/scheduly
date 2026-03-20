import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

type AppRole = 'manager' | 'employee' | null;

interface AuthContextType {
  session: Session | null;
  user: User | null;
  loading: boolean;
  role: AppRole;
  teamMemberId: string | null;
  onboardingCompleted: boolean;
  activeTeamProfileId: string | null;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  loading: true,
  role: null,
  teamMemberId: null,
  onboardingCompleted: false,
  activeTeamProfileId: null,
  signOut: async () => {},
  refreshProfile: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<AppRole>(null);
  const [teamMemberId, setTeamMemberId] = useState<string | null>(null);
  const [onboardingCompleted, setOnboardingCompleted] = useState(false);
  const [activeTeamProfileId, setActiveTeamProfileId] = useState<string | null>(null);

  const fetchRoleAndProfile = useCallback(async (userId: string) => {
    // Fetch role
    const { data: roles } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', userId);

    let resolvedRole: AppRole = 'employee';
    if (roles && roles.length > 0) {
      const hasManager = roles.some(r => r.role === 'manager');
      const hasAdmin = roles.some(r => r.role === 'admin');
      resolvedRole = hasManager || hasAdmin ? 'manager' : 'employee';
    }
    setRole(resolvedRole);

    // Fetch profile
    const { data: profile } = await supabase
      .from('profiles')
      .select('team_member_id, onboarding_completed_at, active_team_profile_id')
      .eq('id', userId)
      .single();

    setTeamMemberId(profile?.team_member_id ?? null);
    setActiveTeamProfileId(profile?.active_team_profile_id ?? null);

    // For employees, onboarding doesn't apply — treat as completed
    if (resolvedRole === 'manager') {
      setOnboardingCompleted(!!profile?.onboarding_completed_at);
    } else {
      setOnboardingCompleted(true);
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    const userId = session?.user?.id;
    if (!userId) return;
    await fetchRoleAndProfile(userId);
  }, [session?.user?.id, fetchRoleAndProfile]);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session);
        if (session?.user) {
          setTimeout(() => fetchRoleAndProfile(session.user.id), 0);
        } else {
          setRole(null);
          setTeamMemberId(null);
          setOnboardingCompleted(false);
          setActiveTeamProfileId(null);
          setLoading(false);
        }
      }
    );

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session?.user) {
        fetchRoleAndProfile(session.user.id).then(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, [fetchRoleAndProfile]);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{
      session,
      user: session?.user ?? null,
      loading,
      role,
      teamMemberId,
      onboardingCompleted,
      activeTeamProfileId,
      signOut,
      refreshProfile,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
