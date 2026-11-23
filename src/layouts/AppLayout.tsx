import { useState, type ReactNode } from "react";
import {
  AppBar,
  Avatar,
  Box,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Stack,
  Toolbar,
  Tooltip,
  Typography,
  useMediaQuery,
} from "@mui/material";
import { alpha, keyframes, useTheme } from "@mui/material/styles";
import DashboardIcon from "@mui/icons-material/DashboardOutlined";
import PointOfSaleIcon from "@mui/icons-material/PointOfSaleOutlined";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLongOutlined";
import Inventory2Icon from "@mui/icons-material/Inventory2Outlined";
import LocalShippingIcon from "@mui/icons-material/LocalShippingOutlined";
import PeopleIcon from "@mui/icons-material/PeopleOutlined";
import BuildIcon from "@mui/icons-material/BuildOutlined";
import PaymentsIcon from "@mui/icons-material/PaymentsOutlined";
import AccountBalanceIcon from "@mui/icons-material/AccountBalanceOutlined";
import AssessmentIcon from "@mui/icons-material/AssessmentOutlined";
import ManageAccountsIcon from "@mui/icons-material/ManageAccountsOutlined";
import SettingsIcon from "@mui/icons-material/SettingsOutlined";
import LogoutIcon from "@mui/icons-material/Logout";
import MenuIcon from "@mui/icons-material/Menu";
import UnfoldMoreIcon from "@mui/icons-material/UnfoldMore";
import { NavLink, useLocation } from "react-router-dom";
import Logo from "../components/Logo";
import { useAuth } from "../hooks/useAuth";
import { useSettings } from "../hooks/useSettings";
import { USER_ROLE_LABELS, type Permission } from "@shared/domain";

const DRAWER_WIDTH = 240;

const rise = keyframes`
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: none; }
`;
const fade = keyframes`
  from { opacity: 0; }
  to { opacity: 1; }
`;
const pulse = keyframes`
  0% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.5); }
  70% { box-shadow: 0 0 0 6px rgba(34, 197, 94, 0); }
  100% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0); }
`;

interface NavItem {
  label: string;
  to: string;
  icon: ReactNode;
  /** Hidden when the signed-in role lacks this. */
  permission: Permission;
  /** Starts a new visual group in the sidebar. */
  section?: string;
}

/** Main navigation (spec §71). */
const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", to: "/", icon: <DashboardIcon />, permission: "sales.view" },
  { label: "POS", to: "/pos", icon: <PointOfSaleIcon />, permission: "pos.sell" },
  { label: "Sales", to: "/sales", icon: <ReceiptLongIcon />, permission: "sales.view", section: "Operations" },
  { label: "Stocks", to: "/stocks", icon: <Inventory2Icon />, permission: "products.view" },
  { label: "Purchase Invoice", to: "/purchases", icon: <LocalShippingIcon />, permission: "products.view" },
  { label: "Customers", to: "/customers", icon: <PeopleIcon />, permission: "customers.view" },
  { label: "Services", to: "/services", icon: <BuildIcon />, permission: "services.view" },
  { label: "Expenses", to: "/expenses", icon: <PaymentsIcon />, permission: "expenses.view", section: "Finance" },
  { label: "Banking", to: "/banking", icon: <AccountBalanceIcon />, permission: "banking.view" },
  { label: "Reports", to: "/reports", icon: <AssessmentIcon />, permission: "reports.view" },
  { label: "Users", to: "/users", icon: <ManageAccountsIcon />, permission: "users.view", section: "Admin" },
  { label: "Settings", to: "/settings", icon: <SettingsIcon />, permission: "settings.view" },
];

