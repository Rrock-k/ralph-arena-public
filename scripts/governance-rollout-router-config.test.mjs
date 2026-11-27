#!/usr/bin/env node
import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeSiteAddress,
  normalizeSlotId,
  normalizeUpstream,
  renderActiveUpstreamCaddy,
} from "./governance-rollout-router-config.mjs";

const template = `
__SITE_ADDRESS__ {
	header X-Ralph-Governance-Active-Slot "__SLOT_ID__"
	reverse_proxy __UPSTREAM__ {
		header_up X-Ralph-Governance-Router-Slot "__SLOT_ID__"
	}
}
`;

test("renders caddy active upstream with slot marker", () => {
  const rendered = renderActiveUpstreamCaddy({
    slotId: "blue",
    upstream: "127.0.0.1:3006",
    siteAddress: ":3000",
    template,
  });

  assert.match(rendered, /:3000 \{/);
  assert.match(rendered, /X-Ralph-Governance-Active-Slot "blue"/);
  assert.match(rendered, /reverse_proxy 127\.0\.0\.1:3006/);
  assert.match(rendered, /X-Ralph-Governance-Router-Slot "blue"/);
});

test("accepts http origins and strips no origin details", () => {
  assert.equal(normalizeUpstream("http://governance-slot-green:3000"), "http://governance-slot-green:3000");
  assert.equal(normalizeUpstream("governance-slot-blue:3000"), "governance-slot-blue:3000");
});

test("rejects unsupported slot ids", () => {
  assert.throws(() => normalizeSlotId("active"), /slot must be one of/);
});

test("rejects upstream paths because active upstream must be an origin", () => {
  assert.throws(() => normalizeUpstream("http://127.0.0.1:3006/api/readiness"), /origin only/);
});

test("rejects unsafe site addresses", () => {
  assert.throws(() => normalizeSiteAddress(":3000 {\nrespond ok"), /unsupported characters/);
});
