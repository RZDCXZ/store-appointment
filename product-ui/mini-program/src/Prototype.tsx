import {
  ArchiveIcon,
  BellIcon,
  CalendarIcon,
  CheckCircledIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  Cross2Icon,
  DownloadIcon,
  ExclamationTriangleIcon,
  GearIcon,
  HeartIcon,
  HomeIcon,
  InfoCircledIcon,
  LockClosedIcon,
  Pencil1Icon,
  PersonIcon,
  PlusIcon,
  ReaderIcon,
  SewingPinIcon,
  TrashIcon,
} from "@radix-ui/react-icons";
import {
  createContext,
  type ReactNode,
  useContext,
  useMemo,
  useState,
} from "react";
import {
  BottomSheet,
  Carousel,
  FlowStack,
  KeyboardInput,
  KeyboardTextarea,
  MobileScroll,
  type FlowControls,
  type FlowScreen,
} from "./mobile";

type ScreenId =
  | "home"
  | "services"
  | "pets"
  | "pet-form"
  | "privacy"
  | "booking-pet"
  | "booking-service"
  | "booking-staff"
  | "booking-time"
  | "booking-confirm"
  | "booking-success"
  | "booking-conflict"
  | "records"
  | "appointment"
  | "reschedule"
  | "messages"
  | "profile"
  | "data-rights";

type AppointmentState = "confirmed" | "cancelled";

type AppState = {
  selectedPet: "团子" | "薄荷";
  selectedAddons: string[];
  staffPreference: "最快可约" | "赵航" | "林夏";
  selectedDate: string;
  selectedTime: string;
  appointmentState: AppointmentState;
  privacyAccepted: boolean;
  profileSaved: boolean;
  setSelectedPet: (pet: "团子" | "薄荷") => void;
  toggleAddon: (addon: string) => void;
  setStaffPreference: (staff: "最快可约" | "赵航" | "林夏") => void;
  setSelectedDate: (date: string) => void;
  setSelectedTime: (time: string) => void;
  setAppointmentState: (state: AppointmentState) => void;
  setPrivacyAccepted: (accepted: boolean) => void;
  setProfileSaved: (saved: boolean) => void;
};

const AppStateContext = createContext<AppState | null>(null);

const screenMeta: Record<ScreenId, { title?: string; topLevel?: boolean; bookingStep?: number }> = {
  home: { topLevel: true },
  services: { title: "服务项目" },
  pets: { title: "宠物档案" },
  "pet-form": { title: "新建宠物" },
  privacy: { title: "隐私同意" },
  "booking-pet": { title: "选择宠物", bookingStep: 1 },
  "booking-service": { title: "选择服务", bookingStep: 2 },
  "booking-staff": { title: "员工偏好", bookingStep: 3 },
  "booking-time": { title: "日期与时段", bookingStep: 4 },
  "booking-confirm": { title: "确认预约", bookingStep: 5 },
  "booking-success": {},
  "booking-conflict": { title: "重新选择时段", bookingStep: 4 },
  records: { topLevel: true },
  appointment: { title: "预约详情" },
  reschedule: { title: "预约改期" },
  messages: { topLevel: true },
  profile: { topLevel: true },
  "data-rights": { title: "数据与隐私" },
};

const dates = [
  { short: "今天", date: "13", day: "周四", value: "8月13日 周四" },
  { short: "明天", date: "14", day: "周五", value: "8月14日 周五" },
  { short: "周六", date: "15", day: "周六", value: "8月15日 周六" },
  { short: "周日", date: "16", day: "周日", value: "8月16日 周日" },
  { short: "闭店", date: "17", day: "周一", value: "8月17日 周一", disabled: true },
  { short: "周二", date: "18", day: "周二", value: "8月18日 周二" },
  { short: "周三", date: "19", day: "周三", value: "8月19日 周三" },
];

const timeSlots = ["10:00", "11:00", "13:30", "15:00", "16:30", "17:30"];

function useAppState() {
  const value = useContext(AppStateContext);
  if (!value) throw new Error("App state is unavailable");
  return value;
}

function makeScreen(id: ScreenId): FlowScreen {
  const meta = screenMeta[id];
  const hasHeader = Boolean(meta.title);
  const bookingFooter = meta.bookingStep && id !== "booking-conflict";
  const topLevelFooter = meta.topLevel;

  return {
    id,
    header: hasHeader ? (flow) => <AppHeader id={id} flow={flow} /> : undefined,
    headerHeight: hasHeader ? 58 : undefined,
    footer: bookingFooter
      ? (flow) => <BookingFooter id={id} flow={flow} />
      : topLevelFooter
        ? (flow) => <BottomTabs active={id} flow={flow} />
        : undefined,
    footerHeight: bookingFooter ? 84 : topLevelFooter ? 72 : undefined,
    render: (flow) => <ScreenContent id={id} flow={flow} />,
  };
}

