export {
  autostartStatus,
  queryAutostart,
  buildAptiloopStartCommand,
  setLogonTriggerEnabled,
  serviceInstall,
  serviceRestart,
  serviceStart,
  serviceStatus,
  serviceStop,
  serviceUninstall,
  setAutostart,
  type AutostartState,
  type ServiceAction,
  type ServiceResult,
  type ServiceRuntimeConfig,
  type ServiceStartCommand,
} from "./service.js";
export { installShortcut, removeShortcut } from "./shortcuts.js";
