import { Box, CircularProgress, CssBaseline, ThemeProvider } from '@mui/material';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HashRouter } from 'react-router-dom';
import { theme } from './theme';
import { AuthProvider, useAuth } from './hooks/useAuth';
import LoginPage from './pages/LoginPage';
import FirstRunWizard from './pages/FirstRunWizard';
import AppRouter from './router/AppRouter';

/**
 * There is no server and no network, so retrying a failed call is pointless —
 * a rejection means a business rule was broken or the database refused, and the
 * user should see that immediately rather than after three silent retries.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: false, staleTime: 15_000 },
    mutations: { retry: false },
  },
});

export default function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          {/* HashRouter, because the packaged app is served from file:// */}
          <HashRouter>
            <Gate />
          </HashRouter>
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

/** Decides between the first-run wizard, the login screen and the application. */
function Gate() {
  const { loading, user, requiresFirstRunSetup } = useAuth();

  if (loading) {
    return (
      <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (requiresFirstRunSetup) return <FirstRunWizard />;
  if (!user) return <LoginPage />;
  return <AppRouter />;
}