function AppStateProvider({ children }: { children: ReactNode }) {
  const [selectedPet, setSelectedPet] = useState<"团子" | "薄荷">("团子");
  const [selectedAddons, setSelectedAddons] = useState<string[]>(["修甲护理"]);
  const [staffPreference, setStaffPreference] = useState<"最快可约" | "赵航" | "林夏">("赵航");
  const [selectedDate, setSelectedDate] = useState("8月13日 周四");
  const [selectedTime, setSelectedTime] = useState("11:00");
  const [appointmentState, setAppointmentState] = useState<AppointmentState>("confirmed");
  const [privacyAccepted, setPrivacyAccepted] = useState(true);
  const [profileSaved, setProfileSaved] = useState(false);

  const value = useMemo<AppState>(
    () => ({
      selectedPet,
      selectedAddons,
      staffPreference,
      selectedDate,
      selectedTime,
      appointmentState,
      privacyAccepted,
      profileSaved,
      setSelectedPet,
      toggleAddon: (addon) =>
        setSelectedAddons((items) =>
          items.includes(addon) ? items.filter((item) => item !== addon) : [...items, addon],
        ),
      setStaffPreference,
      setSelectedDate,
      setSelectedTime,
      setAppointmentState,
      setPrivacyAccepted,
      setProfileSaved,
    }),
    [
      selectedPet,
      selectedAddons,
      staffPreference,
      selectedDate,
      selectedTime,
      appointmentState,
      privacyAccepted,
      profileSaved,
    ],
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export default function Prototype() {
  return (
    <AppStateProvider>
      <FlowStack initial={makeScreen("home")} />
    </AppStateProvider>
  );
}

function AppHeader({ id, flow }: { id: ScreenId; flow: FlowControls }) {
  const { bookingStep, title } = screenMeta[id];
  return (
    <div className="app-header">
      <button className="icon-button" onClick={flow.pop} aria-label="返回">
        <ChevronLeftIcon />
      </button>
      <div className="app-header-title">
        <strong>{title}</strong>
        {bookingStep ? <span>预约步骤 {bookingStep}/5</span> : null}
      </div>
      <span className="header-spacer" />
      {bookingStep ? (
        <div className="step-track" aria-label={`预约进度 ${bookingStep}/5`}>
          <span style={{ width: `${bookingStep * 20}%` }} />
        </div>
      ) : null}
    </div>
  );
}

function BottomTabs({ active, flow }: { active: ScreenId; flow: FlowControls }) {
  const tabs: { id: ScreenId; label: string; icon: ReactNode; unread?: boolean }[] = [
    { id: "home", label: "首页", icon: <HomeIcon /> },
    { id: "records", label: "预约记录", icon: <CalendarIcon /> },
    { id: "messages", label: "消息", icon: <BellIcon />, unread: true },
    { id: "profile", label: "我的", icon: <PersonIcon /> },
  ];
  return (
    <nav className="bottom-tabs" aria-label="主导航">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          className={active === tab.id ? "active" : ""}
          onClick={() => flow.replace(makeScreen(tab.id))}
        >
          <span className="tab-icon">
            {tab.icon}
            {tab.unread ? <i aria-label="有未读消息" /> : null}
          </span>
          <span>{tab.label}</span>
        </button>
      ))}
    </nav>
  );
}

function ScreenContent({ id, flow }: { id: ScreenId; flow: FlowControls }) {
  switch (id) {
    case "home":
      return <HomeScreen flow={flow} />;
    case "services":
      return <ServicesScreen />;
    case "pets":
      return <PetsScreen flow={flow} />;
    case "pet-form":
      return <PetFormScreen flow={flow} />;
    case "privacy":
      return <PrivacyScreen flow={flow} />;
    case "booking-pet":
      return <BookingPetScreen flow={flow} />;
    case "booking-service":
      return <BookingServiceScreen />;
    case "booking-staff":
      return <BookingStaffScreen />;
    case "booking-time":
      return <BookingTimeScreen flow={flow} />;
    case "booking-confirm":
      return <BookingConfirmScreen />;
    case "booking-success":
      return <BookingSuccessScreen flow={flow} />;
    case "booking-conflict":
      return <BookingConflictScreen flow={flow} />;
    case "records":
      return <RecordsScreen flow={flow} />;
    case "appointment":
      return <AppointmentScreen flow={flow} />;
    case "reschedule":
      return <RescheduleScreen flow={flow} />;
    case "messages":
      return <MessagesScreen flow={flow} />;
    case "profile":
      return <ProfileScreen flow={flow} />;
    case "data-rights":
      return <DataRightsScreen />;
  }
}

function MobilePage({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <MobileScroll className={`app-screen ${className}`}>
      <main className="page-content">{children}</main>
    </MobileScroll>
  );
}

