import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { expect, test, type Page } from "@playwright/test";

const demoPassword = "Rongguang2026!";
const execFileAsync = promisify(execFile);

test.afterAll(async () => {
  await execFileAsync("corepack", ["pnpm", "--filter", "@rongguang/api", "db:reset"], {
    cwd: new URL("../../../", import.meta.url),
  });
});

async function loginAsManager(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByRole("combobox", { name: "演示账号" }).selectOption("manager");
  await page.getByLabel("演示密码").fill(demoPassword);
  await page.getByRole("button", { name: "进入管理端" }).click();
  await expect(page.getByRole("heading", { name: "今日工作台" })).toBeVisible();
}

test("MG-13 可创建并登录员工、刷新独立路由、用键盘编辑技能并显示停用阻断入口", async ({ page }) => {
  await loginAsManager(page);

  await page.goto("/manager/services/staff");
  await expect(page.getByRole("heading", { name: "员工与技能" })).toBeVisible();
  await page.getByRole("button", { name: "新增员工" }).click();
  await page.getByLabel("演示账号").fill("ticket20browser");
  await page.getByLabel("员工姓名").fill("唐语");
  await page.getByLabel("演示密码").fill("Ticket20-Browser!");
  await page.getByRole("button", { name: "创建员工账号" }).click();
  await expect(page.getByText("唐语的员工账号已创建。")).toBeVisible();

  await page.getByRole("button", { name: "退出登录" }).click();
  await page.getByRole("combobox", { name: "演示账号" }).selectOption("__other_staff__");
  await page.getByLabel("其他员工账号").fill("ticket20browser");
  await page.getByLabel("演示密码").fill("Ticket20-Browser!");
  await page.getByRole("button", { name: "进入管理端" }).click();
  await expect(page.getByRole("heading", { name: "我的今日工作" })).toBeVisible();
  await expect(page.getByText("唐语 · 员工")).toBeVisible();

  await page.getByRole("button", { name: "退出登录" }).click();
  await loginAsManager(page);
  await page.goto("/manager/services/staff");
  await page.reload();
  await expect(page.getByRole("heading", { name: "员工技能矩阵" })).toBeVisible();

  const linxia = page.getByRole("row", { name: /林夏/ });
  await linxia.getByRole("button", { name: "编辑林夏技能" }).click();
  const catCare = page.getByRole("checkbox", { name: /猫咪洗护/ });
  await catCare.focus();
  await expect(catCare).toBeFocused();
  await catCare.press("Space");
  await expect(catCare).toBeChecked();
  await page.getByRole("button", { name: "保存林夏技能" }).click();
  await expect(page.getByText("林夏的技能已保存，新的可约时段会立即使用当前覆盖。")).toBeVisible();
  await expect(linxia.getByLabel("林夏具备猫咪洗护所需全部技能")).toBeVisible();

  const chenjia = page.getByRole("row", { name: /陈嘉/ });
  await chenjia.getByRole("button", { name: "停用陈嘉账号" }).click();
  const dialog = page.getByRole("alertdialog", { name: "停用陈嘉账号" });
  await expect(dialog.getByRole("button", { name: "取消" })).toBeFocused();
  await dialog.getByRole("button", { name: "确认停用陈嘉账号" }).click();
  await expect(page.getByRole("heading", { name: /陈嘉仍有 \d+ 笔未来预约/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /处理.*的预约/ }).first()).toHaveAttribute(
    "href",
    /\/manager\/appointments\//,
  );
});
