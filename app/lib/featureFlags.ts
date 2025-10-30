function resolveBooleanFlag(envValue: string | undefined, defaultsTo: boolean): boolean {
  if (typeof envValue !== "string") {
    return defaultsTo;
  }

  const normalised = envValue.trim().toLowerCase();
  if (!normalised) {
    return defaultsTo;
  }

  if (["0", "false", "off", "disabled", "no"].includes(normalised)) {
    return false;
  }

  if (["1", "true", "on", "enabled", "yes"].includes(normalised)) {
    return true;
  }

  return defaultsTo;
}

export const featureFlags = {
  priorityV3: resolveBooleanFlag(process.env.NEXT_PUBLIC_FEATURE_PRIORITY_V3, true),
  threadedInbox: resolveBooleanFlag(process.env.NEXT_PUBLIC_ENABLE_THREADED_INBOX, false),
};
