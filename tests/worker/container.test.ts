import assert from "node:assert/strict";
import { test } from "node:test";
import { prepareContainer } from "../../src/worker/container-ready.ts";

test("application health is ready before entering the SDK port-readiness gate", async () => {
  const calls: string[] = [];
  let attempts = 0;
  await prepareContainer({
    async start() {
      calls.push("start");
    },
    async health() {
      calls.push("health");
      if (++attempts === 1) throw new Error("Container is not listening");
      return new Response('{"status":"ok"}');
    },
    async ready() {
      assert.equal(attempts, 2);
      calls.push("ready");
    },
  }, new AbortController().signal);
  assert.deepEqual(calls, ["start", "health", "health", "ready"]);
});

test("known early provisioning errors retry, but other startup errors do not", async () => {
  let attempts = 0;
  await prepareContainer({
    async start() {
      if (++attempts === 1) throw "there is no container instance";
    },
    async health() {
      return new Response(null);
    },
    async ready() {},
  }, new AbortController().signal);
  assert.equal(attempts, 2);
  const failure = new Error("Unexpected container failure");
  await assert.rejects(prepareContainer({
    async start() {
      throw failure;
    },
    async health() {
      assert.fail("No health request should follow failed startup");
    },
    async ready() {
      assert.fail("No readiness gate should follow failed startup");
    },
  }, new AbortController().signal), (error) => error === failure);
});

test("cancelling slow health stops readiness without entering the SDK gate", async () => {
  const abort = new AbortController();
  const failure = new Error("Cancelled");
  await assert.rejects(prepareContainer({
    async start() {},
    async health() {
      abort.abort(failure);
      return new Promise<Response>(() => {});
    },
    async ready() {
      assert.fail("Cancelled startup must not enter the readiness gate");
    },
  }, abort.signal), (error) => error === failure);
  await assert.rejects(prepareContainer({
    async start() {
      assert.fail("An already-cancelled request must not start a container");
    },
    async health() {
      assert.fail("An already-cancelled request must not probe health");
    },
    async ready() {
      assert.fail("An already-cancelled request must not enter the readiness gate");
    },
  }, abort.signal), (error) => error === failure);
});
