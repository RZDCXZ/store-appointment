import type {
  CustomerDataDeletionResponse,
  CustomerDataRightsFutureBooking,
  CustomerDataRightsStatusResponse,
} from "@rongguang/contracts";

import {
  clearCustomerSessionAfterDeletion,
  loadCustomerContext,
  openCustomerSelector,
} from "../../services/customer-session";
import {
  deleteCustomerData,
  fetchCustomerDataExport,
  fetchCustomerDataRights,
} from "../../services/data-rights-api";
import {
  formatBookingDate,
  formatBookingLocalDate,
  formatBookingTime,
} from "../../services/booking-presentation";

interface FutureBookingView extends CustomerDataRightsFutureBooking {
  dateLabel: string;
  timeLabel: string;
}

function formatDateTime(
  startsAt: string,
  endsAt: string,
): Pick<FutureBookingView, "dateLabel" | "timeLabel"> {
  return {
    dateLabel: formatBookingDate(formatBookingLocalDate(startsAt)).fullLabel,
    timeLabel: `${formatBookingTime(startsAt)}–${formatBookingTime(endsAt)}`,
  };
}

function exportFilename(exportedAt: string): string {
  const localDate = formatBookingLocalDate(exportedAt).replaceAll("-", "");
  return `rongguang-my-data-${localDate}.json`;
}

function writeExportFile(filePath: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().writeFile({
      filePath,
      data: `${JSON.stringify(value, null, 2)}\n`,
      encoding: "utf8",
      success: () => resolve(),
      fail: (error) => reject(new Error(error.errMsg || "导出文件写入失败。")),
    });
  });
}

Page({
  data: {
    pageState: "loading" as "loading" | "ready" | "auth" | "error" | "deleted",
    customerName: "",
    phoneMasked: "",
    summary: {
      petCount: 0,
      privacyConsentCount: 0,
      bookingCount: 0,
      messageCount: 0,
    },
    futureBookings: [] as FutureBookingView[],
    canDelete: false,
    anonymizedItems: [] as string[],
    retainedItems: [] as string[],
    disclaimer: "",
    errorMessage: "",
    exporting: false,
    deleting: false,
    confirmationStep: 0 as 0 | 1 | 2,
    deletionAcknowledged: false,
    deletionResult: null as CustomerDataDeletionResponse | null,
  },
  async onShow() {
    this.setData({ pageState: "loading", errorMessage: "" });
    const context = await loadCustomerContext("/pages/data-rights/index");
    if (context.kind !== "active") {
      this.setData({
        pageState: "auth",
        errorMessage: context.kind === "unavailable" ? context.message : "请先选择一个演示顾客。",
      });
      return;
    }
    await this.loadRights();
  },
  async loadRights() {
    try {
      const rights = await fetchCustomerDataRights();
      this.applyRights(rights);
    } catch (error) {
      this.setData({
        pageState: "error",
        errorMessage: error instanceof Error ? error.message : "数据权利信息加载失败，请重试。",
      });
    }
  },
  applyRights(rights: CustomerDataRightsStatusResponse) {
    this.setData({
      pageState: "ready",
      customerName: rights.customer.displayName,
      phoneMasked: rights.customer.phoneMasked,
      summary: rights.dataSummary,
      futureBookings: rights.futureBookings.map((booking) => ({
        ...booking,
        ...formatDateTime(booking.startsAt, booking.endsAt),
      })),
      canDelete: rights.canDelete,
      anonymizedItems: rights.retentionPolicy.anonymized,
      retainedItems: rights.retentionPolicy.retained,
      disclaimer: rights.retentionPolicy.disclaimer,
      errorMessage: "",
    });
  },
  chooseCustomer() {
    openCustomerSelector("/pages/data-rights/index");
  },
  retry() {
    void this.onShow();
  },
  openFutureBooking(event: WechatMiniprogram.BaseEvent) {
    const id = event.currentTarget.dataset.id as unknown;
    if (typeof id === "string" && id) {
      wx.navigateTo({ url: `/pages/booking-detail/index?id=${encodeURIComponent(id)}` });
    }
  },
  async exportData() {
    if (this.data.exporting) return;
    this.setData({ exporting: true, errorMessage: "" });
    try {
      const exported = await fetchCustomerDataExport();
      const filePath = `${wx.env.USER_DATA_PATH}/${exportFilename(exported.exportedAt)}`;
      await writeExportFile(filePath, exported);
      await new Promise<void>((resolve) => {
        wx.showModal({
          title: "导出完成",
          content: `本人资料已保存为 JSON：${filePath}`,
          showCancel: false,
          success: () => resolve(),
          fail: () => resolve(),
        });
      });
    } catch (error) {
      this.setData({
        errorMessage: error instanceof Error ? error.message : "本人资料导出失败，请重试。",
      });
    } finally {
      this.setData({ exporting: false });
    }
  },
  openDeletionConfirmation() {
    if (!this.data.canDelete) {
      wx.showToast({ title: "请先处理未来预约", icon: "none" });
      return;
    }
    this.setData({ confirmationStep: 1, deletionAcknowledged: false, errorMessage: "" });
  },
  advanceDeletionConfirmation() {
    if (this.data.confirmationStep === 1) {
      this.setData({ confirmationStep: 2 });
    }
  },
  closeDeletionConfirmation() {
    if (!this.data.deleting) {
      this.setData({ confirmationStep: 0, deletionAcknowledged: false });
    }
  },
  noop() {},
  updateDeletionAcknowledgement(event: WechatMiniprogram.CheckboxGroupChange) {
    this.setData({ deletionAcknowledged: event.detail.value.includes("confirmed") });
  },
  async submitDeletion() {
    if (!this.data.deletionAcknowledged || this.data.deleting) return;
    this.setData({ deleting: true, errorMessage: "" });
    try {
      const result = await deleteCustomerData();
      clearCustomerSessionAfterDeletion();
      this.setData({
        pageState: "deleted",
        deletionResult: result,
        deleting: false,
        confirmationStep: 0,
      });
      wx.showModal({
        title: "资料已匿名化",
        content: "身份与宠物资料已删除，匿名预约事实仍用于演示经营统计。",
        showCancel: false,
        success: () => wx.switchTab({ url: "/pages/profile/index" }),
      });
    } catch (error) {
      this.setData({
        deleting: false,
        confirmationStep: 0,
        deletionAcknowledged: false,
        errorMessage: error instanceof Error ? error.message : "资料删除失败，请重试。",
      });
      await this.loadRights();
    }
  },
});
