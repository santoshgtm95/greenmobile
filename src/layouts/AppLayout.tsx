import { useState, type ReactNode } from "react";
import {
  AppBar,
  Avatar,
  Box,
  Chip,
  Divider,
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
} from "@mui/material";
import DashboardIcon from "@mui/icons-material/Dashboard";
import PointOfSaleIcon from "@mui/icons-material/PointOfSale";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import Inventory2Icon from "@mui/icons-material/Inventory2";
import WarehouseIcon from "@mui/icons-material/Warehouse";
import PeopleIcon from "@mui/icons-material/People";
import BuildIcon from "@mui/icons-material/Build";
import PaymentsIcon from "@mui/icons-material/Payments";
import AccountBalanceIcon from "@mui/icons-material/AccountBalance";
import AssessmentIcon from "@mui/icons-material/Assessment";
import ManageAccountsIcon from "@mui/icons-material/ManageAccounts";
import SettingsIcon from "@mui/icons-material/Settings";
import LogoutIcon from "@mui/icons-material/Logout";
import WifiOffIcon from "@mui/icons-material/WifiOff";
import { NavLink, useLocation } from "react-router-dom";
import Logo from "../components/Logo";
import { useAuth } from "../hooks/useAuth";
import { useSettings } from "../hooks/useSettings";
import { USER_ROLE_LABELS, type Permission } from "@shared/domain";

const DRAWER_WIDTH = 232;

interface NavItem {
  label: string;
  to: string;
  icon: ReactNode;
  /** Hidden when the signed-in role lacks this. */
  permission: Permission;
}

/** Main navigation (spec §71). */
const NAV_ITEMS: NavItem[] = [
  {
    label: "Dashboard",
    to: "/",
    icon: <DashboardIcon />,
    permission: "sales.view",
  },
  {
    label: "POS",
    to: "/pos",
    icon: <PointOfSaleIcon />,
    permission: "pos.sell",
  },
  {
    label: "Sales",
    to: "/sales",
    icon: <ReceiptLongIcon />,
    permission: "sales.view",
  },
  {
    label: "Products",
    to: "/products",
    icon: <Inventory2Icon />,
    permission: "products.view",
  },
  {
    label: "Inventory",
    to: "/inventory",
    icon: <WarehouseIcon />,
    permission: "inventory.view",
  },
  {
    label: "Customers",
    to: "/customers",
    icon: <PeopleIcon />,
    permission: "customers.view",
  },
  {
    label: "Services",
    to: "/services",
    icon: <BuildIcon />,
    permission: "services.view",
  },
  {
    label: "Expenses",
    to: "/expenses",
    icon: <PaymentsIcon />,
    permission: "expenses.view",
  },
  {
    label: "Banking",
    to: "/banking",
    icon: <AccountBalanceIcon />,
    permission: "banking.view",
  },
  {
    label: "Reports",
    to: "/reports",
    icon: <AssessmentIcon />,
    permission: "reports.view",
  },
  {
    label: "Users",
    to: "/users",
    icon: <ManageAccountsIcon />,
    permission: "users.view",
  },
  {
    label: "Settings",
    to: "/settings",
    icon: <SettingsIcon />,
    permission: "settings.view",
  },
];

export default function AppLayout({ children }: { children: ReactNode }) {
  const { user, can, logout } = useAuth();
  const { data: settings } = useSettings();
  const location = useLocation();
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);

  const visibleItems = NAV_ITEMS.filter((item) => can(item.permission));
  const currentLabel =
    visibleItems.find((item) =>
      item.to === "/"
        ? location.pathname === "/"
        : location.pathname.startsWith(item.to),
    )?.label ?? "Green Mobile";

  return (
    <Box sx={{ display: "flex", minHeight: "100vh" }}>
      <Drawer
        variant="permanent"
        sx={{
          width: DRAWER_WIDTH,
          flexShrink: 0,
          "& .MuiDrawer-paper": {
            width: DRAWER_WIDTH,
            boxSizing: "border-box",
            bgcolor: "#0f1b2d",
            color: "#e3e8ef",
            borderRight: "none",
          },
        }}
      >
        <Stack
          direction="row"
          spacing={1.5}
          sx={{ px: 2, py: 2, alignItems: "center" }}
        >
          {/* onDark: the logo's grey half is unreadable straight on this navy. */}
          <Logo size={32} onDark />
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="subtitle1" noWrap sx={{ fontWeight: 700 }}>
              {settings?.shopName || "Green Mobile"}
            </Typography>
            <Typography variant="caption" sx={{ color: "#8fa3bf" }}>
              Offline Point of Sale
            </Typography>
          </Box>
        </Stack>
        <Divider sx={{ borderColor: "rgba(255,255,255,0.08)" }} />

        <List sx={{ px: 1, py: 1 }}>
          {visibleItems.map((item) => (
            <ListItemButton
              key={item.to}
              component={NavLink}
              to={item.to}
              end={item.to === "/"}
              sx={{
                borderRadius: 1.5,
                mb: 0.5,
                color: "#c2cede",
                "& .MuiListItemIcon-root": { color: "#8fa3bf", minWidth: 38 },
                "&.active": {
                  bgcolor: "primary.main",
                  color: "#fff",
                  "& .MuiListItemIcon-root": { color: "#fff" },
                },
                "&:hover": { bgcolor: "rgba(255,255,255,0.06)" },
              }}
            >
              <ListItemIcon>{item.icon}</ListItemIcon>
              <ListItemText
                primary={item.label}
                slotProps={{ primary: { sx: { fontSize: 14.5 } } }}
              />
            </ListItemButton>
          ))}
        </List>

        <Box sx={{ mt: "auto", p: 2 }}>
          <Tooltip title="This POS stores all data on this computer and needs no internet connection.">
            <Chip
              icon={<WifiOffIcon sx={{ fontSize: 16 }} />}
              label="Works offline"
              size="small"
              sx={{ bgcolor: "rgba(255,255,255,0.08)", color: "#c2cede" }}
            />
          </Tooltip>
        </Box>
      </Drawer>

      <Box
        sx={{
          flexGrow: 1,
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
        }}
      >
        <AppBar
          position="sticky"
          color="inherit"
          sx={{
            borderBottom: "1px solid",
            borderColor: "divider",
            bgcolor: "background.paper",
          }}
        >
          <Toolbar sx={{ gap: 2 }}>
            <Typography variant="h6" sx={{ flexGrow: 1 }}>
              {currentLabel}
            </Typography>

            {user && (
              <>
                <Box
                  sx={{
                    textAlign: "right",
                    display: { xs: "none", sm: "block" },
                  }}
                >
                  <Typography
                    variant="body2"
                    sx={{ fontWeight: 600, lineHeight: 1.2 }}
                  >
                    {user.fullName}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {USER_ROLE_LABELS[user.role]}
                  </Typography>
                </Box>
                <IconButton onClick={(e) => setMenuAnchor(e.currentTarget)}>
                  <Avatar
                    sx={{
                      width: 34,
                      height: 34,
                      bgcolor: "primary.main",
                      fontSize: 15,
                    }}
                  >
                    {user.fullName.trim().charAt(0).toUpperCase()}
                  </Avatar>
                </IconButton>
                <Menu
                  anchorEl={menuAnchor}
                  open={Boolean(menuAnchor)}
                  onClose={() => setMenuAnchor(null)}
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

        <Box component="main" sx={{ flexGrow: 1, p: 3, minWidth: 0 }}>
          {children}
        </Box>
      </Box>
    </Box>
  );
}
