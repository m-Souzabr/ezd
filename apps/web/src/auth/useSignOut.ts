import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';

import { api } from '../api/client';
import { SESSION_KEY } from './session';

/** Signs out, forgets what the account had loaded, and goes to the sign-in page. */
export function useSignOut(): () => void {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const signOut = useMutation({
    mutationFn: api.logout,
    onSettled: () => {
      queryClient.clear();
      queryClient.setQueryData(SESSION_KEY, null);
      void navigate('/login');
    },
  });
  return () => signOut.mutate();
}