function HomeScreen({ flow }: { flow: FlowControls }) {
  const { appointmentState } = useAppState();
  return (
    <MobilePage className="home-screen">
      <section className="home-hero">
        <img src="/assets/brand/rongguang-hero-shiba.png" alt="晨光中的柴犬团子" />
        <div className="hero-content">
          <div className="brand-row">
            <div className="brand-lockup">
              <b>茸光</b>
              <span>宠物洗护</span>
            </div>
            <button className="identity-link" onClick={() => flow.push(makeScreen("profile"))}>
              演示顾客 · 许岚 <ChevronRightIcon />
            </button>
          </div>
          <div className="store-open">
            <span>今日营业 · 09:30–19:00</span>
            <strong>8月13日 周四</strong>
          </div>
          <button className="primary hero-cta" onClick={() => flow.push(makeScreen("booking-pet"))}>
            为宠物预约洗护 <ChevronRightIcon />
          </button>
        </div>
      </section>

      {appointmentState === "confirmed" ? (
        <section className="next-appointment surface">
          <div className="section-kicker">
            <span><CalendarIcon /> 下次预约</span>
            <StatusTag>已确认</StatusTag>
          </div>
          <div className="appointment-time"><ClockIcon /> 今天&nbsp; 11:00–12:15</div>
          <div className="appointment-main">
            <img className="pet-avatar" src="/assets/brand/pet-tuanzi-shiba.png" alt="团子" />
            <div>
              <strong>团子</strong>
              <span>犬基础洗护 + 修甲护理</span>
              <small><PersonIcon /> 赵航</small>
            </div>
            <button className="text-link" onClick={() => flow.push(makeScreen("appointment"))}>
              查看详情 <ChevronRightIcon />
            </button>
          </div>
        </section>
      ) : (
        <section className="empty-inline surface">
          <CalendarIcon />
          <div><strong>近期没有预约</strong><span>选好服务后，我们会立即为你确认员工。</span></div>
        </section>
      )}

      <section className="services-preview">
        <div className="section-heading">
          <h2>洗护服务</h2>
          <button className="text-link" onClick={() => flow.push(makeScreen("services"))}>更多服务 <ChevronRightIcon /></button>
        </div>
        <div className="service-pair">
          <button onClick={() => flow.push(makeScreen("services"))}>
            <img src="/assets/brand/pet-tuanzi-shiba.png" alt="柴犬" />
            <span><b>犬基础洗护</b><strong>¥128 <small>起</small></strong></span>
          </button>
          <button onClick={() => flow.push(makeScreen("services"))}>
            <img src="/assets/brand/pet-bohe-british-shorthair.png" alt="英国短毛猫" />
            <span><b>猫咪洗护</b><strong>¥168 <small>起</small></strong></span>
          </button>
        </div>
      </section>

      <section className="trust-row" aria-label="门店承诺">
        <span><PersonIcon />确定员工</span>
        <span><ReaderIcon />价格透明</span>
        <span><CheckCircledIcon />到店核销</span>
      </section>
    </MobilePage>
  );
}

function ServicesScreen() {
  const [selected, setSelected] = useState("犬基础洗护");
  const services = [
    { name: "犬基础洗护", price: "¥128 起", time: "60–120 分钟", pet: "适合犬类", image: "/assets/brand/pet-tuanzi-shiba.png" },
    { name: "犬造型美容", price: "¥268 起", time: "120–180 分钟", pet: "适合犬类", image: "/assets/brand/pet-lizi-golden.png" },
    { name: "猫咪洗护", price: "¥168 起", time: "90 分钟", pet: "适合猫咪", image: "/assets/brand/pet-bohe-british-shorthair.png" },
  ];
  return (
    <MobilePage>
      <p className="page-intro">价格与时长会根据宠物种类和体重确定，预约时可看到最终规格。</p>
      <div className="segmented" role="tablist">
        <button className={selected !== "猫咪洗护" ? "active" : ""} onClick={() => setSelected("犬基础洗护")}>犬类</button>
        <button className={selected === "猫咪洗护" ? "active" : ""} onClick={() => setSelected("猫咪洗护")}>猫咪</button>
      </div>
      <section className="stack-list">
        {services.filter((service) => selected === "猫咪洗护" ? service.name === "猫咪洗护" : service.name !== "猫咪洗护").map((service) => (
          <article className="service-card" key={service.name}>
            <img src={service.image} alt={service.name} />
            <div>
              <span className="eyebrow">{service.pet}</span>
              <h2>{service.name}</h2>
              <p>{service.time} · 含 15 分钟门店周转</p>
              <strong>{service.price}</strong>
            </div>
          </article>
        ))}
      </section>
      <section className="info-band"><InfoCircledIcon /> 主要服务由同一员工连续完成；兼容增项会在预约中展示。</section>
    </MobilePage>
  );
}

function PetsScreen({ flow }: { flow: FlowControls }) {
  return (
    <MobilePage>
      <div className="section-heading compact-heading">
        <div><span className="eyebrow">在用 · 2</span><h1>我的宠物</h1></div>
        <button className="secondary small-button" onClick={() => flow.push(makeScreen("pet-form"))}><PlusIcon /> 新增</button>
      </div>
      <section className="pet-list">
        <PetRow image="/assets/brand/pet-tuanzi-shiba.png" name="团子" meta="柴犬 · 8.4kg · 小型" tag="怕吹风" note="今天 11:00 有预约" onClick={() => flow.push(makeScreen("pet-form"))} />
        <PetRow image="/assets/brand/pet-bohe-british-shorthair.png" name="薄荷" meta="英短 · 4.8kg · 小型" tag="对陌生犬敏感" onClick={() => flow.push(makeScreen("pet-form"))} />
      </section>
      <details className="archive-group">
        <summary>已归档 · 1</summary>
        <p>已归档宠物不会出现在预约选择中。</p>
      </details>
    </MobilePage>
  );
}

function PetRow({ image, name, meta, tag, note, onClick }: { image: string; name: string; meta: string; tag: string; note?: string; onClick: () => void }) {
  return (
    <button className="pet-row" onClick={onClick}>
      <img src={image} alt={name} />
      <span>
        <strong>{name}</strong>
        <small>{meta}</small>
        <i>{tag}</i>
        {note ? <em>{note}</em> : null}
      </span>
      <ChevronRightIcon />
    </button>
  );
}

