Component({
  properties: {
    state: { type: String, value: "loading" },
    title: { type: String, value: "" },
    message: { type: String, value: "" },
    retryLabel: { type: String, value: "重试" },
  },
  methods: {
    retry() {
      this.triggerEvent("retry");
    },
  },
});
