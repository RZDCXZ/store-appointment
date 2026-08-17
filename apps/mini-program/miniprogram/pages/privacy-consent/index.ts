import type { PrivacyConsentStatusResponse } from "@rongguang/contracts";

import { CustomerApiError } from "../../services/customer-api";
import { loadCustomerContext, openCustomerSelector } from "../../services/customer-session";
import { acceptPrivacyConsent, fetchPrivacyConsent } from "../../services/privacy-consent-api";
import { formatShanghaiDateTime } from "../../services/pet-profile-presentation";

type PageState = "loading" | "ready" | "error" | "auth";

function safeReturnTo(value: string | undefined): string {
  return value === "/pages/booking-pet/index" ||
    value === "/pages/booking-service/index" ||
    value === "/pages/booking-staff/index" ||
    value === "/pages/booking-time/index" ||
    value === "/pages/pets/index?mode=booking" ||
    value === "/pages/pets/index"
    ? value
    : "";
}

Page({
  data: {
    pageState: "loading" as PageState,
    authState: "loading" as "active" | "expired" | "missing" | "unavailable" | "loading",
    returnTo: "",
    status: null as PrivacyConsentStatusResponse | null,
    publishedAtLabel: "",
    consentedAtLabel: "",
    accepted: false,
    submitting: false,
    errorMessage: "",
  },
  onLoad(options: Record<string, string | undefined>) {
    const returnTo = safeReturnTo(options.returnTo);
    this.setData({ returnTo });
    void this.loadStatus();
  },
  async loadStatus() {
    const pagePath = this.data.returnTo
      ? `/pages/privacy-consent/index?returnTo=${encodeURIComponent(this.data.returnTo)}`
      : "/pages/privacy-consent/index";
    const context = await loadCustomerContext(pagePath);

    if (context.kind === "expired" || context.kind === "missing") {
      this.setData({ authState: context.kind, pageState: "auth" });
      return;
    }

    this.setData({ authState: context.kind, pageState: "loading", errorMessage: "" });
    try {
      const status = await fetchPrivacyConsent();
      this.setData({
        status,
        publishedAtLabel: formatShanghaiDateTime(status.notice.publishedAt),
        consentedAtLabel: status.consent ? formatShanghaiDateTime(status.consent.consentedAt) : "",
        pageState: "ready",
        accepted: !status.requiresConsent,
      });
    } catch (error) {
      this.setData({
        pageState: "error",
        errorMessage: error instanceof Error ? error.message : "隐私同意状态加载失败，请重试。",
      });
    }
  },
  chooseCustomer() {
    openCustomerSelector(
      this.data.returnTo
        ? `/pages/privacy-consent/index?returnTo=${encodeURIComponent(this.data.returnTo)}`
        : "/pages/privacy-consent/index",
    );
  },
  toggleAccepted() {
    if (this.data.status?.requiresConsent) {
      this.setData({ accepted: !this.data.accepted });
    }
  },
  async confirmConsent() {
    const status = this.data.status;
    if (!status || this.data.submitting) {
      return;
    }

    if (status.requiresConsent && !this.data.accepted) {
      this.setData({ errorMessage: "请先勾选已阅读并同意当前隐私说明。" });
      return;
    }

    if (!status.requiresConsent) {
      this.continueAfterConsent();
      return;
    }

    this.setData({ submitting: true, errorMessage: "" });
    try {
      const updated = await acceptPrivacyConsent(status.notice.version);
      this.setData({
        status: updated,
        publishedAtLabel: formatShanghaiDateTime(updated.notice.publishedAt),
        consentedAtLabel: updated.consent
          ? formatShanghaiDateTime(updated.consent.consentedAt)
          : "",
        accepted: true,
      });
      wx.showToast({ title: "隐私同意已记录", icon: "success" });
      this.continueAfterConsent();
    } catch (error) {
      this.setData({
        errorMessage: error instanceof Error ? error.message : "同意提交失败，请重试。",
      });
      if (error instanceof CustomerApiError && error.code === "PRIVACY_NOTICE_OUTDATED") {
        await this.loadStatus();
      }
    } finally {
      this.setData({ submitting: false });
    }
  },
  continueAfterConsent() {
    if (this.data.returnTo) {
      wx.redirectTo({ url: this.data.returnTo });
    } else {
      wx.navigateBack();
    }
  },
});
