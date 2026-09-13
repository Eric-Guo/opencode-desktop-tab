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
test("rejects invalid config before any window or service mutation", () => {
  const primary = { id: "opencode", title: "OpenCode", label: "O" }
  expect(() => parseDesktopTabs("{broken")).toThrow()
  expect(() => parseDesktopTabs('{"desktopTabs":[]}')).toThrow("opencode")
  expect(() => parseDesktopTabs(JSON.stringify({ desktopTabs: [primary, primary] }))).toThrow("duplicate")
  expect(() => parseDesktopTabs(JSON.stringify({ desktopTabs: [{ ...primary, suggestedQuestions: [5] }] }))).toThrow(
    "Invalid desktop tab",
  )
})
