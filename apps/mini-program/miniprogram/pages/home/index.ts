import { loadCustomerTabState, openCustomerSelector } from "../../services/customer-session";
import {
  displayPrimaryService,
  fetchStorefrontCatalog,
  getStoreBusinessSummary,
  serviceDetailPath,
  type PrimaryServiceDisplay,
  type StoreBusinessSummary,
} from "../../services/storefront-catalog";
import type { CustomerProfile } from "../../types/customer";

type CatalogState = "loading" | "ready" | "empty" | "error";

interface RecentAppointmentPlaceholder {
  badge: string;
  title: string;
  body: string;
}

const loadingBusinessSummary: StoreBusinessSummary = {
  statusLabel: "读取营业状态",
  hoursLabel: "周二至周日 09:30–19:00",
  dateLabel: "上海时间",
  isOpen: false,
};

function recentAppointmentPlaceholder(
  customer: CustomerProfile | null,
): RecentAppointmentPlaceholder {
  if (!customer) {
    return {
      badge: "待选择",
      title: "选择演示顾客后查看最近预约",
      body: "当前可以先浏览全部服务与确定价格。",
    };
  }

  if (customer.story === "已有未来预约") {
    return {
      badge: "已有预约",
      title: `${customer.displayName}有一笔未来预约`,
      body: "具体宠物、员工和时间会显示在这个最近预约位置。",
    };
  }

  return {
    badge: "近期为空",
    title: "近期没有预约",
    body: "选好服务后，可以从这里开始为宠物安排洗护。",
  };
}

Page({
  data: {
    authState: "loading" as "active" | "expired" | "missing" | "unavailable" | "loading",
    customer: null as CustomerProfile | null,
    connectionMessage: "",
    recentAppointment: recentAppointmentPlaceholder(null),
    catalogState: "loading" as CatalogState,
    catalogError: "",
    refreshingCatalog: false,
    businessSummary: loadingBusinessSummary,
    storeAddress: "上海市徐汇区暖茸路 18 号",
    contactPhone: "021-6488 2618",
    serviceCards: [] as PrimaryServiceDisplay[],
  },
  onLoad() {
    void this.loadCatalog();
  },
  async onShow() {
    const customerState = await loadCustomerTabState("/pages/home/index");
    this.setData({
      ...customerState,
      recentAppointment: recentAppointmentPlaceholder(customerState.customer),
    });
  },
  async loadCatalog() {
    const hasCatalog = this.data.serviceCards.length > 0;
    this.setData({
      catalogState: hasCatalog ? this.data.catalogState : "loading",
      catalogError: "",
      refreshingCatalog: hasCatalog,
    });

    try {
      const catalog = await fetchStorefrontCatalog();
      const serviceCards = catalog.primaryServices.map(displayPrimaryService);
      this.setData({
        catalogState: serviceCards.length > 0 ? "ready" : "empty",
        catalogError: "",
        refreshingCatalog: false,
        businessSummary: getStoreBusinessSummary(catalog.store),
        storeAddress: catalog.store.address,
        contactPhone: catalog.store.contactPhone,
        serviceCards,
      });
    } catch (error) {
      this.setData({
        catalogState: hasCatalog ? "ready" : "error",
        catalogError: error instanceof Error ? error.message : "门店服务加载失败，请重试。",
        refreshingCatalog: false,
      });
    }
  },
  primaryAction() {
    wx.navigateTo({ url: "/pages/services/index" });
  },
  goServiceCatalog() {
    wx.navigateTo({ url: "/pages/services/index" });
  },
  goServiceDetail(event: WechatMiniprogram.BaseEvent) {
    const serviceId = event.currentTarget.dataset.id as unknown;

    if (typeof serviceId === "string") {
      wx.navigateTo({ url: serviceDetailPath(serviceId) });
    }
  },
  retryCatalog() {
    void this.loadCatalog();
  },
  goAppointments() {
    wx.switchTab({ url: "/pages/appointments/index" });
  },
  chooseCustomer() {
    openCustomerSelector("/pages/home/index");
  },
});
