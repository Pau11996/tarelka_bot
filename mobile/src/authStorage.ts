export function authStorageKeys(apiUrl: string) {
  const scope = apiUrl.replace(/\/+$/, "").replace(/[^a-zA-Z0-9.-]/g, (char) =>
    `_${char.codePointAt(0)!.toString(16)}_`,
  );
  return {
    token: `tarelka.access_token.${scope}`,
    pendingLogin: `tarelka.pending-login.${scope}`,
  };
}
