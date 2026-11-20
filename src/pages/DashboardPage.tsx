import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ElementType,
  type ReactNode,
} from "react";
import {
  Alert,
  Box,
  Chip,
  FormControlLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { alpha, keyframes } from "@mui/material/styles";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import TrendingDownIcon from "@mui/icons-material/TrendingDown";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import PointOfSaleIcon from "@mui/icons-material/PointOfSale";
import PaymentsIcon from "@mui/icons-material/Payments";
import MoneyOffIcon from "@mui/icons-material/MoneyOff";
import ShowChartIcon from "@mui/icons-material/ShowChart";
import Inventory2Icon from "@mui/icons-material/Inventory2";
import BuildIcon from "@mui/icons-material/Build";
import PendingActionsIcon from "@mui/icons-material/PendingActions";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  LabelList,
} from "recharts";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useMoneyFormatter } from "../hooks/useSettings";
import ChartCard from "../components/charts/ChartCard";
import MoneyTooltip from "../components/charts/MoneyTooltip";
import {
  CHART_COLORS,
  MARK,
  AXIS_TICK,
  compactMinor,
  truncateLabel,
} from "../components/charts/chartTheme";
import { PosApiError } from "@shared/errors";
import {
  PAYMENT_METHOD_LABELS,
  SERVICE_STATUS_LABELS,
  type PaymentMethod,
  type ServiceStatus,
} from "@shared/domain";
import {
  DATE_PRESETS,
  DATE_PRESET_LABELS,
  resolvePreset,
  formatBusinessDay,
  formatInstant,
  type DatePreset,
} from "@shared/datetime";

// --- Motion ------------------------------------------------------------------

const fadeUp = keyframes`
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: none; }
`;

const ACCENT = {
  blue: "#2a78d6",
  indigo: "#5b5bd6",
  orange: "#eb6834",
  teal: "#00897b",
  green: "#2e7d32",
  red: "#c62828",
  amber: "#e08600",
} as const;

const noMotion = {
  "@media (prefers-reduced-motion: reduce)": {
    animation: "none",
    transition: "none",
  },
};

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Eases a number from its last value to the new one, so figures count up on load and on period change. */
function useCountUp(target: number, duration = 900): number {
  const [value, setValue] = useState(0);
  const from = useRef(0);
  const reduce = prefersReducedMotion();

  useEffect(() => {
    if (reduce) return;
    const begin = from.current;
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const next = Math.round(begin + (target - begin) * (1 - (1 - t) ** 3));
      from.current = next;
      setValue(next);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, duration, reduce]);

  return reduce ? target : value;
}

/** Fades a block up into place; `delay` staggers a row of them. Also gives the card inside the dashboard look. */
function Reveal({
  delay = 0,
  children,
}: {
  delay?: number;
  children: ReactNode;
}) {
  return (
    <Box
      sx={{
        animation: `${fadeUp} .45s cubic-bezier(.2,.7,.2,1) both`,
        animationDelay: `${delay}ms`,
        minWidth: 0,
        "& > .MuiPaper-root": {
          borderRadius: 3,
          height: "100%",
          boxShadow: "0 1px 2px rgba(16,24,40,.04)",
          transition: "box-shadow .2s ease, border-color .2s ease",
          "&:hover": { boxShadow: "0 6px 18px -10px rgba(16,24,40,.18)" },
        },
        ...noMotion,
      }}
    >
      {children}
    </Box>
  );
}

