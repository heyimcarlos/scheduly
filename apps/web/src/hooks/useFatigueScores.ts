import { useMutation } from '@tanstack/react-query';
import { computeFatigueScores, FatigueScoresRequest } from '@/lib/api';
import type { FatigueScoresMap } from '@/hooks/useRedistribute';

interface ComputeFatigueScoresParams {
  request: FatigueScoresRequest;
  memberIdsByEmployeeId: Record<number, string>;
}

/** Compute fatigue scores for manual shift changes, returning a FatigueScoresMap keyed by memberId. */
export function useFatigueScores() {
  return useMutation<FatigueScoresMap, Error, ComputeFatigueScoresParams>({
    mutationFn: async ({ request, memberIdsByEmployeeId }) => {
      const response = await computeFatigueScores(request);
      const map: FatigueScoresMap = {};
      for (const [employeeIdStr, trajectory] of Object.entries(
        response.fatigue_trajectories,
      )) {
        const employeeId = Number(employeeIdStr);
        const memberId = memberIdsByEmployeeId[employeeId];
        if (!memberId) continue;
        // Day-0 score
        if (trajectory[0] != null) {
          map[memberId] = Math.round(trajectory[0] * 100);
        }
      }
      return map;
    },
  });
}