function PetFormScreen({ flow }: { flow: FlowControls }) {
  const [weight, setWeight] = useState("8.4");
  const [saved, setSaved] = useState(false);
  return (
    <MobilePage>
      {saved ? <Toast>宠物档案已保存</Toast> : null}
      <section className="profile-photo-editor">
        <img src="/assets/brand/pet-tuanzi-shiba.png" alt="团子" />
        <button><Pencil1Icon /> 更换照片</button>
      </section>
      <FormSection title="基础资料">
        <Field label="宠物名称" value="团子" />
        <ChoiceField label="种类" options={["犬", "猫"]} selected="犬" />
        <label className="field-group">
          <span>当前体重 <b>必填</b></span>
          <div className="unit-field"><KeyboardInput value={weight} onChange={(event) => setWeight(event.target.value)} inputMode="decimal" /><i>kg</i></div>
          <small>{weight || "0"}kg · 小型 <span>体型将影响服务规格</span></small>
        </label>
      </FormSection>
      <FormSection title="更多资料">
        <Field label="品种" value="柴犬" />
        <ChoiceField label="性别" options={["公", "母", "未知"]} selected="公" />
        <Field label="出生日期" value="2021-05-18" />
      </FormSection>
      <FormSection title="护理信息">
        <ChoiceField label="护理标签" options={["怕吹风", "皮肤敏感", "不喜剪甲"]} selected="怕吹风" />
        <label className="field-group"><span>护理注意事项</span><KeyboardTextarea defaultValue="吹风时请从低档开始，靠近耳朵时动作轻一些。" rows={3} /></label>
      </FormSection>
      <button className="primary full-button" onClick={() => { setSaved(true); window.setTimeout(() => flow.pop(), 500); }}>保存宠物档案</button>
      <section className="danger-zone">
        <strong>归档宠物</strong>
        <p>团子在今天 11:00 有未来预约，当前无法归档。</p>
        <button disabled><ArchiveIcon /> 归档团子</button>
      </section>
    </MobilePage>
  );
}

function PrivacyScreen({ flow }: { flow: FlowControls }) {
  const { privacyAccepted, setPrivacyAccepted } = useAppState();
  return (
    <MobilePage>
      <section className="document-hero"><LockClosedIcon /><h1>请确认隐私说明</h1><p>我们只使用完成预约与宠物洗护所需的信息。</p></section>
      <section className="document-body">
        <dl><div><dt>当前版本</dt><dd>2026.08 · 预约页面</dd></div><div><dt>信息范围</dt><dd>顾客资料、宠物档案、预约记录</dd></div><div><dt>保留方式</dt><dd>历史服务事实匿名保留，联系方式可删除</dd></div></dl>
        <button className="document-link">查看完整隐私说明 <ChevronRightIcon /></button>
      </section>
      <label className="consent-check"><input type="checkbox" checked={privacyAccepted} onChange={(event) => setPrivacyAccepted(event.target.checked)} /><span>我已阅读并同意《隐私说明》</span></label>
      <button className="primary full-button" disabled={!privacyAccepted} onClick={flow.pop}>同意并继续</button>
    </MobilePage>
  );
}

function BookingPetScreen({ flow }: { flow: FlowControls }) {
  const { selectedPet, setSelectedPet } = useAppState();
  return (
    <MobilePage>
      <QuestionLead number="01" title="这次为谁预约？" body="请选择一只在用宠物，后续服务会按种类与体重匹配。" />
      <section className="selection-list">
        <SelectionCard selected={selectedPet === "团子"} onClick={() => setSelectedPet("团子")} image="/assets/brand/pet-tuanzi-shiba.png" title="团子" meta="柴犬 · 8.4kg · 小型" detail="护理标签：怕吹风" />
        <SelectionCard selected={selectedPet === "薄荷"} onClick={() => setSelectedPet("薄荷")} image="/assets/brand/pet-bohe-british-shorthair.png" title="薄荷" meta="英短 · 4.8kg · 小型" detail="护理标签：对陌生犬敏感" />
      </section>
      <button className="add-row" onClick={() => flow.push(makeScreen("pet-form"))}><PlusIcon /> 新增宠物档案 <ChevronRightIcon /></button>
    </MobilePage>
  );
}

function BookingServiceScreen() {
  const { selectedAddons, toggleAddon } = useAppState();
  return (
    <MobilePage>
      <QuestionLead number="02" title="选择主要服务与增项" body="团子的体重已匹配为小型，价格与时长现在即可确定。" />
      <section className="selected-service">
        <div className="service-title-row"><span><CheckCircledIcon /></span><div><small>已匹配服务规格</small><h2>犬基础洗护｜小型</h2></div></div>
        <div className="service-facts"><span><b>¥128</b> 价格</span><span><b>60 分钟</b> 服务时长</span></div>
        <p>洗护、基础梳理、耳部与眼周清洁。</p>
      </section>
      <section>
        <div className="section-heading compact-heading"><h2>可选增项</h2><span className="muted">同一员工连续完成</span></div>
        <div className="addon-list">
          <Addon title="修甲护理" meta="+¥30 · +15 分钟" checked={selectedAddons.includes("修甲护理")} onChange={() => toggleAddon("修甲护理")} />
          <Addon title="除废毛护理" meta="+¥48 · +30 分钟" checked={selectedAddons.includes("除废毛护理")} onChange={() => toggleAddon("除废毛护理")} />
          <Addon title="口腔清洁" meta="+¥25 · +15 分钟" checked={selectedAddons.includes("口腔清洁")} onChange={() => toggleAddon("口腔清洁")} />
        </div>
      </section>
    </MobilePage>
  );
}

