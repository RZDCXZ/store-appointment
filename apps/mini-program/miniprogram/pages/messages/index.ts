import { fetchCustomerMessage, fetchCustomerMessages } from "../../services/booking-api";
import {
  presentCustomerMessage,
  type CustomerMessageDisplay,
} from "../../services/booking-presentation";
import { loadCustomerContext, openCustomerSelector } from "../../services/customer-session";
import type { CustomerProfile } from "../../types/customer";

type MessagePageState = "loading" | "ready" | "empty" | "error" | "auth";

Page({
  data: {
    authState: "loading" as "active" | "expired" | "missing" | "unavailable" | "loading",
    customer: null as CustomerProfile | null,
    pageState: "loading" as MessagePageState,
    messages: [] as CustomerMessageDisplay[],
    errorMessage: "",
    refreshing: false,
    openingMessageId: "",
  },
  async onShow() {
    await this.loadMessages();
  },
  async loadMessages() {
    const context = await loadCustomerContext("/pages/messages/index");
    if (context.kind === "expired" || context.kind === "missing") {
      this.setData({
        authState: context.kind,
        customer: null,
        pageState: "auth",
        refreshing: false,
      });
      return;
    }
    const hasMessages = this.data.messages.length > 0;
    this.setData({
      authState: context.kind,
      customer: context.customer,
      pageState: hasMessages ? "ready" : "loading",
      errorMessage: "",
      refreshing: hasMessages,
    });
    try {
      const response = await fetchCustomerMessages();
      const messages = response.messages.map(presentCustomerMessage);
      this.setData({
        pageState: messages.length > 0 ? "ready" : "empty",
        messages,
        errorMessage: "",
        refreshing: false,
      });
    } catch (error) {
      this.setData({
        pageState: hasMessages ? "ready" : "error",
        errorMessage: error instanceof Error ? error.message : "模拟消息没有加载出来，请重试。",
        refreshing: false,
      });
    }
  },
  async openMessage(event: WechatMiniprogram.BaseEvent) {
    const messageId = event.currentTarget.dataset.id as unknown;
    if (typeof messageId !== "string" || this.data.openingMessageId) return;
    this.setData({ openingMessageId: messageId, errorMessage: "" });
    try {
      const { message } = await fetchCustomerMessage(messageId);
      wx.navigateTo({
        url: `/pages/booking-detail/index?id=${encodeURIComponent(message.bookingId)}`,
      });
    } catch (error) {
      this.setData({
        errorMessage: error instanceof Error ? error.message : "消息没有打开，请重试。",
      });
    } finally {
      this.setData({ openingMessageId: "" });
    }
  },
  retry() {
    void this.loadMessages();
  },
  onPullDownRefresh() {
    void this.loadMessages().finally(() => wx.stopPullDownRefresh());
  },
  chooseCustomer() {
    openCustomerSelector("/pages/messages/index");
  },
});
