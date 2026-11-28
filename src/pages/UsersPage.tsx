import { useState } from 'react';
import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  CircularProgress,
  DialogActions,
  DialogContent,
  DialogContentText,
  FormControlLabel,
  IconButton,
  Paper,
  Snackbar,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import EditIcon from '@mui/icons-material/Edit';
import KeyIcon from '@mui/icons-material/Key';
import DeleteOutlinedIcon from '@mui/icons-material/DeleteOutlined';
import ShieldIcon from '@mui/icons-material/Shield';
import PersonRemoveOutlinedIcon from '@mui/icons-material/PersonRemoveOutlined';
import { historyTableSx } from '../components/historyTableSx';
import { MovementDialog } from '../components/MovementParts';
import { PageHeader, TableCardHeader } from '../components/PageLayout';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import UserDialog from '../components/UserDialog';
import ResetPasswordDialog from '../components/ResetPasswordDialog';
import { PosApiError } from '@shared/errors';
import { USER_ROLE_LABELS, type UserRole } from '@shared/domain';
import { formatInstant } from '@shared/datetime';
import type { StaffUser } from '@shared/api';

/**
 * Staff accounts (spec §8, §30, §31).
 *
 * The thing this screen has to get right is not the table — it is that a shop
 * cannot lock itself out. There is no support line and no reset email: if the
 * last administrator loses their access, nobody can ever change a setting, take
 * a backup or reset a password on this installation again.
 *
 * So the controls that would do that are disabled here and refused in the main
 * process, and the screen says which account is load-bearing and why.
 */
const ROLE_COLOUR: Record<UserRole, 'error' | 'warning' | 'default'> = {
  ADMIN: 'error',
  MANAGER: 'warning',
  SALES: 'default',
  CASHIER: 'default',
};

