import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { api } from '../lib/api';
import { PosApiError } from '@shared/errors';
import { USER_ROLES, USER_ROLE_LABELS, type UserRole } from '@shared/domain';
import {
  zCreateUser,
  zUpdateUser,
  type CreateUserFormValues,
  type CreateUserInput,
  type UpdateUserFormValues,
  type UpdateUserInput,
} from '@shared/validation';
import { useState } from 'react';
import type { StaffUser } from '@shared/api';

/** What each role can do, in the words a shop owner would use. */
const ROLE_SUMMARY: Record<UserRole, string> = {
  CASHIER: 'Runs the till and looks things up. Cannot refund, discount or see the books.',
  MANAGER:
    'Runs the shop: refunds, cancellations, stock, expenses and reports. Cannot change settings, manage users or take backups.',
  ADMIN: 'Everything, including settings, users, backups and the audit log.',
};

/**
 * Create or edit a staff account (spec §8, §31).
 *
 * Passwords are set here only when creating. Changing an existing account's
 * password is a separate, deliberately more awkward action — see
 * ResetPasswordDialog — because it needs the administrator's own password.
 */
export default function UserDialog({
  user,
  isLastActiveAdmin,
  isSelf,
  onClose,
  onSaved,
}: {
  /** null creates a new account. */
  user: StaffUser | null;
  isLastActiveAdmin: boolean;
  isSelf: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  return user ? (
    <EditUser
      user={user}
      isLastActiveAdmin={isLastActiveAdmin}
      isSelf={isSelf}
      onClose={onClose}
      onSaved={onSaved}
    />
  ) : (
    <CreateUser onClose={onClose} onSaved={onSaved} />
  );
}

function CreateUser({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<CreateUserFormValues, unknown, CreateUserInput>({
    resolver: zodResolver(zCreateUser),
    defaultValues: {
      username: '',
      fullName: '',
      phone: '',
      role: 'CASHIER',
      password: '',
      confirmPassword: '',
    },
  });

  const {
    register,
    control,
    handleSubmit,
    watch,
    setError,
    formState: { errors, isSubmitting },
  } = form;

  const create = useMutation({
    mutationFn: (values: CreateUserInput) => api.users.create(values),
    onSuccess: onSaved,
    onError: (err) => {
      // Field errors from the main process land on the right input.
      if (err instanceof PosApiError && err.fields) {
        for (const [field, message] of Object.entries(err.fields)) {
          setError(field as keyof CreateUserFormValues, { message });
        }
        if (!Object.keys(err.fields).length) setFormError(err.message);
        return;
      }
      setFormError(
        err instanceof PosApiError ? err.message : 'That account could not be created.',
      );
    },
  });

  const role = watch('role');

  return (
    <Dialog open onClose={isSubmitting ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Add a staff account</DialogTitle>
      <Stack
        component="form"
        onSubmit={handleSubmit((values) => create.mutate(values))}
        noValidate
      >
        <DialogContent dividers>
          <Stack spacing={2}>
            {formError && <Alert severity="error">{formError}</Alert>}

            <TextField
              label="Full name"
              autoFocus
              required
              error={Boolean(errors.fullName)}
              helperText={errors.fullName?.message}
              {...register('fullName')}
            />

            <Stack direction="row" spacing={2}>
              <TextField
                label="Username"
                required
                fullWidth
                error={Boolean(errors.username)}
                helperText={errors.username?.message ?? 'Used to sign in. Letters, numbers, . _ -'}
                {...register('username')}
              />
              <TextField
                label="Phone"
                fullWidth
                error={Boolean(errors.phone)}
                helperText={errors.phone?.message}
                {...register('phone')}
              />
            </Stack>

            <Controller
              control={control}
              name="role"
              render={({ field }) => (
                <TextField select label="Role" {...field} required>
                  {USER_ROLES.map((option) => (
                    <MenuItem key={option} value={option}>
                      {USER_ROLE_LABELS[option]}
                    </MenuItem>
                  ))}
                </TextField>
              )}
            />
            <Alert severity="info" icon={false} sx={{ py: 0.5 }}>
              <Typography variant="caption">{ROLE_SUMMARY[role as UserRole]}</Typography>
            </Alert>

            <Stack direction="row" spacing={2}>
              <TextField
                label="Password"
                type="password"
                required
                fullWidth
                error={Boolean(errors.password)}
                helperText={errors.password?.message ?? 'At least 6 characters'}
                {...register('password')}
              />
              <TextField
                label="Confirm password"
                type="password"
                required
                fullWidth
                error={Boolean(errors.confirmPassword)}
                helperText={errors.confirmPassword?.message}
                {...register('confirmPassword')}
              />
            </Stack>

            <Typography variant="caption" color="text.secondary">
              Tell them this password in person and ask them to change it from their own account.
              There is no email on this system, so a forgotten password has to be reset by an
              administrator.
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" disabled={isSubmitting}>
            {isSubmitting ? 'Creating…' : 'Create account'}
          </Button>
        </DialogActions>
      </Stack>
    </Dialog>
  );
}

function EditUser({
  user,
  isLastActiveAdmin,
  isSelf,
  onClose,
  onSaved,
}: {
  user: StaffUser;
  isLastActiveAdmin: boolean;
  isSelf: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<UpdateUserFormValues, unknown, UpdateUserInput>({
    resolver: zodResolver(zUpdateUser),
    defaultValues: {
      id: user.id,
      fullName: user.fullName,
      phone: user.phone ?? '',
      role: user.role,
      isActive: user.isActive === 1,
    },
  });

  const {
    register,
    control,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = form;

  const update = useMutation({
    mutationFn: (values: UpdateUserInput) => api.users.update(values),
    onSuccess: onSaved,
    onError: (err) =>
      setFormError(err instanceof PosApiError ? err.message : 'That account could not be saved.'),
  });

  const role = watch('role');
  const isActive = watch('isActive');

  // The main process refuses these outright; disabling the controls means the
  // user is not invited to try.
  const roleLocked = isLastActiveAdmin;
  const activeLocked = isLastActiveAdmin || isSelf;

  return (
    <Dialog open onClose={isSubmitting ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{user.fullName}</DialogTitle>
      <Stack
        component="form"
        onSubmit={handleSubmit((values) => update.mutate(values))}
        noValidate
      >
        <DialogContent dividers>
          <Stack spacing={2}>
            {formError && <Alert severity="error">{formError}</Alert>}

            {isLastActiveAdmin && (
              <Alert severity="warning">
                This is the only administrator who can still sign in. Their role and active state
                are locked until another administrator exists — otherwise nobody could change
                settings, take backups or reset a password on this computer.
              </Alert>
            )}

            <TextField
              label="Username"
              value={user.username}
              disabled
              helperText="A username cannot be changed — it appears on past records."
            />

            <TextField
              label="Full name"
              autoFocus
              required
              error={Boolean(errors.fullName)}
              helperText={errors.fullName?.message}
              {...register('fullName')}
            />

            <TextField
              label="Phone"
              error={Boolean(errors.phone)}
              helperText={errors.phone?.message}
              {...register('phone')}
            />

            <Controller
              control={control}
              name="role"
              render={({ field }) => (
                <TextField select label="Role" {...field} disabled={roleLocked}>
                  {USER_ROLES.map((option) => (
                    <MenuItem key={option} value={option}>
                      {USER_ROLE_LABELS[option]}
                    </MenuItem>
                  ))}
                </TextField>
              )}
            />
            <Alert severity="info" icon={false} sx={{ py: 0.5 }}>
              <Typography variant="caption">{ROLE_SUMMARY[role as UserRole]}</Typography>
            </Alert>

            <Controller
              control={control}
              name="isActive"
              render={({ field }) => (
                <FormControlLabel
                  control={
                    <Switch
                      checked={field.value}
                      disabled={activeLocked}
                      onChange={(e) => field.onChange(e.target.checked)}
                    />
                  }
                  label={field.value ? 'Can sign in' : 'Cannot sign in'}
                />
              )}
            />
            {isSelf && !isLastActiveAdmin && (
              <Typography variant="caption" color="text.secondary">
                You cannot deactivate the account you are signed in with.
              </Typography>
            )}
            {!isActive && (
              <Alert severity="info">
                A deactivated account keeps its history — past sales and repair jobs still name it.
              </Alert>
            )}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" disabled={isSubmitting}>
            {isSubmitting ? 'Saving…' : 'Save changes'}
          </Button>
        </DialogActions>
      </Stack>
    </Dialog>
  );
}
