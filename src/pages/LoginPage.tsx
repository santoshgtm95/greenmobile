import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Collapse,
  IconButton,
  InputAdornment,
  Link,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { alpha, keyframes } from "@mui/material/styles";
import PersonOutlineIcon from "@mui/icons-material/PersonOutlined";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import WifiOffIcon from "@mui/icons-material/WifiOff";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { zLogin, type LoginInput } from "@shared/validation";
import Logo from "../components/Logo";
import { useAuth } from "../hooks/useAuth";
import { PosApiError } from "@shared/errors";

const rise = keyframes`
  from { opacity: 0; transform: translateY(16px); }
  to { opacity: 1; transform: none; }
`;
const pop = keyframes`
  0% { opacity: 0; transform: scale(0.5) rotate(-15deg); }
  70% { opacity: 1; transform: scale(1.08) rotate(3deg); }
  100% { transform: none; }
`;
const float = keyframes`
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-6px); }
`;
const drift = keyframes`
  0%, 100% { transform: translate(0, 0) scale(1); }
  50% { transform: translate(40px, -30px) scale(1.15); }
`;
const shakeFrames = `
  10%, 90% { transform: translateX(-2px); }
  20%, 80% { transform: translateX(4px); }
  30%, 50%, 70% { transform: translateX(-6px); }
  40%, 60% { transform: translateX(6px); }
`;
// Two identical animations: alternating names replays the shake without remounting the form.
const shakes = [
  keyframes`${shakeFrames}`,
  keyframes`${shakeFrames} 100% { transform: none; }`,
];
const sheen = keyframes`
  from { transform: translateX(-120%) skewX(-20deg); }
  to { transform: translateX(220%) skewX(-20deg); }
`;

/** Staggered entrance for the n-th block of the form. */
const step = (n: number) => ({
  animation: `${rise} 500ms ${150 + n * 70}ms ease-out both`,
});

/**
 * Sign-in screen (spec §29). Works with no network of any kind.
 */
