import { useMutation } from '@tanstack/react-query';
import {
  AbsenceImpactRequest,
  AbsenceImpactResponse,
  analyzeAbsenceImpact,
} from '@/lib/api';

export function useAbsenceImpact() {
  return useMutation<AbsenceImpactResponse, Error, AbsenceImpactRequest>({
    mutationFn: analyzeAbsenceImpact,
  });
}
