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
  "miniprogram/pages/appointments/index.json",
  "miniprogram/pages/appointments/index.ts",
  "miniprogram/pages/appointments/index.wxml",
  "miniprogram/pages/appointments/index.wxss",
  "miniprogram/pages/messages/index.json",
  "miniprogram/pages/messages/index.ts",
  "miniprogram/pages/messages/index.wxml",
  "miniprogram/pages/messages/index.wxss",
  "miniprogram/pages/profile/index.json",
  "miniprogram/pages/profile/index.ts",
  "miniprogram/pages/profile/index.wxml",
  "miniprogram/pages/profile/index.wxss",
  "miniprogram/pages/services/index.json",
  "miniprogram/pages/services/index.ts",
  "miniprogram/pages/services/index.wxml",
  "miniprogram/pages/services/index.wxss",
  "miniprogram/pages/service-detail/index.json",
  "miniprogram/pages/service-detail/index.ts",
  "miniprogram/pages/service-detail/index.wxml",
  "miniprogram/pages/service-detail/index.wxss",
  "miniprogram/services/storefront-presentation.ts",
  "miniprogram/templates/customer-auth-prompt.wxml",
  "miniprogram/assets/brand/rongguang-hero-shiba.jpg",
  "miniprogram/assets/brand/pet-tuanzi-shiba.jpg",
  "miniprogram/assets/brand/pet-lizi-golden.jpg",
  "miniprogram/assets/brand/pet-bohe-british-shorthair.jpg",
  "miniprogram/assets/promises/employee.png",
  "miniprogram/assets/promises/price.png",
  "miniprogram/assets/promises/checkin.png",
];

export async function verifyProject() {
  await Promise.all(requiredFiles.map((file) => access(new URL(file, projectRoot))));
  const appConfig = JSON.parse(
    await readFile(new URL("miniprogram/app.json", projectRoot), "utf8"),
  );

  const requiredPages = [
    "pages/home/index",
    "pages/appointments/index",
    "pages/messages/index",
    "pages/profile/index",
    "pages/services/index",
    "pages/service-detail/index",
  ];

  if (!requiredPages.every((page) => appConfig.pages?.includes(page))) {
    throw new Error("miniprogram/app.json 必须登记四个顾客 tab 与两个服务目录页面。");
  }

  console.info(`原生小程序项目结构检查通过：${requiredPages.join("、")}`);
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  verifyProject().catch((error) => {
    console.error("小程序项目结构检查失败。", error);
    process.exitCode = 1;
  });
}