export default function AppLayout({ children }: { children: ReactNode }) {
  const { user, can, logout } = useAuth();
  const { data: settings } = useSettings();
  const location = useLocation();
  const theme = useTheme();
  const compact = useMediaQuery(theme.breakpoints.down("md"));
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [navOpen, setNavOpen] = useState(false);

  const visibleItems = NAV_ITEMS.filter((item) => can(item.permission));
  const currentItem = visibleItems.find((item) =>
    item.to === "/" ? location.pathname === "/" : location.pathname.startsWith(item.to),
  );
  const currentLabel = currentItem?.label ?? "Green Mobile";
  const shopName = settings?.shopName || "Green Mobile";

  const sidebar = (
    <Stack sx={{ height: "100%" }}>
      <Stack direction="row" spacing={1.25} sx={{ px: 2, height: 60, alignItems: "center", flexShrink: 0 }}>
        <Logo size={28} />
        <Box sx={{ minWidth: 0 }}>
          <Typography noWrap sx={{ fontWeight: 650, fontSize: 14.5, letterSpacing: "-0.01em", lineHeight: 1.25 }}>
            {shopName}
          </Typography>
          <Typography noWrap sx={{ fontSize: 12, color: "text.secondary", lineHeight: 1.3 }}>
            Point of Sale
          </Typography>
        </Box>
      </Stack>

      <List component="nav" sx={{ px: 1.25, py: 1, overflowY: "auto", flexGrow: 1 }}>
        {visibleItems.map((item) => (
          <Box key={item.to}>
            {item.section && (
              <Typography
                sx={{ px: 1.25, pt: 2, pb: 0.75, fontSize: 11.5, fontWeight: 600, color: "text.disabled", letterSpacing: "0.04em", textTransform: "uppercase" }}
              >
                {item.section}
              </Typography>
            )}
            <ListItemButton
              component={NavLink}
              to={item.to}
              end={item.to === "/"}
              onClick={() => setNavOpen(false)}
              sx={{
                mb: 0.25,
                py: 0.6,
                px: 1.25,
                color: "text.secondary",
                transition: "background-color 150ms, color 150ms",
                "& .MuiListItemIcon-root": { color: "text.disabled", minWidth: 32, transition: "color 150ms" },
                "& .MuiSvgIcon-root": { fontSize: 19 },
                "&:hover": { bgcolor: alpha(theme.palette.text.primary, 0.05), color: "text.primary" },
                "&:hover .MuiListItemIcon-root": { color: "text.secondary" },
                "&.active": {
                  bgcolor: "background.paper",
                  color: "text.primary",
                  boxShadow: `0 1px 2px ${alpha(theme.palette.text.primary, 0.08)}, 0 0 0 1px ${theme.palette.divider}`,
                  "& .MuiListItemIcon-root": { color: "primary.main" },
                  "& .MuiListItemText-primary": { fontWeight: 600 },
                },
                "&.Mui-focusVisible": { outline: `2px solid ${alpha(theme.palette.primary.main, 0.5)}`, outlineOffset: 1 },
              }}
            >
              <ListItemIcon>{item.icon}</ListItemIcon>
              <ListItemText primary={item.label} slotProps={{ primary: { sx: { fontSize: 14, fontWeight: 500 } } }} />
            </ListItemButton>
          </Box>
        ))}
      </List>

      <Tooltip title="This POS stores all data on this computer and needs no internet connection." placement="top">
        <Stack direction="row" spacing={1} sx={{ m: 1.5, px: 1.25, py: 1, alignItems: "center", borderRadius: 2, color: "text.secondary", fontSize: 12.5 }}>
          <Box sx={{ width: 7, height: 7, borderRadius: "50%", bgcolor: "#22c55e", animation: `${pulse} 2.4s infinite` }} />
          <span>Offline · data on this PC</span>
        </Stack>
      </Tooltip>
    </Stack>
  );

  return (
    <Box
      sx={{
        display: "flex",
        minHeight: "100vh",
        bgcolor: "background.default",
        "@media (prefers-reduced-motion: reduce)": { "& *": { animation: "none !important" } },
      }}
    >
      <Drawer
        variant={compact ? "temporary" : "permanent"}
        open={compact ? navOpen : true}
        onClose={() => setNavOpen(false)}
        ModalProps={{ keepMounted: true }}
        sx={{
          width: compact ? 0 : DRAWER_WIDTH,
          flexShrink: 0,
          "& .MuiDrawer-paper": {
            width: DRAWER_WIDTH,
            boxSizing: "border-box",
            bgcolor: "#f3f4f7",
            borderRight: `1px solid ${theme.palette.divider}`,
          },
        }}
      >
        {sidebar}
      </Drawer>

      <Box sx={{ flexGrow: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <AppBar
          position="sticky"
          color="inherit"
          elevation={0}
          sx={{
            bgcolor: alpha(theme.palette.background.default, 0.8),
            backdropFilter: "blur(12px) saturate(180%)",
            borderBottom: `1px solid ${theme.palette.divider}`,
          }}
        >
          <Toolbar sx={{ gap: 1.5, minHeight: "60px !important", px: { xs: 2, md: 3 } }}>
            {compact && (
              <IconButton edge="start" aria-label="Open menu" onClick={() => setNavOpen(true)}>
                <MenuIcon />
              </IconButton>
            )}
            {/* Breadcrumb; keyed so it fades on every page change. */}
            <Stack
              key={currentLabel}
              direction="row"
              spacing={1}
              sx={{ flexGrow: 1, minWidth: 0, alignItems: "center", animation: `${fade} 250ms ease-out both` }}
            >
              <Typography noWrap sx={{ color: "text.secondary", fontSize: 14, display: { xs: "none", sm: "block" } }}>
                {shopName}
              </Typography>
              <Typography sx={{ color: "text.disabled", display: { xs: "none", sm: "block" } }}>/</Typography>
              <Typography noWrap sx={{ fontWeight: 600, fontSize: 15, letterSpacing: "-0.01em" }}>
                {currentLabel}
              </Typography>
            </Stack>

            {user && (
              <>
                <Box
                  component="button"
                  type="button"
                  aria-label="Account menu"
                  onClick={(e) => setMenuAnchor(e.currentTarget)}
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                    p: 0.5,
                    pr: { xs: 0.5, sm: 1 },
                    border: 0,
                    borderRadius: 2,
                    bgcolor: "transparent",
                    color: "inherit",
                    font: "inherit",
                    cursor: "pointer",
                    transition: "background-color 150ms",
                    "&:hover": { bgcolor: alpha(theme.palette.text.primary, 0.05) },
                    "&:focus-visible": { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: 2 },
                  }}
                >
                  <Avatar
                    sx={{
                      width: 30,
                      height: 30,
                      fontSize: 13,
                      fontWeight: 600,
                      color: "primary.dark",
                      bgcolor: alpha(theme.palette.primary.main, 0.12),
                    }}
                  >
                    {user.fullName.trim().charAt(0).toUpperCase()}
                  </Avatar>
                  <Box sx={{ textAlign: "left", display: { xs: "none", sm: "block" } }}>
                    <Typography sx={{ fontWeight: 600, fontSize: 13.5, lineHeight: 1.2 }}>{user.fullName}</Typography>
                    <Typography sx={{ fontSize: 12, color: "text.secondary", lineHeight: 1.2 }}>
                      {USER_ROLE_LABELS[user.role]}
                    </Typography>
                  </Box>
                  <UnfoldMoreIcon sx={{ fontSize: 16, color: "text.disabled", display: { xs: "none", sm: "block" } }} />
                </Box>
                <Menu
                  anchorEl={menuAnchor}
                  open={Boolean(menuAnchor)}
                  onClose={() => setMenuAnchor(null)}
                  anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
                  transformOrigin={{ vertical: "top", horizontal: "right" }}
                  slotProps={{ paper: { sx: { minWidth: 200 } } }}
                >
                  <MenuItem
                    onClick={() => {
                      setMenuAnchor(null);
                      void logout();
                    }}
                  >
                    <ListItemIcon>
                      <LogoutIcon fontSize="small" />
                    </ListItemIcon>
                    Sign out
                  </MenuItem>
                </Menu>
              </>
            )}
          </Toolbar>
        </AppBar>

        <Box
          component="main"
          sx={{
            flexGrow: 1,
            p: { xs: 2, md: 3 },
            minWidth: 0,
            // Pages are a Stack of blocks; each block eases in, one after another.
            // A new page mounts new nodes, so this replays on every navigation.
            "& > .MuiStack-root > *, & > .MuiPaper-root": {
              animation: `${rise} 320ms cubic-bezier(.2,.8,.2,1) both`,
            },
            ...Object.fromEntries(
              Array.from({ length: 8 }, (_, i) => [
                `& > .MuiStack-root > :nth-of-type(${i + 1})`,
                { animationDelay: `${i * 40}ms` },
              ]),
            ),
            // Page cards: rounder, hairline border, faint depth.
            "& .MuiPaper-root:not(.MuiAccordion-root)": {
              borderRadius: 3,
              transition: "box-shadow 200ms, border-color 200ms",
            },
            "& > .MuiStack-root > .MuiPaper-root, & > .MuiPaper-root": {
              boxShadow: `0 1px 2px ${alpha(theme.palette.text.primary, 0.04)}`,
            },
          }}
        >
          {children}
        </Box>
      </Box>
    </Box>
  );
}