/** Dashboard (spec §31, §72). */
export default function DashboardPage() {
  const money = useMoneyFormatter();

  const [preset, setPreset] = useState<DatePreset>("TODAY");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  // Every chart has a table twin, so no value is reachable by hover alone.
  const [asTables, setAsTables] = useState(false);

  const range = useMemo(
    () =>
      resolvePreset(preset, {
        from: customFrom || undefined,
        to: customTo || undefined,
      }),
    [preset, customFrom, customTo],
  );

  const board = useQuery({
    queryKey: ["dashboard", range],
    queryFn: () => api.reports.dashboard(range),
    // Hold the previous render while refetching rather than flashing a skeleton.
    placeholderData: (previous) => previous,
  });

  const data = board.data;
  const cards = data?.cards;
  const charts = data?.charts;

  // The server widens the by-day window to at least a week; say so, so the chart
  // period is never mistaken for the card period.
  const trendRange = data?.trendRange;
  const trendWidened = Boolean(
    trendRange &&
    (trendRange.from !== range.from || trendRange.to !== range.to),
  );
  const trendSubtitle = trendRange
    ? `${formatBusinessDay(trendRange.from)} — ${formatBusinessDay(trendRange.to)}${
        trendWidened ? " (widened to show a trend)" : ""
      }`
    : undefined;

  const singleDay = range.from === range.to;
  const count = (n: number) => String(n);
  const netProfit = cards?.netProfit ?? 0;
  const lowStockCount = cards?.lowStockCount ?? 0;

  return (
    <Stack spacing={2.5}>
      {/* One filter bar above everything it scopes — never per chart. */}
      <Paper
        sx={{
          position: "relative",
          overflow: "hidden",
          px: 2,
          py: 1.25,
          borderRadius: 3,
          border: "1px solid",
          borderColor: "divider",
          boxShadow: "0 1px 2px rgba(16,24,40,.04)",
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 1.5,
        }}
      >
        <TextField
          select
          size="small"
          fullWidth={false}
          label="Period"
          value={preset}
          onChange={(e) => setPreset(e.target.value as DatePreset)}
          sx={{ width: 180 }}
        >
          {DATE_PRESETS.map((option) => (
            <MenuItem key={option} value={option}>
              {DATE_PRESET_LABELS[option]}
            </MenuItem>
          ))}
        </TextField>
        {preset === "CUSTOM" && (
          <>
            <TextField
              size="small"
              fullWidth={false}
              label="From"
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
              sx={{ width: 170 }}
            />
            <TextField
              size="small"
              fullWidth={false}
              label="To"
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
              sx={{ width: 170 }}
            />
          </>
        )}
        <Typography variant="body2" color="text.secondary" sx={{ flexGrow: 1 }}>
          {singleDay
            ? formatBusinessDay(range.from)
            : `${formatBusinessDay(range.from)} — ${formatBusinessDay(range.to)}`}
        </Typography>
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={asTables}
              onChange={(e) => setAsTables(e.target.checked)}
            />
          }
          label={<Typography variant="body2">Show as tables</Typography>}
          sx={{ mr: 0 }}
        />
        {board.isFetching && data && (
          <LinearProgress
            sx={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 2 }}
          />
        )}
      </Paper>

      {board.isError && (
        <Alert severity="error">
          {board.error instanceof PosApiError
            ? board.error.message
            : "Unable to load the dashboard."}
        </Alert>
      )}

      {/* KPI row. Headline numbers are figures, not one-bar charts. */}
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
          gap: 2,
        }}
      >
        <Reveal delay={30}>
          <StatTile
            label="Sales"
            value={cards?.transactions ?? 0}
            format={count}
            icon={PointOfSaleIcon}
            accent={ACCENT.blue}
            hint={`${cards?.itemsSold ?? 0} item(s) sold`}
          />
        </Reveal>
        <Reveal delay={60}>
          <StatTile
            label="Revenue"
            value={cards?.revenue ?? 0}
            format={money}
            icon={PaymentsIcon}
            accent={ACCENT.indigo}
            hint="Net of discounts, excluding tax"
          />
        </Reveal>
        <Reveal delay={90}>
          <StatTile
            label="Expenses"
            value={cards?.expenses ?? 0}
            format={money}
            icon={MoneyOffIcon}
            accent={ACCENT.orange}
            hint="Shop running costs"
          />
        </Reveal>
        <Reveal delay={120}>
          <StatTile
            label="Gross profit"
            value={cards?.grossProfit ?? 0}
            format={money}
            icon={ShowChartIcon}
            accent={ACCENT.teal}
            hint="Goods and repairs"
          />
        </Reveal>
        <Reveal delay={150}>
          <StatTile
            label="Net profit"
            value={netProfit}
            format={money}
            icon={netProfit >= 0 ? TrendingUpIcon : TrendingDownIcon}
            accent={netProfit >= 0 ? ACCENT.green : ACCENT.red}
            tone={netProfit >= 0 ? "positive" : "negative"}
            hint={netProfit >= 0 ? "Profit" : "Loss"}
          />
        </Reveal>
        <Reveal delay={180}>
          <StatTile
            label="Low stock"
            value={lowStockCount}
            format={count}
            icon={Inventory2Icon}
            accent={lowStockCount > 0 ? ACCENT.amber : ACCENT.green}
            tone={lowStockCount > 0 ? "warning" : undefined}
            hint={lowStockCount > 0 ? "Needs reordering" : "All above minimum"}
          />
        </Reveal>
      </Box>

      {(cards?.serviceRevenue ?? 0) > 0 ||
      (cards?.outstandingServiceBalance ?? 0) > 0 ? (
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
            gap: 2,
          }}
        >
          <Reveal delay={200}>
            <StatTile
              label="Repair income"
              value={cards?.serviceRevenue ?? 0}
              format={money}
              icon={BuildIcon}
              accent={ACCENT.teal}
              hint="Jobs delivered in this period"
            />
          </Reveal>
          <Reveal delay={220}>
            <StatTile
              label="Owed on repairs"
              value={cards?.outstandingServiceBalance ?? 0}
              format={money}
              icon={PendingActionsIcon}
              accent={ACCENT.amber}
              tone={
                (cards?.outstandingServiceBalance ?? 0) > 0
                  ? "warning"
                  : undefined
              }
              hint="Across all open jobs"
            />
          </Reveal>
        </Box>
      ) : null}

      {/* Time charts. Both series share one unit, so one axis — never a second scale. */}
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", lg: "1fr 1fr" },
          gap: 2,
        }}
      >
        <Reveal delay={225}>
          <ChartCard
            title="Sales by day"
            subtitle={
              trendSubtitle ?? "Revenue and the profit on goods inside it"
            }
            empty={!charts || charts.salesByDay.every((d) => d.netSales === 0)}
          >
            {asTables ? (
              <DayTable
                rows={(charts?.salesByDay ?? []).map((d) => ({
                  day: d.day,
                  a: d.netSales,
                  b: d.grossProfit,
                }))}
                headA="Revenue"
                headB="Profit on goods"
                money={money}
              />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={charts?.salesByDay ?? []}
                  margin={{ top: 8, right: 12, bottom: 4, left: 4 }}
                >
                  <defs>
                    <SoftGradient id="dashArea1" color={CHART_COLORS.series1} />
                    <SoftGradient id="dashArea2" color={CHART_COLORS.series2} />
                  </defs>
                  <CartesianGrid
                    stroke={CHART_COLORS.grid}
                    strokeWidth={MARK.gridWidth}
                    vertical={false}
                  />
                  <XAxis
                    dataKey="day"
                    tickFormatter={(day: string) => day.slice(5)}
                    tick={AXIS_TICK}
                    stroke={CHART_COLORS.axis}
                    tickLine={false}
                  />
                  <YAxis
                    tickFormatter={compactMinor}
                    tick={AXIS_TICK}
                    stroke={CHART_COLORS.axis}
                    tickLine={false}
                    width={52}
                  />
                  <Tooltip
                    content={(props) => (
                      <MoneyTooltip {...props} format={money} isDay />
                    )}
                  />
                  <Legend
                    iconType="plainline"
                    wrapperStyle={{ fontSize: 12 }}
                  />
                  {(
                    [
                      [
                        "Revenue",
                        "netSales",
                        CHART_COLORS.series1,
                        "dashArea1",
                      ],
                      [
                        "Profit on goods",
                        "grossProfit",
                        CHART_COLORS.series2,
                        "dashArea2",
                      ],
                    ] as const
                  ).map(([name, key, color, fill]) => (
                    <Area
                      key={key}
                      name={name}
                      type="monotone"
                      dataKey={key}
                      stroke={color}
                      strokeWidth={2.5}
                      fill={`url(#${fill})`}
                      animationDuration={1100}
                      dot={{
                        r: 3,
                        fill: color,
                        stroke: CHART_COLORS.surface,
                        strokeWidth: MARK.dotRingWidth,
                      }}
                      activeDot={{
                        r: 6,
                        stroke: CHART_COLORS.surface,
                        strokeWidth: 2,
                      }}
                    />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            )}
          </ChartCard>
        </Reveal>

        <Reveal delay={260}>
          <ChartCard
            title="Revenue vs expenses"
            subtitle={trendSubtitle ?? "What came in against what went out"}
            empty={
              !charts ||
              charts.revenueVsExpenses.every(
                (d) => d.revenue === 0 && d.expenses === 0,
              )
            }
          >
            {asTables ? (
              <DayTable
                rows={(charts?.revenueVsExpenses ?? []).map((d) => ({
                  day: d.day,
                  a: d.revenue,
                  b: d.expenses,
                }))}
                headA="Revenue"
                headB="Expenses"
                money={money}
              />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={charts?.revenueVsExpenses ?? []}
                  margin={{ top: 8, right: 12, bottom: 4, left: 4 }}
                  barGap={3}
                >
                  <defs>
                    <SolidGradient id="dashBar1" color={CHART_COLORS.series1} />
                    <SolidGradient id="dashBar2" color={CHART_COLORS.series2} />
                  </defs>
                  <CartesianGrid
                    stroke={CHART_COLORS.grid}
                    strokeWidth={MARK.gridWidth}
                    vertical={false}
                  />
                  <XAxis
                    dataKey="day"
                    tickFormatter={(day: string) => day.slice(5)}
                    tick={AXIS_TICK}
                    stroke={CHART_COLORS.axis}
                    tickLine={false}
                  />
                  <YAxis
                    tickFormatter={compactMinor}
                    tick={AXIS_TICK}
                    stroke={CHART_COLORS.axis}
                    tickLine={false}
                    width={52}
                  />
                  <Tooltip
                    content={(props) => (
                      <MoneyTooltip {...props} format={money} isDay />
                    )}
                    cursor={{ fill: alpha(CHART_COLORS.series1, 0.06) }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar
                    name="Revenue"
                    dataKey="revenue"
                    fill="url(#dashBar1)"
                    maxBarSize={MARK.barMaxThickness}
                    radius={[6, 6, 0, 0]}
                    animationDuration={900}
                  />
                  <Bar
                    name="Expenses"
                    dataKey="expenses"
                    fill="url(#dashBar2)"
                    maxBarSize={MARK.barMaxThickness}
                    radius={[6, 6, 0, 0]}
                    animationDuration={900}
                    animationBegin={150}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>
        </Reveal>
      </Box>

      {/* Magnitude comparisons. One hue each — bar length already encodes size. */}
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", lg: "1fr 1fr" },
          gap: 2,
        }}
      >
        <Reveal delay={290}>
          <ChartCard
            title="Top products"
            subtitle="By revenue in this period"
            height={300}
            empty={!charts || charts.topProducts.length === 0}
          >
            {asTables ? (
              <NameValueTable
                rows={(charts?.topProducts ?? []).map((p) => ({
                  name: p.productName,
                  value: p.netSales,
                  extra: `${p.quantity} sold · ${money(p.grossProfit)} profit`,
                }))}
                valueHead="Revenue"
                money={money}
              />
            ) : (
              <HorizontalBars
                id="dashTop"
                color={CHART_COLORS.series1}
                data={(charts?.topProducts ?? []).map((p) => ({
                  name: p.productName,
                  value: p.netSales,
                }))}
                money={money}
              />
            )}
          </ChartCard>
        </Reveal>

        <Reveal delay={320}>
          <ChartCard
            title="Sales by category"
            subtitle="Where the revenue came from"
            height={300}
            empty={!charts || charts.salesByCategory.length === 0}
          >
            {asTables ? (
              <NameValueTable
                rows={(charts?.salesByCategory ?? []).map((c) => ({
                  name: c.categoryName,
                  value: c.netSales,
                  extra: `${c.quantity} item(s)`,
                }))}
                valueHead="Revenue"
                money={money}
              />
            ) : (
              <HorizontalBars
                id="dashCategory"
                color={CHART_COLORS.series1}
                data={(charts?.salesByCategory ?? [])
                  .slice(0, 8)
                  .map((c) => ({ name: c.categoryName, value: c.netSales }))}
                money={money}
              />
            )}
          </ChartCard>
        </Reveal>
      </Box>

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", lg: "1fr 2fr" },
          gap: 2,
        }}
      >
        <Reveal delay={350}>
          <ChartCard
            title="Payment methods"
            subtitle="How customers paid"
            height={240}
            empty={!charts || charts.paymentMethods.length === 0}
          >
            {asTables ? (
              <NameValueTable
                rows={(charts?.paymentMethods ?? []).map((m) => ({
                  name:
                    PAYMENT_METHOD_LABELS[m.paymentMethod as PaymentMethod] ??
                    m.paymentMethod,
                  value: m.total,
                  extra: `${m.count} payment(s)`,
                }))}
                valueHead="Taken"
                money={money}
              />
            ) : (
              <HorizontalBars
                id="dashPay"
                color={CHART_COLORS.series1}
                data={(charts?.paymentMethods ?? []).map((m) => ({
                  name:
                    PAYMENT_METHOD_LABELS[m.paymentMethod as PaymentMethod] ??
                    m.paymentMethod,
                  value: m.total,
                }))}
                money={money}
                labelWidth={100}
              />
            )}
          </ChartCard>
        </Reveal>

        <Reveal delay={380}>
          <Paper sx={{ p: 2, border: "1px solid", borderColor: "divider" }}>
            <SectionTitle title="Low stock" />
            {(data?.lowStock.length ?? 0) === 0 ? (
              <Typography variant="body2" color="text.secondary">
                Every product is above its minimum.
              </Typography>
            ) : (
              <Stack spacing={1.25}>
                {(data?.lowStock ?? []).map((row) => {
                  const out = row.stockQuantity <= 0;
                  const pct =
                    row.minimumStock > 0
                      ? Math.max(
                          0,
                          Math.min(
                            100,
                            (row.stockQuantity / row.minimumStock) * 100,
                          ),
                        )
                      : 0;
                  return (
                    <Box key={row.id}>
                      <Stack
                        direction="row"
                        spacing={1.5}
                        sx={{ alignItems: "baseline" }}
                      >
                        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                          <Typography
                            variant="body2"
                            noWrap
                            sx={{ fontWeight: 600 }}
                          >
                            {row.name}
                          </Typography>
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            noWrap
                            sx={{ display: "block" }}
                          >
                            {row.sku} · {row.categoryName ?? "—"}
                          </Typography>
                        </Box>
                        <Typography
                          variant="body2"
                          sx={{
                            fontVariantNumeric: "tabular-nums",
                            whiteSpace: "nowrap",
                            color: "text.secondary",
                          }}
                        >
                          <Box
                            component="span"
                            sx={{
                              fontWeight: 800,
                              color: out ? "error.main" : "warning.main",
                            }}
                          >
                            {row.stockQuantity}
                          </Box>
                          {` / ${row.minimumStock || "—"}`}
                          {out && " · out"}
                        </Typography>
                      </Stack>
                      <LinearProgress
                        variant="determinate"
                        value={pct}
                        color={out ? "error" : "warning"}
                        aria-label={`${row.name}: ${row.stockQuantity} in stock, minimum ${row.minimumStock}`}
                        sx={{
                          mt: 0.5,
                          height: 6,
                          borderRadius: 3,
                          bgcolor: "action.hover",
                        }}
                      />
                    </Box>
                  );
                })}
              </Stack>
            )}
          </Paper>
        </Reveal>
      </Box>

      {/* Recent activity (spec §31) */}
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", lg: "repeat(3, 1fr)" },
          gap: 2,
        }}
      >
        <Reveal delay={410}>
          <Paper sx={{ p: 2, border: "1px solid", borderColor: "divider" }}>
            <SectionTitle title="Recent sales" />
            {(data?.recent.sales.length ?? 0) === 0 && <Empty />}
            {(data?.recent.sales ?? []).map((sale) => (
              <ActivityRow
                key={sale.id}
                icon={ReceiptLongIcon}
                title={sale.invoiceNumber}
                subtitle={`${sale.customerName} · ${formatInstant(sale.saleDate)}`}
              >
                {sale.status !== "COMPLETED" && (
                  <Chip
                    size="small"
                    label={sale.status.replace(/_/g, " ").toLowerCase()}
                  />
                )}
                <Typography
                  variant="body2"
                  sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 700 }}
                >
                  {money(sale.grandTotal)}
                </Typography>
              </ActivityRow>
            ))}
          </Paper>
        </Reveal>

        <Reveal delay={440}>
          <Paper sx={{ p: 2, border: "1px solid", borderColor: "divider" }}>
            <SectionTitle title="Recent expenses" />
            {(data?.recent.expenses.length ?? 0) === 0 && <Empty />}
            {(data?.recent.expenses ?? []).map((expense) => (
              <ActivityRow
                key={expense.id}
                icon={MoneyOffIcon}
                title={expense.description}
                subtitle={`${expense.categoryName} · ${formatBusinessDay(expense.expenseDay)}`}
              >
                <Typography
                  variant="body2"
                  sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 700 }}
                >
                  {money(expense.amount)}
                </Typography>
              </ActivityRow>
            ))}
          </Paper>
        </Reveal>

        <Reveal delay={470}>
          <Paper sx={{ p: 2, border: "1px solid", borderColor: "divider" }}>
            <SectionTitle title="Recent service orders" />
            {(data?.recent.services.length ?? 0) === 0 && <Empty />}
            {(data?.recent.services ?? []).map((job) => (
              <ActivityRow
                key={job.id}
                icon={BuildIcon}
                title={`${job.deviceBrand} ${job.deviceModel}`}
                subtitle={`${job.serviceNumber} · ${job.customerName}`}
              >
                <Chip
                  size="small"
                  variant="outlined"
                  label={
                    SERVICE_STATUS_LABELS[job.status as ServiceStatus] ??
                    job.status
                  }
                />
              </ActivityRow>
            ))}
          </Paper>
        </Reveal>
      </Box>
    </Stack>
  );
}

