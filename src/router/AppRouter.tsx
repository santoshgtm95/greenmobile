import { Navigate, Route, Routes } from 'react-router-dom';
import AppLayout from '../layouts/AppLayout';
import SettingsPage from '../pages/SettingsPage';
import ProductsPage from '../pages/ProductsPage';
import PosPage from '../pages/PosPage';
import SalesPage from '../pages/SalesPage';
import CustomersPage from '../pages/CustomersPage';
import ExpensesPage from '../pages/ExpensesPage';
import BankingPage from '../pages/BankingPage';
import AdvancesPage from '../pages/AdvancesPage';
import ServicesPage from '../pages/ServicesPage';
import DashboardPage from '../pages/DashboardPage';
import ReportsPage from '../pages/ReportsPage';
import InventoryPage from '../pages/InventoryPage';
import UsersPage from '../pages/UsersPage';
import { useAuth } from '../hooks/useAuth';
import type { Permission } from '@shared/domain';
import { Alert, Stack, Typography } from '@mui/material';

/**
 * Routes for a signed-in user.
 *
 * Every route is permission-gated here, and again in the main process on each
 * IPC call — the guard below only decides what to draw.
 */
export default function AppRouter() {
  return (
    <AppLayout>
      <Routes>
        <Route
          path="/"
          element={
            <Guard permission="sales.view">
              <DashboardPage />
            </Guard>
          }
        />
        <Route
          path="/pos"
          element={
            <Guard permission="pos.sell">
              <PosPage />
            </Guard>
          }
        />
        <Route
          path="/sales"
          element={
            <Guard permission="sales.view">
              <SalesPage />
            </Guard>
          }
        />
        <Route
          path="/products"
          element={
            <Guard permission="products.view">
              <ProductsPage />
            </Guard>
          }
        />
        {/* The tab lives in the address, so /inventory/movements is linkable. */}
        <Route
          path="/inventory"
          element={
            <Guard permission="inventory.view">
              <InventoryPage />
            </Guard>
          }
        />
        <Route
          path="/inventory/:tab"
          element={
            <Guard permission="inventory.view">
              <InventoryPage />
            </Guard>
          }
        />
        <Route
          path="/customers"
          element={
            <Guard permission="customers.view">
              <CustomersPage />
            </Guard>
          }
        />
        <Route
          path="/services"
          element={
            <Guard permission="services.view">
              <ServicesPage />
            </Guard>
          }
        />
        <Route
          path="/expenses"
          element={
            <Guard permission="expenses.view">
              <ExpensesPage />
            </Guard>
          }
        />
        <Route
          path="/banking"
          element={
            <Guard permission="banking.view">
              <BankingPage />
            </Guard>
          }
        />
        <Route
          path="/banking/advances"
          element={
            <Guard permission="banking.view">
              <AdvancesPage />
            </Guard>
          }
        />
        <Route
          path="/reports"
          element={
            <Guard permission="reports.view">
              <ReportsPage />
            </Guard>
          }
        />
        <Route
          path="/users"
          element={
            <Guard permission="users.view">
              <UsersPage />
            </Guard>
          }
        />
        {/* The tab lives in the address, so /settings/backup is linkable. */}
        <Route
          path="/settings"
          element={
            <Guard permission="settings.view">
              <SettingsPage />
            </Guard>
          }
        />
        <Route
          path="/settings/:tab"
          element={
            <Guard permission="settings.view">
              <SettingsPage />
            </Guard>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppLayout>
  );
}

/** Renders children only if the signed-in role holds `permission`. */
function Guard({ permission, children }: { permission: Permission; children: React.ReactNode }) {
  const { can } = useAuth();
  if (can(permission)) return <>{children}</>;
  return (
    <Stack spacing={2}>
      <Typography variant="h5">Not available</Typography>
      <Alert severity="warning">
        Your role does not have access to this screen. Ask an administrator if you need it.
      </Alert>
    </Stack>
  );
}
