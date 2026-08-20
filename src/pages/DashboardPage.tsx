import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Chip,
  FormControlLabel,
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
} from '@mui/material';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  LabelList,
} from 'recharts';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useMoneyFormatter } from '../hooks/useSettings';
import ChartCard from '../components/charts/ChartCard';
import MoneyTooltip from '../components/charts/MoneyTooltip';
import { CHART_COLORS, MARK, AXIS_TICK, compactMinor, truncateLabel } from '../components/charts/chartTheme';
import { PosApiError } from '@shared/errors';
import { PAYMENT_METHOD_LABELS, SERVICE_STATUS_LABELS, type PaymentMethod, type ServiceStatus } from '@shared/domain';
import {
  DATE_PRESETS,
  DATE_PRESET_LABELS,
  resolvePreset,
  formatBusinessDay,
  formatInstant,
  type DatePreset,
} from '@shared/datetime';

/** Dashboard (spec §31, §72). */
export default function DashboardPage() {
  const money = useMoneyFormatter();

  const [preset, setPreset] = useState<DatePreset>('TODAY');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  // Every chart has a table twin, so no value is reachable by hover alone.
  const [asTables, setAsTables] = useState(false);

  const range = useMemo(
    () => resolvePreset(preset, { from: customFrom || undefined, to: customTo || undefined }),
    [preset, customFrom, customTo],
  );

  const board = useQuery({
    queryKey: ['dashboard', range],
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
        trendWidened ? ' (widened to show a trend)' : ''
      }`
    : undefined;

  const singleDay = range.from === range.to;

  return (
    <Stack spacing={2} sx={{ opacity: board.isFetching && data ? 0.7 : 1, transition: 'opacity .15s' }}>
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
        <Typography variant="h5" sx={{ flexGrow: 1 }}>
          Dashboard
        </Typography>
      </Stack>

      {board.isError && (
        <Alert severity="error">
          {board.error instanceof PosApiError ? board.error.message : 'Unable to load the dashboard.'}
        </Alert>
      )}

      {/* One filter row above everything it scopes — never per chart. */}
      <Paper sx={{ p: 2, border: '1px solid', borderColor: 'divider' }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ alignItems: 'center' }}>
          <TextField
            select
            label="Period"
            value={preset}
            onChange={(e) => setPreset(e.target.value as DatePreset)}
            sx={{ maxWidth: 190 }}
          >
            {DATE_PRESETS.map((option) => (
              <MenuItem key={option} value={option}>
                {DATE_PRESET_LABELS[option]}
              </MenuItem>
            ))}
          </TextField>

          {preset === 'CUSTOM' && (
            <>
              <TextField
                label="From"
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
                sx={{ maxWidth: 170 }}
              />
              <TextField
                label="To"
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
                sx={{ maxWidth: 170 }}
              />
            </>
          )}

          <Typography variant="body2" color="text.secondary" sx={{ flexGrow: 1 }}>
            {singleDay
              ? formatBusinessDay(range.from)
              : `${formatBusinessDay(range.from)} — ${formatBusinessDay(range.to)}`}
          </Typography>

          <FormControlLabel
            control={<Switch checked={asTables} onChange={(e) => setAsTables(e.target.checked)} />}
            label="Show as tables"
          />
        </Stack>
      </Paper>

      {/* KPI row. Headline numbers are figures, not one-bar charts. */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(178px, 1fr))',
          gap: 2,
        }}
      >
        <StatTile label="Sales" value={String(cards?.transactions ?? 0)} hint={`${cards?.itemsSold ?? 0} item(s) sold`} />
        <StatTile label="Revenue" value={money(cards?.revenue ?? 0)} hint="Net of discounts, excluding tax" />
        <StatTile label="Expenses" value={money(cards?.expenses ?? 0)} hint="Shop running costs" />
        <StatTile label="Gross profit" value={money(cards?.grossProfit ?? 0)} hint="Goods and repairs" />
        <StatTile
          label="Net profit"
          value={money(cards?.netProfit ?? 0)}
          tone={(cards?.netProfit ?? 0) >= 0 ? 'positive' : 'negative'}
          hint={(cards?.netProfit ?? 0) >= 0 ? 'Profit' : 'Loss'}
        />
        <StatTile
          label="Low stock"
          value={String(cards?.lowStockCount ?? 0)}
          tone={(cards?.lowStockCount ?? 0) > 0 ? 'warning' : undefined}
          hint={(cards?.lowStockCount ?? 0) > 0 ? 'Needs reordering' : 'All above minimum'}
        />
      </Box>

      {(cards?.serviceRevenue ?? 0) > 0 || (cards?.outstandingServiceBalance ?? 0) > 0 ? (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(178px, 1fr))',
            gap: 2,
          }}
        >
          <StatTile label="Repair income" value={money(cards?.serviceRevenue ?? 0)} hint="Jobs delivered in this period" />
          <StatTile
            label="Owed on repairs"
            value={money(cards?.outstandingServiceBalance ?? 0)}
            tone={(cards?.outstandingServiceBalance ?? 0) > 0 ? 'warning' : undefined}
            hint="Across all open jobs"
          />
        </Box>
      ) : null}

      {/* Time charts. Both series share one unit, so one axis — never a second scale. */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' }, gap: 2 }}>
        <ChartCard
          title="Sales by day"
          subtitle={trendSubtitle ?? 'Revenue and the profit on goods inside it'}
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
              <LineChart data={charts?.salesByDay ?? []} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
                <CartesianGrid stroke={CHART_COLORS.grid} strokeWidth={MARK.gridWidth} vertical={false} />
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
                <Tooltip content={(props) => <MoneyTooltip {...props} format={money} isDay />} />
                <Legend iconType="plainline" wrapperStyle={{ fontSize: 12 }} />
                <Line
                  name="Revenue"
                  type="monotone"
                  dataKey="netSales"
                  stroke={CHART_COLORS.series1}
                  strokeWidth={MARK.lineWidth}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  dot={{
                    r: MARK.dotRadius,
                    fill: CHART_COLORS.series1,
                    stroke: CHART_COLORS.surface,
                    strokeWidth: MARK.dotRingWidth,
                  }}
                  activeDot={{ r: MARK.dotRadius + 2 }}
                />
                <Line
                  name="Profit on goods"
                  type="monotone"
                  dataKey="grossProfit"
                  stroke={CHART_COLORS.series2}
                  strokeWidth={MARK.lineWidth}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  dot={{
                    r: MARK.dotRadius,
                    fill: CHART_COLORS.series2,
                    stroke: CHART_COLORS.surface,
                    strokeWidth: MARK.dotRingWidth,
                  }}
                  activeDot={{ r: MARK.dotRadius + 2 }}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard
          title="Revenue vs expenses"
          subtitle={trendSubtitle ?? 'What came in against what went out'}
          empty={
            !charts ||
            charts.revenueVsExpenses.every((d) => d.revenue === 0 && d.expenses === 0)
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
                barGap={2}
              >
                <CartesianGrid stroke={CHART_COLORS.grid} strokeWidth={MARK.gridWidth} vertical={false} />
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
                  content={(props) => <MoneyTooltip {...props} format={money} isDay />}
                  cursor={{ fill: 'rgba(0,0,0,0.03)' }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar
                  name="Revenue"
                  dataKey="revenue"
                  fill={CHART_COLORS.series1}
                  maxBarSize={MARK.barMaxThickness}
                  radius={MARK.barRadiusColumn}
                />
                <Bar
                  name="Expenses"
                  dataKey="expenses"
                  fill={CHART_COLORS.series2}
                  maxBarSize={MARK.barMaxThickness}
                  radius={MARK.barRadiusColumn}
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </Box>

      {/* Magnitude comparisons. One hue each — bar length already encodes size. */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' }, gap: 2 }}>
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
              data={(charts?.topProducts ?? []).map((p) => ({
                name: p.productName,
                value: p.netSales,
              }))}
              money={money}
            />
          )}
        </ChartCard>

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
              data={(charts?.salesByCategory ?? []).slice(0, 8).map((c) => ({
                name: c.categoryName,
                value: c.netSales,
              }))}
              money={money}
            />
          )}
        </ChartCard>
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 2fr' }, gap: 2 }}>
        <ChartCard
          title="Payment methods"
          subtitle="How customers paid"
          height={240}
          empty={!charts || charts.paymentMethods.length === 0}
        >
          {asTables ? (
            <NameValueTable
              rows={(charts?.paymentMethods ?? []).map((m) => ({
                name: PAYMENT_METHOD_LABELS[m.paymentMethod as PaymentMethod] ?? m.paymentMethod,
                value: m.total,
                extra: `${m.count} payment(s)`,
              }))}
              valueHead="Taken"
              money={money}
            />
          ) : (
            <HorizontalBars
              data={(charts?.paymentMethods ?? []).map((m) => ({
                name: PAYMENT_METHOD_LABELS[m.paymentMethod as PaymentMethod] ?? m.paymentMethod,
                value: m.total,
              }))}
              money={money}
              labelWidth={100}
            />
          )}
        </ChartCard>

        <Paper sx={{ p: 2, border: '1px solid', borderColor: 'divider' }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>
            Low stock
          </Typography>
          {(data?.lowStock.length ?? 0) === 0 ? (
            <Typography variant="body2" color="text.secondary">
              Every product is above its minimum.
            </Typography>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Product</TableCell>
                  <TableCell>Category</TableCell>
                  <TableCell align="right">In stock</TableCell>
                  <TableCell align="right">Minimum</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(data?.lowStock ?? []).map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      {row.name}
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                        {row.sku}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ color: 'text.secondary' }}>{row.categoryName ?? '—'}</TableCell>
                    <TableCell
                      align="right"
                      sx={{
                        fontVariantNumeric: 'tabular-nums',
                        fontWeight: 700,
                        color: row.stockQuantity <= 0 ? 'error.main' : 'warning.main',
                      }}
                    >
                      {row.stockQuantity}
                    </TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: 'text.secondary' }}>
                      {row.minimumStock || '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Paper>
      </Box>

      {/* Recent activity (spec §31) */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'repeat(3, 1fr)' }, gap: 2 }}>
        <Paper sx={{ p: 2, border: '1px solid', borderColor: 'divider' }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
            Recent sales
          </Typography>
          {(data?.recent.sales.length ?? 0) === 0 && <Empty />}
          <Stack spacing={1}>
            {(data?.recent.sales ?? []).map((sale) => (
              <Stack key={sale.id} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                  <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
                    {sale.invoiceNumber}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
                    {sale.customerName} · {formatInstant(sale.saleDate)}
                  </Typography>
                </Box>
                {sale.status !== 'COMPLETED' && (
                  <Chip size="small" label={sale.status.replace(/_/g, ' ').toLowerCase()} />
                )}
                <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                  {money(sale.grandTotal)}
                </Typography>
              </Stack>
            ))}
          </Stack>
        </Paper>

        <Paper sx={{ p: 2, border: '1px solid', borderColor: 'divider' }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
            Recent expenses
          </Typography>
          {(data?.recent.expenses.length ?? 0) === 0 && <Empty />}
          <Stack spacing={1}>
            {(data?.recent.expenses ?? []).map((expense) => (
              <Stack key={expense.id} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                  <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
                    {expense.description}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
                    {expense.categoryName} · {formatBusinessDay(expense.expenseDay)}
                  </Typography>
                </Box>
                <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                  {money(expense.amount)}
                </Typography>
              </Stack>
            ))}
          </Stack>
        </Paper>

        <Paper sx={{ p: 2, border: '1px solid', borderColor: 'divider' }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
            Recent service orders
          </Typography>
          {(data?.recent.services.length ?? 0) === 0 && <Empty />}
          <Stack spacing={1}>
            {(data?.recent.services ?? []).map((job) => (
              <Stack key={job.id} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                  <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
                    {job.deviceBrand} {job.deviceModel}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
                    {job.serviceNumber} · {job.customerName}
                  </Typography>
                </Box>
                <Chip
                  size="small"
                  variant="outlined"
                  label={SERVICE_STATUS_LABELS[job.status as ServiceStatus] ?? job.status}
                />
              </Stack>
            ))}
          </Stack>
        </Paper>
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
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'positive' | 'negative' | 'warning';
}) {
  const color =
    tone === 'positive' ? 'success.main' : tone === 'negative' ? 'error.main' : tone === 'warning' ? 'warning.main' : 'text.primary';

  const Icon =
    tone === 'positive' ? TrendingUpIcon : tone === 'negative' ? TrendingDownIcon : tone === 'warning' ? WarningAmberIcon : null;

  return (
    <Paper sx={{ p: 2, border: '1px solid', borderColor: 'divider' }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
        {label}
      </Typography>
      <Typography variant="h5" sx={{ fontWeight: 700, color, mt: 0.25 }}>
        {value}
      </Typography>
      {hint && (
        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', mt: 0.25 }}>
          {Icon && <Icon sx={{ fontSize: 14, color }} />}
          <Typography variant="caption" color="text.secondary">
            {hint}
          </Typography>
        </Stack>
      )}
    </Paper>
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
  data,
  money,
  labelWidth = 130,
}: {
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
        <CartesianGrid stroke={CHART_COLORS.grid} strokeWidth={MARK.gridWidth} horizontal={false} />
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
          cursor={{ fill: 'rgba(0,0,0,0.03)' }}
        />
        <Bar
          name="Revenue"
          dataKey="value"
          fill={CHART_COLORS.series1}
          maxBarSize={MARK.barMaxThickness}
          radius={MARK.barRadiusRow}
        >
          <LabelList
            dataKey="value"
            position="right"
            formatter={(value: unknown) => money(Number(value ?? 0))}
            style={{ fontSize: 11, fill: CHART_COLORS.muted, fontVariantNumeric: 'tabular-nums' }}
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
    <Box sx={{ height: '100%', overflow: 'auto' }}>
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
              <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatBusinessDay(row.day)}</TableCell>
              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                {money(row.a)}
              </TableCell>
              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
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
    <Box sx={{ height: '100%', overflow: 'auto' }}>
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
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                    {row.extra}
                  </Typography>
                )}
              </TableCell>
              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                {money(row.value)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
}