// -----------------------------------------------------------------------------

function Empty() {
  return (
    <Typography variant="body2" color="text.secondary">
      Nothing yet.
    </Typography>
  );
}

function IconBubble({
  icon: Icon,
  accent,
  size = 36,
}: {
  icon: ElementType;
  accent: string;
  size?: number;
}) {
  return (
    <Box
      aria-hidden
      sx={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: 2,
        display: "grid",
        placeItems: "center",
        color: accent,
        bgcolor: alpha(accent, 0.12),
      }}
    >
      <Icon sx={{ fontSize: size * 0.55 }} />
    </Box>
  );
}

function SectionTitle({ title }: { title: string }) {
  return (
    <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>
      {title}
    </Typography>
  );
}

function ActivityRow({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: ElementType;
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <Stack
      direction="row"
      spacing={1.25}
      sx={{
        alignItems: "center",
        mx: -1,
        px: 1,
        py: 0.75,
        borderRadius: 2,
        transition: "background-color .2s",
        "&:hover": { bgcolor: "action.hover" },
      }}
    >
      <IconBubble icon={icon} accent="#64748b" size={32} />
      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
        <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
          {title}
        </Typography>
        <Typography
          variant="caption"
          color="text.secondary"
          noWrap
          sx={{ display: "block" }}
        >
          {subtitle}
        </Typography>
      </Box>
      {children}
    </Stack>
  );
}

