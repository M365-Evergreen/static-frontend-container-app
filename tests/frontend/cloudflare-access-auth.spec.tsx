import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../../src/react-app/auth/AuthProvider";
import { AuthControls } from "../../src/react-app/auth/AuthControls";
import { useAuth } from "../../src/react-app/auth/auth-context";

function Harness() {
  const auth = useAuth();
  return (
    <>
      <AuthControls />
      {auth.account && <p>Authenticated workspace</p>}
    </>
  );
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("Cloudflare Access browser integration", () => {
  it("uses the Access-protected Worker identity and requires no browser login library", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      Response.json({ id: "access:user-1", name: "selected@example.com" }),
    ));
    render(
      <AuthProvider>
        <Harness />
      </AuthProvider>,
    );
    expect(await screen.findByText("Authenticated workspace")).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("fails closed when Cloudflare Access authentication is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      Response.json(
        { error: { message: "Cloudflare Access authentication is required." } },
        { status: 401 },
      ),
    ));
    render(
      <AuthProvider>
        <Harness />
      </AuthProvider>,
    );
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Cloudflare Access authentication is required.",
    );
  });
});
