import { useState } from 'react';
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  IconButton,
  MenuItem,
  Paper,
  Snackbar,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import BackupIcon from '@mui/icons-material/Backup';
import RestoreIcon from '@mui/icons-material/Restore';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import DriveFileMoveIcon from '@mui/icons-material/DriveFileMove';
import DeleteOutlinedIcon from '@mui/icons-material/DeleteOutlined';
import SaveAltIcon from '@mui/icons-material/SaveAlt';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { PosApiError } from '@shared/errors';
import { formatInstant } from '@shared/datetime';
import {
  BACKUP_KEEP_OPTIONS,
  BACKUP_KIND_LABELS,
  type BackupFile,
  type BackupInspection,
} from '@shared/backup';
import { AUTO_BACKUP_FREQUENCIES } from '@shared/domain';
import type { UpdateSettingsInput } from '@shared/validation';

/**
 * Database backup and restore (spec §53–§55).
 *
 * All the shop's data is on this one computer, so this screen is the difference
 * between a failed disk being an afternoon's inconvenience and the end of the
 * business's records. It is written to make the safe thing the easy thing:
 * restoring always takes a safety copy first, and the warning says so.
 */
export default function BackupPanel() {
  const queryClient = useQueryClient();
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [candidate, setCandidate] = useState<BackupFile | null>(null);
  const [inspection, setInspection] = useState<BackupInspection | null>(null);
  const [pendingDelete, setPendingDelete] = useState<BackupFile | null>(null);

  const overview = useQuery({
    queryKey: ['backup', 'overview'],
    queryFn: () => api.backup.overview(),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['backup', 'overview'] });
  const fail = (err: unknown, fallback: string) =>
    setError(err instanceof PosApiError ? err.message : fallback);

  const createBackup = useMutation({
    mutationFn: (chooseLocation: boolean) => api.backup.create({ chooseLocation }),
    onSuccess: (result) => {
      setError(null);
      if (result.created) setToast(`Backup saved to ${result.file.path}`);
      void refresh();
    },
    onError: (err) => fail(err, 'The backup could not be created.'),
  });

  /** Step one of a restore: read the file and show what is in it. */
  const inspect = useMutation({
    mutationFn: (file: BackupFile) => api.backup.inspect({ path: file.path }),
    onSuccess: (result, file) => {
      setError(null);
      setCandidate(file);
      setInspection(result);
    },
    onError: (err) => fail(err, 'That backup could not be read.'),
  });

  const restore = useMutation({
    mutationFn: (file: BackupFile) => api.backup.restore({ path: file.path }),
    onSuccess: () => {
      // The restored database has its own users, and the session was cleared in
      // the main process. Reloading is the honest way back to the sign-in screen.
      window.location.reload();
    },
    onError: (err) => {
      fail(err, 'The database could not be restored.');
      setCandidate(null);
      setInspection(null);
    },
  });

  const removeBackup = useMutation({
    mutationFn: (file: BackupFile) => api.backup.delete({ path: file.path }),
    onSuccess: () => {
      setError(null);
      setPendingDelete(null);
      setToast('Backup deleted.');
      void refresh();
    },
    onError: (err) => fail(err, 'That backup could not be deleted.'),
  });

  const chooseFolder = useMutation({
    mutationFn: () => api.backup.chooseFolder(),
    onSuccess: (result) => {
      if (!result.chosen) return;
      if (!result.writable) {
        setError(`Backups cannot be written to ${result.path}. Choose a different folder.`);
        return;
      }
      setError(null);
      setToast(`Backups will be written to ${result.path}`);
      void refresh();
      void queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: (err) => fail(err, 'That folder could not be used.'),
  });

  const updateSchedule = useMutation({
    // Typed against the schema rather than as a loose string map: the loose type
    // is what let this send a payload the boundary rejects without the compiler
    // noticing.
    mutationFn: (values: UpdateSettingsInput['values']) => api.settings.update({ values }),
    onSuccess: () => {
      setError(null);
      void refresh();
      void queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: (err) => fail(err, 'The backup schedule could not be saved.'),
  });

  const data = overview.data;
  const busy = createBackup.isPending || restore.isPending;

  return (
    <Stack spacing={2}>
      {error && (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {overview.isError && (
        <Alert severity="error">
          {overview.error instanceof PosApiError
            ? overview.error.message
            : 'The backup folder could not be read.'}
        </Alert>
      )}

      <Alert severity="info">
        <AlertTitle>Everything is on this computer</AlertTitle>
        There is no cloud copy of your sales, stock or customers. A backup on a USB drive or a
        second disk is the only thing that survives this machine failing.
      </Alert>

      {/* Actions ------------------------------------------------------------ */}
      <Paper sx={{ p: 2, border: '1px solid', borderColor: 'divider' }}>
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
          <Button
            variant="contained"
            startIcon={<BackupIcon />}
            onClick={() => createBackup.mutate(false)}
            disabled={busy}
          >
            {createBackup.isPending ? 'Backing up…' : 'Create backup'}
          </Button>
          <Button
            startIcon={<SaveAltIcon />}
            onClick={() => createBackup.mutate(true)}
            disabled={busy}
          >
            Back up to…
          </Button>
          <Button
            startIcon={<DriveFileMoveIcon />}
            onClick={() => chooseFolder.mutate()}
            disabled={busy}
          >
            Change backup folder
          </Button>
          <Button
            color="inherit"
            startIcon={<FolderOpenIcon />}
            onClick={() => void api.backup.openFolder()}
          >
            Open backup folder
          </Button>
        </Stack>

        {data && (
          <Stack spacing={0.5} sx={{ mt: 2 }}>
            <FolderLine label="Backups are written to" value={data.folders.effectiveDir} />
            {data.folders.customDir && !data.folders.customDirWritable && (
              <Alert severity="warning" sx={{ mt: 1 }}>
                Your chosen folder <strong>{data.folders.customDir}</strong> cannot be reached — a
                USB drive may be unplugged. Backups are going to the application folder until it is
                available again.
              </Alert>
            )}
            <FolderLine
              label="Database size"
              value={`${formatBytes(data.databaseSizeBytes)} · ${data.backups.length} backup${
                data.backups.length === 1 ? '' : 's'
              } on disk`}
            />
          </Stack>
        )}
      </Paper>

      {/* Schedule ----------------------------------------------------------- */}
      <Paper sx={{ p: 2, border: '1px solid', borderColor: 'divider' }}>
        <Typography variant="subtitle1" sx={{ mb: 1.5 }}>
          Automatic backup
        </Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: 'center' }}>
          {/* Fixed widths, not minWidth: inside a row these would otherwise
              stretch and squeeze the status text beside them into a column. */}
          <TextField
            select
            label="Run"
            size="small"
            sx={{ width: 190 }}
            value={data?.autoBackupFrequency ?? 'DAILY'}
            disabled={!data || updateSchedule.isPending}
            onChange={(e) => updateSchedule.mutate({ autoBackupFrequency: e.target.value })}
          >
            {AUTO_BACKUP_FREQUENCIES.map((option) => (
              <MenuItem key={option} value={option}>
                {option === 'DISABLED' ? 'Never' : option === 'DAILY' ? 'Every day' : 'Every week'}
              </MenuItem>
            ))}
          </TextField>

          <TextField
            select
            label="Keep the last"
            size="small"
            sx={{ width: 180 }}
            value={data?.autoBackupKeep ?? 10}
            disabled={!data || updateSchedule.isPending}
            onChange={(e) => updateSchedule.mutate({ autoBackupKeep: e.target.value })}
          >
            {BACKUP_KEEP_OPTIONS.map((option) => (
              <MenuItem key={option} value={option}>
                {option} backups
              </MenuItem>
            ))}
          </TextField>

          <Typography variant="body2" color="text.secondary">
            {data?.lastAutoBackupDay
              ? `Last automatic backup: ${data.lastAutoBackupDay}`
              : 'No automatic backup has run yet.'}
          </Typography>
        </Stack>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
          Runs when the application starts. Only automatic backups are ever removed — backups you
          made yourself, and the ones taken before an update or a restore, are kept until you delete
          them.
        </Typography>
      </Paper>

      {/* The files ---------------------------------------------------------- */}
      <Paper sx={{ border: '1px solid', borderColor: 'divider' }}>
        <Box sx={{ px: 2, pt: 2, pb: 1 }}>
          <Typography variant="subtitle1">Available backups</Typography>
        </Box>
        <Divider />

        {overview.isLoading ? (
          <Box sx={{ p: 3, display: 'grid', placeItems: 'center' }}>
            <CircularProgress size={26} />
          </Box>
        ) : (data?.backups.length ?? 0) === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
            No backups yet. Press <strong>Create backup</strong> to make the first one.
          </Typography>
        ) : (
          <TableContainer sx={{ maxHeight: 460 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell>File</TableCell>
                  <TableCell>Made</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell align="right">Size</TableCell>
                  <TableCell>Folder</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data?.backups.map((file) => (
                  <TableRow key={file.path} hover>
                    <TableCell sx={{ fontFamily: 'monospace', fontSize: 12.5 }}>
                      {file.name}
                    </TableCell>
                    <TableCell>{formatInstant(file.createdAt)}</TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={BACKUP_KIND_LABELS[file.kind]}
                        color={file.kind === 'MANUAL' ? 'primary' : 'default'}
                        variant={file.kind === 'MANUAL' ? 'filled' : 'outlined'}
                      />
                    </TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                      {formatBytes(file.sizeBytes)}
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" color="text.secondary">
                        {file.folder === 'CUSTOM' ? 'Your folder' : 'Application folder'}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Stack direction="row" spacing={0.5} sx={{ justifyContent: 'flex-end' }}>
                        <Button
                          size="small"
                          startIcon={<RestoreIcon />}
                          onClick={() => inspect.mutate(file)}
                          disabled={busy || inspect.isPending}
                        >
                          Restore
                        </Button>
                        <Tooltip title="Delete this backup file">
                          <IconButton
                            size="small"
                            onClick={() => setPendingDelete(file)}
                            disabled={busy}
                          >
                            <DeleteOutlinedIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>

      <RestoreDialog
        file={candidate}
        inspection={inspection}
        busy={restore.isPending}
        onCancel={() => {
          setCandidate(null);
          setInspection(null);
        }}
        onBackupFirst={() => createBackup.mutate(false)}
        onRestore={() => candidate && restore.mutate(candidate)}
        backingUp={createBackup.isPending}
      />

      <Dialog open={Boolean(pendingDelete)} onClose={() => setPendingDelete(null)}>
        <DialogTitle>Delete this backup?</DialogTitle>
        <DialogContent>
          <DialogContentText component="div">
            <Box sx={{ fontFamily: 'monospace', fontSize: 13, mb: 1 }}>{pendingDelete?.name}</Box>
            The file is removed from disk. Your current data is not affected.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPendingDelete(null)}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            disabled={removeBackup.isPending}
            onClick={() => pendingDelete && removeBackup.mutate(pendingDelete)}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={Boolean(toast)}
        autoHideDuration={7000}
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

function FolderLine({ label, value }: { label: string; value: string }) {
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline' }}>
      <Typography variant="caption" color="text.secondary" sx={{ minWidth: 170 }}>
        {label}
      </Typography>
      <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>
        {value}
      </Typography>
    </Stack>
  );
}

/**
 * The restore warning (spec §55).
 *
 * Shows what is actually inside the file, because "restore backup" means nothing
 * until you know whether it is yesterday's or last March's. The three buttons
 * are the ones the spec names.
 */
function RestoreDialog({
  file,
  inspection,
  busy,
  backingUp,
  onCancel,
  onBackupFirst,
  onRestore,
}: {
  file: BackupFile | null;
  inspection: BackupInspection | null;
  busy: boolean;
  backingUp: boolean;
  onCancel: () => void;
  onBackupFirst: () => void;
  onRestore: () => void;
}) {
  const usable = inspection?.ok === true;

  return (
    <Dialog open={Boolean(file && inspection)} onClose={busy ? undefined : onCancel} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ color: usable ? 'warning.dark' : 'error.main' }}>
        {usable ? 'Restore this backup?' : 'This backup cannot be used'}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <Box sx={{ fontFamily: 'monospace', fontSize: 13 }}>{file?.name}</Box>

          {!usable && <Alert severity="error">{inspection?.problem}</Alert>}

          {usable && inspection && (
            <>
              <Alert severity="warning">
                Restoring this backup will replace all current POS data — every sale, product,
                customer and repair job recorded since it was made.
              </Alert>

              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: 'auto 1fr',
                  columnGap: 3,
                  rowGap: 0.75,
                  p: 2,
                  bgcolor: 'background.default',
                  borderRadius: 1,
                }}
              >
                {(
                  [
                    ['Made', file ? formatInstant(file.createdAt) : '—'],
                    ['Products', String(inspection.contents.products)],
                    ['Sales', String(inspection.contents.sales)],
                    ['Customers', String(inspection.contents.customers)],
                    ['Repair jobs', String(inspection.contents.services)],
                    [
                      'Database version',
                      inspection.schemaVersion < inspection.expectedSchemaVersion
                        ? `${inspection.schemaVersion} — will be updated to ${inspection.expectedSchemaVersion}`
                        : String(inspection.schemaVersion),
                    ],
                  ] as Array<[string, string]>
                ).map(([label, value]) => (
                  <Box key={label} sx={{ display: 'contents' }}>
                    <Typography variant="body2" color="text.secondary">
                      {label}
                    </Typography>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {value}
                    </Typography>
                  </Box>
                ))}
              </Box>

              <Alert severity="success">
                A backup of your current data is taken automatically before anything is replaced, so
                this can be undone. Use <strong>Back up current data</strong> as well if you want a
                copy somewhere you choose.
              </Alert>

              <Typography variant="caption" color="text.secondary">
                You will be signed out. Sign in with the username and password that were in use when
                this backup was made.
              </Typography>
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        {usable && (
          <>
            <Button onClick={onBackupFirst} disabled={busy || backingUp}>
              {backingUp ? 'Backing up…' : 'Back up current data'}
            </Button>
            <Button color="warning" variant="contained" onClick={onRestore} disabled={busy}>
              {busy ? 'Restoring…' : 'Restore'}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