function BookingStaffScreen() {
  const { staffPreference, setStaffPreference } = useAppState();
  const options: { id: "最快可约" | "赵航" | "林夏"; image?: string; title: string; meta: string; detail: string }[] = [
    { id: "最快可约", title: "最快可约", meta: "选择时段后确定具体员工", detail: "优先展示本次服务最早可用的安排" },
    { id: "赵航", image: "/assets/brand/staff-zhaohang.png", title: "赵航", meta: "本次服务全部可完成", detail: "最近可约 · 今天 11:00" },
    { id: "林夏", image: "/assets/brand/staff-linxia.png", title: "林夏", meta: "本次服务全部可完成", detail: "最近可约 · 周六 10:00" },
  ];
  return (
    <MobilePage>
      <QuestionLead number="03" title="有偏好的员工吗？" body="指定员工可能影响可约时间；选择最快可约也会为你确定具体员工。" />
      <section className="selection-list">
        {options.map((option) => (
          <SelectionCard key={option.id} selected={staffPreference === option.id} onClick={() => setStaffPreference(option.id)} image={option.image} icon={!option.image ? <ClockIcon /> : undefined} title={option.title} meta={option.meta} detail={option.detail} />
        ))}
      </section>
    </MobilePage>
  );
}

function BookingTimeScreen({ flow }: { flow: FlowControls }) {
  const { selectedDate, setSelectedDate, selectedTime, setSelectedTime } = useAppState();
  return (
    <MobilePage>
      <QuestionLead number="04" title="选择日期与开始时间" body="时段已考虑员工技能、服务时长和门店周转。" />
      <Carousel ariaLabel="未来 14 天" className="date-carousel" contentClassName="date-track">
        {dates.map((item) => (
          <button key={item.value} disabled={item.disabled} className={selectedDate === item.value ? "active" : ""} onClick={() => setSelectedDate(item.value)}>
            <small>{item.short}</small><b>{item.date}</b><span>{item.day}</span>
          </button>
        ))}
      </Carousel>
      <div className="availability-note"><span className="open-dot" /> {selectedDate} · 可约 6 个时段</div>
      <section className="time-grid">
        {timeSlots.map((time) => (
          <button
            key={time}
            className={selectedTime === time ? "active" : ""}
            onClick={() => {
              setSelectedTime(time);
              if (time === "16:30") flow.push(makeScreen("booking-conflict"));
            }}
          >
            <b>{time}</b><span>{time === "11:00" ? "赵航" : time === "16:30" ? "刚刚约满" : "最快可约"}</span>
          </button>
        ))}
      </section>
      <section className="info-band"><InfoCircledIcon /> 周一闭店。灰色日期暂无可约时段；选择后仍会在提交时再次确认。</section>
    </MobilePage>
  );
}

function BookingConfirmScreen() {
  const { selectedAddons, staffPreference, selectedDate, selectedTime, privacyAccepted } = useAppState();
  const endTime = selectedTime === "11:00" ? "12:15" : "17:45";
  return (
    <MobilePage>
      <QuestionLead number="05" title="确认本次预约" body="提交成功后将立即确认并分配具体员工。" />
      <section className="confirm-sheet">
        <ConfirmRow label="宠物" value="团子 · 柴犬 · 小型" image="/assets/brand/pet-tuanzi-shiba.png" />
        <ConfirmRow label="服务" value={`犬基础洗护${selectedAddons.length ? ` + ${selectedAddons.join(" + ")}` : ""}`} detail="75 分钟" />
        <ConfirmRow label="员工" value={staffPreference === "最快可约" ? "提交后确定" : staffPreference} />
        <ConfirmRow label="时间" value={`${selectedDate}  ${selectedTime}–${endTime}`} detail="门店另预留 15 分钟交接，不计入服务时长" />
        <ConfirmRow label="价格" value="¥158" emphasis />
      </section>
      <section className={`consent-summary ${privacyAccepted ? "ok" : "warning"}`}>
        {privacyAccepted ? <CheckCircledIcon /> : <ExclamationTriangleIcon />}
        <span><strong>{privacyAccepted ? "隐私同意已确认" : "需要确认隐私说明"}</strong><small>当前版本 2026.08</small></span>
      </section>
      <p className="submission-note">点击确认表示你已核对宠物、服务、员工偏好与时间。预约创建成功后立即占用该时段。</p>
    </MobilePage>
  );
}

function BookingSuccessScreen({ flow }: { flow: FlowControls }) {
  return (
    <MobilePage className="success-screen">
      <section className="success-hero"><CheckCircledIcon /><span>预约已确认</span><h1>团子的洗护安排好了</h1><p>具体员工与核销码已经生成，可在预约详情中随时查看。</p></section>
      <section className="success-ticket">
        <div><img src="/assets/brand/pet-tuanzi-shiba.png" alt="团子" /><span><small>8月13日 周四</small><strong>11:00–12:15</strong></span></div>
        <dl><div><dt>服务</dt><dd>犬基础洗护 + 修甲护理</dd></div><div><dt>员工</dt><dd>赵航</dd></div><div><dt>价格</dt><dd>¥158</dd></div></dl>
      </section>
      <button className="primary full-button" onClick={() => flow.replace(makeScreen("appointment"))}>查看预约详情</button>
      <button className="secondary full-button" onClick={() => flow.replace(makeScreen("home"))}>返回首页</button>
    </MobilePage>
  );
}

