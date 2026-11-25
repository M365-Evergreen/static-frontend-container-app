import { useCallback, useEffect, useState, type ReactNode } from "react";
import { readApiError } from "../chat/chat.api";
import { AuthContext, type ApiRequest } from "./auth-context";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<{ id: string; name: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const initialize = async () => {
      try {
        const response = await fetch("/api/auth/status", {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!response.ok) throw new Error(await readApiError(response));
        const value: unknown = await response.json();
        if (
          typeof value !== "object" ||
          value === null ||
          !("id" in value) ||
          typeof value.id !== "string" ||
          !("name" in value) ||
          typeof value.name !== "string"
        ) {
          throw new Error("The server returned an invalid Cloudflare Access identity.");
        }
        if (!controller.signal.aborted) setAccount({ id: value.id, name: value.name });
      } catch (failure) {
        if (!controller.signal.aborted) {
          setError(
            failure instanceof Error
              ? failure.message
              : "Cloudflare Access authentication could not be checked.",
          );
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void initialize();
    return () => controller.abort();
  }, []);

  const request: ApiRequest = useCallback(
    async (url, init) => {
      if (!url.startsWith("/api/")) {
        throw new Error("Authenticated requests must use a relative API URL.");
      }
      if (!account) throw new Error("Sign in through Cloudflare Access to use chat.");
      init?.signal?.throwIfAborted();
      const response = await fetch(url, init);
      if (response.status === 401 || response.status === 403) {
        try {
          setError(await readApiError(response.clone()));
        } catch {
          setError("Your Cloudflare Access session is invalid or expired.");
        }
      }
      return response;
    },
    [account],
  );

  return (
    <AuthContext.Provider
      value={{
        account,
        loading,
        configured: true,
        error,
        signIn: async () => undefined,
        signOut: async () => undefined,
        request,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
