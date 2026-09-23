import { expect, test } from "bun:test"
import { parseDesktopTabs } from "../src/main/desktop-tabs"

test("reads JSONC and preserves all site initialization and display options", () => {
  expect(
    parseDesktopTabs(`{
    // existing configuration remains valid
    "desktopTabs": [
      {"id":"opencode","title":"OpenCode","label":"O","skipDisplay":true},
      {"id":"site","title":"Site","label":"S","url":"https://example.com/app","partition":"persist:site","localServer":true,"localAgent":"7777","welcomeText":"Hello","suggestedQuestions":["One"],"releaseWhenLostFocus":true,"systemControlColor":"white"},
    ],
  }`)[1],
  ).toEqual({
    type: "web",
    id: "site",
    title: "Site",
    label: "S",
    skipDisplay: false,
    url: "https://example.com/app",
    partition: "persist:site",
    localServer: true,
    localAgent: "7777",
    welcomeText: "Hello",
    suggestedQuestions: ["One"],
    releaseWhenLostFocus: true,
    systemControlColor: "white",
  })
})

test("normalizes legacy and explicit tab types while keeping agent metadata independent of the renderer", () => {
  const primary = { id: "opencode" as const, title: "Sigma", label: "Assistant" }
  const local = {
    id: "7777",
    title: "7777",
    label: "7777",
    html: "7777/index.html",
    devHtml: "index.html",
    localAgent: "7777",
    welcomeText: "# 7777\n\nWelcome",
    suggestedQuestions: ["One", "Two"],
    releaseWhenLostFocus: true,
  }
  const web = {
    id: "site",
    title: "Site",
    label: "S",
    url: "https://example.com/app",
    partition: "persist:site",
    localServer: true,
    localAgent: "plm",
  }
  const legacy = parseDesktopTabs(JSON.stringify({ desktopTabs: [primary, local, web] }))
  expect(legacy).toEqual([
    { ...primary, type: "primary", skipDisplay: false },
    { ...local, type: "local", skipDisplay: false },
    { ...web, type: "web", skipDisplay: false },
  ])
  expect(parseDesktopTabs(JSON.stringify({ desktopTabs: legacy }))).toEqual(legacy)
  const shared = {
    ...local,
    type: "local" as const,
    id: "another-agent",
    localAgent: "another",
    devServerEnv: "SHARED_UI_URL",
  }
  expect(parseDesktopTabs(JSON.stringify({ desktopTabs: [primary, local, shared] }))[2]).toEqual({
    ...shared,
    skipDisplay: false,
  })
})

test.each([
  { type: "unknown", html: "agent/index.html" },
  { type: null, html: "agent/index.html" },
  { type: "primary" },
  { type: "web", html: "agent/index.html" },
  { type: "web", url: "https://example.com" },
  { type: "web", url: "invalid", partition: "site" },
  { type: "web", url: "https://example.com", partition: "site", devServerEnv: "DEV_URL" },
  { type: "local" },
  { type: "local", html: "agent/index.html", devServerEnv: false },
  { type: "local", html: "agent/index.html", devHtml: 3 },
  { type: "local", html: "agent/index.html", localServer: true },
  { html: "agent/index.html", url: "https://example.com", partition: "site" },
  { type: "local", id: "opencode", html: "agent/index.html" },
  { id: "opencode", url: "https://example.com", partition: "site" },
])("rejects conflicting or incomplete tab sources: %j", (fields) => {
  expect(() =>
    parseDesktopTabs(
      JSON.stringify({
        desktopTabs: [
          { id: "opencode", title: "Sigma", label: "Assistant" },
          { id: "agent", title: "Agent", label: "A", ...fields },
        ],
      }),
      "fixture.jsonc",
    ),
  ).toThrow("Invalid desktop tab at desktopTabs[1]: fixture.jsonc")
})
test("rejects invalid config before any window or service mutation", () => {
  const primary = { id: "opencode", title: "OpenCode", label: "O" }
  expect(() => parseDesktopTabs("{broken")).toThrow()
  expect(() => parseDesktopTabs('{"desktopTabs":[]}')).toThrow("opencode")
  expect(() => parseDesktopTabs(JSON.stringify({ desktopTabs: [primary, primary] }))).toThrow("duplicate")
  expect(() => parseDesktopTabs(JSON.stringify({ desktopTabs: [{ ...primary, suggestedQuestions: [5] }] }))).toThrow(
    "Invalid desktop tab",
  )
})
