import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Link,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { zLogin, type LoginInput } from "@shared/validation";
import Logo from "../components/Logo";
import { useAuth } from "../hooks/useAuth";
import { PosApiError } from "@shared/errors";

/**
 * Sign-in screen (spec §29). Works with no network of any kind.
 */
export default function LoginPage() {
  const { login } = useAuth();
  const [formError, setFormError] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);

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
      setFormError(
        err instanceof PosApiError
          ? err.message
          : "Unable to sign in. Please try again.",
      );
    }
  };

  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        bgcolor: "background.default",
        p: 2,
      }}
    >
      <Card sx={{ width: 400, border: "1px solid", borderColor: "divider" }}>
        <CardContent sx={{ p: 4 }}>
          <Stack
            spacing={3}
            component="form"
            onSubmit={handleSubmit(onSubmit)}
            noValidate
          >
            <Stack spacing={1} sx={{ alignItems: "center" }}>
              {/* Spec §29 opens the sign-in screen with the shop logo. */}
              <Logo size={72} />
              <Typography variant="h5">Green Mobile</Typography>
              <Typography variant="body2" color="text.secondary">
                Sign in to open the till
              </Typography>
            </Stack>

            {formError && <Alert severity="error">{formError}</Alert>}

            <TextField
              label="Username"
              autoFocus
              autoComplete="username"
              error={Boolean(errors.username)}
              helperText={errors.username?.message}
              {...register("username")}
            />

            <TextField
              label="Password"
              type="password"
              autoComplete="current-password"
              error={Boolean(errors.password)}
              helperText={errors.password?.message}
              {...register("password")}
            />

            <Button
              type="submit"
              variant="contained"
              size="large"
              disabled={isSubmitting}
            >
              {isSubmitting ? "Signing in…" : "Login"}
            </Button>

            <Box sx={{ textAlign: "center" }}>
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

            {showHelp && (
              <Alert severity="info">
                There is no email service in an offline POS, so passwords are
                reset in person: ask an administrator to open{" "}
                <strong>Users → Reset Password</strong>. They will need to enter
                their own password to confirm.
              </Alert>
            )}
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}
