import {
  fetchDemoCustomers,
  isCustomerTabPath,
  loadCustomerContext,
  switchDemoCustomer,
  takeRecoveryPath,
} from "../../services/customer-session";
import type { CustomerProfile, DemoCustomerChoice } from "../../types/customer";

Page({
  data: {
    authState: "loading" as "active" | "expired" | "missing" | "unavailable" | "loading",
    currentCustomer: null as CustomerProfile | null,
    choices: [] as DemoCustomerChoice[],
    loadingChoices: true,
    switchingKey: "",
    selectorOpen: false,
    errorMessage: "",
  },
  async onLoad() {
    await this.loadChoices();
  },
  async onShow() {
    const context = await loadCustomerContext("/pages/profile/index");
    this.setData({
      authState: context.kind,
      currentCustomer: "customer" in context ? context.customer : null,
      selectorOpen: context.kind === "expired" || context.kind === "missing",
      errorMessage: context.kind === "unavailable" ? context.message : "",
    });
  },
  async loadChoices() {
    this.setData({ loadingChoices: true, errorMessage: "" });

    try {
      const choices = await fetchDemoCustomers();
      this.setData({ choices, loadingChoices: false });
    } catch (error) {
      this.setData({
        loadingChoices: false,
        errorMessage: error instanceof Error ? error.message : "演示顾客加载失败，请重试。",
      });
    }
  },
  openSelector() {
    this.setData({ selectorOpen: true });
  },
  closeSelector() {
    if (this.data.currentCustomer) {
      this.setData({ selectorOpen: false });
    }
  },
  async selectCustomer(event: WechatMiniprogram.BaseEvent) {
    const key = event.currentTarget.dataset.key as unknown;

    if (typeof key !== "string" || this.data.switchingKey) {
      return;
    }

    this.setData({ switchingKey: key, errorMessage: "" });

    try {
      const customer = await switchDemoCustomer(key);
      this.setData({
        authState: "active",
        currentCustomer: customer,
        selectorOpen: false,
        switchingKey: "",
      });
      wx.showToast({ title: `已切换为${customer.displayName}`, icon: "success" });

      const recoveryPath = takeRecoveryPath();
      if (recoveryPath && recoveryPath !== "/pages/profile/index") {
        if (isCustomerTabPath(recoveryPath)) {
          wx.switchTab({ url: recoveryPath });
        } else {
          wx.navigateTo({ url: recoveryPath });
        }
      }
    } catch (error) {
      this.setData({
        switchingKey: "",
        errorMessage: error instanceof Error ? error.message : "身份切换失败，请重试。",
      });
    }
  },
  openPets() {
    wx.navigateTo({ url: "/pages/pets/index" });
  },
  openPrivacyConsent() {
    wx.navigateTo({ url: "/pages/privacy-consent/index" });
  },
});
