import { useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { api } from '../lib/api';
import { PosApiError } from '@shared/errors';
import {
  zResetPassword,
  type ResetPasswordFormValues,
  type ResetPasswordInput,
} from '@shared/validation';
import type { StaffUser } from '@shared/api';

/**
 * Local password reset (spec §30).
 *
 * There is no email on this system, so an administrator is the only way back in
 * for someone who has forgotten their password. That makes this the one screen
 * where an unattended session would be most damaging — so the administrator
 * re-enters their own password, checked in the main process, before the reset is
 * allowed.
 */
export default function ResetPasswordDialog({
  user,
  onClose,
  onDone,
}: {
  user: StaffUser;
  onClose: () => void;
  onDone: (user: StaffUser) => void;
}) {
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<ResetPasswordFormValues, unknown, ResetPasswordInput>({
    resolver: zodResolver(zResetPassword),
    defaultValues: {
      userId: user.id,
      adminPassword: '',
      newPassword: '',
      confirmPassword: '',
    },
  });

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = form;

  const reset = useMutation({
    mutationFn: (values: ResetPasswordInput) => api.users.resetPassword(values),
    onSuccess: () => onDone(user),
    onError: (err) => {
      if (err instanceof PosApiError && err.fields) {
        for (const [field, message] of Object.entries(err.fields)) {
          setError(field as keyof ResetPasswordFormValues, { message });
        }
        return;
      }
      setFormError(
        err instanceof PosApiError ? err.message : 'That password could not be reset.',
      );
    },
  });

  return (
    <Dialog open onClose={isSubmitting ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Reset the password for {user.fullName}</DialogTitle>
      <Stack component="form" onSubmit={handleSubmit((values) => reset.mutate(values))} noValidate>
        <DialogContent dividers>
          <Stack spacing={2}>
            {formError && <Alert severity="error">{formError}</Alert>}

            <Alert severity="info">
              You are setting a new password for <strong>{user.username}</strong>. Tell it to them
              in person and ask them to change it from their own account.
            </Alert>

            <TextField
              label="New password"
              type="password"
              autoFocus
              required
              error={Boolean(errors.newPassword)}
              helperText={errors.newPassword?.message ?? 'At least 6 characters'}
              {...register('newPassword')}
            />
            <TextField
              label="Confirm new password"
              type="password"
              required
              error={Boolean(errors.confirmPassword)}
              helperText={errors.confirmPassword?.message}
              {...register('confirmPassword')}
            />

            <TextField
              label="Your own password"
              type="password"
              required
              error={Boolean(errors.adminPassword)}
              helperText={
                errors.adminPassword?.message ??
                'Confirms it is really you, not someone at your unlocked screen.'
              }
              {...register('adminPassword')}
            />

            <Typography variant="caption" color="text.secondary">
              This reset is recorded in the audit log against your account.
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" disabled={isSubmitting}>
            {isSubmitting ? 'Resetting…' : 'Reset password'}
          </Button>
        </DialogActions>
      </Stack>
    </Dialog>
  );
}
