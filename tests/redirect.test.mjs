import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script, "inline redirect script exists");

function runRedirect(target, { token, duplicateTarget = false } = {}) {
  const params = new URLSearchParams();
  if (target !== undefined) params.append("u", target);
  if (duplicateTarget && target !== undefined) params.append("u", target);
  if (token !== undefined) params.set("t", token);

  const elements = new Map([
    ["status", { id: "status", textContent: "", style: {} }],
    ["manual-wrap", { style: { display: "none" } }],
    ["manual", { href: "#" }],
    ["guidance", { style: { display: "none" } }],
  ]);
  const navigations = [];
  const location = { search: params.toString() ? `?${params}` : "" };
  Object.defineProperty(location, "href", {
    set(value) { navigations.push(value); },
  });
  const context = {
    URL,
    URLSearchParams,
    document: { getElementById: (id) => elements.get(id) },
    window: { location },
  };
  vm.runInNewContext(script, context);
  return { elements, navigations };
}

const deploymentId = "123e4567-e89b-42d3-a456-426614174000";
const privateLink = `intoss-private://dear-press?_deploymentId=${deploymentId}&host=appsInTossHost`;

test("accepts valid test links and preserves the exact query", () => {
  const target = `${privateLink}&extra=a%2Fb`;
  const { elements, navigations } = runRedirect(target, { token: "legacy-token" });
  assert.deepEqual(navigations, [target]);
  assert.equal(elements.get("manual").href, target);
  assert.equal(elements.get("manual-wrap").style.display, "block");
  assert.equal(elements.get("guidance").style.display, "block");
});

test("accepts valid test links without the legacy token", () => {
  const { navigations } = runRedirect(privateLink);
  assert.deepEqual(navigations, [privateLink]);
});

test("accepts test links without an optional host parameter", () => {
  const target = `intoss-private://dear-press?_deploymentId=${deploymentId}`;
  const { navigations } = runRedirect(target);
  assert.deepEqual(navigations, [target]);
});

test("accepts documented app paths and preserves path and query", () => {
  const target = `intoss-private://dear-press/notice/detail?_deploymentId=${deploymentId}&queryParams=%7B%22id%22%3A%221%22%7D`;
  const { navigations } = runRedirect(target);
  assert.deepEqual(navigations, [target]);
});

test("accepts a normal trailing slash path", () => {
  const target = `intoss-private://dear-press/notice/?_deploymentId=${deploymentId}`;
  const { navigations } = runRedirect(target);
  assert.deepEqual(navigations, [target]);
});

test("accepts production links", () => {
  const target = "intoss://dear-press?campaign=test";
  const { navigations } = runRedirect(target);
  assert.deepEqual(navigations, [target]);
});

test("rejects missing, malformed, duplicate, or unsafe targets without navigation", async (t) => {
  const cases = [
    ["missing target", undefined],
    ["malformed URL", "%"],
    ["raw whitespace", ` ${privateLink}`],
    ["duplicate target", privateLink, { duplicateTarget: true }],
    ["wrong host", `intoss-private://other-app?_deploymentId=${deploymentId}&host=appsInTossHost`],
    ["lookalike host", `intoss-private://dear-press.evil.example?_deploymentId=${deploymentId}&host=appsInTossHost`],
    ["credentials", `intoss-private://user@dear-press?_deploymentId=${deploymentId}&host=appsInTossHost`],
    ["empty user info", `intoss-private://@dear-press?_deploymentId=${deploymentId}&host=appsInTossHost`],
    ["port", `intoss-private://dear-press:444?_deploymentId=${deploymentId}&host=appsInTossHost`],
    ["path traversal", `intoss-private://dear-press/%2e%2e/evil?_deploymentId=${deploymentId}&host=appsInTossHost`],
    ["encoded slash path segment", `intoss-private://dear-press/path%2Fother?_deploymentId=${deploymentId}&host=appsInTossHost`],
    ["repeated slash path", `intoss-private://dear-press/path//other?_deploymentId=${deploymentId}&host=appsInTossHost`],
    ["malformed deployment ID", "intoss-private://dear-press?_deploymentId=not-a-uuid&host=appsInTossHost"],
    ["http", "https://dear-press.example/"],
    ["http scheme", "http://dear-press.example/"],
        ["encoded scheme", "https%3A%2F%2Fdear-press.example%2F"],
    ["javascript", "javascript:alert(1)"],
    ["data", "data:text/html,hello"],
    ["file", "file:///etc/passwd"],
    ["vbscript", "vbscript:msgbox(1)"],
    ["unsupported scheme", "custom://dear-press"],
    ["missing test deployment", "intoss-private://dear-press?host=appsInTossHost"],
    ["wrong test host", `intoss-private://dear-press?_deploymentId=${deploymentId}&host=other`],
    ["duplicate test fields", `intoss-private://dear-press?_deploymentId=${deploymentId}&_deploymentId=${deploymentId}&host=appsInTossHost`],
  ];

  for (const [name, target, options] of cases) {
    await t.test(name, () => {
      const { elements, navigations } = runRedirect(target, options);
      assert.deepEqual(navigations, []);
      assert.equal(elements.get("status").id, "err");
      assert.equal(elements.get("manual-wrap").style.display, "none");
      assert.equal(elements.get("guidance").style.display, "none");
    });
  }
});
