import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Divider,
  FormControlLabel,
  MenuItem,
  Step,
  StepLabel,
  Stepper,
  Switch,
  TextField,
  Typography,
  Stack,
} from "@mui/material";
import { useForm, Controller, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  zFirstRunSetup,
  type FirstRunSetupFormValues,
  type FirstRunSetupInput,
} from "@shared/validation";
import { CURRENCY_DECIMALS, formatRate, parseRate } from "@shared/money";
import Logo from "../components/Logo";
import { useAuth } from "../hooks/useAuth";
import { PosApiError } from "@shared/errors";

/**
 * First-run setup (spec §88, §89).
 *
 * Deliberately creates the administrator here rather than shipping a default
 * account, so no installation is ever reachable with a known password.
 */
const STEPS = [
  "Shop",
  "Administrator",
  "Currency & Tax",
  "Receipt",
  "Finish",
] as const;

/** Fields that must be valid before each step's Next button unlocks. */
const STEP_FIELDS: Array<Array<keyof FirstRunSetupFormValues>> = [
  ["shopName", "shopAddress", "shopPhone", "shopEmail"],
  ["fullName", "username", "password", "confirmPassword"],
  ["currency", "taxEnabled", "taxRate", "taxMode"],
  ["receiptWidth", "backupLocation"],
  [],
];

export default function FirstRunWizard() {
  const { completeFirstRunSetup } = useAuth();
  const [step, setStep] = useState(0);
  const [formError, setFormError] = useState<string | null>(null);

  // Three generics: what the fields hold, the context, and what the resolver
  // produces. Naming the third is what gives handleSubmit the parsed payload.
  const form = useForm<FirstRunSetupFormValues, unknown, FirstRunSetupInput>({
    resolver: zodResolver(zFirstRunSetup),
    mode: "onChange",
    defaultValues: {
      shopName: "",
      shopAddress: "",
      shopPhone: "",
      shopEmail: "",
      fullName: "",
      username: "",
      password: "",
      confirmPassword: "",
      currency: "THB",
      taxEnabled: false,
      taxRate: 0,
      taxMode: "EXCLUSIVE",
      receiptWidth: "80mm",
      backupLocation: "",
    },
  });

  const {
    handleSubmit,
    trigger,
    formState: { isSubmitting },
  } = form;

  const next = async () => {
    const ok = await trigger(STEP_FIELDS[step] as never, { shouldFocus: true });
    if (ok) setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const onSubmit = async (values: FirstRunSetupInput) => {
    setFormError(null);
    try {
      await completeFirstRunSetup(values);
    } catch (err) {
      setFormError(
        err instanceof PosApiError
          ? err.message
          : "Unable to complete setup. Please try again.",
      );
    }
  };

  return (
    <Box
      sx={{ minHeight: "100vh", display: "grid", placeItems: "center", p: 3 }}
    >
      <Card sx={{ width: 640, border: "1px solid", borderColor: "divider" }}>
        <CardContent sx={{ p: 4 }}>
          <Stack spacing={1} sx={{ alignItems: "center", mb: 3 }}>
            <Logo size={68} />
            <Typography variant="h5">Welcome to Green Mobile</Typography>
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ textAlign: "center" }}
            >
              A few details and your shop is ready. Everything stays on this
              computer.
            </Typography>
          </Stack>

          <Stepper activeStep={step} sx={{ mb: 3 }}>
            {STEPS.map((label) => (
              <Step key={label}>
                <StepLabel>{label}</StepLabel>
              </Step>
            ))}
          </Stepper>

          <Divider sx={{ mb: 3 }} />

          <Box component="form" onSubmit={handleSubmit(onSubmit)} noValidate>
            {formError && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {formError}
              </Alert>
            )}

            {step === 0 && <ShopStep form={form} />}
            {step === 1 && <AdminStep form={form} />}
            {step === 2 && <MoneyStep form={form} />}
            {step === 3 && <ReceiptStep form={form} />}
            {step === 4 && <FinishStep form={form} />}

            <Stack
              direction="row"
              spacing={1}
              sx={{ justifyContent: "flex-end", mt: 4 }}
            >
              <Button
                disabled={step === 0 || isSubmitting}
                onClick={() => setStep((s) => s - 1)}
              >
                Back
              </Button>
              {step < STEPS.length - 1 ? (
                <Button variant="contained" onClick={next}>
                  Next
                </Button>
              ) : (
                <Button
                  type="submit"
                  variant="contained"
                  size="large"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? "Setting up…" : "Create Shop"}
                </Button>
              )}
            </Stack>
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}

type WizardForm = UseFormReturn<
  FirstRunSetupFormValues,
  unknown,
  FirstRunSetupInput
>;

type StepProps = { form: WizardForm };

function ShopStep({ form }: StepProps) {
  const { register, formState } = form;
  const { errors } = formState;
  return (
    <Stack spacing={2}>
      <TextField
        label="Shop name"
        autoFocus
        required
        error={Boolean(errors.shopName)}
        helperText={errors.shopName?.message}
        {...register("shopName")}
      />
      <TextField
        label="Address"
        multiline
        minRows={2}
        error={Boolean(errors.shopAddress)}
        helperText={errors.shopAddress?.message}
        {...register("shopAddress")}
      />
      <Stack direction="row" spacing={2}>
        <TextField
          label="Phone"
          error={Boolean(errors.shopPhone)}
          helperText={errors.shopPhone?.message}
          {...register("shopPhone")}
        />
        <TextField
          label="Email"
          error={Boolean(errors.shopEmail)}
          helperText={errors.shopEmail?.message}
          {...register("shopEmail")}
        />
      </Stack>
      <Typography variant="caption" color="text.secondary">
        This appears on every invoice and receipt. You can change it later in
        Settings.
      </Typography>
    </Stack>
  );
}

