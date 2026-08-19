import type { ManagerBookingStatus, ManagerCustomerPetProfile } from "@rongguang/contracts";

export const customerBookingStatusLabels: Record<ManagerBookingStatus, string> = {
  confirmed: "已确认",
  checked_in: "已到店",
  completed: "已完成",
  cancelled: "已取消",
  no_show: "已爽约",
  terminated: "已终止",
};

export function formatShanghaiDateTime(value: string): string {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }).formatToParts(new Date(value));
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${read("year")}/${read("month")}/${read("day")} ${read("hour")}:${read("minute")}`;
}

export function petProfileSummary(pet: ManagerCustomerPetProfile): string {
  const species = pet.species === "dog" ? "犬" : "猫";
  const size = { small: "小型", medium: "中型", large: "大型" }[pet.petSize];
  return [species, pet.breed, `${pet.weightKg} kg`, size].filter(Boolean).join(" · ");
}