/**
 * Stat tile (spec §31).
 *
 * Values use proportional figures — tabular digits make a large number look
 * loose. A tone always ships with a word and an icon, so the colour is never
 * the only thing carrying the meaning.
 */
function StatTile({
  label,
  value,
  format,
  hint,
  tone,
  icon,
  accent,
}: {
  label: string;
  value: number;
  format: (n: number) => string;
  hint?: string;
  tone?: "positive" | "negative" | "warning";
  icon: ElementType;
  accent: string;
}) {
  const shown = useCountUp(value);
  const color =
    tone === "positive"
      ? "success.main"
      : tone === "negative"
        ? "error.main"
        : tone === "warning"
          ? "warning.main"
          : "text.primary";
  const ToneIcon =
    tone === "positive"
      ? TrendingUpIcon
      : tone === "negative"
        ? TrendingDownIcon
        : tone === "warning"
          ? WarningAmberIcon
          : null;

  return (
    <Paper
      sx={{
        position: "relative",
        overflow: "hidden",
        p: 2.25,
        border: "1px solid",
        borderColor: "divider",
        "&&:hover": { borderColor: alpha(accent, 0.45) },
      }}
    >
      <Stack
        direction="row"
        sx={{ alignItems: "center", justifyContent: "space-between" }}
      >
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ fontWeight: 600 }}
        >
          {label}
        </Typography>
        <IconBubble icon={icon} accent="#64748b" />
      </Stack>
      <Typography
        variant="h5"
        aria-label={`${label}: ${format(value)}`}
        sx={{ fontWeight: 700, letterSpacing: "-0.02em", color, mt: 0.75 }}
      >
        {format(shown)}
      </Typography>
      {hint && (
        <Stack
          direction="row"
          spacing={0.5}
          sx={{
            alignItems: "center",
            mt: 0.25,
            position: "relative",
            zIndex: 1,
          }}
        >
          {ToneIcon && <ToneIcon sx={{ fontSize: 14, color }} />}
          <Typography variant="caption" color="text.secondary">
            {hint}
          </Typography>
        </Stack>
      )}
    </Paper>
  );
}

