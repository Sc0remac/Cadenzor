export const featureFlags = {
  priorityV3:
    typeof process.env.NEXT_PUBLIC_FEATURE_PRIORITY_V3 === "string"
      ? process.env.NEXT_PUBLIC_FEATURE_PRIORITY_V3.trim().toLowerCase() !== "off"
      : true,
};