function BookingConflictScreen({ flow }: { flow: FlowControls }) {
  const { setSelectedDate, setSelectedTime } = useAppState();
  const suggestions = [
    ["今天", "17:30–18:45", "赵航"],
    ["8月14日 周五", "10:00–11:15", "赵航"],
    ["8月14日 周五", "13:30–14:45", "林夏"],
  ];
  return (
    <MobilePage>
      <section className="conflict-alert"><ExclamationTriangleIcon /><div><h1>刚刚有人选走了这个时段</h1><p>之前填写的内容已为你保留，请选择一个相近时段。</p></div></section>
      <section className="preserved-summary"><span>团子</span><span>犬基础洗护 + 修甲护理</span><span>赵航优先</span></section>
      <h2 className="subheading">相近可约建议</h2>
      <section className="suggestion-list">
        {suggestions.map(([date, time, staff], index) => (
          <button key={`${date}${time}`} onClick={() => { setSelectedDate(date === "今天" ? "8月13日 周四" : date); setSelectedTime(time.slice(0, 5)); flow.replace(makeScreen("booking-confirm")); }}>
            <span><small>{date}</small><strong>{time}</strong><em>{staff} · 可完成全部服务</em></span>
            <i>{index === 0 ? "最近" : ""}</i><ChevronRightIcon />
          </button>
        ))}
      </section>
      <button className="secondary full-button" onClick={flow.pop}>查看其他日期</button>
    </MobilePage>
  );
}

function RecordsScreen({ flow }: { flow: FlowControls }) {
  const { appointmentState } = useAppState();
  const [tab, setTab] = useState<"未来预约" | "历史预约">("未来预约");
  return (
    <MobilePage>
      <TopLevelHeader title="预约记录" subtitle="演示时间 · 8月13日 10:50" />
      <div className="segmented" role="tablist"><button className={tab === "未来预约" ? "active" : ""} onClick={() => setTab("未来预约")}>未来预约</button><button className={tab === "历史预约" ? "active" : ""} onClick={() => setTab("历史预约")}>历史预约</button></div>
      {tab === "未来预约" ? (
        appointmentState === "confirmed" ? (
          <section className="record-list"><button className="record-card" onClick={() => flow.push(makeScreen("appointment"))}><div className="record-date"><strong>13</strong><span>8月 · 周四</span></div><div><StatusTag>已确认</StatusTag><h2>11:00–12:15</h2><p>团子 · 犬基础洗护 + 修甲护理</p><small>赵航</small></div><ChevronRightIcon /></button></section>
        ) : <EmptyState icon={<CalendarIcon />} title="未来没有预约" body="取消后的预约可在历史预约中查看。" action="开始新预约" onClick={() => flow.push(makeScreen("booking-pet"))} />
      ) : (
        <section className="record-list">
          <HistoryRecord date="8月6日" pet="团子" service="犬基础洗护" state="已完成" />
          <HistoryRecord date="7月18日" pet="薄荷" service="猫咪洗护" state="已完成" />
          {appointmentState === "cancelled" ? <HistoryRecord date="8月13日" pet="团子" service="犬基础洗护 + 修甲护理" state="已取消" /> : null}
        </section>
      )}
    </MobilePage>
  );
}

function AppointmentScreen({ flow }: { flow: FlowControls }) {
  const { appointmentState, setAppointmentState } = useAppState();
  const [cancelOpen, setCancelOpen] = useState(false);
  return (
    <MobilePage>
      <section className="appointment-status">
        <StatusTag tone={appointmentState === "cancelled" ? "neutral" : "info"}>{appointmentState === "cancelled" ? "已取消" : "已确认"}</StatusTag>
        <h1>{appointmentState === "cancelled" ? "本次预约已取消" : "到店时请出示核销码"}</h1>
        <p>{appointmentState === "cancelled" ? "该时段已释放，可重新创建预约。" : "可在开始前 30 分钟至开始后 15 分钟内出示"}</p>
      </section>
      {appointmentState !== "cancelled" ? <section className="check-code"><small>六位核销码</small><strong>7 2 9 4 1 6</strong><span>今天 10:30–11:15 有效</span></section> : null}
      <section className="detail-group">
        <ConfirmRow label="宠物" value="团子 · 柴犬 · 小型" image="/assets/brand/pet-tuanzi-shiba.png" />
        <ConfirmRow label="服务" value="犬基础洗护 + 修甲护理" detail="价格快照 ¥158 · 75 分钟" />
        <ConfirmRow label="员工" value="赵航" image="/assets/brand/staff-zhaohang.png" />
        <ConfirmRow label="计划时间" value="8月13日 周四  11:00–12:15" />
      </section>
      {appointmentState === "confirmed" ? (
        <section className="action-stack">
          <button className="primary full-button" onClick={() => flow.push(makeScreen("reschedule"))}>改期</button>
          <button className="danger-link" onClick={() => setCancelOpen(true)}>取消预约</button>
          <p>开始前至少 12 小时可自行改期或取消；当前为演示时间，可继续操作。</p>
        </section>
      ) : <button className="primary full-button" onClick={() => flow.replace(makeScreen("booking-pet"))}>重新预约</button>}
      <BottomSheet open={cancelOpen} onOpenChange={setCancelOpen} title="取消团子的预约？" description="取消后将释放 8月13日 11:00 的时段，原核销码立即失效。">
        <label className="field-group"><span>取消原因</span><select defaultValue="行程变化"><option>行程变化</option><option>宠物临时不适</option><option>其他</option></select></label>
        <button className="danger-button full-button" onClick={() => { setAppointmentState("cancelled"); setCancelOpen(false); }}>确认取消预约</button>
        <button className="secondary full-button" onClick={() => setCancelOpen(false)}>保留预约</button>
      </BottomSheet>
    </MobilePage>
  );
}

