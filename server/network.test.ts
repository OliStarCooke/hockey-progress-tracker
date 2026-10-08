import { test } from "node:test";
import assert from "node:assert/strict";
import { clientFilter } from "./network.ts";
test("only loopback and listed subnets may connect", () => {
  const allowed = clientFilter(["192.168.0.0/24"]);
  assert.equal(allowed("127.0.0.1"), true);
  assert.equal(allowed("::1"), true);
  assert.equal(allowed("192.168.0.42"), true);
  assert.equal(allowed("::ffff:192.168.0.42"), true);
  assert.equal(allowed("192.168.1.42"), false);
  assert.equal(allowed("10.30.4.161"), false);
  assert.equal(allowed(undefined), false);
  assert.equal(clientFilter([])("192.168.0.42"), false);
  assert.throws(() => clientFilter(["192.168.0.0"]), /Invalid/);
  assert.throws(() => clientFilter(["192.168.0.0/33"]), /Invalid/);
  assert.throws(() => clientFilter(["home/24"]), /Invalid/);
});
