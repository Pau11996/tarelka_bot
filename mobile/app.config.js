module.exports = ({ config }) => ({
  ...config,
  extra: {
    ...config.extra,
    ...(process.env.EXPO_PUBLIC_EAS_PROJECT_ID
      ? { eas: { projectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID } }
      : {}),
  },
});