export default function UsersPage() {
  const { user: signedIn, can } = useAuth();
  const queryClient = useQueryClient();

  const [includeInactive, setIncludeInactive] = useState(true);
  const [editing, setEditing] = useState<StaffUser | null | undefined>(undefined);
  const [resetting, setResetting] = useState<StaffUser | null>(null);
  const [removing, setRemoving] = useState<StaffUser | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const users = useQuery({
    queryKey: ['users', includeInactive],
    queryFn: () => api.users.list({ includeInactive }),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['users'] });

  const remove = useMutation({
    mutationFn: (target: StaffUser) => api.users.delete({ id: target.id }),
    onSuccess: (result, target) => {
      setError(null);
      setRemoving(null);
      setToast(
        result.deactivated
          ? `"${target.username}" appears in trading history, so the account was deactivated rather than deleted.`
          : `"${target.username}" was deleted.`,
      );
      void refresh();
    },
    onError: (err) =>
      setError(err instanceof PosApiError ? err.message : 'That account could not be removed.'),
  });

  const rows = users.data?.rows ?? [];
  const activeAdmins = users.data?.activeAdmins ?? 0;

  /** True when losing this account would leave the shop with no administrator. */
  const isLoadBearing = (row: StaffUser) =>
    row.role === 'ADMIN' && row.isActive === 1 && activeAdmins <= 1;

  return (
    <Stack spacing={2}>
      <PageHeader
        title="Users"
        subtitle="Staff accounts, and what each one may see and do"
        actions={
          can('users.manage') && (
            <Button variant="contained" startIcon={<PersonAddIcon />} onClick={() => setEditing(null)}>
              Add User
            </Button>
          )
        }
      />

      {error && (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {users.isError && (
        <Alert severity="error">
          {users.error instanceof PosApiError ? users.error.message : 'Unable to load the staff list.'}
        </Alert>
      )}

      {activeAdmins <= 1 && rows.length > 0 && (
        <Alert severity="warning" icon={<ShieldIcon />}>
          This shop has <strong>one administrator</strong>. If that password is lost there is no way
          back in — no reset email, no support line. Consider adding a second administrator account
          that someone you trust can use.
        </Alert>
      )}

      <Paper sx={historyTableSx}>
        <TableCardHeader
          title="Staff accounts"
          caption={`${rows.length} ${includeInactive ? 'accounts, deactivated included' : 'active accounts'}`}
        >
          <FormControlLabel
            control={
              <Switch size="small" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />
            }
            label="Show deactivated"
          />
        </TableCardHeader>
        {users.isLoading ? (
          <Box sx={{ p: 4, display: 'grid', placeItems: 'center' }}>
            <CircularProgress size={26} />
          </Box>
        ) : (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell>Username</TableCell>
                  <TableCell>Role</TableCell>
                  <TableCell>Phone</TableCell>
                  <TableCell align="right">Sales</TableCell>
                  <TableCell align="right">Repairs</TableCell>
                  <TableCell>Last signed in</TableCell>
                  <TableCell>State</TableCell>
                  {can('users.manage') && <TableCell align="right">Actions</TableCell>}
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((row) => {
                  const isSelf = row.id === signedIn?.id;
                  const loadBearing = isLoadBearing(row);
                  const inactive = row.isActive === 0;

                  return (
                    <TableRow key={row.id} hover sx={{ opacity: inactive ? 0.6 : 1 }}>
                      <TableCell>
                        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                          <Avatar
                            sx={{
                              width: 30,
                              height: 30,
                              fontSize: "0.8125rem",
                              bgcolor: inactive ? 'action.disabled' : 'primary.main',
                            }}
                          >
                            {row.fullName.trim().charAt(0).toUpperCase()}
                          </Avatar>
                          <Box>
                            <Typography variant="body2" sx={{ fontWeight: 600 }}>
                              {row.fullName}
                            </Typography>
                            {isSelf && (
                              <Typography variant="caption" color="text.secondary">
                                This is you
                              </Typography>
                            )}
                          </Box>
                        </Stack>
                      </TableCell>
                      <TableCell sx={{ fontFamily: 'monospace', fontSize: "0.7813rem" }}>
                        {row.username}
                      </TableCell>
                      <TableCell>
                        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                          <Chip
                            size="small"
                            label={USER_ROLE_LABELS[row.role]}
                            color={ROLE_COLOUR[row.role]}
                            variant={row.role === 'CASHIER' ? 'outlined' : 'filled'}
                          />
                          {loadBearing && (
                            <Tooltip title="The only administrator who can sign in. Their role and access are locked until there is another.">
                              <ShieldIcon color="warning" sx={{ fontSize: "1.0625rem" }} />
                            </Tooltip>
                          )}
                        </Stack>
                      </TableCell>
                      <TableCell>
                        <Typography variant="caption" color="text.secondary">
                          {row.phone ?? '—'}
                        </Typography>
                      </TableCell>
                      <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                        {row.salesCount || '—'}
                      </TableCell>
                      <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                        {row.serviceCount || '—'}
                      </TableCell>
                      <TableCell>
                        <Typography variant="caption" color="text.secondary">
                          {row.lastLoginAt ? formatInstant(row.lastLoginAt) : 'Never'}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        {inactive ? (
                          <Chip size="small" variant="outlined" label="Deactivated" />
                        ) : (
                          <Chip size="small" color="success" variant="outlined" label="Active" />
                        )}
                      </TableCell>

                      {can('users.manage') && (
                        <TableCell align="right">
                          <Stack direction="row" spacing={0.5} sx={{ justifyContent: 'flex-end' }}>
                            <Tooltip title="Edit name, role and access">
                              <IconButton size="small" aria-label={`Edit ${row.username}`} onClick={() => setEditing(row)}>
                                <EditIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                            <Tooltip title="Reset this password (spec §30)">
                              <IconButton size="small" aria-label={`Reset password of ${row.username}`} onClick={() => setResetting(row)}>
                                <KeyIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                            <Tooltip
                              title={
                                isSelf
                                  ? 'You cannot remove your own account'
                                  : loadBearing
                                    ? 'The only administrator cannot be removed'
                                    : 'Remove this account'
                              }
                            >
                              <span>
                                <IconButton
                                  size="small"
                                  aria-label={`Remove ${row.username}`}
                                  disabled={isSelf || loadBearing}
                                  onClick={() => setRemoving(row)}
                                >
                                  <DeleteOutlinedIcon fontSize="small" />
                                </IconButton>
                              </span>
                            </Tooltip>
                          </Stack>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}

                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} align="center">
                      <Typography variant="body2" color="text.secondary" sx={{ py: 4 }}>
                        No staff accounts to show.
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>

      <Alert severity="info">
        A cashier runs the till. A manager also handles refunds, stock, expenses and reports. Only
        an administrator can change settings, manage these accounts, take backups or read the audit
        log. Deactivating an account keeps everything it has ever done on record.
      </Alert>

      {editing !== undefined && (
        <UserDialog
          user={editing}
          isLastActiveAdmin={editing ? isLoadBearing(editing) : false}
          isSelf={editing?.id === signedIn?.id}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            setError(null);
            setToast('Account saved.');
            void refresh();
            // A role change alters what the signed-in user may do.
            void queryClient.invalidateQueries({ queryKey: ['auth'] });
          }}
        />
      )}

      {resetting && (
        <ResetPasswordDialog
          user={resetting}
          onClose={() => setResetting(null)}
          onDone={(target) => {
            setResetting(null);
            setToast(`The password for "${target.username}" has been reset.`);
          }}
        />
      )}

      {removing && (
      <MovementDialog
        maxWidth="xs"
        onClose={remove.isPending ? undefined : () => setRemoving(null)}
        tone="error"
        icon={<PersonRemoveOutlinedIcon />}
        title="Remove this account?"
        subtitle={`${removing.fullName} · ${removing.username}`}
      >
        <DialogContent>
          <DialogContentText component="div">
            <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>
              {removing?.fullName} ({removing?.username})
            </Typography>
            {(removing?.salesCount ?? 0) + (removing?.serviceCount ?? 0) > 0 ? (
              <>
                This account is named on {removing?.salesCount ?? 0} sale(s) and{' '}
                {removing?.serviceCount ?? 0} repair job(s), so it will be{' '}
                <strong>deactivated rather than deleted</strong> — its history stays intact and it
                can no longer sign in.
              </>
            ) : (
              <>
                This account has no trading history, so it will be deleted outright. If it turns out
                to be named on something, it will be deactivated instead.
              </>
            )}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRemoving(null)}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            disabled={remove.isPending}
            onClick={() => removing && remove.mutate(removing)}
          >
            {remove.isPending ? 'Removing…' : 'Remove'}
          </Button>
        </DialogActions>
      </MovementDialog>
      )}

      <Snackbar
        open={Boolean(toast)}
        autoHideDuration={8000}
        onClose={() => setToast(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="success" onClose={() => setToast(null)} sx={{ width: '100%' }}>
          {toast}
        </Alert>
      </Snackbar>
    </Stack>
  );
}
