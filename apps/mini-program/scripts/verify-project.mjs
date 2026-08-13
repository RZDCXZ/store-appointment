import { access, readFile } from "node:fs/promises";

const projectRoot = new URL("../", import.meta.url);
const requiredFiles = [
  "project.config.example.json",
  "miniprogram/app.json",
  "miniprogram/app.ts",
  "miniprogram/app.wxss",
  "miniprogram/pages/home/index.json",
  "miniprogram/pages/home/index.ts",
  "miniprogram/pages/home/index.wxml",
  "miniprogram/pages/home/index.wxss",
];

export async function verifyProject() {
  await Promise.all(requiredFiles.map((file) => access(new URL(file, projectRoot))));
  const appConfig = JSON.parse(
    await readFile(new URL("miniprogram/app.json", projectRoot), "utf8"),
  );

  if (!appConfig.pages?.includes("pages/home/index")) {
    throw new Error("miniprogram/app.json 必须登记 pages/home/index。");
  }

  console.info("原生小程序项目结构检查通过：pages/home/index");
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  verifyProject().catch((error) => {
    console.error("小程序项目结构检查失败。", error);
    process.exitCode = 1;
  });
}
