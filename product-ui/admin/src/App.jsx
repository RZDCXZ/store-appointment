import { useEffect, useMemo, useState } from "react";
import {
  AvatarIcon,
  BarChartIcon,
  BellIcon,
  CalendarIcon,
  CheckCircledIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  Cross2Icon,
  CrossCircledIcon,
  DashboardIcon,
  DownloadIcon,
  ExclamationTriangleIcon,
  FileTextIcon,
  GearIcon,
  HomeIcon,
  InfoCircledIcon,
  LockClosedIcon,
  MagnifyingGlassIcon,
  MixIcon,
  MobileIcon,
  Pencil2Icon,
  PersonIcon,
  PlusIcon,
  ReloadIcon,
  RowsIcon,
  SewingPinIcon,
  StopwatchIcon,
} from "@radix-ui/react-icons";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const ASSET = "/assets/brand/";

const staff = [
  {
    id: "lin",
    name: "林夏",
    role: "犬猫美容师",
    avatar: `${ASSET}staff-linxia.png`,
    load: "6/8",
    shift: "09:30–18:00",
  },
  {
    id: "chen",
    name: "陈嘉",
    role: "洗护师",
    avatar: `${ASSET}staff-chenjia.png`,
    load: "5/8",
    shift: "09:30–19:00",
  },
  {
    id: "zhou",
    name: "周宁",
    role: "猫咪护理师",
    avatar: `${ASSET}staff-zhouning.png`,
    load: "4/8",
    shift: "10:00–18:30",
  },
  {
    id: "zhao",
    name: "赵航",
    role: "犬类美容师",
    avatar: `${ASSET}staff-zhaohang.png`,
    load: "2/6",
    shift: "09:30–19:00",
  },
];

const pets = {
  tuanzi: `${ASSET}pet-tuanzi-shiba.png`,
  bohe: `${ASSET}pet-bohe-british-shorthair.png`,
  lizi: `${ASSET}pet-lizi-golden.png`,
};

const bookings = [
  {
    id: "RG-0813-026",
    pet: "栗子",
    petImage: pets.lizi,
    customer: "陆遥",
    service: "犬基础洗护",
    extras: "—",
    staff: "林夏",
    time: "09:30–10:45",
    price: "¥198",
    status: "已确认",
    action: "迟到待处理",
    tone: "late",
  },
  {
    id: "RG-0813-031",
    pet: "薄荷",
    petImage: pets.bohe,
    customer: "程墨",
    service: "猫咪洗护",
    extras: "—",
    staff: "陈嘉",
    time: "10:30–12:00",
    price: "¥168",
    status: "已到店",
    action: "待完成",
    tone: "arrived",
  },
  {
    id: "RG-0813-034",
    pet: "团子",
    petImage: pets.tuanzi,
    customer: "许岚",
    service: "犬基础洗护",
    extras: "修甲护理",
    staff: "赵航",
    time: "11:00–12:15",
    price: "¥158",
    status: "已确认",
    action: "待核销",
    tone: "confirmed",
  },
  {
    id: "RG-0813-039",
    pet: "豆豆",
    petImage: pets.bohe,
    customer: "宋瑶",
    service: "猫咪洗护",
    extras: "除废毛护理",
    staff: "周宁",
    time: "13:00–14:30",
    price: "¥218",
    status: "已确认",
    action: "待核销",
    tone: "confirmed",
  },
  {
    id: "RG-0813-043",
    pet: "花花",
    petImage: pets.tuanzi,
    customer: "顾言",
    service: "犬造型美容",
    extras: "修甲护理",
    staff: "林夏",
    time: "15:30–17:00",
    price: "¥268",
    status: "已确认",
    action: "稍后开始",
    tone: "confirmed",
  },
];

const managerNav = [
  ["workbench", "工作台", DashboardIcon],
  ["appointments", "预约", CalendarIcon],
  ["schedule", "排班", RowsIcon],
  ["services", "服务", MixIcon],
  ["customers", "顾客", PersonIcon],
  ["business", "经营", BarChartIcon],
  ["system", "系统", GearIcon],
];

const staffNav = [
  ["today", "今日工作", HomeIcon],
  ["mine", "我的预约", CalendarIcon],
];

const pageTitles = {
  workbench: ["今日工作台", "风险、状态与员工日时间线"],
  appointments: ["预约", "查看、创建和调整门店预约"],
  schedule: ["排班", "模板、草稿、已发布容量与日期例外"],
  services: ["服务与员工", "服务规格、增项和员工技能"],
  customers: ["顾客与宠物", "档案、历史服务记录与数据导出"],
  business: ["经营", "经营事实、周期对比与指标定义"],
  system: ["系统", "通知、审计与本地演示设置"],
  today: ["我的今日工作", "下一位宠物与行动队列"],
  mine: ["我的预约", "本人预约与履约记录"],
};

function StatusTag({ children, tone = "neutral" }) {
  return <span className={`status-tag ${tone}`}>{children}</span>;
}

