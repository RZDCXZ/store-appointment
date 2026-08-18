import type { StoreServiceRecord } from "@rongguang/contracts";

import { formatShanghaiDateTime } from "./staff-booking-presentation";

export function StoreServiceRecordView({
  record,
}: {
  record: StoreServiceRecord;
}): React.JSX.Element {
  return (
    <section className="staff-service-record" aria-label="只读门店服务记录">
      <header>
        <small>只读原记录</small>
        <h2>门店服务记录</h2>
        <p>原记录不能覆盖或删除；如需补充，请追加带作者与时间的说明。</p>
      </header>
      <dl>
        <div>
          <dt>宠物</dt>
          <dd>{record.pet.name}</dd>
        </div>
        <div>
          <dt>主要服务</dt>
          <dd>{record.primaryService.name}</dd>
        </div>
        <div>
          <dt>增项</dt>
          <dd>
            {record.addons.length > 0 ? record.addons.map((addon) => addon.name).join(" + ") : "无"}
          </dd>
        </div>
        <div>
          <dt>员工</dt>
          <dd>{record.staff.displayName}</dd>
        </div>
        <div>
          <dt>实际到店</dt>
          <dd>{formatShanghaiDateTime(record.actualStartsAt)}</dd>
        </div>
        <div>
          <dt>实际结束</dt>
          <dd>{formatShanghaiDateTime(record.actualEndsAt)}</dd>
        </div>
      </dl>
      <div className="staff-service-record__notes">
        <strong>本次护理标签</strong>
        <p>{record.careTags.length > 0 ? record.careTags.join(" · ") : "未填写"}</p>
        <strong>内部文字记录</strong>
        <p>{record.internalText ?? "未填写"}</p>
      </div>
    </section>
  );
}