function RescheduleScreen({ flow }: { flow: FlowControls }) {
  const [chosen, setChosen] = useState("8月14日 周五 · 10:00–11:15");
  const [done, setDone] = useState(false);
  if (done) {
    return <MobilePage><section className="success-hero compact-success"><CheckCircledIcon /><span>改期成功</span><h1>新的安排已确认</h1></section><section className="compare-card"><div><small>原安排</small><s>8月13日 周四<br />11:00–12:15 · 赵航</s></div><ChevronRightIcon /><div><small>新安排</small><strong>{chosen}<br />赵航</strong></div></section><section className="info-band"><InfoCircledIcon /> 核销码已更新，旧核销码不再有效。</section><button className="primary full-button" onClick={() => flow.replace(makeScreen("appointment"))}>查看新预约</button></MobilePage>;
  }
  return (
    <MobilePage>
      <section className="original-arrangement"><small>当前安排持续有效，直到改期成功</small><strong>8月13日 周四 · 11:00–12:15</strong><span>赵航 · 团子</span></section>
      <QuestionLead number="" title="选择新安排" body="宠物、服务与价格保持不变。" />
      <section className="selection-list compact-selection">
        {["8月14日 周五 · 10:00–11:15", "8月14日 周五 · 13:30–14:45", "8月15日 周六 · 10:00–11:15"].map((item) => <button key={item} className={`time-option ${chosen === item ? "selected" : ""}`} onClick={() => setChosen(item)}><span><strong>{item}</strong><small>赵航 · 可完成全部服务</small></span><CheckCircledIcon /></button>)}
      </section>
      <button className="primary full-button" onClick={() => setDone(true)}>确认新安排</button>
      <button className="secondary full-button" onClick={flow.pop}>保留原安排</button>
    </MobilePage>
  );
}

function MessagesScreen({ flow }: { flow: FlowControls }) {
  return (
    <MobilePage>
      <TopLevelHeader title="消息" subtitle="模拟消息 · 不会真实发送微信通知" />
      <section className="notice-band"><InfoCircledIcon /> 以下内容用于演示确认、改期、取消与开始前提醒。</section>
      <section className="message-list">
        <button onClick={() => flow.push(makeScreen("appointment"))}><span className="message-icon unread"><CheckCircledIcon /></span><div><span><strong>预约已确认</strong><time>10:42</time></span><p>团子的犬基础洗护已确认，员工为赵航。</p><small>查看预约</small></div></button>
        <button onClick={() => flow.push(makeScreen("appointment"))}><span className="message-icon"><BellIcon /></span><div><span><strong>到店提醒</strong><time>昨天</time></span><p>团子的预约将在明天 11:00 开始。</p><small>查看核销码</small></div></button>
        <button><span className="message-icon"><ReaderIcon /></span><div><span><strong>隐私说明已更新</strong><time>8月1日</time></span><p>查看当前隐私说明版本与数据使用范围。</p></div></button>
      </section>
    </MobilePage>
  );
}

function ProfileScreen({ flow }: { flow: FlowControls }) {
  return (
    <MobilePage>
      <section className="profile-hero"><div className="customer-avatar">许</div><div><small>演示顾客</small><h1>许岚</h1><span>138****2608</span></div><button><ChevronRightIcon /></button></section>
      <section className="demo-banner"><InfoCircledIcon /><span><strong>演示身份</strong><small>可切换预置顾客查看不同数据</small></span><button>切换</button></section>
      <MenuGroup title="宠物与预约">
        <MenuRow icon={<HeartIcon />} title="宠物档案" detail="2 只在用" onClick={() => flow.push(makeScreen("pets"))} />
        <MenuRow icon={<CalendarIcon />} title="预约记录" onClick={() => flow.replace(makeScreen("records"))} />
      </MenuGroup>
      <MenuGroup title="资料与隐私">
        <MenuRow icon={<PersonIcon />} title="顾客资料" detail="手机号、姓名" onClick={() => flow.push(makeScreen("pet-form"))} />
        <MenuRow icon={<LockClosedIcon />} title="隐私同意" detail="当前版本 2026.08" onClick={() => flow.push(makeScreen("privacy"))} />
        <MenuRow icon={<GearIcon />} title="数据与隐私" detail="导出、资料删除" onClick={() => flow.push(makeScreen("data-rights"))} />
      </MenuGroup>
      <section className="store-card"><SewingPinIcon /><span><strong>茸光宠物洗护</strong><small>上海市徐汇区暖茸路 18 号</small><small>周二至周日 09:30–19:00</small></span></section>
    </MobilePage>
  );
}

function DataRightsScreen() {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [finalDeleteOpen, setFinalDeleteOpen] = useState(false);
  const [exported, setExported] = useState(false);
  return (
    <MobilePage>
      {exported ? <Toast>数据文件已在本地演示中生成</Toast> : null}
      <section className="document-hero compact-document"><LockClosedIcon /><h1>管理你的数据</h1><p>导出当前资料，或申请删除可识别的顾客资料。</p></section>
      <section className="rights-list">
        <button onClick={() => setExported(true)}><DownloadIcon /><span><strong>导出我的数据</strong><small>顾客资料、宠物档案与预约记录</small></span><ChevronRightIcon /></button>
        <button className="danger-row" onClick={() => setDeleteOpen(true)}><TrashIcon /><span><strong>删除顾客资料</strong><small>历史服务事实将匿名保留</small></span><ChevronRightIcon /></button>
      </section>
      <section className="blocking-note"><ExclamationTriangleIcon /><div><strong>删除前需先处理未来预约</strong><p>团子在 8月13日 11:00 有一笔已确认预约。取消或完成后才能删除资料。</p></div></section>
      <BottomSheet open={deleteOpen} onOpenChange={setDeleteOpen} title="暂时无法删除资料" description="仍有 1 笔未来预约。你可以先前往预约详情处理。">
        <button className="secondary full-button" onClick={() => { setDeleteOpen(false); setFinalDeleteOpen(true); }}>查看匿名保留说明</button>
        <button className="primary full-button" onClick={() => setDeleteOpen(false)}>知道了</button>
      </BottomSheet>
      <BottomSheet open={finalDeleteOpen} onOpenChange={setFinalDeleteOpen} title="资料删除后会发生什么？" description="姓名与手机号将删除，历史预约与门店服务记录会去除身份信息后保留用于审计。">
        <button className="secondary full-button" onClick={() => setFinalDeleteOpen(false)}>返回</button>
      </BottomSheet>
    </MobilePage>
  );
}

