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
  Button,
  Chip,
  Divider,
  LinearProgress,
  Paper,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip as MuiTooltip,
  Typography,
} from "@mui/material";
import { alpha, keyframes } from "@mui/material/styles";
import { useNavigate } from "react-router-dom";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import TrendingDownIcon from "@mui/icons-material/TrendingDown";
import PointOfSaleIcon from "@mui/icons-material/PointOfSale";
import MoneyOffIcon from "@mui/icons-material/MoneyOff";
import Inventory2Icon from "@mui/icons-material/Inventory2";
import BuildIcon from "@mui/icons-material/Build";
import PendingActionsIcon from "@mui/icons-material/PendingActions";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutlined";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import TableChartOutlinedIcon from "@mui/icons-material/TableChartOutlined";
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
} from "recharts";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useAuth } from "../hooks/useAuth";
import { useMoneyFormatter } from "../hooks/useSettings";
import ChartCard from "../components/charts/ChartCard";
import { compactFiltersSx } from "../components/compactSx";
import MoneyTooltip from "../components/charts/MoneyTooltip";
import {
  CHART_COLORS,
  MARK,
  AXIS_TICK,
  compactMinor,
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
function Reveal({ delay = 0, children }: { delay?: number; children: ReactNode }) {
  return (
    <Box
      sx={{
        animation: `${fadeUp} .45s cubic-bezier(.2,.7,.2,1) both`,
        animationDelay: `${delay}ms`,
        minWidth: 0,
        "& > .MuiPaper-root": {
          borderRadius: 3,
          height: "100%",
          border: "1px solid",
          borderColor: "divider",
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

const grid = (columns: object) => ({
  display: "grid",
  gridTemplateColumns: columns,
  gap: 2,
});

function greeting(): string {
  const hour = new Date().getHours();
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

type Trend = "sales" | "cashflow";
type Activity = "sales" | "expenses" | "services";

/** Dashboard (spec §31, §72). */
export default function DashboardPage() {
  const money = useMoneyFormatter();
  const navigate = useNavigate();
  const { user, can } = useAuth();

  const [preset, setPreset] = useState<DatePreset>("TODAY");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  // The trend chart has a table twin, so no value is reachable by hover alone.
  const [asTables, setAsTables] = useState(false);
  const [trend, setTrend] = useState<Trend>("sales");
  const [activity, setActivity] = useState<Activity>("sales");

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
    trendRange && (trendRange.from !== range.from || trendRange.to !== range.to),
  );
  const trendSubtitle = trendRange
    ? `${formatBusinessDay(trendRange.from)} — ${formatBusinessDay(trendRange.to)}${
        trendWidened ? " (widened to show a trend)" : ""
      }`
    : undefined;

  const periodLabel =
    range.from === range.to
      ? formatBusinessDay(range.from)
      : `${formatBusinessDay(range.from)} — ${formatBusinessDay(range.to)}`;

  const revenue = cards?.revenue ?? 0;
  const transactions = cards?.transactions ?? 0;
  const grossProfit = cards?.grossProfit ?? 0;
  const expenses = cards?.expenses ?? 0;
  const netProfit = cards?.netProfit ?? 0;
  // Net profit = gross profit + banking fee profit − expenses; the middle term is what's left over.
  const bankingProfit = netProfit - grossProfit + expenses;
  const lowStockCount = cards?.lowStockCount ?? 0;
  const owedOnRepairs = cards?.outstandingServiceBalance ?? 0;

  const salesByDay = charts?.salesByDay ?? [];
  const paymentTotal = (charts?.paymentMethods ?? []).reduce((s, m) => s + m.total, 0);

  return (
    <Stack
      spacing={2}
      sx={{
        ...compactFiltersSx,
        "& .MuiTypography-body2": { fontSize: "0.78rem" },
        "& .MuiTypography-subtitle2": { fontSize: "0.8rem" },
      }}
    >
      {/* Header: who, when, and the one period filter that scopes everything below. */}
      <Box sx={{ position: "relative" }}>
        <Stack
          direction={{ xs: "column", md: "row" }}
          spacing={1.5}
          sx={{ alignItems: { md: "flex-end" }, justifyContent: "space-between" }}
        >
          <Box>
            <Typography sx={{ fontWeight: 800, fontSize: "1.25rem", letterSpacing: "-0.02em" }}>
              {greeting()}
              {user ? `, ${user.fullName.split(" ")[0]}` : ""}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Here is how the shop is doing · {periodLabel}
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <MuiTooltip title={asTables ? "Show charts" : "Show charts as tables"}>
              <ToggleButton
                value="tables"
                size="small"
                selected={asTables}
                onChange={() => setAsTables((v) => !v)}
                aria-label="Show charts as tables"
                sx={{ borderRadius: 2, py: 0.5 }}
              >
                <TableChartOutlinedIcon fontSize="small" />
              </ToggleButton>
            </MuiTooltip>
            {can("pos.sell") && (
              <Button
                variant="contained"
                size="small"
                disableElevation
                startIcon={<PointOfSaleIcon />}
                onClick={() => navigate("/pos")}
                sx={{ borderRadius: 2, whiteSpace: "nowrap" }}
              >
                New sale
              </Button>
            )}
          </Stack>
        </Stack>

        <Stack
          direction="row"
          sx={{ mt: 1.5, flexWrap: "wrap", gap: 0.75, alignItems: "center" }}
          role="radiogroup"
          aria-label="Period"
        >
          {DATE_PRESETS.map((option) => (
            <Chip
              key={option}
              role="radio"
              aria-checked={preset === option}
              label={DATE_PRESET_LABELS[option]}
              size="small"
              clickable
              color={preset === option ? "primary" : "default"}
              variant={preset === option ? "filled" : "outlined"}
              onClick={() => setPreset(option)}
              sx={{ fontWeight: 600, fontSize: "0.72rem" }}
            />
          ))}
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
                sx={{ width: 160, ml: 0.5 }}
              />
              <TextField
                size="small"
                fullWidth={false}
                label="To"
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
                sx={{ width: 160 }}
              />
            </>
          )}
        </Stack>
        {board.isFetching && data && (
          <LinearProgress sx={{ position: "absolute", left: 0, right: 0, bottom: -8, height: 2 }} />
        )}
      </Box>

      {board.isError && (
        <Alert severity="error">
          {board.error instanceof PosApiError ? board.error.message : "Unable to load the dashboard."}
        </Alert>
      )}

      {/* Hero row: the one number that matters most, then profit, then what needs action. */}
      <Box sx={grid({ xs: "1fr", md: "1fr 1fr", lg: "1.6fr 1fr 1fr" })}>
        <Reveal delay={30}>
          <Paper
            sx={(t) => ({
              p: 2,
              display: "flex",
              flexDirection: "column",
              "&&": {
                borderColor: alpha(t.palette.primary.main, 0.25),
                background: `linear-gradient(135deg, ${alpha(t.palette.primary.main, 0.1)} 0%, ${alpha(
                  t.palette.primary.main,
                  0.02,
                )} 60%)`,
              },
            })}
          >
            <Eyebrow>Revenue</Eyebrow>
            <BigFigure value={revenue} format={money} label="Revenue" size="2rem" />
            <Typography variant="caption" color="text.secondary">
              Net of discounts, excluding tax
            </Typography>
            <Box sx={{ flexGrow: 1, minHeight: 64, mx: -0.5, mt: 1 }}>
              {salesByDay.some((d) => d.netSales !== 0) && (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={salesByDay} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
                    <defs>
                      <SoftGradient id="heroSpark" color={CHART_COLORS.series1} />
                    </defs>
                    <Tooltip content={(props) => <MoneyTooltip {...props} format={money} isDay />} />
                    <Area
                      name="Revenue"
                      type="monotone"
                      dataKey="netSales"
                      stroke={CHART_COLORS.series1}
                      strokeWidth={2}
                      fill="url(#heroSpark)"
                      animationDuration={1100}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </Box>
            <Divider sx={{ my: 1.25 }} />
            <Stack direction="row" divider={<Divider orientation="vertical" flexItem />} spacing={2}>
              <MiniStat label="Sales" value={String(transactions)} />
              <MiniStat label="Items sold" value={String(cards?.itemsSold ?? 0)} />
              <MiniStat label="Avg. sale" value={money(transactions > 0 ? Math.round(revenue / transactions) : 0)} />
            </Stack>
          </Paper>
        </Reveal>

        <Reveal delay={80}>
          <Paper sx={{ p: 2, display: "flex", flexDirection: "column" }}>
            <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between" }}>
              <Eyebrow>Net profit</Eyebrow>
              <Chip
                size="small"
                icon={netProfit >= 0 ? <TrendingUpIcon /> : <TrendingDownIcon />}
                label={netProfit >= 0 ? "Profit" : "Loss"}
                color={netProfit >= 0 ? "success" : "error"}
                variant="outlined"
                sx={{ height: 22, fontSize: "0.68rem", fontWeight: 700 }}
              />
            </Stack>
            <BigFigure
              value={netProfit}
              format={money}
              label="Net profit"
              size="1.6rem"
              color={netProfit >= 0 ? "success.main" : "error.main"}
            />
            <Stack spacing={0.75} sx={{ mt: "auto", pt: 1.5 }}>
              <Breakdown label="Gross profit" hint="Goods and repairs" value={money(grossProfit)} />
              {bankingProfit !== 0 && <Breakdown label="Banking fees" value={money(bankingProfit)} />}
              <Breakdown label="Expenses" hint="Shop running costs" value={`− ${money(expenses)}`} />
              {(cards?.serviceRevenue ?? 0) > 0 && (
                <Breakdown label="Repair income" hint="Jobs delivered" value={money(cards?.serviceRevenue ?? 0)} muted />
              )}
            </Stack>
          </Paper>
        </Reveal>

        <Reveal delay={130}>
          <Paper sx={{ p: 2, display: "flex", flexDirection: "column" }}>
            <Eyebrow>Needs attention</Eyebrow>
            {lowStockCount === 0 && owedOnRepairs === 0 ? (
              <Stack spacing={1} sx={{ flexGrow: 1, alignItems: "center", justifyContent: "center", py: 2 }}>
                <CheckCircleOutlineIcon color="success" sx={{ fontSize: 36 }} />
                <Typography variant="body2" color="text.secondary">
                  All clear — nothing to follow up.
                </Typography>
              </Stack>
            ) : (
              <Stack spacing={1} sx={{ mt: 1 }}>
                <AttentionRow
                  icon={Inventory2Icon}
                  label="Low stock"
                  hint={lowStockCount > 0 ? "Products below minimum" : "All above minimum"}
                  value={String(lowStockCount)}
                  active={lowStockCount > 0}
                  onClick={can("products.view") ? () => navigate("/stocks") : undefined}
                />
                <AttentionRow
                  icon={PendingActionsIcon}
                  label="Owed on repairs"
                  hint="Across all open jobs"
                  value={money(owedOnRepairs)}
                  active={owedOnRepairs > 0}
                  onClick={can("services.view") ? () => navigate("/services") : undefined}
                />
              </Stack>
            )}
          </Paper>
        </Reveal>
      </Box>

      {/* Trend + payment mix. Both trend series share one unit, so one axis — never a second scale. */}
      <Box sx={grid({ xs: "1fr", lg: "2fr 1fr" })}>
        <Reveal delay={180}>
          <ChartCard
            title={trend === "sales" ? "Revenue and profit by day" : "Revenue vs expenses by day"}
            subtitle={trendSubtitle}
            height={280}
            empty={
              !charts ||
              (trend === "sales"
                ? salesByDay.every((d) => d.netSales === 0)
                : charts.revenueVsExpenses.every((d) => d.revenue === 0 && d.expenses === 0))
            }
            action={
              <ToggleButtonGroup
                size="small"
                exclusive
                value={trend}
                onChange={(_, v: Trend | null) => v && setTrend(v)}
                aria-label="Trend chart"
                sx={{ "& .MuiToggleButton-root": { py: 0.25, px: 1, fontSize: "0.68rem", textTransform: "none" } }}
              >
                <ToggleButton value="sales">Profit</ToggleButton>
                <ToggleButton value="cashflow">Expenses</ToggleButton>
              </ToggleButtonGroup>
            }
          >
            {trend === "sales" ? (
              asTables ? (
                <DayTable
                  rows={salesByDay.map((d) => ({ day: d.day, a: d.netSales, b: d.grossProfit }))}
                  headA="Revenue"
                  headB="Profit on goods"
                  money={money}
                />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={salesByDay} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
                    <defs>
                      <SoftGradient id="dashArea1" color={CHART_COLORS.series1} />
                      <SoftGradient id="dashArea2" color={CHART_COLORS.series2} />
                    </defs>
                    <DayAxes />
                    <Tooltip content={(props) => <MoneyTooltip {...props} format={money} isDay />} />
                    <Legend iconType="plainline" wrapperStyle={{ fontSize: 11 }} />
                    {(
                      [
                        ["Revenue", "netSales", CHART_COLORS.series1, "dashArea1"],
                        ["Profit on goods", "grossProfit", CHART_COLORS.series2, "dashArea2"],
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
                        dot={{ r: 3, fill: color, stroke: CHART_COLORS.surface, strokeWidth: MARK.dotRingWidth }}
                        activeDot={{ r: 6, stroke: CHART_COLORS.surface, strokeWidth: 2 }}
                      />
                    ))}
                  </AreaChart>
                </ResponsiveContainer>
              )
            ) : asTables ? (
              <DayTable
                rows={(charts?.revenueVsExpenses ?? []).map((d) => ({ day: d.day, a: d.revenue, b: d.expenses }))}
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
                  <DayAxes />
                  <Tooltip
                    content={(props) => <MoneyTooltip {...props} format={money} isDay />}
                    cursor={{ fill: alpha(CHART_COLORS.series1, 0.06) }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
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

        <Reveal delay={230}>
          <Paper sx={{ p: 2 }}>
            <SectionTitle title="Payment mix" subtitle="How customers paid" />
            <RankList
              money={money}
              rows={(charts?.paymentMethods ?? []).map((m) => ({
                key: m.paymentMethod,
                name: PAYMENT_METHOD_LABELS[m.paymentMethod as PaymentMethod] ?? m.paymentMethod,
                value: m.total,
                meta: `${m.count} payment(s) · ${paymentTotal > 0 ? Math.round((m.total / paymentTotal) * 100) : 0}%`,
              }))}
              barOf={paymentTotal}
            />
          </Paper>
        </Reveal>
      </Box>

      {/* Magnitude comparisons as ranked lists: every value is printed, so they need no table twin. */}
      <Box sx={grid({ xs: "1fr", md: "1fr 1fr" })}>
        <Reveal delay={280}>
          <Paper sx={{ p: 2 }}>
            <SectionTitle title="Top products" subtitle="By revenue in this period" />
            <RankList
              money={money}
              ranked
              rows={(charts?.topProducts ?? []).map((p) => ({
                key: p.productId,
                name: p.productName,
                value: p.netSales,
                meta: `${p.quantity} sold · ${money(p.grossProfit)} profit`,
              }))}
            />
          </Paper>
        </Reveal>
        <Reveal delay={320}>
          <Paper sx={{ p: 2 }}>
            <SectionTitle title="Sales by category" subtitle="Where the revenue came from" />
            <RankList
              money={money}
              ranked
              rows={(charts?.salesByCategory ?? []).slice(0, 8).map((c) => ({
                key: c.categoryName,
                name: c.categoryName,
                value: c.netSales,
                meta: `${c.quantity} item(s)`,
              }))}
            />
          </Paper>
        </Reveal>
      </Box>

      {/* Recent activity (spec §31) beside the low-stock list. */}
      <Box sx={grid({ xs: "1fr", lg: "2fr 1fr" })}>
        <Reveal delay={360}>
          <Paper sx={{ p: 2 }}>
            <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", mb: 0.5 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                Recent activity
              </Typography>
              {can(ACTIVITY_LINKS[activity].permission) && (
                <Button
                  size="small"
                  endIcon={<ChevronRightIcon />}
                  onClick={() => navigate(ACTIVITY_LINKS[activity].to)}
                  sx={{ textTransform: "none", fontSize: "0.72rem" }}
                >
                  View all
                </Button>
              )}
            </Stack>
            <Tabs
              value={activity}
              onChange={(_, v: Activity) => setActivity(v)}
              sx={{
                minHeight: 32,
                mb: 1,
                borderBottom: 1,
                borderColor: "divider",
                "& .MuiTab-root": { minHeight: 32, py: 0.5, px: 1.5, textTransform: "none", fontSize: "0.75rem" },
              }}
            >
              <Tab value="sales" label={`Sales (${data?.recent.sales.length ?? 0})`} />
              <Tab value="expenses" label={`Expenses (${data?.recent.expenses.length ?? 0})`} />
              <Tab value="services" label={`Repairs (${data?.recent.services.length ?? 0})`} />
            </Tabs>

            {activity === "sales" &&
              ((data?.recent.sales.length ?? 0) === 0 ? (
                <Empty />
              ) : (
                (data?.recent.sales ?? []).map((sale) => (
                  <ActivityRow
                    key={sale.id}
                    icon={ReceiptLongIcon}
                    title={sale.invoiceNumber}
                    subtitle={`${sale.customerName} · ${formatInstant(sale.saleDate)}`}
                  >
                    {sale.status !== "COMPLETED" && (
                      <Chip size="small" label={sale.status.replace(/_/g, " ").toLowerCase()} />
                    )}
                    <Amount>{money(sale.grandTotal)}</Amount>
                  </ActivityRow>
                ))
              ))}
            {activity === "expenses" &&
              ((data?.recent.expenses.length ?? 0) === 0 ? (
                <Empty />
              ) : (
                (data?.recent.expenses ?? []).map((expense) => (
                  <ActivityRow
                    key={expense.id}
                    icon={MoneyOffIcon}
                    title={expense.description}
                    subtitle={`${expense.categoryName} · ${formatBusinessDay(expense.expenseDay)}`}
                  >
                    <Amount>{money(expense.amount)}</Amount>
                  </ActivityRow>
                ))
              ))}
            {activity === "services" &&
              ((data?.recent.services.length ?? 0) === 0 ? (
                <Empty />
              ) : (
                (data?.recent.services ?? []).map((job) => (
                  <ActivityRow
                    key={job.id}
                    icon={BuildIcon}
                    title={`${job.deviceBrand} ${job.deviceModel}`}
                    subtitle={`${job.serviceNumber} · ${job.customerName}`}
                  >
                    <Chip
                      size="small"
                      variant="outlined"
                      label={SERVICE_STATUS_LABELS[job.status as ServiceStatus] ?? job.status}
                    />
                  </ActivityRow>
                ))
              ))}
          </Paper>
        </Reveal>

        <Reveal delay={400}>
          <Paper sx={{ p: 2 }}>
            <SectionTitle title="Low stock" subtitle="In stock / minimum" />
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
                      ? Math.max(0, Math.min(100, (row.stockQuantity / row.minimumStock) * 100))
                      : 0;
                  return (
                    <Box key={row.id}>
                      <Stack direction="row" spacing={1.5} sx={{ alignItems: "baseline" }}>
                        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                          <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
                            {row.name}
                          </Typography>
                          <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>
                            {row.sku} · {row.categoryName ?? "—"}
                          </Typography>
                        </Box>
                        <Typography
                          variant="body2"
                          sx={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", color: "text.secondary" }}
                        >
                          <Box
                            component="span"
                            sx={{ fontWeight: 800, color: out ? "error.main" : "warning.main" }}
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
                        sx={{ mt: 0.5, height: 6, borderRadius: 3, bgcolor: "action.hover" }}
                      />
                    </Box>
                  );
                })}
              </Stack>
            )}
          </Paper>
        </Reveal>
      </Box>
    </Stack>
  );
}

const ACTIVITY_LINKS = {
  sales: { to: "/sales", permission: "sales.view" },
  expenses: { to: "/expenses", permission: "expenses.view" },
  services: { to: "/services", permission: "services.view" },
} as const;

// -----------------------------------------------------------------------------

function Empty() {
  return (
    <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
      Nothing yet.
    </Typography>
  );
}

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <Typography
      variant="caption"
      color="text.secondary"
      sx={{ fontWeight: 700, fontSize: "0.68rem", textTransform: "uppercase", letterSpacing: "0.06em" }}
    >
      {children}
    </Typography>
  );
}

function Amount({ children }: { children: ReactNode }) {
  return (
    <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 700, whiteSpace: "nowrap" }}>
      {children}
    </Typography>
  );
}

/**
 * Headline figure. Proportional digits — tabular ones make a large number look
 * loose. It counts up; the aria-label always carries the final value.
 */
function BigFigure({
  value,
  format,
  label,
  size,
  color = "text.primary",
}: {
  value: number;
  format: (n: number) => string;
  label: string;
  size: string;
  color?: string;
}) {
  const shown = useCountUp(value);
  return (
    <Typography
      aria-label={`${label}: ${format(value)}`}
      sx={{ fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1.15, fontSize: size, color, mt: 0.5 }}
    >
      {format(shown)}
    </Typography>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", fontSize: "0.66rem" }}>
        {label}
      </Typography>
      <Typography variant="body2" noWrap sx={{ fontWeight: 700 }}>
        {value}
      </Typography>
    </Box>
  );
}

function Breakdown({ label, hint, value, muted }: { label: string; hint?: string; value: string; muted?: boolean }) {
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: "baseline", color: muted ? "text.secondary" : undefined }}>
      <Typography variant="body2" sx={{ fontWeight: 600 }}>
        {label}
      </Typography>
      {hint && (
        <Typography variant="caption" color="text.secondary" noWrap sx={{ flexGrow: 1, fontSize: "0.65rem" }}>
          {hint}
        </Typography>
      )}
      <Typography
        variant="body2"
        sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 600, ml: "auto", whiteSpace: "nowrap" }}
      >
        {value}
      </Typography>
    </Stack>
  );
}

