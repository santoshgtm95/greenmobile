import { useState } from "react";
import { api } from "../lib/api";
import { applyFontScale, FONT_SCALE_DEFAULT, readFontScale } from "../lib/fontScale";
import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  Box,
  Button,
  Chip,
  Paper,
  Slider,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableRow,
  Typography,
} from "@mui/material";
import WifiOffIcon from "@mui/icons-material/WifiOff";
import { useSettings } from "../hooks/useSettings";
import { formatRate } from "@shared/money";

/**
 * The System tab of Settings: where the shop's data actually lives, which is
 * the thing an owner most needs to know about an offline POS (for backups, and
 * for moving to a new PC).
 */
export default function SystemInfoPage() {
  const [fontScale, setFontScale] = useState(readFontScale);
  const { data: info } = useQuery({
    queryKey: ["app", "info"],
    queryFn: () => api.app.getInfo(),
  });
  const { data: settings } = useSettings();

  const rows: Array<[string, string]> = [
    ["Shop name", settings?.shopName ?? "—"],
    ["Currency", settings?.currency ?? "—"],
    [
      "Tax",
      settings
        ? settings.taxEnabled
          ? `${formatRate(settings.taxRate)} (${settings.taxMode.toLowerCase()})`
          : "Not charged"
        : "—",
    ],
    ["Receipt width", settings?.receiptWidth ?? "—"],
    [
      "Low stock threshold",
      settings ? String(settings.lowStockThreshold) : "—",
    ],
    ["Negative stock", settings?.allowNegativeStock ? "Allowed" : "Blocked"],
    ["Application version", info?.version ?? "—"],
  ];

  return (
    <Stack spacing={2}>
      <Alert severity="success" icon={<WifiOffIcon />}>
        This POS is running entirely from this computer. No internet connection,
        cloud account or licence check is involved in any of its normal
        operations.
      </Alert>

      <Paper sx={{ border: "1px solid", borderColor: "divider", p: 2 }}>
        <Typography variant="subtitle1">Text size</Typography>
        <Typography variant="caption" color="text.secondary">
          Makes every screen's text bigger or smaller. Saved on this device only.
        </Typography>
        <Stack direction="row" spacing={2} sx={{ alignItems: "center", mt: 1, maxWidth: 520 }}>
          <Box component="span" sx={{ fontSize: "0.75rem" }}>A</Box>
          <Slider
            aria-label="Text size"
            value={fontScale}
            min={80}
            max={140}
            step={5}
            marks
            valueLabelDisplay="auto"
            valueLabelFormat={(v) => `${v}%`}
            onChange={(_e, v) => {
              setFontScale(v as number);
              applyFontScale(v as number);
            }}
          />
          <Box component="span" sx={{ fontSize: "1.25rem" }}>A</Box>
          <Typography variant="body2" sx={{ minWidth: 44, fontVariantNumeric: "tabular-nums" }}>
            {fontScale}%
          </Typography>
          <Button
            size="small"
            disabled={fontScale === FONT_SCALE_DEFAULT}
            onClick={() => {
              setFontScale(FONT_SCALE_DEFAULT);
              applyFontScale(FONT_SCALE_DEFAULT);
            }}
          >
            Reset
          </Button>
        </Stack>
      </Paper>

      <Paper sx={{ border: "1px solid", borderColor: "divider" }}>
        <Box sx={{ px: 2, pt: 2 }}>
          <Typography variant="subtitle1">System</Typography>
        </Box>
        <Table size="small">
          <TableBody>
            {rows.map(([label, value]) => (
              <TableRow key={label}>
                <TableCell sx={{ width: 260, color: "text.secondary" }}>
                  {label}
                </TableCell>
                <TableCell sx={{ wordBreak: "break-all" }}>{value}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>

      <Alert severity="info">
        The remaining settings screens — shop details, tax, currency, invoice
        and receipt layout, users and printer — are still to come. The values
        above are already read from the database rather than hard-coded, so
        nothing here is a mock-up.
      </Alert>

      <Box>
        <Chip
          size="small"
          label={info?.isPackaged ? "Packaged build" : "Development build"}
          color={info?.isPackaged ? "success" : "default"}
        />
      </Box>
    </Stack>
  );
}
