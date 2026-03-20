import { useMutation } from '@tanstack/react-query';
import {
  EmergencyRecommendationRequest,
  EmergencyRecommendationResponse,
  getEmergencyRecommendations,
} from '@/lib/api';

export function useEmergencyRecommendations() {
  return useMutation<EmergencyRecommendationResponse, Error, EmergencyRecommendationRequest>({
    mutationFn: getEmergencyRecommendations,
  });
}