function BookingFooter({ id, flow }: { id: ScreenId; flow: FlowControls }) {
  const { selectedAddons, privacyAccepted } = useAppState();
  const price = 128 + (selectedAddons.includes("修甲护理") ? 30 : 0) + (selectedAddons.includes("除废毛护理") ? 48 : 0) + (selectedAddons.includes("口腔清洁") ? 25 : 0);
  const duration = 60 + (selectedAddons.includes("修甲护理") ? 15 : 0) + (selectedAddons.includes("除废毛护理") ? 30 : 0) + (selectedAddons.includes("口腔清洁") ? 15 : 0);
  const next: Partial<Record<ScreenId, ScreenId>> = {
    "booking-pet": "booking-service",
    "booking-service": "booking-staff",
    "booking-staff": "booking-time",
    "booking-time": "booking-confirm",
    "booking-confirm": "booking-success",
  };
  const disabled = id === "booking-confirm" && !privacyAccepted;
  return (
    <div className="booking-footer">
      <div><small>当前合计</small><span><strong>¥{price}</strong> · {duration} 分钟</span></div>
      <button className="primary" disabled={disabled} onClick={() => next[id] && flow.push(makeScreen(next[id]!))}>{id === "booking-confirm" ? "确认预约" : "继续"}</button>
    </div>
  );
}

function TopLevelHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return <header className="top-level-header"><div><div className="mini-brand">茸光</div><h1>{title}</h1><p>{subtitle}</p></div><button className="identity-pill"><PersonIcon /> 许岚</button></header>;
}

function QuestionLead({ number, title, body }: { number: string; title: string; body: string }) {
  return <section className="question-lead">{number ? <span>{number}</span> : null}<h1>{title}</h1><p>{body}</p></section>;
}

function StatusTag({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "neutral" }) {
  return <span className={`status-tag ${tone}`}>{children}</span>;
}

function SelectionCard({ selected, onClick, image, icon, title, meta, detail }: { selected: boolean; onClick: () => void; image?: string; icon?: ReactNode; title: string; meta: string; detail: string }) {
  return <button className={`selection-card ${selected ? "selected" : ""}`} onClick={onClick}>{image ? <img src={image} alt={title} /> : <span className="selection-icon">{icon}</span>}<span><strong>{title}</strong><small>{meta}</small><em>{detail}</em></span><CheckCircledIcon className="selection-check" /></button>;
}

function Addon({ title, meta, checked, onChange }: { title: string; meta: string; checked: boolean; onChange: () => void }) {
  return <label className="addon-row"><input type="checkbox" checked={checked} onChange={onChange} /><span><strong>{title}</strong><small>{meta}</small></span></label>;
}

function ConfirmRow({ label, value, detail, image, emphasis }: { label: string; value: string; detail?: string; image?: string; emphasis?: boolean }) {
  return <div className={`confirm-row ${emphasis ? "emphasis" : ""}`}><span>{label}</span>{image ? <img src={image} alt="" /> : null}<div><strong>{value}</strong>{detail ? <small>{detail}</small> : null}</div></div>;
}

function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return <section className="form-section"><h2>{title}</h2>{children}</section>;
}

function Field({ label, value }: { label: string; value: string }) {
  return <label className="field-group"><span>{label}</span><KeyboardInput defaultValue={value} /></label>;
}

function ChoiceField({ label, options, selected }: { label: string; options: string[]; selected: string }) {
  const [value, setValue] = useState(selected);
  return <div className="field-group"><span>{label}</span><div className="choice-row">{options.map((option) => <button key={option} className={value === option ? "active" : ""} onClick={() => setValue(option)}>{option}</button>)}</div></div>;
}

function MenuGroup({ title, children }: { title: string; children: ReactNode }) {
  return <section className="menu-group"><h2>{title}</h2><div>{children}</div></section>;
}

function MenuRow({ icon, title, detail, onClick }: { icon: ReactNode; title: string; detail?: string; onClick: () => void }) {
  return <button onClick={onClick}><span className="menu-icon">{icon}</span><strong>{title}</strong>{detail ? <small>{detail}</small> : null}<ChevronRightIcon /></button>;
}

function HistoryRecord({ date, pet, service, state }: { date: string; pet: string; service: string; state: string }) {
  return <article className="history-row"><span>{date}</span><div><strong>{pet} · {service}</strong><small>赵航 · ¥158（服务标价）</small></div><StatusTag tone={state === "已取消" ? "neutral" : "info"}>{state}</StatusTag></article>;
}

function EmptyState({ icon, title, body, action, onClick }: { icon: ReactNode; title: string; body: string; action: string; onClick: () => void }) {
  return <section className="empty-state"><span>{icon}</span><h2>{title}</h2><p>{body}</p><button className="primary" onClick={onClick}>{action}</button></section>;
}

function Toast({ children }: { children: ReactNode }) {
  return <div className="toast"><CheckCircledIcon /> {children}</div>;
}
