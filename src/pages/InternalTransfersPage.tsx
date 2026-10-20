import { useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  InputAdornment,
  Paper,
  Snackbar,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  Typography,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import AddIcon from "@mui/icons-material/Add";
import SwapHorizIcon from "@mui/icons-material/SwapHoriz";
import AccountBalanceWalletOutlinedIcon from "@mui/icons-material/AccountBalanceWalletOutlined";
import TextField from "@mui/material/TextField";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useAuth } from "../hooks/useAuth";
import { useMoneyFormatter } from "../hooks/useSettings";
import { useDebounced } from "../hooks/useDebounced";
import BankingTabs from "../components/BankingTabs";
import SummaryCard from "../components/SummaryCard";
import InternalTransferDialog from "../components/InternalTransferDialog";
import DeleteReasonDialog from "../components/DeleteReasonDialog";
import { PosApiError } from "@shared/errors";
import { formatInstant } from "@shared/datetime";
import type { InternalTransfer } from "@shared/api";

/**
 * Internal Account Transfer tab — moves money between the shop's own registered
 * bank/wallet accounts without touching Cash in Hand or customer advances.
 *
 * Lists every transfer with From / To account details and the amount. Admins
 * can record new transfers and soft-delete existing ones with a reason.
 */
export default function InternalTransfersPage() {
  const { can } = useAuth();
  const money = useMoneyFormatter();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);

  const [opening, setOpening] = useState(false);
  const [deleting, setDeleting] = useState<InternalTransfer | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const debouncedSearch = useDebounced(search, 250);

  const query = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      page,
      pageSize,
    }),
    [debouncedSearch, page, pageSize],
  );

  const transfers = useQuery({
    queryKey: ["internalTransfers", query],
    queryFn: () => api.banking.listInternalTransfers(query),
  });

  const shopAccounts = useQuery({
    queryKey: ["shopBankAccounts", "active"],
    queryFn: () => api.banking.listShopAccounts({ includeInactive: false }),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["internalTransfers"] });
    void queryClient.invalidateQueries({ queryKey: ["shopBankAccounts"] });
    void queryClient.invalidateQueries({ queryKey: ["bankingOverview"] });
  };

  const rows = transfers.data?.rows ?? [];
  const canManage = can("banking.manage");

  return (
    <Stack spacing={2}>
      <Stack
        direction="row"
        spacing={2}
        sx={{ alignItems: "center", flexWrap: "wrap" }}
      >
        <Typography variant="h5" sx={{ flexGrow: 1 }}>
          Banking
        </Typography>
        {canManage && (
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setOpening(true)}
          >
            New Transfer
          </Button>
        )}
      </Stack>

      <BankingTabs active="internal-transfers" />

      {transfers.isError && (
        <Alert severity="error">
          {transfers.error instanceof PosApiError
            ? transfers.error.message
            : "Unable to load transfers."}
        </Alert>
      )}

      {/* Summary cards — same grid layout as other Banking tabs. */}
      <Box
        sx={{
          display: "grid",
          gap: 2,
          gridTemplateColumns: {
            xs: "1fr",
            sm: "repeat(2, 1fr)",
            lg: "repeat(4, 1fr)",
          },
        }}
      >
        {/* <SummaryCard
          label="Total transferred"
          value={money(transfers.data?.totalAmount ?? 0)}
          caption="Sum of all internal transfers"
          icon={<SwapHorizIcon fontSize="small" />}
          tone="success"
        />
        <SummaryCard
          label="Transfer count"
          value={String(transfers.data?.total ?? 0)}
          caption="Number of account transfers recorded"
          icon={<AccountBalanceWalletOutlinedIcon fontSize="small" />}
        /> */}
      </Box>

      <Paper sx={{ p: 2, border: "1px solid", borderColor: "divider" }}>
        <TextField
          placeholder="Search account, number or notes"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            },
          }}
          sx={{ width: 320 }}
        />
      </Paper>

      <Paper sx={{ border: "1px solid", borderColor: "divider" }}>
        <TableContainer>
          <Table size="small" sx={{ "& th, & td": { px: 1.25 } }}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ whiteSpace: "nowrap" }}>Number</TableCell>
                <TableCell>Date</TableCell>
                <TableCell>From</TableCell>
                <TableCell>To</TableCell>
                <TableCell align="right">Amount</TableCell>
                <TableCell>Notes</TableCell>
                <TableCell>Created by</TableCell>
                {canManage && <TableCell align="right">Actions</TableCell>}
              </TableRow>
            </TableHead>
            <TableBody>
              {transfers.isLoading && (
                <TableRow>
                  <TableCell
                    colSpan={canManage ? 8 : 7}
                    align="center"
                    sx={{ py: 4, color: "text.secondary" }}
                  >
                    Loading…
                  </TableCell>
                </TableRow>
              )}
              {!transfers.isLoading && rows.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={canManage ? 8 : 7}
                    align="center"
                    sx={{ py: 5, color: "text.secondary" }}
                  >
                    {search
                      ? "No transfers match your search."
                      : "No internal transfers recorded yet."}
                  </TableCell>
                </TableRow>
              )}
              {rows.map((row) => (
                <TableRow key={row.id} hover>
                  <TableCell
                    sx={{
                      fontFamily: "monospace",
                      fontSize: 12.5,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {row.transferNumber}
                  </TableCell>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>
                    {formatInstant(row.transferDate)}
                  </TableCell>
                  <TableCell>
                    <Stack>
                      <Typography variant="body2" noWrap>
                        <strong>{row.fromBankName}</strong>{" "}
                        <Typography
                          component="span"
                          variant="caption"
                          color="text.secondary"
                        >
                          ({row.fromBankKey})
                        </Typography>
                      </Typography>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        noWrap
                      >
                        {row.fromAccountNumber} · {row.fromAccountName}
                      </Typography>
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Stack>
                      <Typography variant="body2" noWrap>
                        <strong>{row.toBankName}</strong>{" "}
                        <Typography
                          component="span"
                          variant="caption"
                          color="text.secondary"
                        >
                          ({row.toBankKey})
                        </Typography>
                      </Typography>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        noWrap
                      >
                        {row.toAccountNumber} · {row.toAccountName}
                      </Typography>
                    </Stack>
                  </TableCell>
                  <TableCell
                    align="right"
                    sx={{
                      fontVariantNumeric: "tabular-nums",
                      whiteSpace: "nowrap",
                      fontWeight: 600,
                    }}
                  >
                    {money(row.amount)}
                  </TableCell>
                  <TableCell sx={{ color: "text.secondary", maxWidth: 200 }}>
                    <Typography variant="body2" noWrap title={row.notes ?? ""}>
                      {row.notes ?? "—"}
                    </Typography>
                  </TableCell>
                  <TableCell
                    sx={{ color: "text.secondary", whiteSpace: "nowrap" }}
                  >
                    {row.createdByName ?? row.createdBy}
                  </TableCell>
                  {canManage && (
                    <TableCell align="right">
                      <Button
                        size="small"
                        color="error"
                        variant="outlined"
                        onClick={() => setDeleting(row)}
                      >
                        Delete
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination
          component="div"
          count={transfers.data?.total ?? 0}
          page={page}
          onPageChange={(_e, next) => setPage(next)}
          rowsPerPage={pageSize}
          onRowsPerPageChange={(e) => {
            setPageSize(Number(e.target.value));
            setPage(0);
          }}
          rowsPerPageOptions={[25, 50, 100]}
        />
      </Paper>

      {opening && (
        <InternalTransferDialog
          shopAccounts={shopAccounts.data ?? []}
          onClose={() => setOpening(false)}
          onSaved={() => {
            setOpening(false);
            setToast("Transfer recorded.");
            refresh();
          }}
        />
      )}

      {deleting && (
        <DeleteReasonDialog
          title="Delete internal transfer"
          message={`Delete transfer ${deleting.transferNumber}? This will reverse the balance changes on both accounts.`}
          onClose={() => setDeleting(null)}
          onConfirm={async (reason) => {
            await api.banking.deleteInternalTransfer({
              id: deleting.id,
              reason,
            });
            setDeleting(null);
            setToast("Transfer deleted.");
            refresh();
          }}
        />
      )}

      <Snackbar
        open={Boolean(toast)}
        autoHideDuration={3000}
        onClose={() => setToast(null)}
        message={toast}
      />
    </Stack>
  );
}
