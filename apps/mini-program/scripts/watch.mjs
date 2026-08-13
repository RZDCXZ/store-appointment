import { watch } from "node:fs";

import { verifyProject } from "./verify-project.mjs";

const miniprogramRoot = new URL("../miniprogram/", import.meta.url);
let timer;

await verifyProject();
console.info("小程序源码监视中；实际编译与热更新由微信开发者工具负责。按 Ctrl+C 退出。");

watch(miniprogramRoot, { recursive: true }, () => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    verifyProject().catch((error) => console.error("小程序项目结构检查失败。", error));
  }, 100);
});
