import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

const TOKEN_KEY = "tarelka.access_token";

type AuthValue = {
  ready: boolean;
  token: string | null;
  signIn: (token: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (Platform.OS === "web"
      ? Promise.resolve().then(() => sessionStorage.getItem(TOKEN_KEY))
      : SecureStore.getItemAsync(TOKEN_KEY))
      .then((stored) => {
        if (active) {
          setToken(stored);
        }
      })
      .catch(() => {
        if (active) {
          setToken(null);
        }
      })
      .finally(() => {
        if (active) {
          setReady(true);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      ready,
      token,
      async signIn(next) {
        if (Platform.OS === "web") sessionStorage.setItem(TOKEN_KEY, next);
        else await SecureStore.setItemAsync(TOKEN_KEY, next);
        setToken(next);
      },
      async signOut() {
        if (Platform.OS === "web") sessionStorage.removeItem(TOKEN_KEY);
        else await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => undefined);
        setToken(null);
      },
    }),
    [ready, token],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (value === null) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return value;
}