/** A tone always ships with a number and a word, so colour never carries the meaning alone. */
function AttentionRow({
  icon,
  label,
  hint,
  value,
  active,
  onClick,
}: {
  icon: ElementType;
  label: string;
  hint: string;
  value: string;
  active: boolean;
  onClick?: () => void;
}) {
  return (
    <Stack
      direction="row"
      spacing={1.25}
      component={onClick ? "button" : "div"}
      onClick={onClick}
      sx={(t) => ({
        alignItems: "center",
        p: 1,
        width: "100%",
        textAlign: "left",
        font: "inherit",
        color: "inherit",
        cursor: onClick ? "pointer" : "default",
        borderRadius: 2,
        border: "1px solid",
        borderColor: active ? alpha(t.palette.warning.main, 0.35) : "divider",
        bgcolor: active ? alpha(t.palette.warning.main, 0.06) : "transparent",
        transition: "background-color .2s",
        "&:hover": onClick ? { bgcolor: alpha(t.palette.warning.main, 0.12) } : undefined,
      })}
    >
      <IconBubble icon={icon} accent={active ? "#e08600" : "#64748b"} />
      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {label}
        </Typography>
        <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>
          {hint}
        </Typography>
      </Box>
      <Typography
        variant="body2"
        sx={{ fontWeight: 800, fontVariantNumeric: "tabular-nums", color: active ? "warning.dark" : "text.secondary" }}
      >
        {value}
      </Typography>
      {onClick && <ChevronRightIcon fontSize="small" sx={{ color: "text.secondary" }} />}
    </Stack>
  );
}