function AdminStep({ form }: StepProps) {
  const { register, formState } = form;
  const { errors } = formState;
  return (
    <Stack spacing={2}>
      <Alert severity="info">
        This account has full access. There is no default password in this
        application — nobody can sign in until you create it here.
      </Alert>
      <TextField
        label="Your full name"
        autoFocus
        required
        error={Boolean(errors.fullName)}
        helperText={errors.fullName?.message}
        {...register("fullName")}
      />
      <TextField
        label="Username"
        required
        error={Boolean(errors.username)}
        helperText={
          errors.username?.message ?? "Used to sign in. Letters, numbers, . _ -"
        }
        {...register("username")}
      />
      <Stack direction="row" spacing={2}>
        <TextField
          label="Password"
          type="password"
          required
          error={Boolean(errors.password)}
          helperText={errors.password?.message ?? "At least 6 characters"}
          {...register("password")}
        />
        <TextField
          label="Confirm password"
          type="password"
          required
          error={Boolean(errors.confirmPassword)}
          helperText={errors.confirmPassword?.message}
          {...register("confirmPassword")}
        />
      </Stack>
    </Stack>
  );
}

function MoneyStep({ form }: StepProps) {
  const { control, watch, formState } = form;
  const { errors } = formState;
  const taxEnabled = watch("taxEnabled");

  return (
    <Stack spacing={2}>
      <Controller
        control={control}
        name="currency"
        render={({ field }) => (
          <TextField
            select
            label="Currency"
            {...field}
            error={Boolean(errors.currency)}
            helperText={errors.currency?.message}
          >
            {Object.keys(CURRENCY_DECIMALS).map((code) => (
              <MenuItem key={code} value={code}>
                {code}
              </MenuItem>
            ))}
          </TextField>
        )}
      />

      <Controller
        control={control}
        name="taxEnabled"
        render={({ field }) => (
          <FormControlLabel
            control={
              <Switch
                checked={field.value}
                onChange={(e) => field.onChange(e.target.checked)}
              />
            }
            label="Charge tax on sales"
          />
        )}
      />

      {taxEnabled && (
        <>
          <Controller
            control={control}
            name="taxRate"
            render={({ field }) => (
              <TextField
                label="Tax rate"
                defaultValue={formatRate(field.value ?? 0).replace("%", "")}
                onChange={(e) => field.onChange(parseRate(e.target.value) ?? 0)}
                error={Boolean(errors.taxRate)}
                helperText={errors.taxRate?.message ?? "Percent, e.g. 7 or 7.5"}
              />
            )}
          />
          <Controller
            control={control}
            name="taxMode"
            render={({ field }) => (
              <TextField select label="Tax handling" {...field}>
                <MenuItem value="EXCLUSIVE">
                  Exclusive — add tax on top of the price
                </MenuItem>
                <MenuItem value="INCLUSIVE">
                  Inclusive — prices already contain tax
                </MenuItem>
              </TextField>
            )}
          />
        </>
      )}

      {!taxEnabled && (
        <Typography variant="caption" color="text.secondary">
          Leave this off if you do not issue tax invoices. It can be switched on
          at any time.
        </Typography>
      )}
    </Stack>
  );
}

function ReceiptStep({ form }: StepProps) {
  const { control, register, formState } = form;
  const { errors } = formState;
  return (
    <Stack spacing={2}>
      <Controller
        control={control}
        name="receiptWidth"
        render={({ field }) => (
          <TextField select label="Receipt printer width" {...field}>
            <MenuItem value="58mm">58 mm thermal</MenuItem>
            <MenuItem value="80mm">80 mm thermal</MenuItem>
          </TextField>
        )}
      />
      <TextField
        label="Backup folder (optional)"
        placeholder="e.g. D:\POS-Backups or a USB drive"
        error={Boolean(errors.backupLocation)}
        helperText={
          errors.backupLocation?.message ??
          "Leave blank to keep backups inside the application data folder. A USB drive or second disk is safer."
        }
        {...register("backupLocation")}
      />
      <Alert severity="info">
        You can pick a printer and change the receipt layout later in Settings →
        Printer. Printing uses the printers already installed in Windows.
      </Alert>
    </Stack>
  );
}

function FinishStep({ form }: StepProps) {
  const values = form.watch();
  const rows: Array<[string, string]> = [
    ["Shop", values.shopName],
    ["Administrator", `${values.fullName} (${values.username})`],
    ["Currency", values.currency],
    [
      "Tax",
      values.taxEnabled
        ? `${formatRate(values.taxRate ?? 0)} ${(values.taxMode ?? "EXCLUSIVE").toLowerCase()}`
        : "Not charged",
    ],
    ["Receipt", values.receiptWidth ?? "80mm"],
    [
      "Backups",
      values.backupLocation?.trim()
        ? values.backupLocation
        : "Application data folder",
    ],
  ];

  return (
    <Stack spacing={2}>
      <Typography variant="subtitle1">Ready to create your shop</Typography>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: "auto 1fr",
          columnGap: 3,
          rowGap: 1,
          p: 2,
          bgcolor: "background.default",
          borderRadius: 1,
        }}
      >
        {rows.map(([label, value]) => (
          <Box key={label} sx={{ display: "contents" }}>
            <Typography variant="body2" color="text.secondary">
              {label}
            </Typography>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {value || "—"}
            </Typography>
          </Box>
        ))}
      </Box>
      <Typography variant="caption" color="text.secondary">
        The database, default categories and settings will be created on this
        computer. No internet connection is needed now or later.
      </Typography>
    </Stack>
  );
}
