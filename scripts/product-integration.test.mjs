import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workspaceRoot = new URL("../", import.meta.url);

test("设计稿路由映射覆盖 MP-01…18、ST-01…09 与 MG-01…18", async () => {
  const routeMap = await readFile(new URL("docs/route-map.md", workspaceRoot), "utf8");

  for (const [prefix, total] of [
    ["MP", 18],
    ["ST", 9],
    ["MG", 18],
  ]) {
    for (let index = 1; index <= total; index += 1) {
      const id = `${prefix}-${String(index).padStart(2, "0")}`;
      assert.match(routeMap, new RegExp(`\\| ${id}\\s+\\|`), `${id} 尚未登记实际入口`);
    }
  }

  assert.doesNotMatch(routeMap, /\| 骨架\s+\|/, "最终路由映射不能保留骨架状态");
});

test("小程序所有已注册页面都登记在设计稿路由映射中", async () => {
  const [routeMap, appConfigText] = await Promise.all([
    readFile(new URL("docs/route-map.md", workspaceRoot), "utf8"),
    readFile(new URL("apps/mini-program/miniprogram/app.json", workspaceRoot), "utf8"),
  ]);
  const appConfig = JSON.parse(appConfigText);

  for (const pagePath of appConfig.pages) {
    assert.ok(routeMap.includes(`\`${pagePath}`), `${pagePath} 尚未登记到路由映射`);
  }
});