/** Fades from the series colour to transparent under an area line. */
function SoftGradient({ id, color }: { id: string; color: string }) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor={color} stopOpacity={0.35} />
      <stop offset="100%" stopColor={color} stopOpacity={0.02} />
    </linearGradient>
  );
}

/** A gentle vertical sheen on a bar, still reading as one solid hue. */
function SolidGradient({
  id,
  color,
  horizontal,
}: {
  id: string;
  color: string;
  horizontal?: boolean;
}) {
  return (
    <linearGradient
      id={id}
      x1="0"
      y1="0"
      x2={horizontal ? "1" : "0"}
      y2={horizontal ? "0" : "1"}
    >
      <stop offset="0%" stopColor={color} stopOpacity={horizontal ? 0.65 : 1} />
      <stop
        offset="100%"
        stopColor={color}
        stopOpacity={horizontal ? 1 : 0.7}
      />
    </linearGradient>
  );
}

/**
 * Magnitude comparison across named things.
 *
 * A single hue for every bar: the length already encodes the size, so shading
 * darker-where-bigger would spend the colour channel on information the reader
 * can already see. One series, so no legend — the card title names it.
 */
function HorizontalBars({
  id,
  color,
  data,
  money,
  labelWidth = 130,
}: {
  /** Unique per chart: the bar gradient is looked up by this id. */
  id: string;
  color: string;
  data: Array<{ name: string; value: number }>;
  money: (minor: number) => string;
  labelWidth?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={data}
        layout="vertical"
        // Right margin leaves room for the end labels so they are never clipped.
        margin={{ top: 4, right: 76, bottom: 4, left: 4 }}
      >
        <defs>
          <SolidGradient id={id} color={color} horizontal />
        </defs>
        <CartesianGrid
          stroke={CHART_COLORS.grid}
          strokeWidth={MARK.gridWidth}
          horizontal={false}
        />
        <XAxis
          type="number"
          tickFormatter={compactMinor}
          tick={AXIS_TICK}
          stroke={CHART_COLORS.axis}
          tickLine={false}
        />
        <YAxis
          type="category"
          dataKey="name"
          tickFormatter={(name: string) => truncateLabel(name, 18)}
          tick={AXIS_TICK}
          stroke={CHART_COLORS.axis}
          tickLine={false}
          width={labelWidth}
        />
        <Tooltip
          content={(props) => <MoneyTooltip {...props} format={money} />}
          cursor={{ fill: alpha(color, 0.06) }}
        />
        <Bar
          name="Revenue"
          dataKey="value"
          fill={`url(#${id})`}
          maxBarSize={MARK.barMaxThickness}
          radius={[0, 6, 6, 0]}
          animationDuration={1000}
        >
          <LabelList
            dataKey="value"
            position="right"
            formatter={(value: unknown) => money(Number(value ?? 0))}
            style={{
              fontSize: 11,
              fill: CHART_COLORS.muted,
              fontVariantNumeric: "tabular-nums",
            }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Table twin for the two-series day charts. */
function DayTable({
  rows,
  headA,
  headB,
  money,
}: {
  rows: Array<{ day: string; a: number; b: number }>;
  headA: string;
  headB: string;
  money: (minor: number) => string;
}) {
  return (
    <Box sx={{ height: "100%", overflow: "auto" }}>
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            <TableCell>Day</TableCell>
            <TableCell align="right">{headA}</TableCell>
            <TableCell align="right">{headB}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.day}>
              <TableCell sx={{ whiteSpace: "nowrap" }}>
                {formatBusinessDay(row.day)}
              </TableCell>
              <TableCell
                align="right"
                sx={{ fontVariantNumeric: "tabular-nums" }}
              >
                {money(row.a)}
              </TableCell>
              <TableCell
                align="right"
                sx={{ fontVariantNumeric: "tabular-nums" }}
              >
                {money(row.b)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
}

/** Table twin for the magnitude charts. */
function NameValueTable({
  rows,
  valueHead,
  money,
}: {
  rows: Array<{ name: string; value: number; extra?: string }>;
  valueHead: string;
  money: (minor: number) => string;
}) {
  return (
    <Box sx={{ height: "100%", overflow: "auto" }}>
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            <TableCell>Name</TableCell>
            <TableCell align="right">{valueHead}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.name}>
              <TableCell>
                {row.name}
                {row.extra && (
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: "block" }}
                  >
                    {row.extra}
                  </Typography>
                )}
              </TableCell>
              <TableCell
                align="right"
                sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}
              >
                {money(row.value)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
}