export default function LoginPage() {
  const { login } = useAuth();
  const [formError, setFormError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [showHelp, setShowHelp] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({
    resolver: zodResolver(zLogin),
    defaultValues: { username: "", password: "" },
  });

  const onSubmit = async (values: LoginInput) => {
    setFormError(null);
    try {
      await login(values);
    } catch (err) {
      setAttempt((n) => n + 1);
      setFormError(
        err instanceof PosApiError
          ? err.message
          : "Unable to sign in. Please try again.",
      );
    }
  };

  const blob = (color: string, size: number, pos: object, delay: number) => (
    <Box
      aria-hidden
      sx={{
        position: "absolute",
        width: size,
        height: size,
        borderRadius: "50%",
        bgcolor: color,
        filter: "blur(80px)",
        opacity: 0.45,
        animation: `${drift} 14s ${delay}s ease-in-out infinite`,
        ...pos,
      }}
    />
  );

  return (
    <Box
      sx={(theme) => ({
        position: "relative",
        overflow: "hidden",
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        p: 2,
        background:
          "linear-gradient(160deg, #ffffff 0%, #ffffff 55%, #ffffff 100%)",
        "@media (prefers-reduced-motion: reduce)": {
          "& *": {
            animation: "none !important",
            transition: "none !important",
          },
        },
        // Faint dot grid over the gradient.
        "&::before": {
          content: '""',
          position: "absolute",
          inset: 0,
          backgroundImage: `radial-gradient(${alpha(theme.palette.primary.light, 0.12)} 1px, transparent 1px)`,
          backgroundSize: "22px 22px",
          maskImage:
            "radial-gradient(circle at center, #000 30%, transparent 75%)",
        },
      })}
    >
      {blob("primary.main", 420, { top: -120, left: -100 }, 0)}
      {blob("primary.dark", 360, { bottom: -120, right: -80 }, -5)}
      {blob("#2563eb", 260, { top: "40%", right: "20%" }, -9)}

      <Card
        elevation={0}
        sx={(theme) => ({
          position: "relative",
          width: "100%",
          maxWidth: 400,
          borderRadius: 4,
          bgcolor: alpha(theme.palette.background.paper, 0.92),
          backdropFilter: "blur(16px)",
          border: "1px solid",
          borderColor: alpha("#fff", 0.12),
          boxShadow: `0 30px 80px ${alpha("#000", 0.45)}, 0 0 0 1px ${alpha(theme.palette.primary.main, 0.08)}`,
          animation:
            attempt > 0
              ? `${shakes[attempt % 2]} 450ms ease-in-out both`
              : `${rise} 600ms cubic-bezier(.2,.9,.3,1) both`,
          // Green accent line along the top edge.
          "&::before": {
            content: '""',
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 4,
            background: `linear-gradient(90deg, ${theme.palette.primary.light}, ${theme.palette.primary.main}, ${theme.palette.primary.dark})`,
          },
        })}
      >
        <CardContent sx={{ p: { xs: 3, sm: 4 } }}>
          <Stack
            spacing={2.5}
            component="form"
            onSubmit={handleSubmit(onSubmit)}
            noValidate
          >
            <Stack spacing={1} sx={{ alignItems: "center" }}>
              {/* Spec §29 opens the sign-in screen with the shop logo. */}
              <Box
                sx={(theme) => ({
                  p: 1.25,
                  borderRadius: 4,
                  bgcolor: alpha(theme.palette.primary.main, 0.08),
                  boxShadow: `0 10px 30px ${alpha(theme.palette.primary.main, 0.25)}`,
                  animation: `${pop} 700ms cubic-bezier(.2,.9,.3,1.3) both, ${float} 4s 800ms ease-in-out infinite`,
                })}
              >
                <Logo size={64} />
              </Box>
              <Typography
                variant="h5"
                sx={{ fontWeight: 800, letterSpacing: -0.3, ...step(1) }}
              >
                Green Mobile
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={step(2)}>
                Sign in to open the till
              </Typography>
            </Stack>

            <Collapse in={Boolean(formError)} unmountOnExit>
              <Alert severity="error">{formError}</Alert>
            </Collapse>

            <TextField
              label="Username"
              autoFocus
              autoComplete="username"
              error={Boolean(errors.username)}
              helperText={errors.username?.message}
              sx={step(3)}
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <PersonOutlineIcon fontSize="small" />
                    </InputAdornment>
                  ),
                },
              }}
              {...register("username")}
            />

            <TextField
              label="Password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              error={Boolean(errors.password)}
              helperText={errors.password?.message}
              sx={step(4)}
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <LockOutlinedIcon fontSize="small" />
                    </InputAdornment>
                  ),
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        edge="end"
                        size="small"
                        aria-label={
                          showPassword ? "Hide password" : "Show password"
                        }
                        onClick={() => setShowPassword((v) => !v)}
                      >
                        {showPassword ? (
                          <VisibilityOffIcon fontSize="small" />
                        ) : (
                          <VisibilityIcon fontSize="small" />
                        )}
                      </IconButton>
                    </InputAdornment>
                  ),
                },
              }}
              {...register("password")}
            />

            <Button
              type="submit"
              variant="contained"
              size="large"
              disabled={isSubmitting}
              sx={(theme) => ({
                ...step(5),
                position: "relative",
                overflow: "hidden",
                py: 1.25,
                borderRadius: 2,
                fontWeight: 700,
                background: `linear-gradient(135deg, ${theme.palette.primary.main}, ${theme.palette.primary.dark})`,
                boxShadow: `0 8px 22px ${alpha(theme.palette.primary.main, 0.4)}`,
                transition: "transform 200ms, box-shadow 200ms",
                "&:hover": {
                  transform: "translateY(-2px)",
                  boxShadow: `0 12px 28px ${alpha(theme.palette.primary.main, 0.5)}`,
                },
                "&:active": { transform: "none" },
                // Light sweep across the button on hover.
                "&::after": {
                  content: '""',
                  position: "absolute",
                  top: 0,
                  bottom: 0,
                  left: 0,
                  width: "40%",
                  background:
                    "linear-gradient(90deg, transparent, rgba(255,255,255,0.35), transparent)",
                  transform: "translateX(-120%) skewX(-20deg)",
                },
                "&:hover::after": { animation: `${sheen} 700ms ease-out` },
              })}
            >
              {isSubmitting ? "Signing in…" : "Login"}
            </Button>

            <Box sx={{ textAlign: "center", ...step(6) }}>
              <Link
                component="button"
                type="button"
                variant="body2"
                underline="hover"
                onClick={() => setShowHelp((v) => !v)}
              >
                Forgot password
              </Link>
            </Box>

            <Collapse in={showHelp}>
              <Alert severity="info">
                There is no email service in an offline POS, so passwords are
                reset in person: ask an administrator to open{" "}
                <strong>Users → Reset Password</strong>. They will need to enter
                their own password to confirm.
              </Alert>
            </Collapse>
          </Stack>
        </CardContent>
      </Card>

      <Stack
        direction="row"
        spacing={0.75}
        sx={{
          position: "absolute",
          bottom: 16,
          alignItems: "center",
          color: "#8fa3bf",
          animation: `${rise} 600ms 700ms ease-out both`,
        }}
      >
        <WifiOffIcon sx={{ fontSize: 15 }} />
        <Typography variant="caption">
          Offline Point of Sale · your data stays on this computer
        </Typography>
      </Stack>
    </Box>
  );
}
