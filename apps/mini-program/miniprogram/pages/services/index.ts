import { fetchStorefrontCatalog } from "../../services/storefront-catalog";
import {
  displayPrimaryService,
  displayServiceAddon,
  type PrimaryServiceDisplay,
  type ServiceAddonDisplay,
} from "../../services/storefront-presentation";

type CatalogState = "loading" | "ready" | "empty" | "error";

Page({
  data: {
    catalogState: "loading" as CatalogState,
    refreshing: false,
    errorMessage: "",
    primaryServices: [] as PrimaryServiceDisplay[],
    addons: [] as ServiceAddonDisplay[],
  },
  onLoad() {
    void this.loadCatalog();
  },
  async loadCatalog() {
    const hasCatalog = this.data.primaryServices.length > 0;
    this.setData({
      catalogState: hasCatalog ? this.data.catalogState : "loading",
      refreshing: hasCatalog,
      errorMessage: "",
    });

    try {
      const catalog = await fetchStorefrontCatalog();
      const primaryServices = catalog.primaryServices.map(displayPrimaryService);
      this.setData({
        catalogState: primaryServices.length > 0 ? "ready" : "empty",
        refreshing: false,
        errorMessage: "",
        primaryServices,
        addons: catalog.addons.map(displayServiceAddon),
      });
    } catch (error) {
      this.setData({
        catalogState: hasCatalog ? "ready" : "error",
        refreshing: false,
        errorMessage: error instanceof Error ? error.message : "门店服务加载失败，请重试。",
      });
    }
  },
  retry() {
    void this.loadCatalog();
  },
});
