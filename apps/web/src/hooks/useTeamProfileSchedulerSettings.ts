import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useActiveTeamProfile } from '@/hooks/useActiveTeamProfile';
import {
  buildDefaultWorkloadTemplate,
  type DemandOverrides,
  type TeamProfileConfig,
  type WorkloadTemplatePoint,
} from '@/types/teamProfile';

export function useTeamProfileSchedulerSettings() {
  const {
    profile: activeTeamProfile,
    config: activeTeamProfileConfig,
    isLoading: loadingTeamProfile,
    refetch,
  } = useActiveTeamProfile();
  const [demandOverrides, setDemandOverrides] = useState<DemandOverrides | undefined>();
  const [workloadTemplate, setWorkloadTemplate] = useState<WorkloadTemplatePoint[]>([]);

  useEffect(() => {
    setDemandOverrides(activeTeamProfileConfig?.demand_overrides);

    const nextTemplate =
      activeTeamProfileConfig?.workload_template && activeTeamProfileConfig.workload_template.length > 0
        ? activeTeamProfileConfig.workload_template
        : activeTeamProfileConfig?.slot_policies
          ? buildDefaultWorkloadTemplate(activeTeamProfileConfig.slot_policies)
          : [];
    setWorkloadTemplate(nextTemplate);
  }, [activeTeamProfileConfig]);

  const persistConfig = useCallback(
    async (patch: Partial<TeamProfileConfig>) => {
      if (!activeTeamProfile || !activeTeamProfileConfig) {
        toast.error('Complete team setup before saving scheduler settings');
        return false;
      }

      const updatedConfig: TeamProfileConfig = {
        ...activeTeamProfileConfig,
        ...patch,
      };

      if (!updatedConfig.demand_overrides) {
        delete updatedConfig.demand_overrides;
      }

      if (!updatedConfig.workload_template || updatedConfig.workload_template.length === 0) {
        delete updatedConfig.workload_template;
      }

      const { error } = await supabase
        .from('team_profiles')
        .update({ config: updatedConfig })
        .eq('id', activeTeamProfile.id);

      if (error) {
        toast.error('Failed to save scheduler settings');
        return false;
      }

      await refetch();
      return true;
    },
    [activeTeamProfile, activeTeamProfileConfig, refetch],
  );

  const saveDemandOverrides = useCallback(
    async (overrides: DemandOverrides | undefined) => {
      setDemandOverrides(overrides);
      const ok = await persistConfig({ demand_overrides: overrides });
      if (ok) {
        toast.success('Demand overrides updated');
      }
    },
    [persistConfig],
  );

  const saveWorkloadTemplate = useCallback(
    async (template: WorkloadTemplatePoint[] | undefined) => {
      const nextTemplate = template ?? [];
      setWorkloadTemplate(nextTemplate);
      const ok = await persistConfig({ workload_template: nextTemplate });
      if (ok) {
        toast.success('Known workload updated');
      }
    },
    [persistConfig],
  );

  return {
    activeTeamProfile,
    activeTeamProfileConfig,
    loadingTeamProfile,
    demandOverrides,
    workloadTemplate,
    slotPolicies: useMemo(
      () => activeTeamProfileConfig?.slot_policies ?? {},
      [activeTeamProfileConfig],
    ),
    saveDemandOverrides,
    saveWorkloadTemplate,
  };
}