function IconButton({ label, children, onClick }) {
  return (
    <button
      className="icon-button"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function EmptyState({ icon: Icon = CalendarIcon, title, body, action }) {
  return (
    <div className="empty-state">
      <Icon />
      <strong>{title}</strong>
      <p>{body}</p>
      {action}
    </div>
  );
}

export function App() {
  const [loggedIn, setLoggedIn] = useState(true);
  const [role, setRole] = useState("manager");
  const [active, setActive] = useState("workbench");
  const [drawer, setDrawer] = useState(null);
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState("");
  const [mobileNav, setMobileNav] = useState(false);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const chooseRole = (nextRole) => {
    setRole(nextRole);
    setActive(nextRole === "manager" ? "workbench" : "today");
    setLoggedIn(true);
    setMobileNav(false);
    setToast(`已切换为${nextRole === "manager" ? "店长" : "员工"}演示身份`);
  };

  if (!loggedIn) return <LoginScreen onLogin={chooseRole} />;

  const nav = role === "manager" ? managerNav : staffNav;
  const [title, subtitle] = pageTitles[active] ?? pageTitles.workbench;

  const openBooking = (booking = bookings[2]) =>
    setDrawer({ type: "booking", booking });
  const notify = (message) => setToast(message);

  return (
    <div className={`admin-app role-${role}`}>
      <Sidebar
        role={role}
        nav={nav}
        active={active}
        onNavigate={(key) => {
          setActive(key);
          setMobileNav(false);
        }}
        onLogin={() => setLoggedIn(false)}
        onRole={chooseRole}
        mobileOpen={mobileNav}
      />
      <div className="app-main">
        <DemoBar
          onAdvance={() => notify("演示时间已推进 15 分钟；到期提醒已重新计算")}
        />
        <header className="topbar">
          <button
            className="mobile-menu"
            onClick={() => setMobileNav(true)}
            aria-label="打开导航"
          >
            <RowsIcon />
          </button>
          <div>
            <h1>{title}</h1>
            <p>{subtitle}</p>
          </div>
          <div className="topbar-actions">
            {role === "manager" && active === "workbench" ? (
              <span className="topbar-date">
                2026年8月13日 周四 10:50，上海时间
              </span>
            ) : (
              <label className="global-search">
                <MagnifyingGlassIcon />
                <input aria-label="搜索" placeholder="搜索预约、顾客或宠物" />
                <kbd>⌘ K</kbd>
              </label>
            )}
            <IconButton
              label="通知"
              onClick={() => {
                setActive("system");
                setToast("已打开需人工处理的通知任务");
              }}
            >
              <BellIcon />
              <i />
            </IconButton>
            <button
              className="role-switch"
              onClick={() =>
                chooseRole(role === "manager" ? "staff" : "manager")
              }
            >
              {role === "manager" ? "员工视图" : "店长视图"}
            </button>
          </div>
        </header>

        <main className={`page-shell page-${active}`}>
          {role === "manager" && active === "workbench" && (
            <Workbench
              onBooking={openBooking}
              onNavigate={setActive}
              onModal={setModal}
            />
          )}
          {role === "manager" && active === "appointments" && (
            <Appointments onBooking={openBooking} onModal={setModal} />
          )}
          {role === "manager" && active === "schedule" && (
            <Schedule onModal={setModal} />
          )}
          {role === "manager" && active === "services" && (
            <Services notify={notify} />
          )}
          {role === "manager" && active === "customers" && (
            <Customers onDrawer={setDrawer} />
          )}
          {role === "manager" && active === "business" && (
            <Business notify={notify} />
          )}
          {role === "manager" && active === "system" && (
            <System onDrawer={setDrawer} onModal={setModal} notify={notify} />
          )}
          {role === "staff" && active === "today" && (
            <StaffToday onBooking={openBooking} onModal={setModal} />
          )}
          {role === "staff" && active === "mine" && (
            <StaffAppointments onBooking={openBooking} />
          )}
        </main>
      </div>

      {drawer && (
        <Drawer
          data={drawer}
          onClose={() => setDrawer(null)}
          onModal={(name) => {
            setDrawer(null);
            setModal(name);
          }}
          notify={notify}
          role={role}
        />
      )}
      {modal && (
        <ModalFlow
          type={modal}
          onClose={() => setModal(null)}
          notify={(message) => {
            setModal(null);
            notify(message);
          }}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          <CheckCircledIcon />
          {toast}
        </div>
      )}
      {mobileNav && (
        <button
          className="nav-scrim"
          aria-label="关闭导航"
          onClick={() => setMobileNav(false)}
        />
      )}
    </div>
  );
}

function LoginScreen({ onLogin }) {
  const [selected, setSelected] = useState("manager");
  const [error, setError] = useState("");
  return (
    <main className="login-screen">
      <section className="login-brand">
        <div className="login-wordmark">
          <span>茸光</span>
          <small>宠物洗护 · 管理端</small>
        </div>
        <div className="login-copy">
          <StatusTag tone="sage">本地演示系统</StatusTag>
          <h1>
            把下一位宠物，
            <br />
            照顾得从容一些。
          </h1>
          <p>员工与店长共用的预约、履约和排班工作台。</p>
        </div>
        <img src={`${ASSET}rongguang-hero-shiba.png`} alt="晨光中的柴犬" />
      </section>
      <section className="login-panel">
        <div className="login-form">
          <div className="compact-logo">
            茸光 <span>后台</span>
          </div>
          <h2>欢迎回来</h2>
          <p className="muted">
            请选择演示身份。这里不会连接真实微信或发送真实消息。
          </p>
          <div className="role-cards" role="radiogroup" aria-label="演示身份">
            <button
              className={selected === "manager" ? "selected" : ""}
              onClick={() => setSelected("manager")}
            >
              <span className="role-icon">
                <DashboardIcon />
              </span>
              <span>
                <strong>店长 · 沈青</strong>
                <small>完整管理与经营权限</small>
              </span>
              <CheckCircledIcon />
            </button>
            <button
              className={selected === "staff" ? "selected" : ""}
              onClick={() => setSelected("staff")}
            >
              <span className="role-icon">
                <PersonIcon />
              </span>
              <span>
                <strong>员工 · 林夏</strong>
                <small>今日工作与本人预约</small>
              </span>
              <CheckCircledIcon />
            </button>
          </div>
          {error && (
            <div className="inline-error">
              <ExclamationTriangleIcon />
              {error}
            </div>
          )}
          <button
            className="primary-button login-submit"
            onClick={() =>
              selected ? onLogin(selected) : setError("请选择一个演示身份")
            }
          >
            进入管理端 <ChevronRightIcon />
          </button>
          <div className="login-note">
            <LockClosedIcon />
            <span>演示身份不会绕过界面权限；敏感信息访问仍会写入审计。</span>
          </div>
        </div>
      </section>
    </main>
  );
}

function Sidebar({
  role,
  nav,
  active,
  onNavigate,
  onLogin,
  onRole,
  mobileOpen,
}) {
  return (
    <aside className={`sidebar ${mobileOpen ? "mobile-open" : ""}`}>
      <div className="brand">
        <strong>茸光</strong>
        <span>宠物洗护</span>
      </div>
      <div className="role-label">
        {role === "manager" ? "店长后台" : "员工工作台"}
      </div>
      <nav>
        {nav.map(([key, label, Icon]) => (
          <button
            key={key}
            className={active === key ? "active" : ""}
            onClick={() => onNavigate(key)}
          >
            <Icon />
            <span>{label}</span>
            {active === key && <i />}
          </button>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <button
          className="identity-card"
          onClick={() => onRole(role === "manager" ? "staff" : "manager")}
        >
          <img
            src={
              role === "manager"
                ? `${ASSET}staff-zhouning.png`
                : `${ASSET}staff-linxia.png`
            }
            alt="当前身份头像"
          />
          <span>
            <strong>
              {role === "manager" ? "店长 · 沈青" : "员工 · 林夏"}
            </strong>
            <small>切换演示身份</small>
          </span>
          <ChevronRightIcon />
        </button>
        <button className="logout-link" onClick={onLogin}>
          返回登录页
        </button>
      </div>
    </aside>
  );
}

function DemoBar({ onAdvance }) {
  return (
    <div className="demo-bar">
      <span>
        <InfoCircledIcon />
        <strong>本地演示模式</strong>
      </span>
      <span>
        当前演示时间 <b>2026-08-13 10:50</b>（上海时间）
      </span>
      <button onClick={onAdvance}>
        <StopwatchIcon />
        推进时间 +15 分钟
      </button>
    </div>
  );
}

function Workbench({ onBooking, onNavigate, onModal }) {
  const risks = [
    {
      tone: "danger",
      icon: ExclamationTriangleIcon,
      title: "待处理停班",
      detail: "林夏，周六 14:00–18:00，影响 2 笔预约",
      action: () => onModal("impact"),
    },
    {
      tone: "warning",
      icon: BellIcon,
      title: "通知最终失败",
      detail: "预约改期通知，自动发送 3 次失败",
      action: () => onNavigate("system"),
    },
    {
      tone: "warning",
      icon: ClockIcon,
      title: "迟到待处理",
      detail: "栗子，原定 09:30，负责人林夏",
      action: () => onBooking(bookings[0]),
    },
  ];
  const stats = [
    [CalendarIcon, "18", "已确认", "较昨日 +3"],
    [HomeIcon, "8", "已到店", "较昨日 +2"],
    [CheckCircledIcon, "6", "已完成", "较昨日 +1"],
    [CrossCircledIcon, "1", "已取消", "较昨日 ±0"],
    [StopwatchIcon, "0", "已爽约", "较昨日 ±0"],
    [Cross2Icon, "0", "已终止", "较昨日 ±0"],
  ];
  return (
    <div className="workbench-page">
      <div className="page-meta">
        <span>2026年8月13日 周四 10:50，上海时间</span>
        <button className="text-button">
          <ReloadIcon />
          刷新
        </button>
      </div>
      <section className="workbench-summary">
        <div className="risk-panel panel">
          <header>
            <div>
              <h2>
                风险队列 <span>3</span>
              </h2>
              <StatusTag tone="danger">需优先处理</StatusTag>
            </div>
            <button className="text-button">
              查看全部 <ChevronRightIcon />
            </button>
          </header>
          <div className="risk-list">
            {risks.map(({ tone, icon: Icon, title, detail, action }) => (
              <button
                className={`risk-row ${tone}`}
                key={title}
                onClick={action}
              >
                <Icon />
                <span>
                  <strong>{title}</strong>
                  <small>{detail}</small>
                </span>
                <b>去处理</b>
                <ChevronRightIcon />
              </button>
            ))}
          </div>
        </div>
        <div className="stats-panel panel">
          <header>
            <h2>今日状态</h2>
            <InfoCircledIcon />
          </header>
          <div className="stats-grid">
            {stats.map(([Icon, value, label, compare]) => (
              <div className="stat" key={label}>
                <Icon />
                <strong>{value}</strong>
                <span>{label}</span>
                <small>{compare}</small>
              </div>
            ))}
          </div>
        </div>
      </section>
      <TodayTimeline onBooking={onBooking} />
    </div>
  );
}

function TodayTimeline({ onBooking }) {
  const timeline = {
    lin: [
      { left: 0, width: 12.3, booking: bookings[0], className: "late" },
      {
        left: 13.2,
        width: 13.2,
        booking: { ...bookings[2], staff: "林夏" },
        className: "confirmed",
      },
      { left: 27.2, width: 9.2, label: "休息 12:15–13:00", className: "break" },
      {
        left: 37.8,
        width: 13.7,
        label: "可预约 13:00–14:00",
        className: "available",
      },
      {
        left: 65.4,
        width: 17.4,
        label: "可预约 15:30–17:00",
        className: "available",
      },
    ],
    chen: [
      { left: 10.4, width: 16.6, booking: bookings[1], className: "arrived" },
      { left: 27.2, width: 9.2, label: "休息 12:00–12:45", className: "break" },
      {
        left: 37.8,
        width: 17.2,
        label: "可预约 12:45–14:15",
        className: "available",
      },
      {
        left: 62.2,
        width: 17.2,
        label: "可预约 16:00–17:30",
        className: "available",
      },
    ],
    zhou: [
      {
        left: 0,
        width: 12,
        label: "可预约 09:30–10:30",
        className: "available",
      },
      { left: 30, width: 10, label: "休息 12:30–13:15", className: "break" },
      { left: 40.5, width: 17.5, booking: bookings[3], className: "confirmed" },
      {
        left: 72.8,
        width: 17,
        label: "可预约 16:30–18:00",
        className: "available",
      },
    ],
    zhao: [
      {
        left: 0,
        width: 25,
        label: "可预约 09:30–12:00",
        className: "available",
      },
      {
        left: 39,
        width: 20.5,
        label: "可预约 13:00–15:00",
        className: "available",
      },
      {
        left: 65.5,
        width: 34.2,
        label: "可预约 15:30–19:00",
        className: "available",
      },
    ],
  };
  const timeLabels = [
    "09:30",
    "10:30",
    "11:30",
    "12:30",
    "13:30",
    "14:30",
    "15:30",
    "16:30",
    "17:30",
    "18:30",
    "19:00",
  ];
  return (
    <section className="timeline-panel panel">
      <header className="timeline-header">
        <div>
          <h2>今日排班与预约</h2>
          <span>09:30–19:00</span>
        </div>
        <div className="timeline-actions">
          <label>
            <input type="checkbox" />
            仅看未完成
          </label>
          <button className="control-button">
            15 分钟周转 <ChevronDownIcon />
          </button>
          <button className="control-button">
            <CalendarIcon />
            查看日历
          </button>
        </div>
      </header>
      <div className="time-ruler">
        <span />
        {timeLabels.map((time) => (
          <b key={time}>{time}</b>
        ))}
      </div>
      <div className="timeline-body">
        <i className="now-line">
          <span>10:50</span>
        </i>
        {staff.map((person) => (
          <div className="staff-lane" key={person.id}>
            <div className="staff-cell">
              <img src={person.avatar} alt={person.name} />
              <span>
                <strong>{person.name}</strong>
                <small>{person.shift}</small>
                <small>今日 {person.load}</small>
              </span>
            </div>
            <div className="lane-track">
              {timeline[person.id].map((block, index) => (
                <button
                  key={index}
                  style={{ left: `${block.left}%`, width: `${block.width}%` }}
                  className={`timeline-block ${block.className}`}
                  onClick={() => block.booking && onBooking(block.booking)}
                >
                  {block.booking ? (
                    <>
                      <img
                        src={block.booking.petImage}
                        alt=""
                        aria-hidden="true"
                      />
                      <strong>{block.booking.pet}</strong>
                      <small>{block.booking.time}</small>
                      <span>{block.booking.status}</span>
                    </>
                  ) : (
                    <>
                      <strong>{block.label.split(" ")[0]}</strong>
                      <small>
                        {block.label.slice(block.label.indexOf(" ") + 1)}
                      </small>
                    </>
                  )}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <footer className="calendar-legend">
        <span>
          <i className="legend confirmed" />
          预约
        </span>
        <span>
          <i className="legend available" />
          可预约
        </span>
        <span>
          <i className="legend break" />
          休息
        </span>
        <span>
          <i className="legend turnover" />
          15 分钟周转
        </span>
        <span>
          <i className="legend pending" />
          待处理容量变化
        </span>
      </footer>
    </section>
  );
}

function PageToolbar({ children, onCreate, createLabel }) {
  return (
    <div className="page-toolbar">
      <div>{children}</div>
      {onCreate && (
        <button className="primary-button" onClick={onCreate}>
          <PlusIcon />
          {createLabel}
        </button>
      )}
    </div>
  );
}

function Segmented({ value, onChange, options }) {
  return (
    <div className="segmented" role="tablist">
      {options.map(([key, label]) => (
        <button
          key={key}
          className={value === key ? "active" : ""}
          onClick={() => onChange(key)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function Appointments({ onBooking, onModal }) {
  const [view, setView] = useState("list");
  const [query, setQuery] = useState("");
  const filtered = bookings.filter((item) =>
    `${item.pet}${item.customer}${item.id}`.includes(query),
  );
  return (
    <div className="content-page">
      <PageToolbar onCreate={() => onModal("proxy")} createLabel="代客预约">
        <Segmented
          value={view}
          onChange={setView}
          options={[
            ["calendar", "按员工日历"],
            ["list", "预约列表"],
          ]}
        />
      </PageToolbar>
      <div className="filter-bar panel">
        <label className="search-field">
          <MagnifyingGlassIcon />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索顾客、宠物或预约号"
          />
        </label>
        <button className="control-button">
          <CalendarIcon />
          8月13日 周四
        </button>
        <button className="control-button">
          全部状态 <ChevronDownIcon />
        </button>
        <button className="control-button">
          全部员工 <ChevronDownIcon />
        </button>
        <button className="text-button">重置</button>
      </div>
      {view === "calendar" ? (
        <CompactCalendar onBooking={onBooking} />
      ) : (
        <section className="table-panel panel">
          <header>
            <div>
              <h2>8月13日的预约</h2>
              <span>共 5 笔，1 笔需立即处理</span>
            </div>
            <button className="text-button">
              <DownloadIcon />
              导出当前结果
            </button>
          </header>
          {filtered.length ? (
            <div className="data-table booking-table">
              <div className="table-head">
                <span>时间与状态</span>
                <span>宠物 / 顾客</span>
                <span>服务</span>
                <span>员工</span>
                <span>标价</span>
                <span>操作</span>
              </div>
              {filtered.map((booking) => (
                <button
                  className="table-row"
                  key={booking.id}
                  onClick={() => onBooking(booking)}
                >
                  <span>
                    <strong>{booking.time}</strong>
                    <StatusTag tone={booking.tone}>{booking.status}</StatusTag>
                    <small>{booking.action}</small>
                  </span>
                  <span className="pet-cell">
                    <img src={booking.petImage} alt={booking.pet} />
                    <span>
                      <strong>{booking.pet}</strong>
                      <small>
                        {booking.customer} · {booking.id}
                      </small>
                    </span>
                  </span>
                  <span>
                    <strong>{booking.service}</strong>
                    <small>{booking.extras}</small>
                  </span>
                  <span>{booking.staff}</span>
                  <span className="mono">{booking.price}</span>
                  <span className="row-action">
                    查看详情 <ChevronRightIcon />
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <EmptyState
              title="没有符合条件的预约"
              body="保留了当前筛选条件，你可以清空搜索或切换日期。"
            />
          )}
        </section>
      )}
    </div>
  );
}

function CompactCalendar({ onBooking }) {
  return (
    <section className="compact-calendar panel">
      <header>
        <div>
          <h2>按员工日历</h2>
          <span>服务区间与 15 分钟周转分别显示</span>
        </div>
        <button className="control-button">
          <ChevronLeftIcon />
          8月13日 周四
          <ChevronRightIcon />
        </button>
      </header>
      <div className="calendar-grid">
        {staff.map((person, index) => (
          <div className="calendar-column" key={person.id}>
            <div className="calendar-person">
              <img src={person.avatar} alt={person.name} />
              <strong>{person.name}</strong>
              <small>负载 {person.load}</small>
            </div>
            {bookings
              .filter((_, bookingIndex) => bookingIndex % 4 === index % 4)
              .map((booking) => (
                <button
                  key={booking.id}
                  className={`calendar-booking ${booking.tone}`}
                  onClick={() => onBooking(booking)}
                >
                  <strong>{booking.time}</strong>
                  <span>
                    {booking.pet} · {booking.service}
                  </span>
                  <small>
                    {booking.status} / {booking.action}
                  </small>
                  <i>周转 15 分钟</i>
                </button>
              ))}
          </div>
        ))}
      </div>
    </section>
  );
}

function Schedule({ onModal }) {
  const [tab, setTab] = useState("published");
  return (
    <div className="content-page">
      <PageToolbar
        onCreate={() => onModal("capacity")}
        createLabel="新建容量变化"
      >
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            ["template", "排班模板"],
            ["draft", "14 天草稿"],
            ["published", "已发布排班"],
          ]}
        />
      </PageToolbar>
      <div className="capacity-alert">
        <ExclamationTriangleIcon />
        <span>
          <strong>林夏的停班正在等待处理</strong>
          <small>
            周六 14:00–18:00 已停止接受新预约；2 笔已有预约需要逐笔处理。
          </small>
        </span>
        <button onClick={() => onModal("impact")}>
          处理受影响预约 <ChevronRightIcon />
        </button>
      </div>
      {tab === "template" && <TemplateSchedule />}
      {tab === "draft" && <DraftSchedule />}
      {tab === "published" && <PublishedSchedule onModal={onModal} />}
    </div>
  );
}

function TemplateSchedule() {
  return (
    <section className="panel schedule-surface">
      <header>
        <div>
          <h2>每周排班模板</h2>
          <span>模板不会直接产生可预约容量</span>
        </div>
        <button className="secondary-button">
          <Pencil2Icon />
          编辑模板
        </button>
      </header>
      <div className="week-grid">
        <div className="week-head">员工</div>
        {["周二", "周三", "周四", "周五", "周六", "周日", "周一"].map((d) => (
          <div className="week-head" key={d}>
            {d}
          </div>
        ))}
        {staff.map((person) => (
          <FragmentRow key={person.id} person={person} />
        ))}
      </div>
    </section>
  );
}

function FragmentRow({ person }) {
  return (
    <>
      <div className="week-person">
        <img src={person.avatar} alt={person.name} />
        <strong>{person.name}</strong>
      </div>
      {Array.from({ length: 7 }).map((_, index) => (
        <div
          className={`shift-cell ${index === 6 ? "closed" : ""}`}
          key={index}
        >
          {index === 6 ? (
            "闭店"
          ) : (
            <>
              <strong>{index === 2 ? "10:00–18:30" : "09:30–19:00"}</strong>
              <small>休息 12:30–13:15</small>
            </>
          )}
        </div>
      ))}
    </>
  );
}

function DraftSchedule() {
  return (
    <section className="panel split-layout">
      <div>
        <header>
          <div>
            <h2>8月14日–8月27日草稿</h2>
            <span>未发布 · 不产生顾客可约容量</span>
          </div>
          <StatusTag tone="warning">存在 3 处变化</StatusTag>
        </header>
        <div className="draft-days">
          {[
            "8/14 周五",
            "8/15 周六",
            "8/16 周日",
            "8/17 周一",
            "8/18 周二",
          ].map((day, index) => (
            <button key={day} className={index === 1 ? "selected" : ""}>
              <strong>{day}</strong>
              <span>{index === 3 ? "门店闭店" : "4 名员工 · 31.5h"}</span>
              {index === 1 && <StatusTag tone="warning">待复核</StatusTag>}
            </button>
          ))}
        </div>
      </div>
      <aside>
        <h3>发布前检查</h3>
        <dl>
          <div>
            <dt>覆盖日期</dt>
            <dd>14 天</dd>
          </div>
          <div>
            <dt>新增容量</dt>
            <dd>238.5h</dd>
          </div>
          <div>
            <dt>与预约冲突</dt>
            <dd className="danger-text">2 笔</dd>
          </div>
        </dl>
        <p>发布只会影响当前开放窗口内的新预约；已有预约不会自动移动。</p>
        <button className="primary-button">检查冲突并发布</button>
      </aside>
    </section>
  );
}

function PublishedSchedule({ onModal }) {
  const days = [
    "8/11 周二",
    "8/12 周三",
    "8/13 周四",
    "8/14 周五",
    "8/15 周六",
    "8/16 周日",
    "8/17 周一",
  ];
  return (
    <section className="panel schedule-surface">
      <header>
        <div>
          <h2>已发布排班</h2>
          <span>顾客可预约的具体日期容量</span>
        </div>
        <div className="header-actions">
          <button className="control-button">
            <ChevronLeftIcon />
            本周
            <ChevronRightIcon />
          </button>
          <button
            className="secondary-button"
            onClick={() => onModal("capacity")}
          >
            添加日期例外
          </button>
        </div>
      </header>
      <div className="load-grid">
        {days.map((day, index) => (
          <div
            className={`load-day ${index === 2 ? "today" : ""} ${index === 6 ? "closed" : ""}`}
            key={day}
          >
            <strong>{day}</strong>
            <span>
              {index === 6
                ? "闭店"
                : `${[72, 66, 68, 75, 82, 58][index] ?? 0}%`}
            </span>
            <div>
              <i
                style={{ width: `${[72, 66, 68, 75, 82, 58][index] ?? 0}%` }}
              />
            </div>
            <small>
              {index === 6
                ? "无容量"
                : `${[27, 25, 26, 28, 31, 22][index]} / 38h`}
            </small>
            {index === 4 && <StatusTag tone="danger">待处理停班</StatusTag>}
          </div>
        ))}
      </div>
      <div className="published-table">
        <div className="table-head">
          <span>员工</span>
          <span>周二 11</span>
          <span>周三 12</span>
          <span>今天 13</span>
          <span>周五 14</span>
          <span>周六 15</span>
          <span>周日 16</span>
        </div>
        {staff.map((person) => (
          <div className="table-row" key={person.id}>
            <span className="pet-cell">
              <img src={person.avatar} alt={person.name} />
              <strong>{person.name}</strong>
            </span>
            {Array.from({ length: 6 }).map((_, i) => (
              <span key={i}>
                <strong>
                  {i === 3 && person.id === "lin"
                    ? "14:00–待处理"
                    : person.shift}
                </strong>
                <small>
                  {i === 2
                    ? person.load
                    : `${Number(person.load[0]) - (i % 2)}/8`}{" "}
                  已约
                </small>
              </span>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

function Services({ notify }) {
  const [tab, setTab] = useState("catalog");
  const services = [
    ["犬基础洗护", "犬 · 小/中/大型", "¥128–228", "60–90 分钟", "在用"],
    ["猫咪洗护", "猫 · 小/中型", "¥168–218", "90 分钟", "在用"],
    ["犬造型美容", "犬 · 小/中/大型", "¥238–368", "120–180 分钟", "在用"],
    ["口腔清洁", "犬/猫 · 增项", "¥48", "+15 分钟", "在用"],
    ["除废毛护理", "犬/猫 · 增项", "¥68", "+30 分钟", "在用"],
  ];
  const skills = [
    "犬基础洗护",
    "猫咪洗护",
    "犬造型美容",
    "修甲护理",
    "口腔清洁",
    "除废毛护理",
  ];
  return (
    <div className="content-page">
      <PageToolbar
        onCreate={() =>
          notify(
            tab === "catalog" ? "已打开新建服务规格表单" : "已打开新建员工表单",
          )
        }
        createLabel={tab === "catalog" ? "新建服务" : "新增员工"}
      >
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            ["catalog", "服务与增项"],
            ["staff", "员工与技能"],
          ]}
        />
      </PageToolbar>
      {tab === "catalog" ? (
        <section className="table-panel panel">
          <header>
            <div>
              <h2>服务目录</h2>
              <span>保存变更仅影响新预约，已有预约保留快照</span>
            </div>
            <button className="control-button">
              全部类型 <ChevronDownIcon />
            </button>
          </header>
          <div className="data-table service-table">
            <div className="table-head">
              <span>名称</span>
              <span>适用范围</span>
              <span>价格</span>
              <span>时长</span>
              <span>状态</span>
              <span>操作</span>
            </div>
            {services.map((row) => (
              <button
                className="table-row"
                key={row[0]}
                onClick={() => notify(`已打开“${row[0]}”详情`)}
              >
                {row.slice(0, 4).map((value) => (
                  <span key={value}>
                    <strong>{value}</strong>
                  </span>
                ))}
                <span>
                  <StatusTag tone="sage">{row[4]}</StatusTag>
                </span>
                <span className="row-action">
                  编辑 <ChevronRightIcon />
                </span>
              </button>
            ))}
          </div>
        </section>
      ) : (
        <section className="panel skill-panel">
          <header>
            <div>
              <h2>员工技能矩阵</h2>
              <span>停用员工前会检查未来预约</span>
            </div>
            <button className="secondary-button">
              <Pencil2Icon />
              编辑技能
            </button>
          </header>
          <div className="skill-matrix">
            <div className="table-head">
              <span>员工</span>
              {skills.map((skill) => (
                <span key={skill}>{skill}</span>
              ))}
            </div>
            {staff.map((person, pi) => (
              <div className="table-row" key={person.id}>
                <span className="pet-cell">
                  <img src={person.avatar} alt={person.name} />
                  <span>
                    <strong>{person.name}</strong>
                    <small>{person.role}</small>
                  </span>
                </span>
                {skills.map((skill, si) => (
                  <span key={skill}>
                    {(pi + si) % 3 !== 1 ? (
                      <CheckCircledIcon className="skill-yes" />
                    ) : (
                      <span className="skill-no">—</span>
                    )}
                  </span>
                ))}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Customers({ onDrawer }) {
  const customers = [
    ["许岚", "138****2608", "团子 · 柴犬 · 8.4kg", "1 笔未来预约", "5 次"],
    ["程墨", "186****9471", "薄荷 · 英短 · 4.8kg", "1 笔进行中", "3 次"],
    ["陆遥", "139****5402", "栗子 · 金毛 · 28.6kg", "迟到待处理", "7 次"],
    ["宋瑶", "137****3188", "豆豆 · 布偶 · 5.2kg", "1 笔未来预约", "2 次"],
  ];
  return (
    <div className="content-page">
      <PageToolbar>
        <label className="search-field standalone">
          <MagnifyingGlassIcon />
          <input placeholder="搜索姓名、手机号或宠物" />
        </label>
      </PageToolbar>
      <section className="table-panel panel">
        <header>
          <div>
            <h2>顾客与宠物档案</h2>
            <span>共 286 位顾客 · 347 只在用宠物</span>
          </div>
          <button className="text-button">
            <DownloadIcon />
            导出当前结果
          </button>
        </header>
        <div className="data-table customer-table">
          <div className="table-head">
            <span>顾客</span>
            <span>手机号</span>
            <span>宠物</span>
            <span>当前预约</span>
            <span>历史完成</span>
            <span>操作</span>
          </div>
          {customers.map((row, index) => (
            <button
              className="table-row"
              key={row[0]}
              onClick={() => onDrawer({ type: "customer", index })}
            >
              <span className="customer-name">
                <AvatarIcon />
                <strong>{row[0]}</strong>
              </span>
              {row.slice(1).map((value) => (
                <span key={value}>
                  <strong>{value}</strong>
                </span>
              ))}
              <span className="row-action">
                查看档案 <ChevronRightIcon />
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

const metricsData = [
  { date: "7/15", utilization: 55, value: 462 },
  { date: "7/19", utilization: 62, value: 588 },
  { date: "7/23", utilization: 59, value: 524 },
  { date: "7/27", utilization: 71, value: 730 },
  { date: "7/31", utilization: 65, value: 684 },
  { date: "8/4", utilization: 73, value: 792 },
  { date: "8/8", utilization: 69, value: 718 },
  { date: "8/13", utilization: 68, value: 754 },
];

function Business({ notify }) {
  const [period, setPeriod] = useState("30");
  const metrics = [
    ["服务工时利用率", "68%", "较前期 +4.2%", "up"],
    ["已完成服务标价", "¥18,860", "较前期 +8.6%", "up"],
    ["取消率", "4.8%", "较前期 -0.7%", "good"],
    ["爽约率", "1.9%", "较前期 +0.2%", "warn"],
    ["服务终止", "3 · 0.8%", "较前期 -0.1%", "good"],
    ["90 天复访顾客", "42%", "较前期 +3.1%", "up"],
  ];
  return (
    <div className="content-page">
      <PageToolbar>
        <Segmented
          value={period}
          onChange={setPeriod}
          options={[
            ["7", "近 7 天"],
            ["30", "近 30 天"],
            ["90", "近 90 天"],
          ]}
        />
      </PageToolbar>
      <div className="metric-grid">
        {metrics.map(([label, value, trend, tone], index) => (
          <article className="metric-card panel" key={label}>
            <span>
              {label}
              <InfoCircledIcon />
            </span>
            <strong>{value}</strong>
            <small className={tone}>{trend}</small>
            {index === 1 && <p>标价合计，非实收金额</p>}
          </article>
        ))}
      </div>
      <section className="chart-grid">
        <article className="panel chart-card">
          <header>
            <div>
              <h2>服务工时利用率</h2>
              <span>已完成服务时长 ÷ 已发布可服务时长</span>
            </div>
            <button className="text-button">查看定义</button>
          </header>
          <div className="chart-wrap">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={metricsData}>
                <CartesianGrid
                  stroke="#e7e1d6"
                  strokeDasharray="3 3"
                  vertical={false}
                />
                <XAxis dataKey="date" tickLine={false} axisLine={false} />
                <YAxis
                  domain={[40, 80]}
                  tickLine={false}
                  axisLine={false}
                  unit="%"
                />
                <Tooltip />
                <Area
                  type="monotone"
                  dataKey="utilization"
                  stroke="#3f6253"
                  strokeWidth={2.5}
                  fill="#dfe9e2"
                  fillOpacity={0.72}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <footer>分子不含取消、爽约、终止与周转时间。</footer>
        </article>
        <article className="panel chart-card">
          <header>
            <div>
              <h2>每日已完成服务标价</h2>
              <span>用于观察服务结构，不代表收款</span>
            </div>
          </header>
          <div className="chart-wrap">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={metricsData}>
                <CartesianGrid
                  stroke="#e7e1d6"
                  strokeDasharray="3 3"
                  vertical={false}
                />
                <XAxis dataKey="date" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} />
                <Tooltip />
                <Bar dataKey="value" fill="#6f8f7e" radius={[5, 5, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <button
            className="secondary-button"
            onClick={() => notify("经营数据 CSV 已生成；导出动作已写入审计")}
          >
            <DownloadIcon />
            按当前筛选导出 CSV
          </button>
        </article>
      </section>
    </div>
  );
}

function System({ onDrawer, onModal, notify }) {
  const [tab, setTab] = useState("notifications");
  return (
    <div className="content-page">
      <PageToolbar>
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            ["notifications", "通知任务"],
            ["audit", "审计记录"],
            ["demo", "演示与重置"],
          ]}
        />
      </PageToolbar>
      {tab === "notifications" && (
        <NotificationTasks onDrawer={onDrawer} notify={notify} />
      )}
      {tab === "audit" && <AuditLog />}
      {tab === "demo" && <DemoSettings onModal={onModal} notify={notify} />}
    </div>
  );
}

function NotificationTasks({ onDrawer, notify }) {
  const rows = [
    ["预约改期通知", "许岚 / 团子", "RG-0813-034", "10:18", "需人工重试"],
    ["预约确认通知", "宋瑶 / 豆豆", "RG-0813-039", "09:42", "已发送"],
    ["开始前提醒", "程墨 / 薄荷", "RG-0813-031", "08:30", "已发送"],
    ["预约取消通知", "顾言 / 花花", "RG-0812-088", "昨天 18:14", "失败"],
  ];
  return (
    <section className="table-panel panel">
      <header>
        <div>
          <h2>模拟微信通知</h2>
          <span>通知失败不会撤销已经成立的预约</span>
        </div>
        <StatusTag tone="warning">1 项需人工处理</StatusTag>
      </header>
      <div className="data-table notification-table">
        <div className="table-head">
          <span>触发业务</span>
          <span>顾客 / 宠物</span>
          <span>预约</span>
          <span>最近尝试</span>
          <span>状态</span>
          <span>操作</span>
        </div>
        {rows.map((row) => (
          <div className="table-row" key={row[2] + row[0]}>
            {row.slice(0, 4).map((value) => (
              <span key={value}>
                <strong>{value}</strong>
              </span>
            ))}
            <span>
              <StatusTag
                tone={
                  row[4] === "已发送"
                    ? "sage"
                    : row[4] === "需人工重试"
                      ? "danger"
                      : "warning"
                }
              >
                {row[4]}
              </StatusTag>
            </span>
            <span>
              {row[4] === "需人工重试" ? (
                <button
                  className="inline-button"
                  onClick={() => notify("人工重试已加入队列，预约事实保持不变")}
                >
                  人工重试
                </button>
              ) : (
                <button
                  className="text-button"
                  onClick={() =>
                    onDrawer({ type: "notification", name: row[0] })
                  }
                >
                  查看记录
                </button>
              )}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function AuditLog() {
  const rows = [
    [
      "10:42:18",
      "林夏 · 员工",
      "预约 RG-0813-031",
      "正常核销",
      "已确认 → 已到店",
    ],
    ["10:32:04", "沈青 · 店长", "排班例外 EX-0815", "创建停班", "进入待处理"],
    ["10:18:55", "系统", "通知 NT-7392", "自动发送失败", "第 3 次失败"],
    ["09:54:21", "沈青 · 店长", "顾客 许岚", "揭示完整手机号", "敏感信息访问"],
  ];
  return (
    <section className="table-panel panel">
      <header>
        <div>
          <h2>审计记录</h2>
          <span>只读 · 记录操作者、时间、对象与变化</span>
        </div>
        <button className="control-button">
          全部操作 <ChevronDownIcon />
        </button>
      </header>
      <div className="data-table audit-table">
        <div className="table-head">
          <span>时间</span>
          <span>操作者</span>
          <span>对象</span>
          <span>动作</span>
          <span>结果</span>
        </div>
        {rows.map((row) => (
          <div className="table-row" key={row[0]}>
            {row.map((value) => (
              <span key={value}>
                <strong>{value}</strong>
              </span>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

function DemoSettings({ onModal, notify }) {
  return (
    <div className="settings-grid">
      <section className="panel settings-card">
        <header>
          <h2>本地演示边界</h2>
        </header>
        <ul className="boundary-list">
          <li>
            <PersonIcon />
            <span>
              <strong>模拟身份</strong>
              <small>店长与员工使用本地演示账号。</small>
            </span>
          </li>
          <li>
            <MobileIcon />
            <span>
              <strong>模拟微信消息</strong>
              <small>不会连接微信或发送真实通知。</small>
            </span>
          </li>
          <li>
            <FileTextIcon />
            <span>
              <strong>本地文件存储</strong>
              <small>数据只在当前演示环境中使用。</small>
            </span>
          </li>
          <li>
            <ClockIcon />
            <span>
              <strong>演示时间</strong>
              <small>当前 2026-08-13 10:50（上海时间）。</small>
            </span>
          </li>
        </ul>
      </section>
      <section className="panel settings-card">
        <header>
          <h2>推进演示时间</h2>
        </header>
        <p>推进时间会触发到期提醒、核销窗口和行动队列重新计算，并写入审计。</p>
        <div className="advance-actions">
          <button
            className="secondary-button"
            onClick={() => notify("演示时间已推进 15 分钟")}
          >
            +15 分钟
          </button>
          <button
            className="secondary-button"
            onClick={() => notify("演示时间已推进 1 小时")}
          >
            +1 小时
          </button>
        </div>
      </section>
      <section className="panel danger-zone">
        <header>
          <h2>重置演示数据</h2>
        </header>
        <p>将重建预约、排班、通知和审计样例，并使全部旧会话失效。</p>
        <button className="danger-button" onClick={() => onModal("reset")}>
          重置演示数据
        </button>
      </section>
    </div>
  );
}

function StaffToday({ onBooking, onModal }) {
  return (
    <div className="staff-page">
      <div className="staff-context">
        <div>
          <StatusTag tone="sage">员工 · 林夏</StatusTag>
          <span>8月13日 周四 · 班次 09:30–18:00</span>
        </div>
        <StatusTag tone="neutral">本地演示</StatusTag>
      </div>
      <section className="next-pet panel">
        <div className="next-label">
          <span>下一位宠物</span>
          <strong>10 分钟后开始</strong>
        </div>
        <div className="next-main">
          <img src={pets.tuanzi} alt="团子" />
          <div>
            <StatusTag tone="confirmed">已确认 · 待核销</StatusTag>
            <h2>团子</h2>
            <p>犬基础洗护 + 修甲护理</p>
            <div className="care-tags">
              <span>怕吹风</span>
              <span>耳部需轻柔</span>
            </div>
          </div>
          <div className="next-time">
            <strong>11:00</strong>
            <span>至 12:15</span>
          </div>
        </div>
        <button className="primary-button" onClick={() => onModal("checkin")}>
          输入核销码 <ChevronRightIcon />
        </button>
      </section>
      <section className="action-queue panel">
        <header>
          <div>
            <h2>行动队列</h2>
            <span>按紧迫度排序</span>
          </div>
          <StatusTag tone="warning">3 项</StatusTag>
        </header>
        <button className="staff-task late" onClick={() => onModal("late")}>
          <ExclamationTriangleIcon />
          <span>
            <strong>栗子 · 迟到待处理</strong>
            <small>原定 09:30 · 已超过 1 小时 20 分钟</small>
          </span>
          <ChevronRightIcon />
        </button>
        <button className="staff-task" onClick={() => onModal("checkin")}>
          <ClockIcon />
          <span>
            <strong>团子 · 待核销</strong>
            <small>核销窗口 10:30–11:15</small>
          </span>
          <ChevronRightIcon />
        </button>
        <button className="staff-task" onClick={() => onModal("complete")}>
          <CheckCircledIcon />
          <span>
            <strong>薄荷 · 待完成</strong>
            <small>10:30 已到店 · 服务进行中</small>
          </span>
          <ChevronRightIcon />
        </button>
      </section>
      <section className="staff-day panel">
        <header>
          <h2>今日时间线</h2>
          <button className="text-button">查看全部</button>
        </header>
        {bookings.slice(0, 4).map((booking) => (
          <button key={booking.id} onClick={() => onBooking(booking)}>
            <time>{booking.time.split("–")[0]}</time>
            <i className={booking.tone} />
            <span>
              <strong>
                {booking.pet} · {booking.service}
              </strong>
              <small>{booking.action}</small>
            </span>
            <StatusTag tone={booking.tone}>{booking.status}</StatusTag>
          </button>
        ))}
      </section>
    </div>
  );
}

function StaffAppointments({ onBooking }) {
  const [filter, setFilter] = useState("today");
  return (
    <div className="content-page staff-list-page">
      <PageToolbar>
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            ["today", "今天"],
            ["upcoming", "接下来"],
            ["history", "已结束"],
          ]}
        />
      </PageToolbar>
      <section className="panel staff-booking-list">
        {bookings.map((booking) => (
          <button key={booking.id} onClick={() => onBooking(booking)}>
            <time>
              <strong>{booking.time}</strong>
              <small>8月13日 周四</small>
            </time>
            <img src={booking.petImage} alt={booking.pet} />
            <span>
              <strong>{booking.pet}</strong>
              <small>
                {booking.service}{" "}
                {booking.extras !== "—" && `+ ${booking.extras}`}
              </small>
            </span>
            <StatusTag tone={booking.tone}>{booking.action}</StatusTag>
            <ChevronRightIcon />
          </button>
        ))}
      </section>
    </div>
  );
}

function Drawer({ data, onClose, onModal, notify, role }) {
  const booking = data.booking ?? bookings[2];
  return (
    <>
      <button className="overlay" aria-label="关闭详情" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true">
        <header>
          <div>
            <span className="eyebrow">
              {data.type === "booking"
                ? booking.id
                : data.type === "customer"
                  ? "顾客档案"
                  : "通知详情"}
            </span>
            <h2>
              {data.type === "booking"
                ? "预约详情"
                : data.type === "customer"
                  ? "许岚与团子"
                  : (data.name ?? "预约改期通知")}
            </h2>
          </div>
          <IconButton label="关闭" onClick={onClose}>
            <Cross2Icon />
          </IconButton>
        </header>
        {data.type === "booking" && (
          <BookingDetail
            booking={booking}
            role={role}
            onModal={onModal}
            notify={notify}
          />
        )}
        {data.type === "customer" && <CustomerDetail notify={notify} />}
        {data.type === "notification" && <NotificationDetail />}
      </aside>
    </>
  );
}

function BookingDetail({ booking, role, onModal, notify }) {
  return (
    <div className="drawer-content">
      <section className="booking-fact">
        <div>
          <StatusTag tone={booking.tone}>{booking.status}</StatusTag>
          {booking.action && (
            <span className="action-reminder">
              <ClockIcon />
              {booking.action}
            </span>
          )}
        </div>
        <strong>{booking.time}</strong>
        <span>8月13日 周四 · {booking.staff}</span>
      </section>
      <section className="pet-profile">
        <img src={booking.petImage} alt={booking.pet} />
        <div>
          <h3>{booking.pet}</h3>
          <p>
            {booking.pet === "薄荷"
              ? "英短 · 4.8kg · 小型"
              : booking.pet === "栗子"
                ? "金毛 · 28.6kg · 大型"
                : "柴犬 · 8.4kg · 小型"}
          </p>
          <div className="care-tags">
            <span>
              {booking.pet === "薄荷"
                ? "对陌生犬敏感"
                : booking.pet === "栗子"
                  ? "耳部需轻柔"
                  : "怕吹风"}
            </span>
          </div>
        </div>
      </section>
      <section className="detail-section emphasis">
        <h3>护理注意事项</h3>
        <p>
          {booking.pet === "团子"
            ? "吹风时从低档开始，避免从头部直吹；修甲前先让团子熟悉工具。"
            : "接触前先呼唤宠物名字，操作过程保持轻柔。"}
        </p>
      </section>
      <section className="detail-section">
        <h3>顾客</h3>
        <dl>
          <div>
            <dt>姓名</dt>
            <dd>{booking.customer}</dd>
          </div>
          <div>
            <dt>手机号</dt>
            <dd>
              138****2608{" "}
              <button className="text-button" onClick={() => onModal("reveal")}>
                揭示完整号码
              </button>
            </dd>
          </div>
        </dl>
      </section>
      <section className="detail-section">
        <h3>本次服务</h3>
        <dl>
          <div>
            <dt>主要服务</dt>
            <dd>{booking.service}</dd>
          </div>
          <div>
            <dt>增项</dt>
            <dd>{booking.extras}</dd>
          </div>
          <div>
            <dt>计划时长</dt>
            <dd>75 分钟</dd>
          </div>
          <div>
            <dt>标价</dt>
            <dd>{booking.price}</dd>
          </div>
        </dl>
      </section>
      <section className="history-list">
        <h3>门店服务记录</h3>
        <article>
          <span>2026-06-18 · 林夏</span>
          <strong>犬基础洗护 · 已完成</strong>
          <p>换毛期，背部除废毛时间较长；吹风时情绪稳定。</p>
          <button className="text-button" onClick={() => onModal("correction")}>
            追加更正说明
          </button>
        </article>
      </section>
      {role === "manager" ? (
        <div className="drawer-actions">
          <button
            className="secondary-button"
            onClick={() => onModal("correction")}
          >
            纠正预约内容
          </button>
          <button
            className="primary-button"
            onClick={() => onModal("reschedule")}
          >
            店长改期
          </button>
        </div>
      ) : (
        <div className="drawer-actions stacked">
          <button
            className="primary-button"
            onClick={() =>
              onModal(
                booking.action === "待完成"
                  ? "complete"
                  : booking.action === "迟到待处理"
                    ? "late"
                    : "checkin",
              )
            }
          >
            {booking.action === "待完成"
              ? "完成服务并保存记录"
              : booking.action === "迟到待处理"
                ? "处理迟到"
                : "输入核销码"}
          </button>
          <button className="danger-link" onClick={() => onModal("terminate")}>
            服务终止
          </button>
        </div>
      )}
    </div>
  );
}

function CustomerDetail({ notify }) {
  return (
    <div className="drawer-content">
      <section className="customer-hero">
        <div className="avatar-large">许</div>
        <div>
          <h3>许岚</h3>
          <p>138****2608 · 隐私同意 v1.2</p>
        </div>
        <button
          className="text-button"
          onClick={() => notify("完整手机号访问确认已打开")}
        >
          揭示号码
        </button>
      </section>
      <section className="detail-section">
        <h3>宠物档案</h3>
        <div className="pet-profile">
          <img src={pets.tuanzi} alt="团子" />
          <div>
            <h3>团子</h3>
            <p>柴犬 · 8.4kg · 小型</p>
            <div className="care-tags">
              <span>怕吹风</span>
            </div>
          </div>
        </div>
      </section>
      <section className="detail-section">
        <h3>未来预约</h3>
        <p>8月13日 11:00–12:15 · 赵航 · 已确认</p>
      </section>
      <section className="detail-section">
        <h3>历史门店服务记录</h3>
        <p>共 5 次完成服务，最近一次为 6月18日。</p>
      </section>
    </div>
  );
}

function NotificationDetail() {
  return (
    <div className="drawer-content">
      <div className="notification-summary">
        <StatusTag tone="danger">需人工重试</StatusTag>
        <h3>预约改期通知</h3>
        <p>通知失败不会撤销已经成立的新安排。</p>
      </div>
      <ol className="attempt-list">
        <li>
          <span>第 1 次</span>
          <strong>10:14:02 · 发送失败</strong>
          <small>模拟通道超时</small>
        </li>
        <li>
          <span>第 2 次</span>
          <strong>10:16:07 · 发送失败</strong>
          <small>模拟通道超时</small>
        </li>
        <li>
          <span>第 3 次</span>
          <strong>10:18:55 · 发送失败</strong>
          <small>进入人工重试</small>
        </li>
      </ol>
    </div>
  );
}

function ModalFlow({ type, onClose, notify }) {
  const components = {
    checkin: <CheckinForm onClose={onClose} notify={notify} />,
    late: <LateForm onClose={onClose} notify={notify} />,
    complete: <CompleteForm onClose={onClose} notify={notify} />,
    terminate: <TerminateForm onClose={onClose} notify={notify} />,
    reveal: <RevealForm onClose={onClose} notify={notify} />,
    correction: <CorrectionForm onClose={onClose} notify={notify} />,
    reschedule: <RescheduleForm onClose={onClose} notify={notify} />,
    proxy: <ProxyBooking onClose={onClose} notify={notify} />,
    capacity: <CapacityChange onClose={onClose} notify={notify} />,
    impact: <ImpactFlow onClose={onClose} notify={notify} />,
    reset: <ResetForm onClose={onClose} notify={notify} />,
  };
  return (
    <>
      <button
        className="overlay modal-overlay"
        aria-label="关闭弹窗"
        onClick={onClose}
      />
      <div
        className={`modal ${["impact", "proxy"].includes(type) ? "modal-wide" : ""}`}
        role="dialog"
        aria-modal="true"
      >
        {components[type] ?? null}
      </div>
    </>
  );
}

function ModalHeader({ eyebrow, title, body, onClose }) {
  return (
    <header className="modal-header">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h2>{title}</h2>
        {body && <p>{body}</p>}
      </div>
      <IconButton label="关闭" onClick={onClose}>
        <Cross2Icon />
      </IconButton>
    </header>
  );
}

function Field({ label, required, hint, children }) {
  return (
    <label className="field">
      <span>
        {label}
        {required && <b> *</b>}
      </span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

function CheckinForm({ onClose, notify }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const submit = () =>
    code === "482731"
      ? notify("团子已于 10:50 核销，状态更新为已到店")
      : setError("核销码不正确，请与顾客确认六位数字");
  return (
    <>
      <ModalHeader
        eyebrow="团子 · 11:00–12:15"
        title="到店核销"
        body="有效窗口 10:30–11:15，支持整串粘贴。"
        onClose={onClose}
      />
      <div className="modal-body">
        <Field label="六位核销码" required hint="演示正确码：482731">
          <input
            className={`code-input ${error ? "invalid" : ""}`}
            inputMode="numeric"
            maxLength={6}
            value={code}
            onChange={(e) => {
              setCode(e.target.value.replace(/\D/g, ""));
              setError("");
            }}
            placeholder="000000"
          />
        </Field>
        {error && (
          <div className="field-error">
            <ExclamationTriangleIcon />
            {error}
          </div>
        )}
        <div className="pet-mini">
          <img src={pets.tuanzi} alt="团子" />
          <span>
            <strong>团子</strong>
            <small>犬基础洗护 + 修甲护理</small>
          </span>
        </div>
      </div>
      <footer className="modal-actions">
        <button className="secondary-button" onClick={onClose}>
          返回预约
        </button>
        <button
          className="primary-button"
          disabled={code.length !== 6}
          onClick={submit}
        >
          确认到店
        </button>
      </footer>
    </>
  );
}

function LateForm({ onClose, notify }) {
  const [reason, setReason] = useState("");
  return (
    <>
      <ModalHeader
        eyebrow="栗子 · 原定 09:30"
        title="迟到待处理"
        body="已超过正常核销窗口 1 小时 20 分钟。"
        onClose={onClose}
      />
      <div className="modal-body">
        <div className="choice-cards">
          <button className="selected">
            <HomeIcon />
            <span>
              <strong>手动核销</strong>
              <small>顾客已经到店，填写原因后继续服务。</small>
            </span>
          </button>
          <button className="danger-choice">
            <CrossCircledIcon />
            <span>
              <strong>标记爽约</strong>
              <small>释放后续容量，不会自动处罚顾客。</small>
            </span>
          </button>
        </div>
        <Field label="处理原因" required>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="例如：顾客提前电话说明路上拥堵，10:48 到店"
          />
        </Field>
      </div>
      <footer className="modal-actions">
        <button className="secondary-button" onClick={onClose}>
          稍后处理
        </button>
        <button
          className="primary-button"
          disabled={!reason.trim()}
          onClick={() => notify("已手动核销栗子，原因和实际到店时间已记录")}
        >
          手动核销
        </button>
      </footer>
    </>
  );
}

function CompleteForm({ onClose, notify }) {
  return (
    <>
      <ModalHeader
        eyebrow="薄荷 · 猫咪洗护"
        title="完成服务"
        body="结构化记录将保存到宠物的门店服务历史。"
        onClose={onClose}
      />
      <div className="modal-body">
        <div className="summary-box">
          <CheckCircledIcon />
          <span>
            <strong>服务摘要已生成</strong>
            <small>10:30 到店 · 12:00 实际结束 · 陈嘉</small>
          </span>
        </div>
        <Field label="本次护理标签">
          <div className="chip-select">
            <button className="selected">情绪稳定</button>
            <button>需要慢速吹风</button>
            <button>换毛期</button>
          </div>
        </Field>
        <Field label="内部文字记录">
          <textarea defaultValue="洗护过程配合良好，耳后轻微打结已梳开。建议 6–8 周后再次护理。" />
        </Field>
      </div>
      <footer className="modal-actions">
        <button className="secondary-button" onClick={onClose}>
          暂不完成
        </button>
        <button
          className="primary-button"
          onClick={() => notify("服务已完成，门店服务记录已保存")}
        >
          完成服务并保存记录
        </button>
      </footer>
    </>
  );
}

function TerminateForm({ onClose, notify }) {
  const [reason, setReason] = useState("");
  return (
    <>
      <ModalHeader
        eyebrow="异常履约"
        title="服务终止"
        body="服务终止与已完成、已取消不同，原因会保留在历史中。"
        onClose={onClose}
      />
      <div className="modal-body">
        <div className="danger-callout">
          <ExclamationTriangleIcon />
          <p>确认后预约进入“已终止”，记录实际结束时间并释放后续容量。</p>
        </div>
        <Field label="终止原因" required>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="说明无法继续服务的具体原因"
          />
        </Field>
      </div>
      <footer className="modal-actions">
        <button className="secondary-button" onClick={onClose}>
          返回
        </button>
        <button
          className="danger-button"
          disabled={!reason.trim()}
          onClick={() => notify("服务已终止，原因与实际结束时间已记录")}
        >
          确认服务终止
        </button>
      </footer>
    </>
  );
}

function RevealForm({ onClose, notify }) {
  return (
    <>
      <ModalHeader
        eyebrow="敏感信息访问"
        title="揭示完整手机号"
        body="此次访问会记录在审计中。"
        onClose={onClose}
      />
      <div className="modal-body">
        <div className="audit-callout">
          <LockClosedIcon />
          <p>仅在联系顾客处理当前预约时使用完整号码，不要复制到外部工具。</p>
        </div>
        <p className="masked-phone">138 **** 2608</p>
      </div>
      <footer className="modal-actions">
        <button className="secondary-button" onClick={onClose}>
          取消
        </button>
        <button
          className="primary-button"
          onClick={() => notify("完整号码已揭示 138 0164 2608，访问已写入审计")}
        >
          确认并揭示
        </button>
      </footer>
    </>
  );
}

function CorrectionForm({ onClose, notify }) {
  return (
    <>
      <ModalHeader
        eyebrow="追加式更正"
        title="纠正预约内容"
        body="原记录保持只读，新说明会带作者与时间。"
        onClose={onClose}
      />
      <div className="modal-body">
        <div className="comparison">
          <div>
            <span>当前</span>
            <strong>8.4kg · 小型</strong>
            <small>犬基础洗护 + 修甲 · ¥158 · 75 分钟</small>
          </div>
          <ChevronRightIcon />
          <div>
            <span>更正后</span>
            <strong>9.1kg · 小型</strong>
            <small>规格不变 · ¥158 · 75 分钟</small>
          </div>
        </div>
        <Field label="更正说明" required>
          <textarea placeholder="说明为什么需要更正，以及依据是什么" />
        </Field>
        <div className="summary-box">
          <CheckCircledIcon />
          <span>
            <strong>技能与容量校验通过</strong>
            <small>赵航仍覆盖全部技能，原预约时间无需变化。</small>
          </span>
        </div>
      </div>
      <footer className="modal-actions">
        <button className="secondary-button" onClick={onClose}>
          返回详情
        </button>
        <button
          className="primary-button"
          onClick={() => notify("更正说明已追加，原记录保持不变")}
        >
          保存更正说明
        </button>
      </footer>
    </>
  );
}

function RescheduleForm({ onClose, notify }) {
  const [slot, setSlot] = useState("15:30");
  return (
    <>
      <ModalHeader
        eyebrow="店长改期"
        title="为团子安排新时间"
        body="新安排失败时，原安排保持不变。"
        onClose={onClose}
      />
      <div className="modal-body">
        <div className="original-plan">
          <span>原安排</span>
          <strong>8月13日 周四 11:00–12:15</strong>
          <small>赵航 · ¥158 · 75 分钟</small>
        </div>
        <Field label="相近可用建议">
          <div className="slot-list">
            {[
              ["15:30", "今天 15:30–16:45 · 赵航"],
              ["10:00", "明天 10:00–11:15 · 林夏"],
              ["13:30", "明天 13:30–14:45 · 赵航"],
            ].map(([key, label]) => (
              <button
                className={slot === key ? "selected" : ""}
                onClick={() => setSlot(key)}
                key={key}
              >
                <ClockIcon />
                <span>
                  <strong>{label}</strong>
                  <small>价格与时长不变</small>
                </span>
                <CheckCircledIcon />
              </button>
            ))}
          </div>
        </Field>
        <Field label="改期原因" required>
          <textarea defaultValue="顾客电话联系，希望调整到稍晚时段。" />
        </Field>
      </div>
      <footer className="modal-actions">
        <button className="secondary-button" onClick={onClose}>
          保留原安排
        </button>
        <button
          className="primary-button"
          onClick={() => notify("改期成功，新核销码已生成；原安排已原子替换")}
        >
          确认新安排
        </button>
      </footer>
    </>
  );
}

function ProxyBooking({ onClose, notify }) {
  const [step, setStep] = useState(1);
  return (
    <>
      <ModalHeader
        eyebrow={`代客预约 · ${step}/3`}
        title={
          step === 1 ? "顾客与宠物" : step === 2 ? "服务与时间" : "确认预约"
        }
        body="线下隐私同意来源会随预约一并记录。"
        onClose={onClose}
      />
      <div className="modal-body proxy-grid">
        {step === 1 && (
          <>
            <Field label="顾客手机号" required>
              <input defaultValue="138 0164 2608" />
            </Field>
            <Field label="顾客姓名" required>
              <input defaultValue="许岚" />
            </Field>
            <div className="selected-customer">
              <img src={pets.tuanzi} alt="团子" />
              <span>
                <strong>已找到：许岚 · 团子</strong>
                <small>柴犬 · 8.4kg · 小型</small>
              </span>
              <CheckCircledIcon />
            </div>
            <Field label="隐私同意来源" required>
              <select defaultValue="counter">
                <option value="counter">线下到店书面同意</option>
                <option>电话口头同意</option>
              </select>
            </Field>
          </>
        )}
        {step === 2 && (
          <>
            <Field label="主要服务">
              <select>
                <option>犬基础洗护 · 小型 · ¥128 · 60 分钟</option>
              </select>
            </Field>
            <Field label="增项">
              <div className="chip-select">
                <button className="selected">修甲护理 +¥30 · 15分钟</button>
                <button>口腔清洁 +¥48</button>
              </div>
            </Field>
            <Field label="日期与时段">
              <div className="slot-list">
                <button className="selected">
                  <ClockIcon />
                  <span>
                    <strong>8月14日 10:00–11:15</strong>
                    <small>林夏 · 技能与容量匹配</small>
                  </span>
                  <CheckCircledIcon />
                </button>
                <button>
                  <ClockIcon />
                  <span>
                    <strong>8月14日 13:30–14:45</strong>
                    <small>赵航 · 技能与容量匹配</small>
                  </span>
                </button>
              </div>
            </Field>
          </>
        )}
        {step === 3 && (
          <div className="confirm-sheet">
            <div className="pet-profile">
              <img src={pets.tuanzi} alt="团子" />
              <div>
                <h3>团子</h3>
                <p>许岚 · 138****2608</p>
              </div>
            </div>
            <dl>
              <div>
                <dt>服务</dt>
                <dd>犬基础洗护 + 修甲护理</dd>
              </div>
              <div>
                <dt>时间</dt>
                <dd>8月14日 10:00–11:15</dd>
              </div>
              <div>
                <dt>员工</dt>
                <dd>林夏</dd>
              </div>
              <div>
                <dt>标价</dt>
                <dd>¥158</dd>
              </div>
              <div>
                <dt>隐私来源</dt>
                <dd>线下到店书面同意</dd>
              </div>
            </dl>
          </div>
        )}
      </div>
      <footer className="modal-actions">
        <button
          className="secondary-button"
          onClick={() => (step === 1 ? onClose() : setStep(step - 1))}
        >
          {step === 1 ? "取消" : "上一步"}
        </button>
        <button
          className="primary-button"
          onClick={() =>
            step === 3
              ? notify("代客预约已确认，具体员工与核销码已生成")
              : setStep(step + 1)
          }
        >
          {step === 3 ? "确认代客预约" : "继续"}
        </button>
      </footer>
    </>
  );
}

function CapacityChange({ onClose, notify }) {
  return (
    <>
      <ModalHeader
        eyebrow="排班容量变化"
        title="创建停班或临时闭店"
        body="确认后受影响区间会立即停止接受新预约。"
        onClose={onClose}
      />
      <div className="modal-body">
        <Field label="变化类型">
          <div className="chip-select">
            <button className="selected">员工停班</button>
            <button>临时闭店</button>
          </div>
        </Field>
        <div className="form-grid">
          <Field label="员工" required>
            <select>
              <option>林夏</option>
            </select>
          </Field>
          <Field label="日期" required>
            <input value="2026-08-15" readOnly />
          </Field>
          <Field label="开始时间" required>
            <input value="14:00" readOnly />
          </Field>
          <Field label="结束时间" required>
            <input value="18:00" readOnly />
          </Field>
        </div>
        <div className="impact-preview">
          <ExclamationTriangleIcon />
          <span>
            <strong>影响预览：2 笔已有预约</strong>
            <small>确认后进入“待处理”，全部预约处理完成前不会正式生效。</small>
          </span>
        </div>
      </div>
      <footer className="modal-actions">
        <button className="secondary-button" onClick={onClose}>
          取消
        </button>
        <button
          className="primary-button"
          onClick={() =>
            notify("容量变化已进入待处理，影响区间已停止接受新预约")
          }
        >
          确认并进入影响处理
        </button>
      </footer>
    </>
  );
}

function ImpactFlow({ onClose, notify }) {
  const [done, setDone] = useState([false, false]);
  const complete = (index) =>
    setDone(done.map((value, i) => (i === index ? true : value)));
  return (
    <>
      <ModalHeader
        eyebrow="待处理容量变化 · EX-0815-02"
        title="处理受影响预约"
        body="林夏 · 8月15日 周六 14:00–18:00 停班"
        onClose={onClose}
      />
      <div className="modal-body impact-body">
        <div className="impact-progress">
          <div>
            <strong>{done.filter(Boolean).length} / 2 已处理</strong>
            <span>全部完成后停班才正式生效</span>
          </div>
          <div>
            <i style={{ width: `${done.filter(Boolean).length * 50}%` }} />
          </div>
          <button className="text-button">撤销待处理停班</button>
        </div>
        {[
          ["豆豆", "宋瑶", "猫咪洗护", "14:00–15:30", "陈嘉可同时间接手"],
          ["花花", "顾言", "犬造型美容", "15:30–17:00", "建议改至 16日 10:00"],
        ].map((row, index) => (
          <article
            className={`impact-booking ${done[index] ? "done" : ""}`}
            key={row[0]}
          >
            <img src={index ? pets.tuanzi : pets.bohe} alt={row[0]} />
            <div>
              <StatusTag tone={done[index] ? "sage" : "warning"}>
                {done[index] ? "已处理" : `待处理 ${index + 1}`}
              </StatusTag>
              <h3>
                {row[0]} · {row[2]}
              </h3>
              <p>
                {row[1]} · 原员工林夏 · {row[3]}
              </p>
            </div>
            <div className="impact-options">
              <button className="selected">
                <PersonIcon />
                <span>
                  <strong>{index ? "改期" : "同时间换员工"}</strong>
                  <small>{row[4]}</small>
                </span>
                <CheckCircledIcon />
              </button>
              <button>
                <CalendarIcon />
                <span>
                  <strong>改期</strong>
                  <small>查看相近可用建议</small>
                </span>
              </button>
              <button className="danger-choice">
                <CrossCircledIcon />
                <span>
                  <strong>取消</strong>
                  <small>需要原因并预览通知</small>
                </span>
              </button>
            </div>
            <button
              className="primary-button"
              disabled={done[index]}
              onClick={() => complete(index)}
            >
              {done[index] ? "已保存" : "保存本笔处理结果"}
            </button>
          </article>
        ))}
      </div>
      <footer className="modal-actions">
        <button className="secondary-button" onClick={onClose}>
          稍后处理
        </button>
        <button
          className="primary-button"
          disabled={!done.every(Boolean)}
          onClick={() => notify("2 笔预约已全部处理，停班正式生效")}
        >
          完成影响处理
        </button>
      </footer>
    </>
  );
}

function ResetForm({ onClose, notify }) {
  const [step, setStep] = useState(1);
  const [text, setText] = useState("");
  return (
    <>
      <ModalHeader
        eyebrow={`危险操作 · ${step}/2`}
        title="重置演示数据"
        body={
          step === 1
            ? "这不是普通保存，重置后无法恢复当前演示状态。"
            : "输入指定文字完成最终确认。"
        }
        onClose={onClose}
      />
      <div className="modal-body">
        {step === 1 ? (
          <div className="danger-callout reset-list">
            <ExclamationTriangleIcon />
            <div>
              <strong>将重建以下数据</strong>
              <ul>
                <li>预约、排班与门店服务记录</li>
                <li>通知任务与审计样例</li>
                <li>全部演示身份会话</li>
              </ul>
            </div>
          </div>
        ) : (
          <Field label="请输入：重置茸光演示数据" required>
            <input value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
        )}
      </div>
      <footer className="modal-actions">
        <button
          className="secondary-button"
          onClick={() => (step === 1 ? onClose() : setStep(1))}
        >
          返回
        </button>
        <button
          className="danger-button"
          disabled={step === 2 && text !== "重置茸光演示数据"}
          onClick={() =>
            step === 1 ? setStep(2) : notify("演示数据已重建，旧会话已失效")
          }
        >
          {step === 1 ? "继续确认" : "确认重置演示数据"}
        </button>
      </footer>
    </>
  );
}
