import { useMutation } from '@tanstack/react-query';
import {
  ParseNoteRequest,
  ParseNoteResponse,
  parseManagerNote,
} from '@/lib/api';

export function useNoteParser() {
  return useMutation<ParseNoteResponse, Error, ParseNoteRequest>({
    mutationFn: parseManagerNote,
  });
}
