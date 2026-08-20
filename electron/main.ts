import { app, BrowserWindow, dialog } from "electron";
import path from "node:path";
import { userDataDir } from "./utils/paths";
import {
  applySecurityPolicy,
  hardenWindow,
  refuseCertificateErrors,
} from "./security";
import { trustWebContents } from "./ipc/registry";
import { logger } from "./utils/logger";
import { startup, type StartupContext } from "./bootstrap";
import { closeDatabase } from "./database";
import { registerAppIpc } from "./ipc/app.ipc";
import { registerAuthIpc } from "./ipc/auth.ipc";
import { registerSettingsIpc } from "./ipc/settings.ipc";
import { registerCatalogIpc } from "./ipc/catalog.ipc";
import { registerSalesIpc } from "./ipc/sales.ipc";
import { registerPrintIpc } from "./ipc/print.ipc";
import { registerExpensesIpc } from "./ipc/expenses.ipc";
import { registerBankingIpc } from "./ipc/banking.ipc";
import { registerServicesIpc } from "./ipc/services.ipc";
import { registerReportsIpc } from "./ipc/reports.ipc";
import { registerBackupIpc } from "./ipc/backup.ipc";
import { registerDataIpc } from "./ipc/data.ipc";
import { registerUsersIpc } from "./ipc/users.ipc";

// Must be set before anything reads app.getPath('userData').
app.setName("MobileShopPOS");
app.setAppUserModelId("com.greenmobile.mobileshoppos");

// Build verification only: lets `npm run smoke` exercise a throwaway shop
// without touching the real %APPDATA%\MobileShopPOS data. Deliberately gated on
// POS_SMOKE so a production run can never be redirected by a stray variable.
if (process.env.POS_SMOKE === "1" && process.env.POS_USER_DATA_DIR) {
  app.setPath("userData", process.env.POS_USER_DATA_DIR);
}

const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;

let mainWindow: BrowserWindow | null = null;
let context: StartupContext | null = null;

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    backgroundColor: "#f4f6f8",
    autoHideMenuBar: true,
    title: "Green Mobile",
    // A packaged build takes its icon from the .exe, which electron-builder
    // stamps from build/icon.ico. Only a dev run needs to be told.
    ...(app.isPackaged
      ? {}
      : { icon: path.join(app.getAppPath(), "build", "icon.png") }),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      spellcheck: false,
    },
  });

  win.once("ready-to-show", () => {
    win.maximize();
    win.show();
  });

  // The renderer is a local application shell: no navigation away, no child
  // windows, no webviews, and no developer tools in a packaged build. See
  // electron/security.ts for what each guard is for.
  hardenWindow(win, DEV_SERVER_URL);

  // Only this window may call the IPC channels (spec §65).
  trustWebContents(win.webContents.id);

  if (DEV_SERVER_URL) {
    void win.loadURL(DEV_SERVER_URL);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    void win.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  return win;
}

async function bootstrap(): Promise<void> {
  // Applied before any window exists, so there is no moment during startup when
  // a request could get out (spec §4, §83).
  applySecurityPolicy(DEV_SERVER_URL);

  context = startup();
  if (!context) {
    // startup() has already told the user what happened.
    app.exit(1);
    return;
  }

  registerAppIpc(context);
  registerAuthIpc();
  registerSettingsIpc();
  registerCatalogIpc();
  registerSalesIpc();
  registerPrintIpc();
  registerExpensesIpc();
  registerBankingIpc();
  registerServicesIpc();
  registerReportsIpc();
  registerBackupIpc();
  registerDataIpc();
  registerUsersIpc();

  mainWindow = createMainWindow();

  if (process.env.POS_SMOKE === "1") {
    const { runSmokeTest } = await import("./utils/smoke");
    runSmokeTest(mainWindow);
  }
}

// Every renderer runs sandboxed, including any window added later.
app.enableSandbox();
refuseCertificateErrors();

// Single instance only — two processes must never open the same SQLite file.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app
    .whenReady()
    .then(bootstrap)
    .catch((err) => {
      logger.error("Fatal error during startup", err);
      dialog.showErrorBox(
        "Green Mobile POS could not start",
        "The application failed to start. Technical details have been written to the log file in:\n\n" +
          userDataDir() +
          "\\logs",
      );
      app.exit(1);
    });

  app.on("window-all-closed", () => {
    app.quit();
  });

  app.on("before-quit", () => {
    logger.info("Application closing");
    closeDatabase();
    logger.close();
  });
}

process.on("uncaughtException", (err) => {
  logger.error("Uncaught exception in main process", err);
});
process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled rejection in main process", reason);
});
