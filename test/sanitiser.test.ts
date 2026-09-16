import assert from "node:assert/strict";
import test from "node:test";
import { aggregateWarnings, detectSensitiveData, redactSensitiveData } from "../src/sanitiser.js";

test("detectSensitiveData reports emails, IP addresses, and user IDs", () => {
  assert.deepEqual(
    detectSensitiveData("email=a@example.com ip=192.168.0.1 userId=synthetic-user-123"),
    [
      { type: "Possible email address", value: "a@example.com", count: 1 },
      { type: "Possible IP address", value: "192.168.0.1", count: 1 },
      { type: "Possible user identifier", value: "userId=synthetic-user-123", count: 1 }
    ]
  );
});

test("redactSensitiveData replaces emails, IP addresses, and user IDs", () => {
  assert.equal(
    redactSensitiveData("email=a@example.com ip=192.168.0.1 userId=synthetic-user-123"),
    "email=[REDACTED:email] ip=[REDACTED:ip] userId=[REDACTED:userId]"
  );
});

test("redactSensitiveData leaves content without sensitive data unchanged", () => {
  assert.equal(redactSensitiveData("INFO Request completed"), "INFO Request completed");
});

test("redactSensitiveData masks bearer tokens and JWTs", () => {
  const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";

  assert.equal(
    redactSensitiveData(`Authorization: Bearer ${jwt} accepted`),
    "Authorization: Bearer [REDACTED:bearer] accepted"
  );
  assert.equal(redactSensitiveData(`session ${jwt} expired`), "session [REDACTED:jwt] expired");
});

test("detectSensitiveData reports a nested value once, under the outermost rule", () => {
  const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";

  assert.deepEqual(detectSensitiveData(`Authorization: Bearer ${jwt}`), [
    { type: "Possible bearer token", value: `Bearer ${jwt}`, count: 1 }
  ]);
});

test("redactSensitiveData masks key=value credentials in several syntaxes", () => {
  assert.equal(redactSensitiveData("connecting with password=hunter2 api_key=abc123"), "connecting with password=[REDACTED:secret] api_key=[REDACTED:secret]");
  assert.equal(redactSensitiveData('body {"password": "hunter2", "client_secret": "s3cr3t"}'), 'body {"password": "[REDACTED:secret]", "client_secret": "[REDACTED:secret]"}');
  assert.equal(redactSensitiveData("GET /cb?access_token=tok123&state=ok"), "GET /cb?access_token=[REDACTED:secret]&state=ok");
});

test("redactSensitiveData masks AWS access key IDs", () => {
  assert.equal(redactSensitiveData("using AKIAIOSFODNN7EXAMPLE for upload"), "using [REDACTED:awsKey] for upload");
});

test("redactSensitiveData masks IPv6 addresses but not timestamps", () => {
  assert.equal(redactSensitiveData("client 2001:0db8:85a3:0000:0000:8a2e:0370:7334 connected"), "client [REDACTED:ipv6] connected");
  assert.equal(redactSensitiveData("client 2001:db8::8a2e:370:7334 connected"), "client [REDACTED:ipv6] connected");
  assert.equal(redactSensitiveData("client fe80::1 connected"), "client [REDACTED:ipv6] connected");
  assert.equal(redactSensitiveData("loopback ::1 connected"), "loopback [REDACTED:ipv6] connected");

  const timestamped = "2026-05-31T09:14:03Z INFO listening on :8080 elapsed 00:01:02.345";
  assert.equal(redactSensitiveData(timestamped), timestamped);
});

test("redactSensitiveData does not treat ordinary prose as credentials", () => {
  const line = "ERROR Authentication failed: invalid token correlationId=req_3a51 status=401";
  assert.equal(redactSensitiveData(line), line);
});

test("aggregateWarnings collapses repeated type/value pairs and sums counts", () => {
  const aggregated = aggregateWarnings([
    { type: "Possible IP address", value: "[REDACTED:ip]", count: 1 },
    { type: "Possible email address", value: "[REDACTED:email]", count: 1 },
    { type: "Possible IP address", value: "[REDACTED:ip]", count: 1 },
    { type: "Possible IP address", value: "[REDACTED:ip]", count: 2 }
  ]);

  assert.deepEqual(aggregated, [
    { type: "Possible IP address", value: "[REDACTED:ip]", count: 4 },
    { type: "Possible email address", value: "[REDACTED:email]", count: 1 }
  ]);
});