function IconBubble({ icon: Icon, accent, size = 36 }: { icon: ElementType; accent: string; size?: number }) {
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

function SectionTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <Box sx={{ mb: 1.5 }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
        {title}
      </Typography>
      {subtitle && (
        <Typography variant="caption" color="text.secondary">
          {subtitle}
        </Typography>
      )}
    </Box>
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
        <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>
          {subtitle}
        </Typography>
      </Box>
      {children}
    </Stack>
  );
}

/**
 * Magnitude comparison across named things, with every value printed.
 *
 * One hue for every bar: the length already encodes the size. Bars scale to the
 * largest row, or to `barOf` (a total) when the list is a share of a whole.
 */
function RankList({
  rows,
  money,
  ranked,
  barOf,
}: {
  rows: Array<{ key: string; name: string; value: number; meta?: string }>;
  money: (minor: number) => string;
  ranked?: boolean;
  barOf?: number;
}) {
  if (rows.length === 0) return <Empty />;
  const scale = barOf ?? Math.max(...rows.map((r) => r.value));
  return (
    <Stack spacing={1.25} component="ol" sx={{ listStyle: "none", m: 0, p: 0 }}>
      {rows.map((row, i) => (
        <Box component="li" key={row.key}>
          <Stack direction="row" spacing={1} sx={{ alignItems: "baseline" }}>
            {ranked && (
              <Typography
                variant="caption"
                sx={{ width: 16, flexShrink: 0, fontWeight: 700, color: "text.secondary", fontVariantNumeric: "tabular-nums" }}
              >
                {i + 1}
              </Typography>
            )}
            <Box sx={{ flexGrow: 1, minWidth: 0 }}>
              <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
                {row.name}
              </Typography>
              {row.meta && (
                <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block", fontSize: "0.65rem" }}>
                  {row.meta}
                </Typography>
              )}
            </Box>
            <Amount>{money(row.value)}</Amount>
          </Stack>
          <Box
            aria-hidden
            sx={{ mt: 0.5, ml: ranked ? 3 : 0, height: 5, borderRadius: 3, bgcolor: "action.hover", overflow: "hidden" }}
          >
            <Box
              sx={{
                height: "100%",
                width: `${scale > 0 ? Math.max(0, (row.value / scale) * 100) : 0}%`,
                borderRadius: 3,
                background: `linear-gradient(90deg, ${alpha(CHART_COLORS.series1, 0.65)}, ${CHART_COLORS.series1})`,
                transition: "width .8s cubic-bezier(.2,.7,.2,1)",
                ...noMotion,
              }}
            />
          </Box>
        </Box>
      ))}
    </Stack>
  );
}

/** Shared grid and axes for the by-day charts. */
function DayAxes() {
  return (
    <>
      <CartesianGrid stroke={CHART_COLORS.grid} strokeWidth={MARK.gridWidth} vertical={false} />
      <XAxis
        dataKey="day"
        tickFormatter={(day: string) => day.slice(5)}
        tick={AXIS_TICK}
        stroke={CHART_COLORS.axis}
        tickLine={false}
      />
      <YAxis tickFormatter={compactMinor} tick={AXIS_TICK} stroke={CHART_COLORS.axis} tickLine={false} width={52} />
    </>
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
function SolidGradient({ id, color }: { id: string; color: string }) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor={color} stopOpacity={1} />
      <stop offset="100%" stopColor={color} stopOpacity={0.7} />
    </linearGradient>
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
              <TableCell sx={{ whiteSpace: "nowrap" }}>{formatBusinessDay(row.day)}</TableCell>
              <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>
                {money(row.a)}
              </TableCell>
              <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>
                {money(row.b)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
}
