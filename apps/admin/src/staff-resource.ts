import { useBackofficeResource } from "./backoffice-resource";
import type { BackofficeResource } from "./backoffice-resource";

export type StaffResource<T> = BackofficeResource<T>;

export function useStaffResource<T>(path: string): StaffResource<T> {
  return useBackofficeResource(path, "本人预约读取失败，请稍后重试。");
}
