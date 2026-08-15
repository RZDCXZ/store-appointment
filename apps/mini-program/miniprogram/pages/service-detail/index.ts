import {
  displayPrimaryService,
  displayServiceAddon,
  fetchStorefrontCatalog,
  type PrimaryServiceDisplay,
  type ServiceAddonDisplay,
} from "../../services/storefront-catalog";

type DetailState = "loading" | "ready" | "not-found" | "error";

Page({
  data: {
    serviceId: "",
    detailState: "loading" as DetailState,
    refreshing: false,
    errorMessage: "",
    service: null as PrimaryServiceDisplay | null,
    addons: [] as ServiceAddonDisplay[],
  },
  onLoad(query: Record<string, string | undefined>) {
    const serviceId = typeof query.id === "string" ? query.id : "";
    this.setData({ serviceId });
    void this.loadService();
  },
  async loadService() {
    if (!this.data.serviceId) {
      this.setData({ detailState: "not-found", errorMessage: "" });
      return;
    }

    const hasService = Boolean(this.data.service);
    this.setData({
      detailState: hasService ? "ready" : "loading",
      refreshing: hasService,
      errorMessage: "",
    });

    try {
      const catalog = await fetchStorefrontCatalog();
      const service = catalog.primaryServices.find((item) => item.id === this.data.serviceId);

      if (!service) {
        this.setData({
          detailState: "not-found",
          refreshing: false,
          service: null,
          addons: [],
        });
        return;
      }

      const addonIds = new Set(service.availableAddonIds);
      this.setData({
        detailState: "ready",
        refreshing: false,
        errorMessage: "",
        service: displayPrimaryService(service),
        addons: catalog.addons.filter((addon) => addonIds.has(addon.id)).map(displayServiceAddon),
      });
    } catch (error) {
      this.setData({
        detailState: hasService ? "ready" : "error",
        refreshing: false,
        errorMessage: error instanceof Error ? error.message : "服务详情加载失败，请重试。",
      });
    }
  },
  retry() {
    void this.loadService();
  },
  goCatalog() {
    wx.redirectTo({ url: "/pages/services/index" });
  },
});
